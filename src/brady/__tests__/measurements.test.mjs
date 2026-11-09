import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describePixels, describeSize, formatDistance, fromPixels, toPixels, previewWidth } from '../measurements.ts'

test('mm, inches, and pixels use the active printer PPI', () => {
  for (const ppi of [203, 300, 600]) {
    assert.equal(toPixels(25.4, 'mm', ppi), ppi)
    assert.equal(toPixels(1, 'in', ppi), ppi)
    assert.equal(fromPixels(ppi, 'mm', ppi), 25.4)
    assert.equal(fromPixels(ppi, 'in', ppi), 1)
    assert.equal(toPixels(8, 'px', ppi), 8)
  }
})

test('previews use the same physical display scale rather than stretching each page to its container', () => {
  assert.equal(previewWidth(200, 102, 203), 200)
  assert.equal(previewWidth(400, 102, 203), 400)
  assert.equal(previewWidth(600, 150, 300), 406)
  assert.equal(previewWidth(400, 1200, 203), 200)
})

test('preview sizes show the selected unit and raster dimensions at the actual render PPI', () => {
  assert.equal(describeSize(406, 203, 203, 'mm'), '50.8 x 25.4 mm (406 x 203 px)')
  assert.equal(describeSize(406, 203, 203, 'in'), '2 x 1 in (406 x 203 px)')
  assert.equal(describeSize(406, 203, 203, 'px'), '406 x 203 px')
  assert.equal(describeSize(600, 300, 300, 'mm'), '50.8 x 25.4 mm (600 x 300 px)')
  assert.equal(describeSize(416, 102, 203, 'mm'), '52.051 x 12.763 mm (416 x 102 px)')
})

test('unit round trips preserve raster dimensions and physical distances round to pixels', () => {
  for (const unit of ['mm', 'in', 'px']) {
    for (const pixels of [0, 1, 8, 102, 416, 8192]) {
      assert.equal(Math.round(toPixels(fromPixels(pixels, unit, 203), unit, 203)), pixels)
    }
  }
  assert.equal(Math.round(toPixels(1, 'mm', 203)), 8)
  assert.equal(describePixels(203, 203), '25.4 mm / 1 in / 203 px')
  assert.equal(formatDistance(Infinity), 'Invalid')
  assert.equal(formatDistance(NaN), 'Invalid')
})
