<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { mergeSupportingFiles } from './supporting-files'

const props = defineProps<{ files: File[]; busy: boolean }>()
const emit = defineEmits<{
  'update:files': [files: File[]]
  'clear-cache': []
  close: []
  error: [cause: unknown]
}>()
const dialog = ref<HTMLDialogElement>()
const input = ref<HTMLInputElement>()
const notice = ref('')
const error = ref('')
const total = computed(() => props.files.reduce((sum, file) => sum + file.size, 0))
function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${Math.ceil(bytes / 1024)} KiB`
}
function upload(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  error.value = ''
  try {
    const result = mergeSupportingFiles(props.files, Array.from(event.target.files ?? []))
    emit('update:files', result.files)
    notice.value = result.replaced.length ? `Replaced: ${result.replaced.join(', ')}` : 'Files uploaded.'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    emit('error', cause)
  } finally {
    event.target.value = ''
  }
}
function remove(name: string) {
  error.value = ''
  emit('update:files', props.files.filter(file => file.name !== name))
  notice.value = `Removed ${name}.`
}
onMounted(() => dialog.value?.showModal())
onUnmounted(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="studio-dialog file-manager" aria-labelledby="supporting-title" @close="emit('close')"
    @keydown.esc.prevent="dialog?.close()">
    <div class="section-heading">
      <h2 id="supporting-title">Supporting files / fonts</h2>
      <button autofocus @click="dialog?.close()">Close</button>
    </div>
    <p class="hint">Upload .typ modules, data, images, or fonts. Imports use these filenames. Uploading the same name replaces that file. Files stay in memory.</p>
    <fieldset :disabled="busy">
      <div class="actions">
        <button class="primary" @click="input?.click()">Upload files</button>
        <input ref="input" hidden type="file" aria-label="Upload supporting files" multiple @change="upload">
        <button :disabled="!files.length" @click="emit('update:files', []); notice = 'All uploaded files removed.'">Remove all files</button>
        <span class="hint">{{ files.length }} files / {{ size(total) }} of 50 MiB</span>
      </div>
      <ul v-if="files.length" class="managed-files">
        <li v-for="file in files" :key="file.name">
          <div><strong>{{ file.name }}</strong><small class="hint">{{ /\.(ttf|otf)$/i.test(file.name) ? 'Font' : 'File' }} / {{ size(file.size) }}</small></div>
          <button :aria-label="`Remove ${file.name}`" @click="remove(file.name)">Remove</button>
        </li>
      </ul>
      <p v-else class="hint">No uploaded files. Lato and standard Typst fonts are already included.</p>
      <div class="cache-tools">
        <button @click="emit('clear-cache')">Clear runtime/package cache</button>
        <p class="hint">Clears downloaded compiler assets, fonts, and public packages, not your uploads. Assets download again when needed.</p>
      </div>
    </fieldset>
    <p v-if="notice" class="hint" role="status">{{ notice }}</p>
    <p v-if="error" class="warning-text" role="alert">{{ error }}</p>
  </dialog>
</template>
