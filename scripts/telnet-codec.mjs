const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240

export class TelnetDecoder {
  state = 'data'
  command = 0

  push(bytes) {
    const data = []
    const replies = []
    for (const byte of bytes) {
      if (this.state === 'data') {
        if (byte === IAC) this.state = 'iac'
        else data.push(byte)
      } else if (this.state === 'iac') {
        if (byte === IAC) { data.push(byte); this.state = 'data' }
        else if ([DO, DONT, WILL, WONT].includes(byte)) { this.command = byte; this.state = 'option' }
        else if (byte === SB) this.state = 'sub'
        else this.state = 'data'
      } else if (this.state === 'option') {
        if (this.command === DO) replies.push(IAC, WONT, byte)
        if (this.command === WILL) replies.push(IAC, DONT, byte)
        this.state = 'data'
      } else if (this.state === 'sub') {
        if (byte === IAC) this.state = 'sub-iac'
      } else {
        this.state = byte === SE ? 'data' : 'sub'
      }
    }
    return { data: Buffer.from(data), replies: Buffer.from(replies) }
  }
}

export function encodeTelnet(bytes) {
  const result = []
  for (const byte of bytes) {
    result.push(byte)
    if (byte === IAC) result.push(IAC)
  }
  return Buffer.from(result)
}
