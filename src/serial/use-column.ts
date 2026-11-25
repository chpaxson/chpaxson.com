import { computed, effectScope, ref, shallowRef } from 'vue'
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

export function useColumn(index: number, global: GlobalSettings, report: (message: string) => void,
  gatewayToken: () => string | null = () => null) {
  const preferenceScope = effectScope(true)
  const settings = preferenceScope.run(() =>
    savedSettings(`wsc_col_${index}`, defaultColumnSettings(index), validateColumn, report))!
  const connected = ref(false)
  const serialCanReconnect = ref(false)
  const telnetCanReconnect = ref(false)
  const canReconnect = computed(() => settings.transport === 'serial' ? serialCanReconnect.value : telnetCanReconnect.value)
  const busy = ref(false)
  const sending = ref(false)
  const info = ref('')
  const messages = shallowRef<Message[]>([])
  const logging = ref(false)
  const disconnectNotices = shallowRef<{ id: number; time: Date }[]>([])
  let noticeId = 0
  let counter = 0
  let port: SerialPort | null = null
  let rememberedPort: SerialPort | null = null
  let socket: WebSocket | null = null
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
    if (socket) {
      const current = socket
      socket = null
      current.close()
    }
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
  function handleDisconnect() {
    if (!connected.value) return
    disconnectNotices.value = [...disconnectNotices.value, { id: ++noticeId, time: new Date() }].slice(-8)
    void disconnect()
  }
  function dismissDisconnectNotice(id: number) {
    disconnectNotices.value = disconnectNotices.value.filter((notice) => notice.id !== id)
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
        // Do not await cleanup here: cleanup waits for this read loop.
        queueMicrotask(handleDisconnect)
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
      rememberedPort = device
      serialCanReconnect.value = true
      readDone = readLoop(reader)
    } catch (error) {
      if (reader) { reader.releaseLock(); reader = null }
      await releasePort()
      throw error
    }
  }
  async function reconnect() {
    if (settings.transport === 'telnet') {
      await connect()
      return
    }
    if (!rememberedPort || busy.value || connected.value) return
    busy.value = true
    try {
      await open(rememberedPort)
    } catch (error) {
      report(`${settings.label}: could not reconnect to the previous port: ${errorMessage(error)}`)
    } finally { busy.value = false }
  }
  async function connect() {
    if (settings.transport === 'telnet') {
      if (busy.value || connected.value) return
      busy.value = true
      try {
        validateColumn(settings)
        const host = settings.telnetHost.trim()
        if (!host) throw new Error('Enter a Telnet host or IP address in Options')
        await openTelnet(host, settings.telnetPort)
      } catch (error) {
        report(`${settings.label}: failed to connect: ${errorMessage(error)}`)
      } finally { busy.value = false }
      return
    }
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
  function openTelnet(host: string, portNumber: number) {
    const token = gatewayToken()
    if (!token) throw new Error('Unlock the Telnet gateway in Options first')
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:8765')
      ws.binaryType = 'arraybuffer'
      socket = ws
      const decoder = new ReceivedText()
      let ready = false
      ws.onopen = () => ws.send(JSON.stringify({ type: 'connect', token, host, port: portNumber }))
      ws.onmessage = (event: MessageEvent<unknown>) => {
        if (!ready && typeof event.data === 'string') {
          try {
            const response: unknown = JSON.parse(event.data)
            if (typeof response !== 'object' || response === null || !('type' in response) || response.type !== 'ready') {
              throw new Error('Invalid gateway response')
            }
            ready = true
            info.value = `Telnet ${host}:${portNumber}`
            connected.value = true
            telnetCanReconnect.value = true
            resolve()
          } catch (error) {
            ws.close()
            reject(error)
          }
        } else if (ready && event.data instanceof ArrayBuffer) {
          const decoded = decoder.push(new Uint8Array(event.data))
          if (decoded.bytes.length) append('in', decoded.text, decoded.bytes)
        } else {
          report(`${settings.label}: invalid gateway message`)
          ws.close()
        }
      }
      ws.onerror = () => {
        if (!ready) reject(new Error('Cannot reach local Telnet gateway'))
        else report(`${settings.label}: Telnet gateway connection failed`)
      }
      ws.onclose = (event) => {
        if (!ready) reject(new Error(event.reason || 'Local Telnet gateway connection closed'))
        if (socket !== ws) return
        socket = null
        if (ready) {
          const tail = decoder.push(new Uint8Array(), true)
          if (tail.bytes.length) append('in', tail.text, tail.bytes)
          if (event.reason && event.code !== 1000) report(`${settings.label}: ${event.reason}`)
          handleDisconnect()
        }
      }
    })
  }
  async function refresh() {
    if (settings.transport === 'telnet' && connected.value && !busy.value) {
      busy.value = true
      try {
        if (!await releasePort()) return
        await openTelnet(settings.telnetHost.trim(), settings.telnetPort)
      } catch (error) {
        report(`${settings.label}: could not reconnect: ${errorMessage(error)}`)
      } finally { busy.value = false }
      return
    }
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
    if ((!writer && !socket) || !connected.value || busy.value) {
      report(`${settings.label}: connect before sending.`)
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
      if (socket) socket.send(bytes)
      else if (writer) await writer.write(bytes)
      else throw new Error('Connection closed before sending')
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
    index, settings, connected, canReconnect, busy, sending, info, messages, logging, disconnectNotices,
    connect, reconnect, disconnect, refresh, send, trim, clear, startLogging, stopLogging,
    handleDisconnect, dismissDisconnectNotice,
    dispose: async () => { preferenceScope.stop(); await disconnect() },
    ownsPort: (device: EventTarget | null) => port === device,
  }
}
export type ConsoleColumn = ReturnType<typeof useColumn>
