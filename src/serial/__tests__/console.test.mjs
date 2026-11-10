import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { readFile } from 'node:fs/promises'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { ansiParts, logFilename, logLine, messageMeta, outgoingParts, parseOutgoingText, ReceivedText, resolveKeyCombo } from '../format.ts'
import { boundedInteger, defaultColumnSettings, savedSettings, validateColumn, validateGlobal } from '../settings.ts'
import { useColumn } from '../use-column.ts'

function cookies() {
  const jar = new Map()
  globalThis.document = {
    get cookie() { return [...jar].map(([key, value]) => `${key}=${value}`).join('; ') },
    set cookie(value) {
      const [pair] = value.split(';')
      const index = pair.indexOf('=')
      jar.set(pair.slice(0, index), pair.slice(index + 1))
    },
  }
}
const globalSettings = () => ({ numColumns: 2, bufferSize: 10, tsFormat: 'time-ms', darkMode: true })

test('outgoing encoding preserves UTF-8, raw bytes, key escapes, and unknown tokens', () => {
  assert.deepEqual([...parseOutgoingText('A\\x00`CTRL+D`💡\r\n', true, true)],
    [65, 0, 4, 240, 159, 146, 161, 13, 10])
  assert.equal(new TextDecoder().decode(parseOutgoingText('\\xFF`UNKNOWN`', false, true)), '\\xFF`UNKNOWN`')
  assert.equal(resolveKeyCombo('CTRL+ALT+DEL'), 127)
  assert.equal(resolveKeyCombo('CTRL+SPACE'), 0)
  assert.equal(resolveKeyCombo('SHIFT'), null)
  assert.deepEqual(outgoingParts('💡\\xFF`CTRL+C`', true, true).map(({ start, end }) => [start, end]),
    [[0, 4], [4, 5], [5, 6]])
})

test('ANSI styling is parsed as text, strips CSI controls, and maps Unicode byte ranges', () => {
  const parts = ansiParts('\x1b[31;1m💡<script>\x1b[0m!\x1b[2J', true)
  assert.equal(parts.map((part) => part.text).join(''), '💡<script>!')
  assert.equal(parts[0].start, 7)
  assert.equal(parts[0].end, 11)
  assert.match(parts[0].style, /color:#cc0000/)
  assert.match(parts[0].style, /font-weight:bold/)
  assert.equal(parts.at(-1).style, '')
  assert.match(ansiParts('\x1b[38;2;1;2;3mRGB')[0].style, /color:rgb\(1,2,3\)/)
  assert.match(ansiParts('\x1b[48;5;196mBG')[0].style, /background-color:rgb\(255,0,0\)/)
})

test('received UTF-8 split between reads retains the original byte sequence', () => {
  const decoder = new ReceivedText()
  assert.equal(decoder.push(new Uint8Array([65, 240, 159])).text, 'A')
  const result = decoder.push(new Uint8Array([146, 161, 66]))
  assert.equal(result.text, '💡B')
  assert.deepEqual([...result.bytes], [240, 159, 146, 161, 66])
  assert.equal(decoder.push(new Uint8Array([0xe2])).text, '')
  assert.equal(decoder.push(new Uint8Array(), true).text, '\uFFFD')
})

test('metadata, hidden outgoing logs, filenames, and numeric bounds retain their contracts', () => {
  const settings = defaultColumnSettings(0)
  const time = new Date('2026-01-02T03:04:05.006Z')
  const message = { type: 'out', text: 'data', time, num: 7, bytes: new Uint8Array() }
  settings.showMsgNum = true
  assert.equal(messageMeta(message, settings, 'iso'), '#7 2026-01-02T03:04:05.006Z ->')
  settings.showOutgoing = false
  assert.equal(logLine(message, settings, 'iso'), null)
  settings.showOutgoing = true
  settings.logMetadata = false
  assert.equal(logLine(message, settings, 'iso'), 'data')
  assert.match(logFilename(time, 'Port / 1'), /^\d{8}_\d{6}_Port___1\.log$/)
  assert.equal(boundedInteger(NaN, 1, 8, 2), 2)
  assert.equal(boundedInteger(100, 1, 8, 2), 8)
  assert.equal(boundedInteger(-1, 10, 20000, 500), 10)
})

test('existing preference cookies are restored, validated, and persisted', async () => {
  cookies()
  document.cookie = `wsc_col_0=${encodeURIComponent(JSON.stringify({ label: 'Existing', baud: 115200, hexView: true }))}`
  const errors = []
  const settings = savedSettings('wsc_col_0', defaultColumnSettings(0), validateColumn, (message) => errors.push(message))
  assert.equal(settings.label, 'Existing')
  assert.equal(settings.baud, 115200)
  assert.equal(settings.sendLF, true)
  settings.label = 'Updated'
  await nextTick()
  assert.match(decodeURIComponent(document.cookie), /Updated/)
  assert.deepEqual(errors, [])
  document.cookie = `wsc_global=${encodeURIComponent(JSON.stringify({ numColumns: 999, bufferSize: -1 }))}`
  const global = savedSettings('wsc_global', globalSettings(), validateGlobal, (message) => errors.push(message))
  assert.equal(global.numColumns, 8)
  assert.equal(global.bufferSize, 10)
  document.cookie = `wsc_col_1=${encodeURIComponent('{"parity":"invalid"}')}`
  const fallback = savedSettings('wsc_col_1', defaultColumnSettings(1), validateColumn, (message) => errors.push(message))
  assert.equal(fallback.parity, 'none')
  assert.equal(errors.length, 1)
})

function device() {
  let input
  const writes = []
  let opens = 0
  let closes = 0
  let failWrites = false
  const port = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 1 }),
    async open(options) {
      assert.equal(options.baudRate, 9600)
      opens++
      this.readable = new ReadableStream({ start(controller) { input = controller } })
      this.writable = new WritableStream({
        write(bytes) {
          if (failWrites) throw new Error('device write failure')
          writes.push([...bytes])
        },
      })
    },
    async close() {
      assert.equal(this.readable.locked, false)
      assert.equal(this.writable.locked, false)
      closes++
    },
  }
  const api = new EventTarget()
  api.requestPort = async () => port
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: api } })
  return {
    port, writes, receive: (bytes) => input.enqueue(new Uint8Array(bytes)),
    end: () => input.close(), failWrites: () => { failWrites = true },
    get opens() { return opens }, get closes() { return closes },
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('serial lifecycle sends exact bytes, bounds buffers, refreshes the same port, and releases locks', async () => {
  cookies()
  const mock = device()
  const errors = []
  const global = globalSettings()
  const column = useColumn(0, global, (message) => errors.push(message))
  await column.connect()
  assert.equal(column.connected.value, true)
  assert.match(column.info.value, /VID:1234 PID:0001/)
  column.settings.hexEscape = true
  column.settings.keyEscape = true
  column.settings.sendCR = true
  assert.equal(await column.send('\\xFF`CTRL+C`'), true)
  assert.deepEqual(mock.writes[0], [255, 3, 13, 10])
  assert.equal(column.messages.value[0].text, '\\xFF`CTRL+C`\\r\\n')
  assert.deepEqual(column.messages.value[0].outgoing.map(({ start, end }) => [start, end]), [[0, 1], [1, 2], [2, 3], [3, 4]])
  assert.equal(await column.send('💡abc', true), true)
  assert.deepEqual(mock.writes[1], [240, 159, 146, 161])
  for (let i = 0; i < 15; i++) { mock.receive([65 + i]); await settle() }
  assert.equal(column.messages.value.length, 10)
  global.bufferSize = 5
  column.trim()
  assert.equal(column.messages.value.length, 5)
  column.clear()
  assert.equal(column.messages.value.length, 0)
  await column.refresh()
  assert.equal(mock.opens, 2)
  assert.equal(mock.closes, 1)
  await column.disconnect()
  assert.equal(mock.closes, 2)
  assert.equal(column.connected.value, false)
  assert.deepEqual(errors, [])
})

test('unexpected end and write failures are surfaced and cleanup cannot deadlock', async () => {
  cookies()
  const mock = device()
  const errors = []
  const column = useColumn(0, globalSettings(), (message) => errors.push(message))
  await column.connect()
  mock.failWrites()
  assert.equal(await column.send('retain me'), false)
  assert.equal(column.messages.value.length, 0)
  assert.match(errors[0], /send failed/)
  mock.end()
  await settle()
  await column.disconnect()
  assert.equal(column.connected.value, false)
  assert.equal(mock.closes, 1)
  assert.ok(errors.some((error) => error.includes('stream ended')))
})

test('logs include buffered history and keep recording after visible messages are cleared', async () => {
  cookies()
  const mock = device()
  const errors = []
  const column = useColumn(0, globalSettings(), (message) => errors.push(message))
  await column.connect()
  mock.receive([65])
  await settle()
  column.settings.logIncludeBuffered = true
  column.settings.logMetadata = false
  column.startLogging()
  column.clear()
  mock.receive([66])
  await settle()
  column.settings.showOutgoing = false
  await column.send('hidden')
  let downloaded
  let filename
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:console-test' }
  URL.revokeObjectURL = () => {}
  document.createElement = () => ({
    set href(value) { assert.equal(value, 'blob:console-test') },
    set download(value) { filename = value },
    click() {}, remove() {},
  })
  document.body = { appendChild() {} }
  try {
    column.stopLogging()
    assert.equal(column.logging.value, false)
    assert.equal(await downloaded.text(), 'A\nB\n')
    assert.match(filename, /_Port_1\.log$/)
  } finally {
    URL.createObjectURL = originalCreate
    // The production download revokes after a short delay.
    setTimeout(() => { URL.revokeObjectURL = originalRevoke }, 1100)
    await column.disconnect()
  }
  assert.deepEqual(errors, [])
})

test('cancelling the device chooser leaves the column disconnected without an error', async () => {
  cookies()
  const api = new EventTarget()
  api.requestPort = async () => { throw new DOMException('No port selected', 'NotFoundError') }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: api } })
  const errors = []
  const column = useColumn(0, globalSettings(), (message) => errors.push(message))
  await column.connect()
  assert.equal(column.connected.value, false)
  assert.equal(column.busy.value, false)
  assert.deepEqual(errors, [])
})

test('both routed tools load their component styles and compile without ignored template elements', async () => {
  for (const [file, style] of [['../SerialConsole.vue', './console.css'], ['../../brady/LabelStudio.vue', './studio.css']]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    assert.equal(descriptor.styles[0].src, style)
    const template = compileTemplate({
      source: descriptor.template.content, filename: file, id: file,
      compilerOptions: { expressionPlugins: ['typescript'] },
    })
    assert.deepEqual(template.errors, [])
  }
})
