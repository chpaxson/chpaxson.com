<script setup lang="ts">
import { nextTick, ref } from 'vue'
import IntegerInput from '../components/IntegerInput.vue'
import type { Gateway } from './use-gateway'

const props = defineProps<{ gateway: Gateway }>()
const dialog = ref<HTMLDialogElement>()
const tokenInput = ref<HTMLInputElement>()
const token = ref('')
const host = ref('')
const port = ref(23)
let opener: HTMLElement | null = null

async function show() {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
  await nextTick()
  if (!props.gateway.unlocked.value) tokenInput.value?.focus()
}
function close() {
  token.value = ''
  dialog.value?.close()
  opener?.focus()
}
async function unlock() {
  const value = token.value
  token.value = ''
  await props.gateway.unlock(value)
}
function addTarget() {
  props.gateway.updateTarget('add', host.value, port.value)
}
defineExpose({ show })
</script>

<template>
  <dialog ref="dialog" class="studio-dialog gateway-dialog" aria-labelledby="gateway-title"
    @cancel="close" @click="(event) => { if (event.target === dialog) close() }">
    <div class="modal-content">
      <h2 id="gateway-title">Telnet gateway</h2>
      <p>Run the local gateway and enter its token. Telnet traffic is unencrypted.</p>
      <p>First run <code>telnet-gateway.exe init</code>, then <code>telnet-gateway.exe token</code> in a terminal.</p>
      <p v-if="gateway.error.value" class="banner error" role="alert">{{ gateway.error.value }}</p>
      <template v-if="!gateway.unlocked.value">
        <form @submit.prevent="unlock">
          <label class="field">Gateway token
            <input ref="tokenInput" v-model="token" type="password" autocomplete="off" required
              :disabled="gateway.busy.value">
          </label>
          <div class="actions">
            <button type="submit" class="primary" :disabled="gateway.busy.value">{{ gateway.busy.value ? 'Unlocking...' : 'Unlock' }}</button>
          </div>
        </form>
      </template>
      <template v-else>
        <p>Unlocked for this page session. Allowed destinations are stored by the gateway.</p>
        <ul class="gateway-targets">
          <li v-for="target in gateway.targets.value" :key="`${target.host}:${target.port}`">
            <span>{{ target.host }}:{{ target.port }}</span>
            <button type="button" :aria-label="`Remove ${target.host}:${target.port}`"
              @click="gateway.updateTarget('remove', target.host, target.port)">Remove</button>
          </li>
        </ul>
        <p v-if="!gateway.targets.value.length">No destinations allowed yet.</p>
        <form class="gateway-add" @submit.prevent="addTarget">
          <label class="field">Host or IP address
            <input v-model.trim="host" type="text" required placeholder="192.168.1.10">
          </label>
          <label class="field">Telnet port
            <IntegerInput v-model="port" label="Gateway target port" :min="1" :max="65535" required />
          </label>
          <button type="submit">Add destination</button>
        </form>
        <button type="button" @click="gateway.lock()">Lock gateway</button>
      </template>
      <div class="actions"><button type="button" @click="close">Close</button></div>
    </div>
  </dialog>
</template>
