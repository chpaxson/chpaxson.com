import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

async function loadSave(window, extra = {}) {
  const context = vm.createContext({ window, DOMException, ...extra })
  const source = ts.transpileModule(await readFile(new URL('../source-save.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = new vm.SourceTextModule(source, { context })
  await module.link(() => { throw new Error('Unexpected import') })
  await module.evaluate()
  return module.namespace.saveTypstSource
}

test('Save As restricts the picker to .typ and writes exactly the source before reporting success', async () => {
  const calls = []
  const save = await loadSave({
    async showSaveFilePicker(options) {
      calls.push(JSON.parse(JSON.stringify(options)))
      return {
        name: 'renamed.typ',
        async createWritable() {
          return {
            async write(source) { calls.push(source) },
            async close() { calls.push('closed') },
          }
        },
      }
    },
  })
  const result = await save('#set page(width: 52mm)\nLabel', 'labels')
  assert.deepEqual(calls, [
    { suggestedName: 'labels.typ', excludeAcceptAllOption: true,
      types: [{ description: 'Typst source', accept: { 'text/plain': ['.typ'] } }] },
    '#set page(width: 52mm)\nLabel', 'closed',
  ])
  assert.equal(result.filename, 'renamed.typ')
  assert.equal(result.downloaded, false)
})

test('cancelling Save As does not report a saved file or request a download', async () => {
  const save = await loadSave({
    async showSaveFilePicker() { throw new DOMException('Cancelled', 'AbortError') },
  })
  assert.equal(await save('Label', 'labels.typ'), undefined)
})

test('picker, file write, and file close failures propagate rather than reporting success', async () => {
  for (const stage of ['picker', 'create', 'write', 'close']) {
    const failure = new Error(`Failed at ${stage}`)
    const save = await loadSave({
      async showSaveFilePicker() {
        if (stage === 'picker') throw failure
        return {
          async createWritable() {
            if (stage === 'create') throw failure
            return {
              async write() { if (stage === 'write') throw failure },
              async close() { if (stage === 'close') throw failure },
            }
          },
        }
      },
    })
    await assert.rejects(save('Label', 'labels.typ'), error => error === failure)
  }
})

test('unsupported browsers explicitly return download mode with source-only bytes and a .typ name', async () => {
  let blob
  let clicked = false
  let revoked = false
  const anchor = { click() { clicked = true } }
  const save = await loadSave({}, {
    Blob,
    URL: {
      createObjectURL(value) { blob = value; return 'blob:source' },
      revokeObjectURL(url) { assert.equal(url, 'blob:source'); revoked = true },
    },
    document: { createElement(tag) { assert.equal(tag, 'a'); return anchor } },
    setTimeout(callback) { callback() },
  })
  const result = await save('Only Typst source\n', 'loaded.TYP')
  assert.equal(result.downloaded, true)
  assert.equal(anchor.download, 'loaded.TYP')
  assert.equal(anchor.href, 'blob:source')
  assert.equal(await blob.text(), 'Only Typst source\n')
  assert.equal(clicked, true)
  assert.equal(revoked, true)
})
