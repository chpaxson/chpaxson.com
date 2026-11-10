import type { ColumnSettings, TimestampFormat } from './settings'

export interface Message {
  type: 'in' | 'out'
  text: string
  bytes: Uint8Array
  time: Date
  num: number
  outgoing?: TextPart[]
}
export interface TextPart {
  text: string
  start: number
  end: number
  style: string
}

const pad = (n: number, length = 2) => String(n).padStart(length, '0')

export function formatTimestamp(date: Date, format: TimestampFormat) {
  if (format === 'iso') return date.toISOString()
  if (format === 'unix') return String(date.getTime())
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return format === 'time' ? time : `${time}.${pad(date.getMilliseconds(), 3)}`
}

export function messageMeta(message: Message, settings: ColumnSettings, format: TimestampFormat) {
  const parts: string[] = []
  if (settings.showMsgNum) parts.push(`#${message.num}`)
  if (settings.showTimestamps) parts.push(formatTimestamp(message.time, format))
  if (settings.showOutgoing) parts.push(message.type === 'out' ? '->' : '<-')
  return parts.join(' ')
}

export function logLine(message: Message, settings: ColumnSettings, format: TimestampFormat) {
  if (message.type === 'out' && !settings.showOutgoing) return null
  const meta = settings.logMetadata ? messageMeta(message, settings, format) : ''
  return meta ? `${meta} ${message.text}` : message.text
}

export function logFilename(date: Date, label: string) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_` +
    `${(label || 'port').replace(/[^a-z0-9_-]/gi, '_')}.log`
}

const namedKeys: Record<string, number> = {
  ENTER: 13, RETURN: 13, CR: 13, LF: 10, NEWLINE: 10, LINEFEED: 10, TAB: 9,
  ESC: 27, ESCAPE: 27, SPACE: 32, BACKSPACE: 8, BS: 8, DEL: 127, DELETE: 127,
  NUL: 0, NULL: 0,
}
const ctrlSymbols: Record<string, number> = { '@': 0, '[': 27, '\\': 28, ']': 29, '^': 30, '_': 31, '?': 127 }

export function resolveKeyCombo(token: string): number | null {
  const parts = token.toUpperCase().split('+').map((part) => part.trim()).filter(Boolean)
  const ctrl = parts.includes('CTRL') || parts.includes('CONTROL')
  const base = parts.filter((part) =>
    !['CTRL', 'CONTROL', 'ALT', 'SHIFT', 'META', 'CMD', 'WIN', 'OPTION'].includes(part)).at(-1)
  if (!base) return null
  if (ctrl) {
    if (/^[A-Z]$/.test(base)) return base.charCodeAt(0) - 64
    if (base === 'SPACE') return 0
    if (Object.prototype.hasOwnProperty.call(ctrlSymbols, base)) return ctrlSymbols[base]!
  }
  if (Object.prototype.hasOwnProperty.call(namedKeys, base)) return namedKeys[base]!
  return /^[A-Z0-9]$/.test(base) ? base.charCodeAt(0) : null
}

// Keep display tokens attached to their actual byte ranges, including escape
// spellings and the visible \r / \n suffixes on outgoing messages.
export function outgoingParts(text: string, hexEscape: boolean, keyEscape: boolean): TextPart[] {
  const parts: TextPart[] = []
  let offset = 0
  for (let i = 0; i < text.length;) {
    let token = String.fromCodePoint(text.codePointAt(i)!)
    let size = new TextEncoder().encode(token).length
    if (hexEscape && /^\\x[0-9a-f]{2}/i.test(text.slice(i))) {
      token = text.slice(i, i + 4)
      size = 1
    } else if (keyEscape && text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1 && resolveKeyCombo(text.slice(i + 1, end)) !== null) {
        token = text.slice(i, end + 1)
        size = 1
      }
    }
    parts.push({ text: token, start: offset, end: offset + size, style: '' })
    offset += size
    i += token.length
  }
  return parts
}

export function parseOutgoingText(text: string, hexEscape: boolean, keyEscape: boolean) {
  const bytes: number[] = []
  for (const part of outgoingParts(text, hexEscape, keyEscape)) {
    if (hexEscape && /^\\x[0-9a-f]{2}$/i.test(part.text)) {
      bytes.push(Number.parseInt(part.text.slice(2), 16))
    } else if (keyEscape && part.text.length > 1 && part.text.startsWith('`') && part.text.endsWith('`')) {
      bytes.push(resolveKeyCombo(part.text.slice(1, -1))!)
    } else {
      bytes.push(...new TextEncoder().encode(part.text))
    }
  }
  return new Uint8Array(bytes)
}

const ansiBase = [
  '#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
]
function ansi256(n: number) {
  if (n < 16) return n === 0 ? '#000000' : ansiBase[n]!
  if (n >= 232) return `rgb(${Array(3).fill(8 + (n - 232) * 10).join(',')})`
  const levels = [0, 95, 135, 175, 215, 255]
  n -= 16
  return `rgb(${[levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6]].join(',')})`
}
function freshAnsi() {
  return { fg: '', bg: '', bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false }
}
function ansiStyle(state: ReturnType<typeof freshAnsi>) {
  const fg = state.inverse ? state.bg || 'var(--console-bg)' : state.fg
  const bg = state.inverse ? state.fg || 'var(--console-text)' : state.bg
  return [
    fg && `color:${fg}`, bg && `background-color:${bg}`,
    state.bold && 'font-weight:bold', state.dim && 'opacity:0.65',
    state.italic && 'font-style:italic',
    (state.underline || state.strike) &&
      `text-decoration:${[state.underline && 'underline', state.strike && 'line-through'].filter(Boolean).join(' ')}`,
  ].filter(Boolean).join(';')
}
function applySgr(state: ReturnType<typeof freshAnsi>, params: string) {
  const codes = params ? params.split(';').map(Number) : [0]
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) Object.assign(state, freshAnsi())
    else if (code === 1) state.bold = true
    else if (code === 2) state.dim = true
    else if (code === 3) state.italic = true
    else if (code === 4) state.underline = true
    else if (code === 7) state.inverse = true
    else if (code === 9) state.strike = true
    else if (code === 22) { state.bold = false; state.dim = false }
    else if (code === 23) state.italic = false
    else if (code === 24) state.underline = false
    else if (code === 27) state.inverse = false
    else if (code === 29) state.strike = false
    else if (code === 39) state.fg = ''
    else if (code === 49) state.bg = ''
    else if (code >= 30 && code <= 37) state.fg = ansiBase[code - 30]!
    else if (code >= 40 && code <= 47) state.bg = ansiBase[code - 40]!
    else if (code >= 90 && code <= 97) state.fg = ansiBase[code - 90 + 8]!
    else if (code >= 100 && code <= 107) state.bg = ansiBase[code - 100 + 8]!
    else if (code === 38 || code === 48) {
      const target = code === 38 ? 'fg' : 'bg'
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined && codes[i + 2]! <= 255) {
        state[target] = ansi256(codes[i + 2]!)
        i += 2
      } else if (codes[i + 1] === 2 && codes.slice(i + 2, i + 5).length === 3 &&
          codes.slice(i + 2, i + 5).every((n) => n >= 0 && n <= 255)) {
        state[target] = `rgb(${codes.slice(i + 2, i + 5).join(',')})`
        i += 4
      }
    }
  }
}

export function ansiParts(text: string, perCharacter = false): TextPart[] {
  const parts: TextPart[] = []
  const state = freshAnsi()
  let byteOffset = 0
  let index = 0
  const pattern = /\x1b\[([0-9;]*)([A-Za-z])/g
  function literal(value: string) {
    for (const chunk of perCharacter ? [...value] : [value]) {
      if (!chunk) continue
      const end = byteOffset + new TextEncoder().encode(chunk).length
      parts.push({ text: chunk, start: byteOffset, end, style: ansiStyle(state) })
      byteOffset = end
    }
  }
  for (const match of text.matchAll(pattern)) {
    literal(text.slice(index, match.index))
    byteOffset += new TextEncoder().encode(match[0]).length
    if (match[2] === 'm') applySgr(state, match[1]!)
    index = match.index! + match[0].length
  }
  literal(text.slice(index))
  return parts
}

// Retain incomplete UTF-8 code points between reads so text and raw-byte
// columns agree even when a device splits a character across USB packets.
export class ReceivedText {
  private pending = new Uint8Array()

  push(value: Uint8Array, final = false) {
    const combined = new Uint8Array(this.pending.length + value.length)
    combined.set(this.pending)
    combined.set(value, this.pending.length)
    let end = combined.length
    if (!final) {
      let start = end - 1
      while (start >= 0 && (combined[start]! & 0xc0) === 0x80) start--
      if (start >= 0) {
        const lead = combined[start]!
        const expected = lead >= 0xc2 && lead <= 0xdf ? 2 :
          lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 1
        if (end - start < expected) end = start
      }
    }
    this.pending = combined.slice(end)
    const bytes = combined.slice(0, end)
    return { bytes, text: new TextDecoder().decode(bytes) }
  }
}
