import { createTypstCompiler, type TypstCompiler } from '@myriaddreamin/typst.ts/compiler'
import { loadFonts, withAccessModel, withPackageRegistry } from '@myriaddreamin/typst.ts/options.init'
import { MemoryAccessModel } from '@myriaddreamin/typst.ts/fs/memory'
import type { PackageRegistry, PackageResolveContext, PackageSpec } from '@myriaddreamin/typst.ts/internal.types'
import { cachedAsset, PACKAGE_CACHE } from './asset-cache'
import type { TypstCompileRequest, TypstRequest, TypstResponse } from './typst-protocol'

function send(message: TypstResponse) { postMessage(message) }
let latestId = 0
let activeId = 0
function progress(message: string) {
  if (activeId === latestId) send({ type: 'progress', id: activeId, message })
}

class CachedPackages implements PackageRegistry {
  private archives = new Map<string, Uint8Array>()
  missing = new Set<string>()
  constructor(private readonly memory: MemoryAccessModel) {}

  resolve(spec: PackageSpec, context: PackageResolveContext) {
    if (spec.namespace !== 'preview' || !/^[a-z0-9-]+$/.test(spec.name) ||
        !/^\d+\.\d+\.\d+$/.test(spec.version)) {
      throw new Error('Only versioned @preview packages from packages.typst.org are supported.')
    }
    const url = `https://packages.typst.org/preview/${spec.name}-${spec.version}.tar.gz`
    const archive = this.archives.get(url)
    if (!archive) {
      this.missing.add(url)
      return undefined
    }
    const root = `/@memory/fetch/packages/preview/${spec.name}/${spec.version}`
    context.untar(archive, (path, data, mtime) => {
      const parts = path.replace(/^\.\//, '').split('/')
      if (parts.includes('..') || path.startsWith('/') || path.includes('\\')) {
        throw new Error(`Unsafe package archive path: ${path}`)
      }
      this.memory.insertFile(`${root}/${parts.join('/')}`, data.slice(), new Date(mtime))
    })
    return root
  }

  async fetchMissing() {
    const urls = [...this.missing]
    for (const url of urls) {
      progress(`Loading cached or remote package: ${url.split('/').pop()}`)
      const response = await cachedAsset(url, PACKAGE_CACHE)
      this.archives.set(url, new Uint8Array(await response.arrayBuffer()))
      this.missing.delete(url)
    }
  }
}

const memory = new MemoryAccessModel()
const registry = new CachedPackages(memory)
let compiler: TypstCompiler | undefined
let assets: Required<Pick<TypstCompileRequest, 'files' | 'fonts' | 'baseUrl'>> | undefined
const fetched = new Map<string, Promise<Response>>()

async function compilerAsset(input: string) {
  let response = fetched.get(input)
  if (!response) {
    response = cachedAsset(input)
    fetched.set(input, response)
    void response.catch(() => fetched.delete(input))
  }
  return (await response).clone()
}

async function compile(request: TypstCompileRequest) {
  activeId = request.id
  if (!assets) {
    if (!request.files || !request.fonts) throw new Error('Typst session assets have not been initialized.')
    assets = { files: request.files, fonts: request.fonts, baseUrl: request.baseUrl }
  }
  const sessionAssets = assets
  for (const file of request.files ?? []) {
    if (!file.path || file.path.startsWith('/') || file.path.includes('\\') ||
        file.path.split('/').some(part => part === '..' || part === '.' || !part)) {
      throw new Error(`Invalid project file path: ${file.path}`)
    }
    if (file.path === 'main.typ') throw new Error('main.typ is reserved for the pasted source. Rename this supporting file.')
    memory.insertFile(`/@memory/project/${file.path}`, file.data, new Date())
  }
  for (let attempt = 0; attempt < 64; attempt++) {
    if (request.id !== latestId) return
    // Only new package dependencies invalidate cached negative lookups.
    if (registry.missing.size) {
      await registry.fetchMissing()
      compiler = undefined
    }
    if (!compiler) {
      progress('Loading cached Typst compiler and fonts...')
      const next = createTypstCompiler()
      await next.init({
        getWrapper: () => import('@myriaddreamin/typst-ts-web-compiler'),
        getModule: () => compilerAsset(`${sessionAssets.baseUrl}brady-sdk/typst-0.7.0.wasm`),
        beforeBuild: [
          loadFonts([
            ...sessionAssets.fonts,
            'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/Lato-Regular.ttf',
            'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/Lato-Bold.ttf',
            'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/Lato-Italic.ttf',
            'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/Lato-BoldItalic.ttf',
          ], { assets: ['text'], fetcher: (input) => compilerAsset(String(input)) }),
          withAccessModel(memory),
          withPackageRegistry(registry),
        ],
      })
      compiler = next
    }
    if (request.id !== latestId) return
    compiler.addSource('/@memory/project/main.typ', request.source)
    progress('Compiling Typst document...')
    const outcome = await compiler.runWithWorld(
      { mainFilePath: '/@memory/project/main.typ', root: '/@memory/project' },
      async world => {
        // The library frees snapshots only when its callback resolves.
        try { return { result: await world.pdf({ diagnostics: 'unix' }) } }
        catch (cause) { return { cause } }
      },
    )
    if ('cause' in outcome) throw outcome.cause
    const result = outcome.result
    if (registry.missing.size) {
      continue
    }
    if (!result.result) throw new Error(result.diagnostics?.join('\n') || 'Typst compilation produced no PDF.')
    if (request.id === latestId) {
      send({ type: 'result', id: request.id, pdf: result.result, diagnostics: result.diagnostics ?? [] })
    }
    return
  }
  throw new Error('Package dependency discovery exceeded 64 rounds.')
}

let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<TypstRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    if (request.id === latestId) latestId = 0
    return
  }
  latestId = request.id
  queue = queue.then(async () => {
    // The initial request still installs supporting files even when superseded.
    if (request.id !== latestId && !request.files) return
    await compile(request)
  }).catch((cause: unknown) => {
    if (request.id === latestId) {
      send({ type: 'error', id: request.id, message: cause instanceof Error ? cause.message : String(cause) })
    }
  })
}
