<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import ConsoleColumn from './ConsoleColumn.vue'
import IntegerInput from '../components/IntegerInput.vue'
import { serialApi, useColumn, type ConsoleColumn as Column } from './use-column'
import { adjustColumnWidths, boundedInteger, savedSettings, validateGlobal, type GlobalSettings } from './settings'

const notice = ref('')
function report(message: string) {
  console.error(message)
  notice.value = notice.value ? `${notice.value}\n${message}` : message
}
const settings = savedSettings<GlobalSettings>('wsc_global', {
  numColumns: 2, bufferSize: 500, tsFormat: 'time-ms', darkMode: true, tabbedView: false,
}, validateGlobal, report)
const columns = shallowRef<Column[]>(Array.from({ length: settings.numColumns },
  (_, index) => useColumn(index, settings, report)))
const supported = !!serialApi()
const refreshing = ref(false)
const changingColumns = ref(false)
const narrowScreen = ref(false)
const tabbed = computed(() => narrowScreen.value || settings.tabbedView)
const activeTab = ref(0)
const narrowQuery = window.matchMedia('(max-width: 600px)')
const settingsDialog = ref<HTMLDialogElement>()
const settingsButton = ref<HTMLButtonElement>()
const baudPresets = [300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

watch(() => settings.bufferSize, () => columns.value.forEach((column) => column.trim()))
async function changeBuffer(event: Event) {
  const input = event.target as HTMLInputElement
  settings.bufferSize = boundedInteger(input.valueAsNumber, 10, 20000, 500)
  input.value = String(settings.bufferSize)
}
async function changeColumns(event: Event) {
  const input = event.target as HTMLInputElement
  const count = boundedInteger(input.valueAsNumber, 1, 8, 2)
  input.value = String(count)
  if (count === columns.value.length) return
  const removed = columns.value.slice(count)
  if (removed.some((column) => column.logging.value) &&
      !confirm('Removed columns are logging. Save their logs and remove these columns?')) {
    input.value = String(columns.value.length)
    return
  }
  changingColumns.value = true
  try {
    for (const column of removed) {
      if (column.logging.value) column.stopLogging()
      await column.dispose()
    }
    columns.value = Array.from({ length: count },
      (_, index) => columns.value[index] ?? useColumn(index, settings, report))
    if (activeTab.value >= count) activeTab.value = count - 1
    settings.numColumns = count
  } finally { changingColumns.value = false }
}
function updateNarrowScreen(event: MediaQueryList | MediaQueryListEvent) {
  narrowScreen.value = event.matches
}
function selectTab(index: number) {
  activeTab.value = index
}
function tabKey(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % columns.value.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + columns.value.length) % columns.value.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = columns.value.length - 1
  else return
  event.preventDefault()
  selectTab(next)
  void nextTick(() => document.getElementById(`serial-tab-${next}`)?.focus())
}
let resizeStart: { index: number; x: number; left: number; right: number; moved: boolean } | null = null
function columnPair(element: EventTarget | null, column: Column) {
  if (!(element instanceof HTMLElement)) return null
  const shell = element.parentElement
  const nextShell = shell?.nextElementSibling
  const nextColumn = columns.value[column.index + 1]
  if (!shell || !(nextShell instanceof HTMLElement) || !nextColumn) return null
  return {
    nextColumn,
    left: shell.getBoundingClientRect().width,
    right: nextShell.getBoundingClientRect().width,
  }
}
function resizePair(column: Column, nextColumn: Column, left: number, right: number, delta: number) {
  const widths = adjustColumnWidths(left, right, delta)
  column.settings.columnWidth = widths.left
  nextColumn.settings.columnWidth = widths.right
}
function startColumnResize(event: PointerEvent, column: Column) {
  if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return
  const pair = columnPair(event.currentTarget, column)
  if (!pair) return
  resizeStart = { index: column.index, x: event.clientX, left: pair.left, right: pair.right, moved: false }
  event.currentTarget.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function resizeColumn(event: PointerEvent, column: Column) {
  const nextColumn = columns.value[column.index + 1]
  if (resizeStart?.index === column.index && nextColumn &&
      (resizeStart.moved || event.clientX !== resizeStart.x)) {
    resizeStart.moved = true
    resizePair(column, nextColumn, resizeStart.left, resizeStart.right, event.clientX - resizeStart.x)
  }
}
function resetColumnPair(element: EventTarget | null, column: Column) {
  const pair = columnPair(element, column)
  if (pair) resizePair(column, pair.nextColumn, pair.left, pair.right, (pair.right - pair.left) / 2)
}
function resizeColumnKey(event: KeyboardEvent, column: Column) {
  if (!['Home', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') {
    resetColumnPair(event.currentTarget, column)
  } else {
    const pair = columnPair(event.currentTarget, column)
    if (pair) resizePair(column, pair.nextColumn, pair.left, pair.right, event.key === 'ArrowRight' ? 20 : -20)
  }
}
async function refreshPorts() {
  refreshing.value = true
  try { await Promise.all(columns.value.map((column) => column.refresh())) }
  finally { refreshing.value = false }
}
async function showSettings() {
  settingsDialog.value?.showModal()
  await nextTick()
  settingsDialog.value?.querySelector('select')?.focus()
}
function closeSettings() {
  settingsDialog.value?.close()
  settingsButton.value?.focus()
}
function onDisconnect(event: Event) {
  for (const column of columns.value) {
    if (column.ownsPort(event.target)) column.handleDisconnect()
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (columns.value.some((column) => column.logging.value)) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onBeforeRouteLeave(async () => {
  if (columns.value.some((column) => column.busy.value || column.sending.value)) {
    report('Wait for the current serial operation to finish before leaving the console.')
    return false
  }
  const logging = columns.value.filter((column) => column.logging.value)
  if (logging.length && !confirm('Save active logs and leave Serial Console? Buffered messages will be removed.')) return false
  logging.forEach((column) => column.stopLogging())
  await Promise.all(columns.value.map((column) => column.disconnect()))
})
onMounted(() => {
  updateNarrowScreen(narrowQuery)
  narrowQuery.addEventListener('change', updateNarrowScreen)
  serialApi()?.addEventListener('disconnect', onDisconnect)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  narrowQuery.removeEventListener('change', updateNarrowScreen)
  serialApi()?.removeEventListener('disconnect', onDisconnect)
  window.removeEventListener('beforeunload', beforeUnload)
  columns.value.forEach((column) => { void column.dispose() })
})
</script>

<template>
  <div class="tool-page serial-console" :class="{ dark: settings.darkMode }">
  <header class="topbar">
    <div><span class="eyebrow">HARDWARE / WEB SERIAL</span><h1>Web Serial Console</h1></div>
    <div class="topbar-controls">
      <RouterLink class="home-button" to="/">Home</RouterLink>
      <button :disabled="narrowScreen" :aria-pressed="tabbed"
        :title="narrowScreen ? 'Tabs are automatic on narrow screens' : 'Switch between tabs and columns'"
        @click="settings.tabbedView = !settings.tabbedView">Tabbed view</button>
      <button :disabled="refreshing || changingColumns || columns.some((column) => column.busy.value)"
        title="Close connected ports and re-open the same devices" @click="refreshPorts"
      >{{ refreshing ? 'Refreshing...' : 'Refresh Ports' }}</button>
      <button class="icon-btn" :aria-label="settings.darkMode ? 'Switch to light mode' : 'Switch to dark mode'"
        :aria-pressed="settings.darkMode" :title="settings.darkMode ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="settings.darkMode = !settings.darkMode">{{ settings.darkMode ? '☀️' : '🌙' }}</button>
      <button ref="settingsButton" @click="showSettings">Settings</button>
    </div>
  </header>
  <div class="tool-content serial-workspace">
  <p v-if="!supported" class="banner warning" role="status">
    Web Serial API not detected. Serial connections require Chrome or Edge (desktop) over HTTPS or localhost.
  </p>
  <div v-if="notice" class="banner error notice" role="alert">
    <span>{{ notice }}</span><button aria-label="Dismiss error" @click="notice = ''">Dismiss</button>
  </div>
  <div v-if="tabbed && columns.length > 1" class="port-tabs" role="tablist" aria-label="Console connections">
    <button v-for="column in columns" :id="`serial-tab-${column.index}`" :key="column.index"
      type="button" role="tab" :aria-selected="activeTab === column.index"
      :aria-controls="`serial-panel-${column.index}`" :tabindex="activeTab === column.index ? 0 : -1"
      @click="selectTab(column.index)" @keydown="tabKey($event, column.index)">
      <span class="tab-label">{{ column.settings.label || `Port ${column.index + 1}` }}</span>
      <span v-if="column.disconnectNotices.value.length" class="tab-warning" aria-label="Disconnect warning">!</span>
    </button>
  </div>
  <div id="columnsContainer">
    <div v-for="column in columns" v-show="!tabbed || activeTab === column.index"
      :key="column.index" class="column-shell"
      :id="tabbed && columns.length > 1 ? `serial-panel-${column.index}` : undefined"
      :role="tabbed && columns.length > 1 ? 'tabpanel' : undefined"
      :aria-labelledby="tabbed && columns.length > 1 ? `serial-tab-${column.index}` : undefined"
      :class="{ tabbed, 'with-tabs': tabbed && columns.length > 1 }"
      :style="{ flexBasis: tabbed || !column.settings.columnWidth ? '0px' : `${column.settings.columnWidth}px`,
        flexGrow: tabbed || !column.settings.columnWidth ? 1 : 0 }"
    >
      <ConsoleColumn :column="column" :format="settings.tsFormat" :visible="!tabbed || activeTab === column.index" />
      <div v-if="!tabbed && column.index < columns.length - 1" class="column-resizer" role="separator" aria-orientation="vertical"
        :aria-label="`Resize divider between ${column.settings.label} and ${columns[column.index + 1]?.settings.label}`"
        tabindex="0"
        title="Drag or use arrow keys to resize adjacent columns; double-click or press Home to make them equal"
        @pointerdown="startColumnResize($event, column)" @pointermove="resizeColumn($event, column)"
        @pointerup="resizeStart = null" @pointercancel="resizeStart = null" @lostpointercapture="resizeStart = null"
        @keydown="resizeColumnKey($event, column)" @dblclick="resetColumnPair($event.currentTarget, column)" />
    </div>
  </div>
  </div>
  <dialog ref="settingsDialog" class="studio-dialog console-settings" aria-labelledby="settings-title" @click="(event) => {
    if (event.target === settingsDialog) closeSettings()
  }">
    <div class="modal-content">
      <h2 id="settings-title">Console Settings</h2>
      <label class="field">Timestamp format
        <select v-model="settings.tsFormat">
          <option value="time">HH:MM:SS</option>
          <option value="time-ms">HH:MM:SS.mmm</option>
          <option value="iso">ISO 8601</option>
          <option value="unix">Unix epoch (ms)</option>
        </select>
      </label>
      <label class="field">Message buffer size (per column)
        <IntegerInput :model-value="settings.bufferSize" label="Message buffer size (per column)"
          :min="10" :max="20000" :step="10" @change="changeBuffer" />
      </label>
      <label class="field">Number of columns
        <IntegerInput :model-value="settings.numColumns" label="Number of columns" :min="1" :max="8"
          :disabled="changingColumns || refreshing || columns.some((column) => column.busy.value)"
          @change="changeColumns" />
      </label>
      <div class="actions"><button class="primary" @click="closeSettings">Close</button></div>
    </div>
  </dialog>
  <datalist id="baudPresets"><option v-for="baud in baudPresets" :key="baud" :value="baud" /></datalist>
  </div>
</template>

<style src="./console.css"></style>
