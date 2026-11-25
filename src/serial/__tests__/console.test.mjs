import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { readFile } from 'node:fs/promises'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { ansiParts, logFilename, logLine, messageMeta, outgoingParts, parseOutgoingText, ReceivedText, resolveKeyCombo } from '../format.ts'
import { adjustColumnWidths, boundedInteger, defaultColumnSettings, savedSettings, validateColumn, validateGlobal } from '../settings.ts'
import { useColumn } from '../use-column.ts'
import { selectedCopyText } from '../selection.ts'
import { useGateway } from '../use-gateway.ts'

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

test('resizing a divider preserves its pair width and respects both minimum widths', () => {
  assert.deepEqual(adjustColumnWidths(400.5, 500.5, 80), { left: 480.5, right: 420.5 })
  assert.deepEqual(adjustColumnWidths(400, 500, -1000), { left: 280, right: 620 })
  assert.deepEqual(adjustColumnWidths(400, 500, 1000), { left: 620, right: 280 })
  assert.deepEqual(adjustColumnWidths(3990, 500, 100), { left: 4000, right: 490 })
})

test('multi-message copying uses only the selected lane and leaves other selections native', () => {
  const original = globalThis.Element
  class MockElement {
    constructor(name) { this.name = name; this.classList = { contains: (value) => value === name } }
    closest() { return this }
    contains(node) { return node === this || node.parentElement === this }
  }
  globalThis.Element = MockElement
  try {
    const root = { contains: (node) => !node.outside }
    const text = new MockElement('text-cell')
    const meta = new MockElement('meta-cell')
    const hex = new MockElement('hex-cell')
    const focus = { parentElement: new MockElement('text-cell') }
    const fragments = {
      '.text-cell': [{ textContent: 'pha\n' }, { textContent: 'Bra' }],
      '.meta-cell': [{ textContent: '#1 <-' }, { textContent: '#2 ->' }],
      '.hex-cell': [{ textContent: '41 FF' }, { textContent: '42' }],
    }
    const selection = {
      isCollapsed: false, rangeCount: 1, anchorNode: { parentElement: text }, focusNode: focus,
      getRangeAt: () => ({ cloneContents: () => ({ querySelectorAll: (selector) => fragments[selector] }) }),
    }
    assert.equal(selectedCopyText(root, selection), 'pha\nBra')
    selection.anchorNode.parentElement = meta
    assert.equal(selectedCopyText(root, selection), '#1 <-\n#2 ->')
    selection.anchorNode.parentElement = hex
    assert.equal(selectedCopyText(root, selection), '41 FF 42')
    selection.focusNode = { parentElement: hex }
    assert.equal(selectedCopyText(root, selection), null)
    selection.focusNode = { outside: true }
    assert.equal(selectedCopyText(root, selection), null)
  } finally {
    if (original === undefined) delete globalThis.Element
    else globalThis.Element = original
  }
})

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
  assert.equal(settings.transport, 'serial')
  settings.transport = 'telnet'
  settings.telnetHost = '192.168.1.10'
  settings.telnetPort = 2323
  settings.label = 'Updated'
  await nextTick()
  assert.match(decodeURIComponent(document.cookie), /Updated/)
  const restored = savedSettings('wsc_col_0', defaultColumnSettings(0), validateColumn, (message) => errors.push(message))
  assert.equal(restored.transport, 'telnet')
  assert.equal(restored.telnetHost, '192.168.1.10')
  assert.equal(restored.telnetPort, 2323)
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

test('gateway unlocks only after authentication, manages targets, and forgets its token on lock', async () => {
  const original = globalThis.WebSocket
  let socket
  class MockWebSocket {
    static OPEN = 1
    readyState = 1
    constructor() { socket = this; this.sent = []; queueMicrotask(() => this.onopen()) }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.closed = true }
    receive(value) { this.onmessage({ data: JSON.stringify(value) }) }
  }
  globalThis.WebSocket = MockWebSocket
  const errors = []
  const gateway = useGateway((message) => errors.push(message))
  try {
    const pending = gateway.unlock('secret')
    await settle()
    assert.equal(gateway.unlocked.value, false)
    assert.deepEqual(socket.sent[0], { type: 'control', token: 'secret' })
    socket.receive({ type: 'targets', targets: [{ host: 'example.test', port: 23 }] })
    await pending
    assert.equal(gateway.token(), 'secret')
    assert.equal(gateway.targets.value[0].host, 'example.test')
    gateway.updateTarget('add', '  test.local  ', 2323)
    assert.deepEqual(socket.sent[1], { type: 'add', host: 'test.local', port: 2323 })
    socket.receive({ type: 'error', message: 'invalid target' })
    assert.match(gateway.error.value, /invalid target/)
    gateway.lock()
    assert.equal(gateway.token(), null)
    assert.equal(gateway.unlocked.value, false)
    assert.deepEqual(gateway.targets.value, [])
    assert.equal(socket.closed, true)
  } finally { globalThis.WebSocket = original }
})

test('Telnet column sends, receives, reconnects and reports gateway failures', async () => {
  cookies()
  const original = globalThis.WebSocket
  const sockets = []
  class MockWebSocket {
    constructor(url) {
      assert.equal(url, 'ws://127.0.0.1:8765')
      this.sent = []
      sockets.push(this)
      queueMicrotask(() => this.onopen())
    }
    send(data) { this.sent.push(data) }
    close() { this.closed = true }
    receive(data) { this.onmessage({ data }) }
    end(reason = '') { this.onclose({ reason, code: reason ? 1011 : 1000 }) }
  }
  globalThis.WebSocket = MockWebSocket
  const errors = []
  const column = useColumn(0, globalSettings(), (message) => errors.push(message), () => 'test-token')
  try {
    column.settings.transport = 'telnet'
    column.settings.telnetHost = 'host.example'
    column.settings.telnetPort = 2323
    const connecting = column.connect()
    await settle()
    assert.deepEqual(JSON.parse(sockets[0].sent[0]), { type: 'connect', token: 'test-token', host: 'host.example', port: 2323 })
    sockets[0].receive('{"type":"ready"}')
    await connecting
    assert.equal(column.connected.value, true)
    sockets[0].receive(new Uint8Array([65]).buffer)
    assert.equal(column.messages.value[0].text, 'A')
    assert.equal(await column.send('B'), true)
    assert.deepEqual([...sockets[0].sent[1]], [66, 10])
    sockets[0].end()
    await settle()
    assert.equal(column.connected.value, false)
    assert.equal(column.disconnectNotices.value.length, 1)
    const retry = column.reconnect()
    await settle()
    sockets[1].end('Target not allowed by gateway')
    await retry
    assert.match(errors.at(-1), /Target not allowed/)
    const retryAgain = column.reconnect()
    await settle()
    sockets[2].receive('{"type":"ready"}')
    await retryAgain
    assert.equal(column.connected.value, true)
    await column.dispose()
    assert.equal(sockets[2].closed, true)
  } finally { globalThis.WebSocket = original }
})

function device() {
  let input
  const writes = []
  let opens = 0
  let closes = 0
  let failWrites = false
  let failOpen = false
  let requests = 0
  const port = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 1 }),
    async open(options) {
      assert.equal(options.baudRate, 9600)
      if (failOpen) throw new Error('device unavailable')
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
  api.requestPort = async () => { requests++; return port }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: api } })
  return {
    port, writes, receive: (bytes) => input.enqueue(new Uint8Array(bytes)),
    end: () => input.close(), failWrites: () => { failWrites = true },
    setOpenFailure: (value) => { failOpen = value },
    get requests() { return requests },
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

test('disconnected ports retain their device for reconnect, including after a failed retry', async () => {
  cookies()
  const mock = device()
  const errors = []
  const column = useColumn(0, globalSettings(), (message) => errors.push(message))
  assert.equal(column.canReconnect.value, false)
  await column.connect()
  assert.equal(column.canReconnect.value, true)
  mock.end()
  await settle()
  assert.equal(column.connected.value, false)
  assert.equal(column.canReconnect.value, true)
  assert.equal(column.disconnectNotices.value.length, 1)
  const firstNotice = column.disconnectNotices.value[0]
  mock.setOpenFailure(true)
  await column.reconnect()
  assert.equal(column.connected.value, false)
  assert.equal(column.canReconnect.value, true)
  assert.match(errors.at(-1), /could not reconnect.*device unavailable/)
  mock.setOpenFailure(false)
  await column.reconnect()
  assert.equal(column.connected.value, true)
  assert.equal(mock.requests, 1)
  assert.equal(mock.opens, 2)
  await column.disconnect()
  assert.equal(column.canReconnect.value, true)
  assert.equal(column.disconnectNotices.value.length, 1)
  await column.reconnect()
  assert.equal(column.connected.value, true)
  assert.equal(mock.requests, 1)
  column.handleDisconnect()
  column.handleDisconnect()
  await settle()
  assert.equal(column.disconnectNotices.value.length, 2)
  column.dismissDisconnectNotice(firstNotice.id)
  assert.equal(column.disconnectNotices.value.length, 1)
  await column.dispose()
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
  assert.equal(column.disconnectNotices.value.length, 1)
  assert.ok(column.disconnectNotices.value[0].time instanceof Date)
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
