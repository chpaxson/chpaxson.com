import { ref, shallowRef } from 'vue'
import { errorMessage } from './settings.ts'

export interface GatewayTarget { host: string; port: number }
const gatewayUrl = 'ws://127.0.0.1:8765'

export function useGateway(report: (message: string) => void) {
  const unlocked = ref(false)
  const busy = ref(false)
  const error = ref('')
  const targets = shallowRef<GatewayTarget[]>([])
  let token: string | null = null
  let socket: WebSocket | null = null
  function fail(message: string, notify = false) {
    error.value = message
    if (notify) report(message)
  }

  async function unlock(value: string) {
    if (busy.value || unlocked.value) return
    error.value = ''
    if (!value) { fail('Enter the local gateway token.'); return }
    busy.value = true
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(gatewayUrl)
        socket = ws
        let ready = false
        const timer = setTimeout(() => { ws.close(); reject(new Error('Gateway authentication timed out')) }, 12000)
        ws.onopen = () => ws.send(JSON.stringify({ type: 'control', token: value }))
        ws.onmessage = (event: MessageEvent<unknown>) => {
          try {
            if (typeof event.data !== 'string') throw new Error('Invalid gateway response')
            const response: unknown = JSON.parse(event.data)
            if (typeof response !== 'object' || response === null || !('type' in response)) {
              throw new Error('Invalid gateway response')
            }
            if (response.type === 'error' && 'message' in response && typeof response.message === 'string') {
              if (!ready) throw new Error(response.message)
              fail(`Gateway: ${response.message}`)
              return
            }
            if (response.type !== 'targets' || !('targets' in response) || !Array.isArray(response.targets) ||
                !response.targets.every((item: unknown) =>
                  typeof item === 'object' && item !== null && 'host' in item && typeof item.host === 'string' &&
                  'port' in item && typeof item.port === 'number' && Number.isInteger(item.port) &&
                  item.port >= 1 && item.port <= 65535)) throw new Error('Invalid gateway target list')
            targets.value = response.targets
            if (!ready) {
              ready = true
              clearTimeout(timer)
              token = value
              unlocked.value = true
              resolve()
            }
          } catch (error) {
            if (!ready) reject(error)
            else fail(`Gateway: ${errorMessage(error)}`, true)
            ws.close()
          }
        }
        ws.onerror = () => {
          if (!ready) reject(new Error('Cannot reach local Telnet gateway'))
        }
        ws.onclose = (event) => {
          clearTimeout(timer)
          if (!ready) reject(new Error(event.reason || 'Gateway connection closed'))
          if (socket !== ws) return
          socket = null
          token = null
          targets.value = []
          unlocked.value = false
          if (ready && event.code !== 1000) fail(`Gateway disconnected: ${event.reason || 'connection lost'}`, true)
        }
      })
    } catch (error) {
      fail(`Gateway: ${errorMessage(error)}`)
    } finally { busy.value = false }
  }
  function lock() {
    const ws = socket
    socket = null
    token = null
    targets.value = []
    unlocked.value = false
    error.value = ''
    ws?.close()
  }
  function updateTarget(type: 'add' | 'remove', host: string, port: number) {
    if (!socket || !unlocked.value || socket.readyState !== WebSocket.OPEN) {
      fail('Unlock the gateway before changing destinations.')
      return
    }
    error.value = ''
    try { socket.send(JSON.stringify({ type, host: host.trim(), port })) }
    catch (error) { fail(`Gateway: could not update destination: ${errorMessage(error)}`) }
  }
  return { unlocked, busy, error, targets, unlock, lock, updateTarget, token: () => token }
}
export type Gateway = ReturnType<typeof useGateway>
