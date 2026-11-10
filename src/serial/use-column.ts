import { effectScope, ref, shallowRef } from 'vue'
import { logFilename, logLine, outgoingParts, parseOutgoingText, ReceivedText, type Message, type TextPart } from './format.ts'
import {
  defaultColumnSettings, errorMessage, savedSettings, validateColumn,
  type GlobalSettings,
} from './settings.ts'

export interface SerialPort {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: {
    baudRate: number
    dataBits: 7 | 8
    stopBits: 1 | 2
    parity: 'none' | 'even' | 'odd'
    flowControl: 'none' | 'hardware'
  }): Promise<void>
  close(): Promise<void>
  getInfo(): { usbVendorId?: number; usbProductId?: number }
}
export interface SerialApi extends EventTarget {
  requestPort(): Promise<SerialPort>
}
export function serialApi() {
  return (navigator as Navigator & { serial?: SerialApi }).serial
}

export function useColumn(index: number, global: GlobalSettings, report: (message: string) => void) {
  const preferenceScope = effectScope(true)
  const settings = preferenceScope.run(() =>
    savedSettings(`wsc_col_${index}`, defaultColumnSettings(index), validateColumn, report))!
  const connected = ref(false)
  const busy = ref(false)
  const sending = ref(false)
  const info = ref('')
  const messages = shallowRef<Message[]>([])
  const logging = ref(false)
  let counter = 0
  let port: SerialPort | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  let readDone: Promise<void> | null = null
  let closing: Promise<void> | null = null
  let logStart = new Date()
  let logLines: string[] = []

  function append(type: Message['type'], text: string, bytes: Uint8Array, outgoing?: TextPart[]) {
    const message = { type, text, bytes, time: new Date(), num: ++counter, outgoing }
    messages.value = [...messages.value, message].slice(-global.bufferSize)
    if (logging.value) record(message)
  }
  function record(message: Message) {
    const line = logLine(message, settings, global.tsFormat)
    if (line !== null) logLines.push(line)
  }
  function trim() { messages.value = messages.value.slice(-global.bufferSize) }
  function clear() { messages.value = [] }

  async function releasePort() {
    connected.value = false
    const failures: string[] = []
    async function attempt(action: () => void | Promise<unknown>) {
      try { await action() } catch (error) { failures.push(errorMessage(error)) }
    }
    if (reader) await attempt(() => reader!.cancel())
    if (readDone) await attempt(() => readDone!)
    if (writer) {
      await attempt(() => writer!.close())
      await attempt(() => writer!.releaseLock())
    }
    if (port) await attempt(() => port!.close())
    reader = null
    writer = null
    port = null
    readDone = null
    info.value = ''
    if (failures.length) report(`${settings.label}: disconnect failed: ${failures.join('; ')}`)
    return failures.length === 0
  }
  async function disconnect() {
    if (closing) return closing
    busy.value = true
    closing = releasePort().then(() => {})
    try { await closing } finally { closing = null; busy.value = false }
  }
  async function readLoop(stream: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new ReceivedText()
    try {
      while (connected.value) {
        const { value, done } = await stream.read()
        if (done) break
        if (value?.length) {
          const decoded = decoder.push(value)
          if (decoded.bytes.length) append('in', decoded.text, decoded.bytes)
        }
      }
    } catch (error) {
      if (connected.value) report(`${settings.label}: read failed: ${errorMessage(error)}`)
    } finally {
      const tail = decoder.push(new Uint8Array(), true)
      if (tail.bytes.length) append('in', tail.text, tail.bytes)
      stream.releaseLock()
      reader = null
      if (connected.value) {
        report(`${settings.label}: device disconnected or the serial stream ended.`)
        // Do not await cleanup here: cleanup waits for this read loop.
        queueMicrotask(() => { void disconnect() })
      }
    }
  }
  async function open(device: SerialPort) {
    validateColumn(settings)
    await device.open({
      baudRate: settings.baud, dataBits: settings.dataBits, stopBits: settings.stopBits,
      parity: settings.parity, flowControl: settings.flowControl,
    })
    port = device
    try {
      if (!device.readable || !device.writable) throw new Error('Port has no readable/writable stream')
      writer = device.writable.getWriter()
      reader = device.readable.getReader()
      const pi = device.getInfo()
      const parity = settings.parity === 'none' ? 'N' : settings.parity === 'even' ? 'E' : 'O'
      info.value = `${settings.baud} ${settings.dataBits}${parity}${settings.stopBits}` +
        (settings.flowControl === 'hardware' ? ', HW flow' : '') +
        (pi.usbVendorId !== undefined || pi.usbProductId !== undefined ?
          ` (VID:${pi.usbVendorId?.toString(16).padStart(4, '0') ?? '????'} ` +
          `PID:${pi.usbProductId?.toString(16).padStart(4, '0') ?? '????'})` : '')
      connected.value = true
      readDone = readLoop(reader)
    } catch (error) {
      if (reader) { reader.releaseLock(); reader = null }
      await releasePort()
      throw error
    }
  }
  async function connect() {
    const api = serialApi()
    if (!api) { report('Web Serial is unavailable. Use Chrome or Edge over HTTPS or localhost.'); return }
    if (busy.value || connected.value) return
    busy.value = true
    try {
      // Call the chooser before any await to preserve the user gesture.
      const device = await api.requestPort()
      await open(device)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
        report(`${settings.label}: failed to connect: ${errorMessage(error)}`)
      }
    } finally { busy.value = false }
  }
  async function refresh() {
    if (!connected.value || !port || busy.value) return
    const device = port
    busy.value = true
    try {
      if (!await releasePort()) return
      await open(device)
    } catch (error) {
      report(`${settings.label}: could not re-open port: ${errorMessage(error)}`)
    } finally { busy.value = false }
  }
  async function send(text: string, singleCharacter = false) {
    if (!text || sending.value) return false
    if (!writer || !connected.value || busy.value) {
      report(`${settings.label}: connect a port before sending.`)
      return false
    }
    sending.value = true
    const raw = singleCharacter ? [...text][0]! : text
    const payload = singleCharacter ? raw :
      raw + (settings.sendCR ? '\r' : '') + (settings.sendLF ? '\n' : '')
    const bytes = singleCharacter ? new TextEncoder().encode(raw) :
      parseOutgoingText(payload, settings.hexEscape, settings.keyEscape)
    const parts = outgoingParts(raw, !singleCharacter && settings.hexEscape, !singleCharacter && settings.keyEscape)
    let offset = parts.at(-1)?.end ?? 0
    if (!singleCharacter) {
      for (const [enabled, text] of [[settings.sendCR, '\\r'], [settings.sendLF, '\\n']] as const) {
        if (enabled) parts.push({ text, start: offset, end: ++offset, style: '' })
      }
    }
    try {
      await writer.write(bytes)
      append('out', singleCharacter ? raw :
        raw + (settings.sendCR ? '\\r' : '') + (settings.sendLF ? '\\n' : ''), bytes, parts)
      return true
    } catch (error) {
      report(`${settings.label}: send failed: ${errorMessage(error)}`)
      return false
    } finally { sending.value = false }
  }
  function startLogging() {
    logLines = []
    logStart = new Date()
    if (settings.logIncludeBuffered) messages.value.forEach(record)
    logging.value = true
  }
  function stopLogging() {
    const blob = new Blob([logLines.join('\n') + (logLines.length ? '\n' : '')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = logFilename(logStart, settings.label)
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    logging.value = false
  }
  return {
    index, settings, connected, busy, sending, info, messages, logging,
    connect, disconnect, refresh, send, trim, clear, startLogging, stopLogging,
    dispose: async () => { preferenceScope.stop(); await disconnect() },
    ownsPort: (device: EventTarget | null) => port === device,
  }
}
export type ConsoleColumn = ReturnType<typeof useColumn>
