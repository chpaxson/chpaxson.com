import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { TelnetDecoder, encodeTelnet } from './telnet-codec.mjs'

const origins = new Set()
const targets = new Set()
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i += 2) {
  const [option, value] = args.slice(i, i + 2)
  if (!value || !['--origin', '--target'].includes(option)) {
    console.error('Usage: npm run telnet-gateway -- --origin https://site.example --target host:port [--target host:port ...]')
    process.exit(1)
  }
  if (option === '--origin') {
    let url
    try { url = new URL(value) } catch { console.error(`Invalid origin: ${value}`); process.exit(1) }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
      console.error(`Origin must be an exact HTTP(S) origin: ${value}`)
      process.exit(1)
    }
    origins.add(value)
  } else {
    const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):([0-9]+)$/i.exec(value)
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
      console.error(`Invalid target: ${value}`)
      process.exit(1)
    }
    targets.add(`${match[1].toLowerCase()}:${Number(match[2])}`)
  }
}
if (!origins.size || !targets.size) {
  console.error('At least one --origin and --target are required.')
  process.exit(1)
}

const server = createServer((_, response) => { response.writeHead(404); response.end() })
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/' || !origins.has(request.headers.origin)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws))
})
wss.on('connection', (ws) => {
  let tcp
  let ready = false
  const decoder = new TelnetDecoder()
  const timeout = setTimeout(() => ws.close(1008, 'Connection timed out'), 10000)
  function fail(message) {
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, message.slice(0, 100))
    tcp?.destroy()
  }
  ws.on('error', (error) => { console.error('WebSocket error:', error.message); tcp?.destroy() })
  ws.on('close', () => { clearTimeout(timeout); tcp?.destroy() })
  ws.on('message', (message, binary) => {
    if (!tcp) {
      if (binary) { ws.close(1008, 'Expected connection request'); return }
      let request
      try { request = JSON.parse(message.toString()) } catch { ws.close(1008, 'Invalid connection request'); return }
      if (typeof request?.host !== 'string' || !Number.isInteger(request.port)) {
        ws.close(1008, 'Invalid target'); return
      }
      const host = request.host.toLowerCase()
      if (!targets.has(`${host}:${request.port}`)) { ws.close(1008, 'Target not allowed by gateway'); return }
      tcp = createConnection({ host: host.replace(/^\[|\]$/g, ''), port: request.port })
      tcp.on('connect', () => { clearTimeout(timeout); ready = true; ws.send(JSON.stringify({ type: 'ready' })) })
      tcp.on('data', (chunk) => {
        const { data, replies } = decoder.push(chunk)
        if (replies.length) tcp.write(replies)
        if (data.length && ws.readyState === WebSocket.OPEN) {
          if (ws.bufferedAmount > 1024 * 1024) { fail('Browser is not keeping up'); return }
          ws.send(data)
        }
      })
      tcp.on('error', (error) => fail(`Telnet error: ${error.message}`))
      tcp.on('close', () => { if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Telnet connection closed') })
    } else if (!binary || !ready) {
      ws.close(1008, 'Expected data after connection')
    } else if (tcp.writableLength > 1024 * 1024) {
      fail('Telnet server is not keeping up')
    } else {
      tcp.write(encodeTelnet(message))
    }
  })
})
server.on('error', (error) => { console.error(`Gateway error: ${error.message}`); process.exitCode = 1 })
server.listen(8765, '127.0.0.1', () => {
  console.log(`Telnet gateway listening on 127.0.0.1:8765; allowed origins: ${[...origins].join(', ')}; targets: ${[...targets].join(', ')}`)
})
