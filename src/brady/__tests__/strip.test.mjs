import { test } from 'node:test'
import assert from 'node:assert/strict'
import { horizontalBounds, stripLayout } from '../strip.ts'

const defaults = { autoTrim: true, cropLeft: 0, cropRight: 0, margin: 2, separators: true }
function raster(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255)
  return {
    pixels,
    ink(x, y, color = [0, 0, 0, 255]) { pixels.set(color, (y * width + x) * 4) },
  }
}

test('auto trim examines every row, preserves content, and crops only horizontal margins', () => {
  const { pixels, ink } = raster(10, 3)
  ink(2, 2)
  ink(7, 0)
  assert.deepEqual(horizontalBounds(pixels, 10, 3, defaults), { left: 2, width: 6 })
  assert.deepEqual(horizontalBounds(pixels, 10, 3, { ...defaults, cropLeft: 1, cropRight: 2 }),
    { left: 2, width: 6 })
  assert.deepEqual(horizontalBounds(pixels, 10, 3, { ...defaults, autoTrim: false, cropLeft: 1, cropRight: 2 }),
    { left: 1, width: 7 })
})

test('white tolerance and transparent pixels match the white-backed preview', () => {
  const { pixels, ink } = raster(6, 1)
  ink(0, 0, [0, 0, 0, 0])
  ink(1, 0, [250, 250, 250, 255])
  ink(3, 0, [249, 255, 255, 255])
  assert.deepEqual(horizontalBounds(pixels, 6, 1, defaults), { left: 3, width: 1 })
})

test('blank images reject auto trim but allow manual-only crops', () => {
  const { pixels } = raster(5, 2)
  assert.throws(() => horizontalBounds(pixels, 5, 2, defaults), /no non-white content/)
  assert.deepEqual(horizontalBounds(pixels, 5, 2, { ...defaults, autoTrim: false, cropLeft: 1, cropRight: 1 }),
    { left: 1, width: 3 })
  assert.throws(() => horizontalBounds(pixels, 5, 2, { ...defaults, autoTrim: false, cropLeft: 3, cropRight: 2 }),
    /entire image/)
})

test('layout pads only horizontally, centers differing heights, and places exactly 1px separators', () => {
  assert.deepEqual(stripLayout([{ width: 3, height: 4 }, { width: 5, height: 1 }], defaults), {
    width: 17, height: 4,
    positions: [{ x: 2, y: 0, separator: 7 }, { x: 10, y: 1, separator: undefined }],
  })
  assert.deepEqual(stripLayout([{ width: 3, height: 4 }, { width: 5, height: 1 }],
    { ...defaults, margin: 0, separators: false }), {
    width: 8, height: 4,
    positions: [{ x: 0, y: 0, separator: undefined }, { x: 3, y: 1, separator: undefined }],
  })
})

test('single image has no separator or unwanted trailing line', () => {
  assert.deepEqual(stripLayout([{ width: 3, height: 4 }], defaults), {
    width: 7, height: 4, positions: [{ x: 2, y: 0, separator: undefined }],
  })
})

test('optional edge marks reserve exactly one pixel at either end, independently of internal separators', () => {
  for (const separators of [true, false]) {
    const result = stripLayout([{ width: 3, height: 4 }], { ...defaults, separators, edgeSeparators: true })
    assert.equal(result.width, 9)
    assert.equal(result.height, 4)
    assert.equal(result.positions[0].x, 3)
    assert.equal(result.positions[0].separator, undefined)
  }
  const result = stripLayout([{ width: 3, height: 4 }, { width: 5, height: 4 }],
    { ...defaults, edgeSeparators: true })
  assert.equal(result.width, 19)
  assert.equal(result.positions[0].separator, 8)
  assert.equal(result.positions[1].x, 11)
})

test('changing horizontal margins never changes strip height or vertical placement', () => {
  const sizes = [{ width: 3, height: 7 }, { width: 5, height: 2 }]
  for (const margin of [0, 1, 24, 200]) {
    const result = stripLayout(sizes, { ...defaults, margin, edgeSeparators: true })
    assert.equal(result.height, 7)
    assert.deepEqual(result.positions.map(position => position.y), [0, 2])
    assert.equal(result.width, 11 + 4 * margin)
  }
})

test('rejects invalid settings, empty jobs, and exact oversized raster thresholds', () => {
  for (const property of ['margin', 'cropLeft', 'cropRight']) {
    for (const value of [-1, 0.5, NaN, 8193]) {
      assert.throws(() => stripLayout([{ width: 1, height: 1 }], { ...defaults, [property]: value }), /whole number/)
    }
  }
  assert.throws(() => stripLayout([], defaults), /at least one image/)
  const options = { ...defaults, margin: 0 }
  assert.equal(stripLayout([{ width: 8192, height: 1 }], options).width, 8192)
  assert.throws(() => stripLayout([{ width: 8193, height: 1 }], options), /exceeds/)
  assert.equal(stripLayout([{ width: 4000, height: 4000 }], options).height, 4000)
  assert.throws(() => stripLayout([{ width: 4000, height: 4001 }], options), /exceeds/)
})
