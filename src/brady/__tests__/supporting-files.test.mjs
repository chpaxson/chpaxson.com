import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeSupportingFiles } from '../supporting-files.ts'

test('uploads append to existing files and replace only matching filenames', () => {
  const module = new File(['#let label = [Old]'], 'labels.typ')
  const font = new File(['font'], 'custom.ttf')
  const updated = new File(['#let label = [New]'], 'labels.typ')
  const initial = mergeSupportingFiles([], [module, font])
  const result = mergeSupportingFiles(initial.files, [updated, new File(['data'], 'data.json')])
  assert.deepEqual(result.files.map(file => file.name), ['labels.typ', 'custom.ttf', 'data.json'])
  assert.equal(result.files[0], updated)
  assert.equal(result.files[1], font)
  assert.deepEqual(result.replaced, ['labels.typ'])
  assert.equal(initial.files[0], module)
})

test('reserved source and oversized merged uploads reject without changing current files', () => {
  const current = [new File(['module'], 'module.typ')]
  assert.throws(() => mergeSupportingFiles(current, [new File(['source'], 'main.typ')]), /reserved/)
  const huge = { name: 'large.bin', size: 50 * 1024 * 1024 }
  assert.throws(() => mergeSupportingFiles(current, [huge]), /50 MiB/)
  assert.equal(current.length, 1)
  assert.deepEqual(mergeSupportingFiles([], [huge]).files, [huge])
})
