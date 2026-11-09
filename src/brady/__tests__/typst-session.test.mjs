// Run with node --experimental-vm-modules --test src\brady\__tests__\typst-session.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const turn = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function load(file, globals, imports) {
  const context = vm.createContext({
    console, Uint8Array, Response, Blob, URL, DOMException, AbortController,
    setTimeout, clearTimeout, ...globals,
  })
  function dependency(name) {
    const exports = imports[name]
    assert.ok(exports, `Unexpected import: ${name}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  }
  const module = new vm.SourceTextModule(ts.transpileModule(
    await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText, {
    context,
    initializeImportMeta(meta) {
      meta.url = new URL(`../${file}`, import.meta.url).href
      meta.env = { BASE_URL: '/' }
    },
    async importModuleDynamically(name) {
      const imported = dependency(name)
      await imported.link(() => {})
      await imported.evaluate()
      return imported
    },
  })
  await module.link(dependency)
  await module.evaluate()
  return { api: module.namespace, context }
}

async function documentsHarness(options = {}) {
  const workers = []
  const renders = []
  const canvases = []
  let destroyed = 0
  let cancelled = 0
  class Worker {
    constructor(url) {
      this.url = String(url)
      this.messages = []
      this.terminated = false
      workers.push(this)
    }
    postMessage(message) { this.messages.push(message) }
    terminate() { this.terminated = true }
    emit(message) { this.onmessage?.({ data: message }) }
  }
  const pdfPage = {
    getViewport: ({ scale }) => ({ width: 72 * scale, height: 36 * scale }),
    render(config) {
      renders.push(config)
      return {
        promise: options.renderGate?.promise ?? Promise.resolve(),
        cancel() { cancelled++; options.renderGate?.resolve() },
      }
    },
    cleanup() {},
  }
  const { api } = await load('documents.ts', {
    Worker,
    ...(options.timers ?? {}),
    location: { origin: 'https://labels.test' },
    document: {
      createElement() {
        const canvas = {
          width: 0, height: 0, getContext: () => ({}),
          toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })),
        }
        canvases.push(canvas)
        return canvas
      },
    },
  }, {
    './asset-cache': {
      cachedAsset: options.cachedAsset ?? (async () => new Response('worker')),
      clearDocumentCache() {},
    },
    './document-settings': {
      MAX_PAGES: 30,
      validatePpi(ppi) { if (ppi < 72) throw new Error('Invalid PPI') },
      pagePixels: (w, h, ppi) => ({ width: w * ppi / 72, height: h * ppi / 72 }),
    },
    'pdfjs-dist': {
      PDFWorker: { create: () => ({ destroy() {} }) },
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 1, getPage: async () => pdfPage }),
        destroy: async () => { destroyed++ },
      }),
    },
  })
  return { ...api, workers, renders, canvases, destroyed: () => destroyed, cancelled: () => cancelled }
}

test('session retains worker and sends assets only once; successful PDF rendering uses print intent', async () => {
  const h = await documentsHarness()
  const session = new h.TypstSession()
  try {
    const files = [{ path: 'image.png', data: new Uint8Array([1, 2]) }]
    const fonts = [new Uint8Array([3])]
    for (let id = 1; id <= 2; id++) {
      const result = session.render(`source ${id}`, 203, files, fonts, () => {})
      const worker = h.workers[0]
      assert.equal(worker.messages.at(-1).id, id)
      assert.equal('files' in worker.messages.at(-1), id === 1)
      worker.emit({ type: 'result', id, pdf: new Uint8Array([1]), diagnostics: ['warning'] })
      const rendered = await result
      assert.equal(rendered.pages.length, 1)
      assert.equal(rendered.diagnostics[0], 'warning')
      assert.equal(worker.terminated, false)
    }
    assert.equal(h.workers.filter(worker => worker.url.includes('typst.worker')).length, 1)
    assert.ok(h.renders.every(render => render.intent === 'print'))
    assert.ok(h.canvases.every(canvas => canvas.width === 0 && canvas.height === 0))
  } finally { session.dispose() }
  assert.equal(h.workers[0].terminated, true)
})

test('superseding and external abort reject promptly, ignore stale IDs, and retain compiler', async () => {
  const h = await documentsHarness()
  const session = new h.TypstSession()
  try {
    const first = session.render('one', 203, [], [], () => {})
    const rejected = assert.rejects(first, { name: 'AbortError' })
    const abort = new AbortController()
    const messages = []
    const second = session.render('two', 203, [], [], text => messages.push(text), 30, abort.signal)
    await rejected
    const worker = h.workers[0]
    worker.emit({ type: 'error', id: 1, message: 'stale failure' })
    worker.emit({ type: 'progress', id: 1, message: 'stale progress' })
    worker.emit({ type: 'progress', id: 2, message: 'current progress' })
    assert.deepEqual(messages, ['current progress'])
    const aborted = assert.rejects(second, { name: 'AbortError' })
    abort.abort()
    await aborted
    assert.equal(worker.terminated, false)
    const third = session.render('three', 203, [], [], () => {})
    worker.emit({ type: 'error', id: 2, message: 'stale failure' })
    const errored = assert.rejects(third, /current syntax error/)
    worker.emit({ type: 'error', id: 3, message: 'current syntax error' })
    await errored
    assert.equal(h.workers.length, 1)
  } finally { session.dispose() }
})

test('byte changes in files/fonts reset worker, even with in-place mutation; disposal is final', async () => {
  const h = await documentsHarness()
  const session = new h.TypstSession()
  const file = { path: 'support.typ', data: new Uint8Array([1]) }
  const font = new Uint8Array([1])
  let previous
  for (let id = 1; id <= 3; id++) {
    const result = session.render('source', 203, [file], [font], () => {})
    const rejected = assert.rejects(result, /syntax/)
    const worker = h.workers.at(-1)
    if (previous) assert.equal(previous.terminated, true)
    worker.emit({ type: 'error', id, message: 'syntax' })
    await rejected
    previous = worker
    if (id === 1) file.data[0]++
    else font[0]++
  }
  const result = session.render('source', 203, [file], [font], () => {})
  const rejected = assert.rejects(result, { name: 'AbortError' })
  session.dispose()
  session.dispose()
  await rejected
  await assert.rejects(session.render('source', 203, [], [], () => {}), /disposed/)
})

test('rasterization abort cancels the render, cleans canvas, and leaves Typst worker alive', async () => {
  const gate = deferred()
  const h = await documentsHarness({ renderGate: gate })
  const session = new h.TypstSession()
  const abort = new AbortController()
  try {
    const result = session.render('source', 203, [], [], () => {}, 30, abort.signal)
    const rejected = assert.rejects(result, { name: 'AbortError' })
    h.workers[0].emit({ type: 'result', id: 1, pdf: new Uint8Array([1]), diagnostics: [] })
    while (!h.renders.length) await turn()
    abort.abort()
    await rejected
    assert.equal(h.cancelled(), 1)
    assert.equal(h.workers[0].terminated, false)
    assert.ok(h.destroyed() >= 1)
    assert.equal(h.canvases[0].width, 0)
  } finally { session.dispose() }
})

test('worker crashes and timeout are explicit errors and allow the next render to restart', async () => {
  let timeout
  const h = await documentsHarness({ timers: {
    setTimeout(callback) { timeout = callback; return 1 },
    clearTimeout() {},
  } })
  const session = new h.TypstSession()
  try {
    const first = session.render('one', 203, [], [], () => {})
    const failed = assert.rejects(first, /compiler crashed/)
    h.workers[0].onerror({ message: 'compiler crashed' })
    await failed
    assert.equal(h.workers[0].terminated, true)
    const second = session.render('two', 203, [], [], () => {})
    const expired = assert.rejects(second, /exceeded 120 seconds/)
    timeout()
    await expired
    assert.equal(h.workers[1].terminated, true)
    const third = session.render('three', 203, [], [], () => {})
    const rejected = assert.rejects(third, /latest failure/)
    h.workers[2].emit({ type: 'error', id: 3, message: 'latest failure' })
    await rejected
    assert.equal(h.workers.length, 3)
  } finally { session.dispose() }
})

test('abort during PDF worker asset fetch rejects without starting a PDF worker', async () => {
  const fetching = deferred()
  const h = await documentsHarness({ cachedAsset: () => fetching.promise })
  const abort = new AbortController()
  const result = h.rasterizePdf(new Blob(['pdf']), 203, 30, abort.signal)
  const rejected = assert.rejects(result, { name: 'AbortError' })
  await turn()
  abort.abort()
  await rejected
  fetching.resolve(new Response('worker'))
  await turn()
  assert.equal(h.workers.length, 0)
})

async function workerHarness() {
  const sent = []
  const builds = []
  const sources = []
  const fetched = []
  const gate = deferred()
  let registry
  let live = 0
  let maxLive = 0
  let hold = false
  const imports = {
    '@myriaddreamin/typst.ts/compiler': {
      createTypstCompiler() {
        let source
        const instance = {
          async init(config) {
            builds.push(instance)
            await config.getModule()
            for (const hook of config.beforeBuild) await hook()
          },
          addSource(path, text) { source = text; sources.push(text) },
          async runWithWorld(config, callback) {
            live++
            maxLive = Math.max(live, maxLive)
            try {
              return await callback({
                async pdf() {
                  if (hold) { hold = false; await gate.promise }
                  if (source.includes('package')) {
                    if (!registry.resolve({ namespace: 'preview', name: 'example', version: '1.0.0' },
                      { untar() {} })) return { diagnostics: ['package missing'] }
                  }
                  if (source === 'invalid') return { diagnostics: ['syntax error'] }
                  return { result: new Uint8Array([source.length]), diagnostics: [] }
                },
              })
            } finally { live-- }
          },
        }
        return instance
      },
    },
    '@myriaddreamin/typst.ts/options.init': {
      loadFonts: () => () => {},
      withAccessModel: () => () => {},
      withPackageRegistry: value => () => { registry = value },
    },
    '@myriaddreamin/typst.ts/fs/memory': { MemoryAccessModel: class { insertFile() {} } },
    './asset-cache': {
      PACKAGE_CACHE: 'packages',
      cachedAsset: async url => { fetched.push(url); return new Response(new Uint8Array([1])) },
    },
  }
  const { context } = await load('typst.worker.ts', { self: {}, postMessage: message => sent.push(message) }, imports)
  return {
    sent, builds, sources, fetched,
    maxLive: () => maxLive,
    hold: () => { hold = true },
    release: gate.resolve,
    send(id, source, first = false) {
      context.self.onmessage({ data: {
        type: 'compile', id, source, baseUrl: '/',
        ...(first ? { files: [], fonts: [] } : {}),
      } })
    },
    cancel(id) { context.self.onmessage({ data: { type: 'cancel', id } }) },
    async done(id) {
      for (let i = 0; i < 100; i++) {
        const result = sent.find(message => message.id === id && message.type !== 'progress')
        if (result) return result
        await turn()
      }
      assert.fail(`Worker request ${id} did not complete`)
    },
  }
}

test('worker reuses compiler across edits and syntax errors; only a new package rebuilds it', async () => {
  const h = await workerHarness()
  for (const [id, source] of [[1, 'one'], [2, 'two'], [3, 'invalid'], [4, 'four']]) {
    h.send(id, source, id === 1)
    assert.equal((await h.done(id)).type, id === 3 ? 'error' : 'result')
  }
  assert.equal(h.builds.length, 1)
  h.send(5, 'package')
  assert.equal((await h.done(5)).type, 'result')
  assert.equal(h.builds.length, 2)
  h.send(6, 'package edited')
  await h.done(6)
  assert.equal(h.builds.length, 2)
  assert.equal(h.fetched.filter(url => url.includes('.wasm')).length, 1)
  assert.equal(h.fetched.filter(url => url.includes('.tar.gz')).length, 1)
})

test('worker serializes compilation, skips queued obsolete edits, and suppresses cancelled results', async () => {
  const h = await workerHarness()
  h.hold()
  h.send(1, 'one', true)
  while (!h.sources.length) await turn()
  h.send(2, 'obsolete')
  h.send(3, 'latest')
  h.release()
  await h.done(3)
  assert.equal(h.maxLive(), 1)
  assert.deepEqual(h.sources, ['one', 'latest'])
  assert.equal(h.sent.some(message => message.id === 1 && message.type === 'result'), false)
  h.send(4, 'cancelled')
  h.cancel(4)
  await turn()
  assert.equal(h.sources.includes('cancelled'), false)
})

test('installed WASM compiler updates a retained world and recovers after invalid source, offline', async () => {
  const [compiler, options, memory, wrapper, wasm] = await Promise.all([
    import('@myriaddreamin/typst.ts/compiler'),
    import('@myriaddreamin/typst.ts/options.init'),
    import('@myriaddreamin/typst.ts/fs/memory'),
    import('@myriaddreamin/typst-ts-web-compiler'),
    readFile(new URL('../../../node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', import.meta.url)),
  ])
  let builds = 0
  const sent = []
  const { context } = await load('typst.worker.ts', { self: {}, postMessage: message => sent.push(message) }, {
    '@myriaddreamin/typst.ts/compiler': {
      createTypstCompiler() { builds++; return compiler.createTypstCompiler() },
    },
    '@myriaddreamin/typst.ts/options.init': {
      ...options,
      // Geometry-only fixtures need no fonts, keeping this test entirely offline.
      loadFonts: () => options.loadFonts([], { assets: false }),
    },
    '@myriaddreamin/typst.ts/fs/memory': memory,
    '@myriaddreamin/typst-ts-web-compiler': wrapper,
    './asset-cache': {
      PACKAGE_CACHE: 'packages',
      cachedAsset: async url => {
        assert.ok(url.endsWith('.wasm'), `Unexpected network request: ${url}`)
        return new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } })
      },
    },
  })
  async function compile(id, source) {
    context.self.onmessage({ data: {
      type: 'compile', id, source, baseUrl: '/',
      ...(id === 1 ? {
        files: [{ path: 'support.typ', data: new TextEncoder().encode('#let w = 10mm') }], fonts: [],
      } : {}),
    } })
    for (let i = 0; i < 1000; i++) {
      const result = sent.find(message => message.id === id && message.type !== 'progress')
      if (result) return result
      await turn()
    }
    assert.fail(`WASM request ${id} did not complete`)
  }
  const source = '#set page(width: 30mm, height: 20mm, margin: 0mm)\n#import "support.typ": w\n#rect(width: w, height: 5mm)'
  const first = await compile(1, source)
  assert.equal(first.type, 'result', first.message)
  assert.equal(new TextDecoder().decode(first.pdf.subarray(0, 5)), '%PDF-')
  const invalid = await compile(2, '#let broken = (')
  assert.equal(invalid.type, 'error')
  const edited = await compile(3, source.replace('height: 5mm', 'height: 8mm'))
  assert.equal(edited.type, 'result', edited.message)
  assert.notDeepEqual(edited.pdf, first.pdf)
  assert.equal(builds, 1)
})
