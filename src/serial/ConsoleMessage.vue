<script setup lang="ts">
import { computed } from 'vue'
import { ansiParts, messageMeta, type Message } from './format'
import type { ColumnSettings, TimestampFormat } from './settings'

const props = defineProps<{
  message: Message
  settings: ColumnSettings
  format: TimestampFormat
}>()
const parts = computed(() => props.settings.hexView && props.message.outgoing ?
  props.message.outgoing : ansiParts(props.message.text, props.settings.hexView))
</script>

<template>
  <div class="line-wrap" :class="`line-${message.type}`">
    <span class="meta-cell">{{ messageMeta(message, settings, format) }}</span>
    <span class="text-cell"><span
      v-for="(part, index) in parts" :key="index"
      :class="{ 'char-cell': settings.hexView }"
      :data-b0="part.start" :data-b1="part.end" :style="part.style"
    >{{ part.text }}</span></span>
    <span v-if="settings.hexView" class="hex-cell"><template
      v-for="(byte, index) in message.bytes" :key="index"
    >{{ index ? ' ' : '' }}<span
      class="hex-byte" :data-b0="index" :data-b1="index + 1"
    >{{ byte.toString(16).padStart(2, '0').toUpperCase() }}</span></template></span>
  </div>
</template>
