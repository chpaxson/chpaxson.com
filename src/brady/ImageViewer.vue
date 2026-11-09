<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { describeSize, type DistanceUnit } from './measurements'

const props = defineProps<{ image: HTMLImageElement; name: string; ppi: number; unit: DistanceUnit }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const viewport = ref<HTMLDivElement>()
const zoom = ref(1)
const dragging = ref(false)
let drag: { id: number; x: number; y: number; left: number; top: number } | undefined

function fit() {
  const element = viewport.value
  if (!element) return
  zoom.value = Math.max(.01, Math.min(1, (element.clientWidth - 32) / props.image.naturalWidth,
    (element.clientHeight - 32) / props.image.naturalHeight))
  element.scrollTo(0, 0)
}

async function setZoom(value: number, x?: number, y?: number) {
  const element = viewport.value
  if (!element) return
  const anchorX = x ?? element.clientWidth / 2
  const anchorY = y ?? element.clientHeight / 2
  const fractionX = (element.scrollLeft + anchorX) / element.scrollWidth
  const fractionY = (element.scrollTop + anchorY) / element.scrollHeight
  zoom.value = Math.min(32, Math.max(.01, value))
  await nextTick()
  element.scrollLeft = fractionX * element.scrollWidth - anchorX
  element.scrollTop = fractionY * element.scrollHeight - anchorY
}

function wheel(event: WheelEvent) {
  const rect = viewport.value!.getBoundingClientRect()
  void setZoom(zoom.value * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX - rect.left, event.clientY - rect.top)
}
function startPan(event: PointerEvent) {
  if (event.button !== 0 || !viewport.value) return
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
    left: viewport.value.scrollLeft, top: viewport.value.scrollTop }
  viewport.value.setPointerCapture(event.pointerId)
  dragging.value = true
}
function pan(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId || !viewport.value) return
  viewport.value.scrollLeft = drag.left - (event.clientX - drag.x)
  viewport.value.scrollTop = drag.top - (event.clientY - drag.y)
}
function stopPan() { drag = undefined; dragging.value = false }
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') dialog.value?.close()
  else if (event.key === '+' || event.key === '=') void setZoom(zoom.value * 1.2)
  else if (event.key === '-') void setZoom(zoom.value / 1.2)
  else if (event.key === '0') fit()
  else return
  event.preventDefault()
}
onMounted(() => { dialog.value?.showModal(); fit() })
onUnmounted(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="image-viewer" aria-label="Full-size label preview" @close="emit('close')" @keydown="keyboard">
    <div class="viewer-toolbar">
      <strong>{{ name }}</strong>
      <div class="actions">
        <button type="button" aria-label="Zoom out" @click="setZoom(zoom / 1.2)">−</button>
        <output aria-label="Zoom level">{{ Math.round(zoom * 100) }}%</output>
        <button type="button" aria-label="Zoom in" @click="setZoom(zoom * 1.2)">+</button>
        <button type="button" @click="fit">Fit</button>
        <button type="button" @click="setZoom(1)">100%</button>
        <button type="button" autofocus @click="dialog?.close()">Close</button>
      </div>
    </div>
    <p class="hint" title="Scroll to zoom; drag to pan. Keyboard: + / -, 0 to fit, Esc to close.">
      {{ describeSize(image.naturalWidth, image.naturalHeight, ppi, unit) }} / {{ ppi }} PPI. Scroll to zoom; drag to pan.
    </p>
    <div ref="viewport" class="viewer-viewport" :class="{ dragging }" tabindex="0" aria-label="Zoomable image"
      @wheel.prevent="wheel" @pointerdown="startPan" @pointermove="pan"
      @pointerup="stopPan" @pointercancel="stopPan" @lostpointercapture="stopPan">
      <div class="viewer-canvas" :style="{ width: `${image.naturalWidth * zoom}px`, height: `${image.naturalHeight * zoom}px` }">
        <img :src="image.src" :alt="name" draggable="false"
          :style="{ width: `${image.naturalWidth * zoom}px`, height: `${image.naturalHeight * zoom}px` }">
      </div>
    </div>
  </dialog>
</template>
