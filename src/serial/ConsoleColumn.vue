<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ConsoleMessage from './ConsoleMessage.vue'
import { formatTimestamp } from './format'
import { selectedCopyText, selectionCell } from './selection'
import IntegerInput from '../components/IntegerInput.vue'
import type { ConsoleColumn } from './use-column'
import type { ColumnSettings, TimestampFormat } from './settings'

const props = defineProps<{ column: ConsoleColumn; format: TimestampFormat; visible: boolean }>()
const { settings, connected, canReconnect, busy, sending, info, messages, logging, disconnectNotices } = props.column
const sendInput = ref<HTMLInputElement>()
const input = ref('')
const portSettingsOpen = ref(false)
const consoleElement = ref<HTMLElement>()
const hexWidth = ref(settings.hexViewWidth)
const scrollbarWidth = ref(0)
const dragging = ref(false)
const visibleMessages = computed(() => messages.value.filter((message) =>
  message.type !== 'out' || settings.showOutgoing))
type ToggleKey = { [K in keyof ColumnSettings]: ColumnSettings[K] extends boolean ? K : never }[keyof ColumnSettings]
const toggles: { key: ToggleKey; label: string; title?: string }[] = [
  { key: 'sendCR', label: 'Send with \\r' },
  { key: 'sendLF', label: 'Send with \\n' },
  { key: 'hexEscape', label: 'Parse \\xHH hex escapes' },
  {
    key: 'keyEscape', label: 'Parse `KEY` escapes',
    title: '`CTRL+A` ... `CTRL+Z`: 0x01-0x1A\n`CTRL+C`: interrupt\n`CTRL+D`: soft reboot\n' +
      '`ESC`, `TAB`, `ENTER` / `CR`, `LF`, `BACKSPACE`, `DEL`, `NUL`, `SPACE`\n' +
      'Combine with + (Alt/Shift/Meta have no serial effect)',
  },
  { key: 'showTimestamps', label: 'Show timestamps' },
  { key: 'showOutgoing', label: 'Show outgoing data' },
  { key: 'showMsgNum', label: 'Show message number' },
]

async function send(single = false) {
  const original = input.value
  if (await props.column.send(original, single)) {
    // Do not discard text typed while the write was pending.
    if (input.value === original) input.value = single ? original.slice([...original][0]!.length) : ''
  }
  sendInput.value?.focus()
}
function toggleHex() {
  const size = messages.value.reduce((sum, message) => sum + message.bytes.length, 0)
  if (!settings.hexView && size > 20000 &&
      !confirm(`The buffer holds about ${size.toLocaleString()} bytes. Hex View may take a few seconds. Continue?`)) return
  settings.hexView = !settings.hexView
}
function maximumHexWidth() {
  const element = consoleElement.value
  if (!element) return settings.hexViewWidth
  const meta = element.querySelector('.meta-cell')?.getBoundingClientRect().width ?? 0
  return Math.max(80, element.clientWidth - 40 - meta - 80)
}
function layout() {
  hexWidth.value = Math.max(80, Math.min(settings.hexViewWidth, maximumHexWidth()))
  const element = consoleElement.value
  scrollbarWidth.value = element ? element.offsetWidth - element.clientWidth : 0
}
async function updateView() {
  await nextTick()
  layout()
  if (settings.autoScroll && consoleElement.value) {
    consoleElement.value.scrollTop = consoleElement.value.scrollHeight
  }
}
watch([messages, () => settings.autoScroll, () => settings.hexView,
  () => settings.showTimestamps, () => settings.showMsgNum,
  () => settings.showOutgoing, () => props.format], updateView, { flush: 'post' })
watch(() => props.visible, (visible) => { if (visible) void updateView() }, { flush: 'post' })

let startX = 0
let startWidth = 0
function resize(event: PointerEvent) {
  if (!dragging.value) return
  settings.hexViewWidth = Math.max(80, Math.min(maximumHexWidth(), startWidth + startX - event.clientX))
  layout()
}
function startResize(event: PointerEvent) {
  if (!(event.currentTarget instanceof HTMLElement)) return
  event.currentTarget.setPointerCapture(event.pointerId)
  dragging.value = true
  startX = event.clientX
  startWidth = hexWidth.value
  event.preventDefault()
}
function resizeKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  settings.hexViewWidth = Math.max(80, Math.min(maximumHexWidth(),
    hexWidth.value + (event.key === 'ArrowLeft' ? 10 : -10)))
  layout()
}

function beginSelection(event: PointerEvent) {
  const element = consoleElement.value
  if (!element || event.button !== 0) return
  const cell = selectionCell(event.target instanceof Node ? event.target : null)
  element.classList.remove('select-text', 'select-meta', 'select-hex')
  if (cell?.classList.contains('text-cell')) element.classList.add('select-text')
  else if (cell?.classList.contains('meta-cell')) element.classList.add('select-meta')
  else if (cell?.classList.contains('hex-cell')) element.classList.add('select-hex')
}
function copySelection(event: ClipboardEvent) {
  const element = consoleElement.value
  const selection = window.getSelection()
  if (!element || !selection || !event.clipboardData) return
  const text = selectedCopyText(element, selection)
  if (text === null) return
  event.clipboardData.setData('text/plain', text)
  event.preventDefault()
}
function closeLogOptions(event: KeyboardEvent) {
  const details = event.currentTarget
  if (!(details instanceof HTMLDetailsElement) || !details.open) return
  event.preventDefault()
  event.stopPropagation()
  details.open = false
  details.querySelector('summary')?.focus()
}
function syncSelection() {
  const element = consoleElement.value
  if (!element) return
  element.querySelectorAll('.sync-hl').forEach((span) => span.classList.remove('sync-hl'))
  const selection = window.getSelection()
  if (!settings.hexView || !selection || selection.isCollapsed || !selection.rangeCount) return
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return
  const cell = selectionCell(selection.anchorNode)
  const source = cell?.classList.contains('text-cell') ? '.char-cell' :
    cell?.classList.contains('hex-cell') ? '.hex-byte' : ''
  if (!source) return
  const target = source === '.char-cell' ? '.hex-byte' : '.char-cell'
  for (const row of element.querySelectorAll('.line-wrap')) {
    if (!range.intersectsNode(row)) continue
    let start = Infinity
    let end = -Infinity
    for (const span of row.querySelectorAll<HTMLElement>(source)) {
      if (range.intersectsNode(span)) {
        start = Math.min(start, Number(span.dataset.b0))
        end = Math.max(end, Number(span.dataset.b1))
      }
    }
    for (const span of row.querySelectorAll<HTMLElement>(target)) {
      if (Number(span.dataset.b0) < end && Number(span.dataset.b1) > start) span.classList.add('sync-hl')
    }
  }
}
let selectionFrame = 0
function scheduleSelection() {
  cancelAnimationFrame(selectionFrame)
  selectionFrame = requestAnimationFrame(syncSelection)
}
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(layout)
  if (consoleElement.value) observer.observe(consoleElement.value)
  document.addEventListener('selectionchange', scheduleSelection)
  void updateView()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('selectionchange', scheduleSelection)
  cancelAnimationFrame(selectionFrame)
})
</script>

<template>
  <section class="column panel" :aria-label="settings.label">
    <div class="col-header">
      <input v-model="settings.label" type="text" class="col-label" aria-label="Column label" title="Used in log filenames">
      <button
        class="connect-btn" :class="{ connected, disconnected: !connected && canReconnect }" :disabled="busy || sending"
        :title="connected ? 'Connected; click to disconnect' : canReconnect ? 'Reconnect to the previous connection' : 'Connect'"
        @click="connected ? column.disconnect() : canReconnect ? column.reconnect() : column.connect()"
      >{{ busy ? 'Please wait...' : connected ? 'Connected' : canReconnect ? 'Reconnect' : 'Connect' }}</button>
      <button v-if="settings.transport === 'serial' && canReconnect && !connected" :disabled="busy" title="Choose a different port" @click="column.connect()">Choose port</button>
      <button class="port-settings-btn" :class="{ open: portSettingsOpen }"
        :aria-expanded="portSettingsOpen" @click="portSettingsOpen = !portSettingsOpen"
      >Options</button>
      <span v-if="info" class="conn-info" :title="info">{{ info }}</span>
    </div>
    <div v-if="portSettingsOpen" class="conn-settings-panel">
      <div class="conn-settings-grid">
        <label class="field">Connection
          <select v-model="settings.transport" :disabled="connected || busy"><option value="serial">Serial</option><option value="telnet">Telnet</option></select>
        </label>
        <template v-if="settings.transport === 'telnet'">
          <label class="field">Host or IP address
            <input v-model.trim="settings.telnetHost" type="text" :disabled="connected || busy" placeholder="192.168.1.10">
          </label>
          <label class="field">Telnet port
            <IntegerInput v-model="settings.telnetPort" label="Telnet port" :min="1" :max="65535" :disabled="connected || busy" />
          </label>
        </template>
        <template v-else>
        <label class="field">Baud rate
          <IntegerInput v-model="settings.baud" label="Baud rate" list="baudPresets" :min="1" required :disabled="connected || busy" />
        </label>
        <label class="field">Data bits
          <select v-model="settings.dataBits" :disabled="connected || busy"><option :value="8">8</option><option :value="7">7</option></select>
        </label>
        <label class="field">Stop bits
          <select v-model="settings.stopBits" :disabled="connected || busy"><option :value="1">1</option><option :value="2">2</option></select>
        </label>
        <label class="field">Parity
          <select v-model="settings.parity" :disabled="connected || busy"><option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option></select>
        </label>
        <label class="field">Flow control
          <select v-model="settings.flowControl" :disabled="connected || busy"><option value="none">None</option><option value="hardware">Hardware</option></select>
        </label>
        </template>
      </div>
      <p v-if="settings.transport === 'telnet'">Requires the local Telnet gateway. Telnet is unencrypted.</p>
    </div>
    <form class="send-row" @submit.prevent="send()">
      <input ref="sendInput" v-model="input" type="text" class="send-input" placeholder="Message to send..." aria-label="Message to send">
      <button class="send-btn" :disabled="!connected || busy || sending || !input">Send</button>
      <button class="send-char-btn" type="button" :disabled="!connected || busy || sending || !input"
        title="Send only the first character, without escapes or line endings" @click="send(true)"
      >Send Char</button>
    </form>
    <div class="console-toolbar">
      <button class="options-btn" :class="{ open: settings.optionsOpen }"
        :aria-expanded="settings.optionsOpen" @click="settings.optionsOpen = !settings.optionsOpen"
      >Send / display</button>
      <button class="toggle-btn autoscroll-btn" :class="{ active: settings.autoScroll }"
        :aria-pressed="settings.autoScroll" @click="settings.autoScroll = !settings.autoScroll"
      >Auto-scroll</button>
      <button class="toggle-btn hexview-btn" :class="{ active: settings.hexView }"
        :aria-pressed="settings.hexView" @click="toggleHex"
      >Hex View</button>
    </div>
    <div v-if="settings.optionsOpen" class="options-panel">
      <div class="options-grid">
        <button v-for="toggle in toggles" :key="toggle.key" class="toggle-btn"
          :class="{ active: settings[toggle.key] }" :aria-pressed="settings[toggle.key]"
          :title="toggle.title" @click="settings[toggle.key] = !settings[toggle.key]"
        >{{ toggle.label }}</button>
      </div>
    </div>
    <div class="console-wrapper">
      <div ref="consoleElement" class="console" tabindex="0" :aria-label="`${settings.label} messages`"
        :style="{ gridTemplateColumns: settings.hexView ? `max-content minmax(0, 1fr) ${hexWidth}px` : 'max-content minmax(0, 1fr)' }"
        @pointerdown="beginSelection" @copy="copySelection"
      >
        <ConsoleMessage v-for="message in visibleMessages" :key="message.num"
          :message="message" :settings="settings" :format="format"
        />
      </div>
      <div v-if="settings.hexView" class="hex-resizer" :class="{ dragging }"
        :style="{ right: `${scrollbarWidth + hexWidth + 5}px` }"
        role="separator" aria-label="Resize hex view" aria-orientation="vertical"
        :aria-valuenow="Math.round(hexWidth)" :aria-valuemin="80" :aria-valuemax="Math.round(maximumHexWidth())"
        tabindex="0" title="Drag or use arrow keys to resize hex view"
        @pointerdown="startResize" @pointermove="resize" @pointerup="dragging = false"
        @lostpointercapture="dragging = false" @keydown="resizeKey"
      />
      <div v-if="disconnectNotices.length" class="disconnect-notices">
        <div v-for="notice in disconnectNotices" :key="notice.id" class="disconnect-notice" role="alert">
          <div><time :datetime="notice.time.toISOString()">{{ formatTimestamp(notice.time, format) }}</time>
            <span>Connection lost. Reconnect when available.</span></div>
          <button type="button" aria-label="Dismiss disconnect warning"
            @click="column.dismissDisconnectNotice(notice.id)">×</button>
        </div>
      </div>
    </div>
    <div class="log-row">
      <button class="clear-btn" @click="column.clear()">Clear</button>
      <button class="log-btn" @click="logging ? column.stopLogging() : column.startLogging()"
      >{{ logging ? 'Stop Logging (Save File)' : 'Start Logging' }}</button>
      <details class="log-options" @keydown.esc="closeLogOptions">
        <summary>Log options</summary>
        <div class="log-options-panel">
          <button class="toggle-btn" :class="{ active: settings.logMetadata }"
            :aria-pressed="settings.logMetadata" @click="settings.logMetadata = !settings.logMetadata"
          >Include metadata in log</button>
          <button class="toggle-btn" :class="{ active: settings.logIncludeBuffered }"
            :aria-pressed="settings.logIncludeBuffered" @click="settings.logIncludeBuffered = !settings.logIncludeBuffered"
            title="Include messages already in the buffer when logging starts"
          >Include buffered history</button>
        </div>
      </details>
    </div>
  </section>
</template>
