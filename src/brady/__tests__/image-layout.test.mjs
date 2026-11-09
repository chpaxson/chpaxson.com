import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labelLayout } from '../image-layout.ts'
import { parseDistance } from '../measurements.ts'

test('fit scales proportionally to full label height', () => {
  assert.deepEqual(labelLayout(600, 300, 102, 'fit', 203, 203),
    { width: 204, height: 102, drawnHeight: 102, y: 0, scale: .34 })
})

test('fixed PPI crops tall images centrally, and pads short images without stretching', () => {
  const tall = labelLayout(600, 300, 102, 'crop', 300, 203)
  assert.equal(tall.width, 406)
  assert.equal(tall.drawnHeight, 203)
  assert.equal(tall.y, -50.5)
  const short = labelLayout(100, 50, 102, 'crop', 203, 203)
  assert.equal(short.y, 26)
  assert.equal(short.width, 100)
  assert.throws(() => labelLayout(8192, 1, 8192, 'fit', 203, 203), /exceeds/)
})

test('distance entry accepts optional suffixes without browser numeric-step errors', () => {
  assert.equal(parseDistance('3mm', 'in', 203), 3 * 203 / 25.4)
  assert.equal(parseDistance('0.5 inch', 'mm', 203), 101.5)
  assert.equal(parseDistance('8 px', 'mm', 203), 8)
  assert.equal(parseDistance('.3', 'mm', 203), .3 * 203 / 25.4)
  for (const input of ['', '-3', 'mm', '3cats']) assert.ok(Number.isNaN(parseDistance(input, 'mm', 203)))
})

test('print-height release scales proportionally or center crops without changing the source width', () => {
  const scaled = labelLayout(400, 200, 102, 'fit', 203, 203)
  assert.deepEqual(scaled, { width: 204, height: 102, drawnHeight: 102, y: 0, scale: .51 })
  const cropped = labelLayout(400, 200, 102, 'crop', 203, 203)
  assert.deepEqual(cropped, { width: 400, height: 102, drawnHeight: 200, y: -49, scale: 1 })
  const padded = labelLayout(400, 50, 102, 'crop', 203, 203)
  assert.deepEqual(padded, { width: 400, height: 102, drawnHeight: 50, y: 26, scale: 1 })
})
