<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button type="button" class="toggle-btn" :class="{ active: modelValue }"
    :aria-pressed="modelValue" @click="emit('update:modelValue', !modelValue)"><slot /></button>
</template>
