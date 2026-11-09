import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

async function loadRenderer(Image) {
  const context = vm.createContext({ Image })
  async function load(url) {
    const source = ts.transpileModule(await readFile(url, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const module = new vm.SourceTextModule(source, { context, identifier: url.href })
    await module.link(specifier => load(new URL(`${specifier}.ts`, url)))
    return module
  }
  const module = await load(new URL('../renderers.ts', import.meta.url))
  await module.evaluate()
  return module.namespace
}

test('image loading completes without decode(), including when background rendering is suspended', async () => {
  class Image {
    naturalWidth = 203
    naturalHeight = 102
    complete = true
    set src(value) { this.url = value; queueMicrotask(() => this.onload()) }
    decode() { throw new Error('decode must not be used: hidden tab rendering is suspended') }
  }
  const { decodeImage } = await loadRenderer(Image)
  const image = await decodeImage('blob:test')
  assert.equal(image.naturalWidth, 203)
  assert.equal(image.url, 'blob:test')
  assert.equal(image.onload, null)
  assert.equal(image.onerror, null)
})

test('unreadable images and missing dimensions fail explicitly', async () => {
  class BrokenImage {
    set src(_) { queueMicrotask(() => this.onerror()) }
  }
  const broken = await loadRenderer(BrokenImage)
  await assert.rejects(broken.decodeImage('blob:broken'), /could not be loaded/)
  class EmptyImage {
    naturalWidth = 0
    naturalHeight = 0
    set src(_) { queueMicrotask(() => this.onload()) }
  }
  const empty = await loadRenderer(EmptyImage)
  await assert.rejects(empty.decodeImage('blob:empty'), /no drawable dimensions/)
})
