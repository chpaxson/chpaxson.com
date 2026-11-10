<script setup lang="ts">
import { computed, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  modelValue: number
  label: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}>(), { step: 1, disabled: false })
const emit = defineEmits<{
  'update:modelValue': [value: number]
  input: [event: Event]
  change: [event: Event]
}>()
const input = ref<HTMLInputElement>()
const draft = ref('')
watch(() => props.modelValue, (value) => {
  draft.value = Number.isFinite(value) ? String(value) : ''
}, { immediate: true })
const number = computed(() => draft.value === '' ? NaN : Number(draft.value))
function update(event: Event) {
  const element = event.target as HTMLInputElement
  draft.value = element.value
  emit('update:modelValue', element.valueAsNumber)
  emit('input', event)
}
function commit(event: Event) {
  emit('change', event)
  draft.value = (event.target as HTMLInputElement).value
}
function adjust(direction: number) {
  const element = input.value
  if (!element || element.matches(':disabled')) return
  // Use native stepping to preserve min/max, step alignment, and blank-input behavior.
  if (direction > 0) element.stepUp()
  else element.stepDown()
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}
</script>

<template>
  <span class="integer-input">
    <button type="button" :aria-label="`Decrease ${label}`"
      :disabled="disabled || (min !== undefined && number <= min)" @click="adjust(-1)"
    >&minus;</button>
    <input ref="input" v-bind="$attrs" type="number" inputmode="numeric"
      :aria-label="label" :value="draft" :min="min" :max="max" :step="step" :disabled="disabled"
      @input="update" @change="commit">
    <button type="button" :aria-label="`Increase ${label}`"
      :disabled="disabled || (max !== undefined && number >= max)" @click="adjust(1)"
    >+</button>
  </span>
</template>
