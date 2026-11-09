import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pagePixels, printerPpi, validatePpi } from '../document-settings.ts'

test('detects valid SDK resolution and rejects missing, pending, or invalid reports', () => {
  for (const dpi of ['203', '300', '600', '1200']) assert.equal(printerPpi(dpi), Number(dpi))
  for (const dpi of [undefined, '', '0', 'NaN', '203 dpi', '203.5', '71', '1201']) {
    assert.equal(printerPpi(dpi), undefined)
  }
})

test('PDF/Typst page points rasterize to the requested PPI, including fractional sizes', () => {
  assert.deepEqual(pagePixels(72, 36, 203), { width: 203, height: 102 })
  assert.deepEqual(pagePixels(52 / 25.4 * 72, 36, 203), { width: 416, height: 102 })
  assert.deepEqual(pagePixels(72, 36, 300), { width: 300, height: 150 })
})

test('invalid PPI and oversized pages fail before allocating a raster', () => {
  for (const ppi of [0, 71, 1201, 203.5, NaN, Infinity]) assert.throws(() => validatePpi(ppi), /Raster PPI/)
  for (const [w, h] of [[0, 20], [20, -1], [Infinity, 10], [8193, 1], [4000, 4001]]) {
    assert.throws(() => pagePixels(w, h, 72), /Page raster/)
  }
  assert.deepEqual(pagePixels(8192, 1, 72), { width: 8192, height: 1 })
  assert.deepEqual(pagePixels(4000, 4000, 72), { width: 4000, height: 4000 })
})
