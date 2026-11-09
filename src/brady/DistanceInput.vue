<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { describePixels, formatDistance, fromPixels, parseDistance, type DistanceUnit } from './measurements'

const props = defineProps<{ modelValue: number; unit: DistanceUnit; ppi: number; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const draft = ref('')
const focused = ref(false)
function sync() { draft.value = formatDistance(fromPixels(props.modelValue, props.unit, props.ppi)) }
watch(() => [props.unit, props.ppi], sync, { immediate: true })
watch(() => props.modelValue, value => {
  if (!focused.value && value !== Math.round(pixels.value)) sync()
})
const pixels = computed(() => parseDistance(draft.value, props.unit, props.ppi))
const invalid = computed(() => !Number.isFinite(pixels.value) || pixels.value < 0 || pixels.value > 8192)
function update(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  draft.value = event.target.value
  const value = pixels.value
  emit('update:modelValue', Number.isFinite(value) && value >= 0 ? Math.round(value) : NaN)
}
</script>

<template>
  <label>{{ label }} ({{ unit }})
    <input :value="draft" :aria-label="`${label} (${unit})`" type="text" inputmode="decimal"
      :aria-invalid="invalid" @focus="focused = true" @blur="focused = false" @input="update">
    <small v-if="invalid" class="warning-text">Enter a nonnegative distance up to 8192 pixels (mm, in, or px accepted).</small>
    <small class="hint measurement-hint">{{ describePixels(pixels, ppi) }}<br>
      Raster: {{ formatDistance(Math.round(modelValue)) }} px at {{ ppi }} PPI
    </small>
  </label>
</template>
