<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import ConsoleColumn from './ConsoleColumn.vue'
import IntegerInput from '../components/IntegerInput.vue'
import { serialApi, useColumn, type ConsoleColumn as Column } from './use-column'
import { boundedInteger, savedSettings, validateGlobal, type GlobalSettings } from './settings'

const notice = ref('')
function report(message: string) {
  console.error(message)
  notice.value = notice.value ? `${notice.value}\n${message}` : message
}
const settings = savedSettings<GlobalSettings>('wsc_global', {
  numColumns: 2, bufferSize: 500, tsFormat: 'time-ms', darkMode: true,
}, validateGlobal, report)
const columns = shallowRef<Column[]>(Array.from({ length: settings.numColumns },
  (_, index) => useColumn(index, settings, report)))
const supported = !!serialApi()
const refreshing = ref(false)
const changingColumns = ref(false)
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
    settings.numColumns = count
  } finally { changingColumns.value = false }
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
    if (column.ownsPort(event.target)) void column.disconnect()
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
  serialApi()?.addEventListener('disconnect', onDisconnect)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
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
      <RouterLink to="/tools">All tools</RouterLink>
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
  <p class="intro">Connect locally, inspect text and bytes, and capture device logs.</p>
  <p v-if="!supported" class="banner warning" role="status">
    Web Serial API not detected. Open this page in Chrome or Edge (desktop) over HTTPS or localhost.
  </p>
  <div v-if="notice" class="banner error notice" role="alert">
    <span>{{ notice }}</span><button aria-label="Dismiss error" @click="notice = ''">Dismiss</button>
  </div>
  <div id="columnsContainer" :style="{ gridTemplateColumns: `repeat(${columns.length}, minmax(320px, 1fr))` }">
    <ConsoleColumn v-for="column in columns" :key="column.index" :column="column" :format="settings.tsFormat" />
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
