<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import { loadPrinter, type PrinterClient, type CutOption, type PrintSettings } from './printer'
import { combineImages, imageRenderer, renderLabelImage, type LabelRenderer, type RenderOptions } from './renderers'
import type { StripOptions } from './strip'
import { clearDocumentCache, rasterizePdf, TypstSession } from './documents'
import { MAX_PAGES, printerPpi, validatePpi } from './document-settings'
import type { ProjectFile } from './typst-protocol'
import TypstEditor from './TypstEditor.vue'
import ToggleButton from './ToggleButton.vue'
import DistanceInput from './DistanceInput.vue'
import ImageViewer from './ImageViewer.vue'
import { describePixels, describeSize, fromPixels, toPixels, previewWidth, type DistanceUnit } from './measurements'
import type { ImageSizing } from './image-layout'
import { saveTypstSource } from './source-save'
import SupportingFilesDialog from './SupportingFilesDialog.vue'
import IntegerInput from '../components/IntegerInput.vue'

interface Label {
  id: number
  name: string
  source: Blob
  renderer: LabelRenderer
  image: HTMLImageElement
  sizing: ImageSizing
  ppi?: number
}

const client = shallowRef<PrinterClient>()
const connected = ref(false)
const info = ref<PrinterClient['info']>()
const sdkLoading = ref(true)
const busy = ref('')
const workflow = ref<'upload' | 'typst'>('upload')
const labels = shallowRef<Label[]>([])
const selected = ref<number>()
const copies = ref(1)
const cut = ref<CutOption>(0)
const collate = ref(true)
const options = ref<RenderOptions>({ rotation: 0, monochrome: false, threshold: 160 })
const appliedOptions = ref<RenderOptions>({ ...options.value })
const renderPending = computed(() => labels.value.length > 0 &&
  (options.value.rotation !== appliedOptions.value.rotation ||
   options.value.monochrome !== appliedOptions.value.monochrome ||
   options.value.threshold !== appliedOptions.value.threshold))
const baseUrl = import.meta.env.BASE_URL
const dark = ref(true)
const distanceUnit = ref<DistanceUnit>('mm')
const viewer = shallowRef<{ image: HTMLImageElement; name: string; ppi: number }>()
const toasts = ref<{ id: number; message: string; error: boolean }[]>([])
let toastId = 0
const toastTimers = new Set<ReturnType<typeof setTimeout>>()
const fileInput = ref<HTMLInputElement>()
const typstInput = ref<HTMLInputElement>()
const filesOpen = ref(false)
const manualPpi = ref(203)
const pdfPpiOverride = ref<number>()
const detectedPpi = computed(() => connected.value ? printerPpi(info.value?.dpi) : undefined)
const rasterPpi = computed(() => workflow.value === 'typst'
  ? detectedPpi.value ?? (connected.value ? manualPpi.value : 203)
  : pdfPpiOverride.value ?? detectedPpi.value ?? 203)
const outputPpi = computed(() => detectedPpi.value ?? rasterPpi.value)
const jobPpi = computed(() => workflow.value === 'typst' ? rasterPpi.value : outputPpi.value)
const usePrinterHeight = ref(true)
const manualHeightInches = ref(.5)
const heightInches = computed(() => usePrinterHeight.value && info.value?.mediaHeightInches
  ? info.value.mediaHeightInches : manualHeightInches.value)
const labelHeight = computed({
  get: () => Math.round(heightInches.value * outputPpi.value),
  set: (pixels: number) => { manualHeightInches.value = pixels / outputPpi.value },
})
const prepared = shallowRef<{ id: number; image: HTMLImageElement }[]>([])
const preparing = ref(false)
const preparationError = ref('')
let preparationRevision = 0
const typstTemplate = '#set page(width: 52mm, height: 0.5in, margin: 1mm)\n#set par(leading: 0.2em)\n#set align(center + horizon)\n#set text(font: "Lato", size: 5mm, weight: "bold")\n\nLabel 1\n#pagebreak()\nLabel 2'
const typstStorageKey = 'brady-studio-typst-source-v1'
const typstSource = ref(typstTemplate)
const sourceStorageError = ref('')
const typstFiles = shallowRef<File[]>([])
const savedTypst = ref(typstSource.value)
const typstFilename = ref('labels.typ')
const typstDirty = computed(() => typstSource.value !== savedTypst.value)
const savingTypst = ref(false)
const liveImages = shallowRef<HTMLImageElement[]>([])
const liveStatus = ref('')
const liveError = ref('')
const liveDiagnostics = ref<string[]>([])
const liveStale = ref(true)
const livePpi = ref(203)
let liveController: AbortController | undefined
let liveRevision = 0
let typstSession = new TypstSession()
const preview = computed(() => prepared.value.find(label => label.id === selected.value))
const selectedName = computed(() => labels.value.find(label => label.id === selected.value)?.name ?? 'Label')
const combine = ref(false)
const typstCombine = ref(true)
const stripOptions = ref<Omit<StripOptions, 'margin'>>({
  autoTrim: true, cropLeft: 0, cropRight: 0, separators: true, edgeSeparators: true,
})
const marginMm = ref(5)
const marginPixels = computed({
  get: () => toPixels(marginMm.value, 'mm', jobPpi.value),
  set: (pixels: number) => { marginMm.value = fromPixels(pixels, 'mm', jobPpi.value) },
})
const combinedImage = shallowRef<HTMLImageElement>()
const combinedError = ref('')
const buildingStrip = ref(false)
let stripRevision = 0
const combining = computed({
  get: () => workflow.value === 'typst' ? typstCombine.value : combine.value,
  set: (value: boolean) => { if (workflow.value === 'typst') typstCombine.value = value; else combine.value = value },
})
const activeImages = computed(() => workflow.value === 'typst' ? liveImages.value : prepared.value.map(label => label.image))
const previewImage = computed(() => combining.value ? combinedImage.value
  : workflow.value === 'typst' ? liveImages.value[0] : preview.value?.image)
const printImages = computed(() => combining.value
  ? combinedImage.value ? [combinedImage.value] : []
  : activeImages.value)
const jobPending = computed(() => workflow.value === 'typst'
  ? liveStale.value || !!liveError.value || !!liveStatus.value
  : renderPending.value || preparing.value || !!preparationError.value)
const bluetoothSupported = window.isSecureContext && 'bluetooth' in navigator
const ready = computed(() => connected.value && info.value?.model.toUpperCase() === 'M211')
const printing = computed(() => busy.value === 'Sending print job')
const materialHeight = computed(() => Math.round((info.value?.mediaHeightInches ?? manualHeightInches.value) * jobPpi.value))
interface PendingPrint {
  images: HTMLImageElement[]
  settings: PrintSettings
  height: number
  ppi: number
}
const pendingPrint = shallowRef<PendingPrint>()
const heightDialog = ref<HTMLDialogElement>()
let nextId = 0
let poll: ReturnType<typeof setInterval> | undefined
let disposed = false

function record(message: string, isError = false) {
  if (isError && toasts.value.some(toast => toast.error && toast.message === message)) return
  const id = ++toastId
  toasts.value = [...toasts.value, { id, message, error: isError }].slice(-8)
  if (!isError) {
    const timer = setTimeout(() => {
      toasts.value = toasts.value.filter(toast => toast.id !== id)
      toastTimers.delete(timer)
    }, 8000)
    toastTimers.add(timer)
  }
}

function report(cause: unknown) {
  record(cause instanceof Error ? cause.message : String(cause), true)
}

function refresh() {
  if (!client.value) return
  const wasConnected = connected.value
  connected.value = client.value.connected
  info.value = connected.value ? client.value.info : undefined
  if (wasConnected && !connected.value && busy.value !== 'Disconnecting') {
    report(new Error('The printer disconnected. Reconnect before continuing.'))
  }
}

async function action(name: string, operation: () => Promise<void>, success: string) {
  if (busy.value) return
  busy.value = name
  try {
    await operation()
    record(success)
  } catch (cause) {
    report(cause)
  } finally {
    refresh()
    busy.value = ''
  }
}

async function initializeSdk() {
  sdkLoading.value = true
  try {
    const loaded = await loadPrinter(refresh)
    if (disposed) {
      if (loaded.connected) await loaded.disconnect()
      return
    }
    client.value = loaded
    refresh()
  } catch (cause) {
    report(cause)
  } finally {
    sdkLoading.value = false
  }
}

onMounted(() => {
  try {
    const stored = localStorage.getItem(typstStorageKey)
    if (stored !== null) typstSource.value = stored
  } catch (cause) {
    sourceStorageError.value = 'Could not restore the local source draft. Save a .typ file to keep your work.'
    report(new Error(`${sourceStorageError.value} ${String(cause)}`))
  }
  try {
    const stored = localStorage.getItem('brady-studio-theme')
    dark.value = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  } catch (cause) {
    report(new Error(`Theme storage unavailable: ${String(cause)}`))
  }
  void initializeSdk()
  poll = setInterval(refresh, 1500)
  window.addEventListener('keydown', saveShortcut)
})
watch(typstSource, source => {
  try {
    localStorage.setItem(typstStorageKey, source)
    sourceStorageError.value = ''
  } catch (cause) {
    if (!sourceStorageError.value) {
      report(new Error(`Could not save the local source draft: ${String(cause)}`))
    }
    sourceStorageError.value = 'Local draft storage is unavailable or full. Save a .typ file to keep your work.'
  }
}, { flush: 'sync' })

function resetTypst() {
  if (typstSource.value !== typstTemplate &&
      !confirm('Replace the current Typst source and its local draft with the starter template? Save a .typ copy first if needed.')) return
  typstSource.value = typstTemplate
  typstFilename.value = 'labels.typ'
}
onUnmounted(() => {
  disposed = true
  if (poll) clearInterval(poll)
  liveController?.abort()
  typstSession.dispose()
  liveRevision++
  preparationRevision++
  stripRevision++
  for (const timer of toastTimers) clearTimeout(timer)
  window.removeEventListener('keydown', saveShortcut)
  if (client.value?.connected) {
    void client.value.disconnect().catch(cause => console.error('Could not disconnect M211 on exit:', cause))
  }
})
onBeforeRouteLeave(async () => {
  if (busy.value) {
    report(new Error('Wait for the current printer operation to finish before leaving Label Studio.'))
    return false
  }
  if ((labels.value.length || typstFiles.value.length || typstDirty.value) &&
      !confirm('Leave Label Studio? Unsaved artwork and supporting files will be removed. The local Typst draft is retained.')) return false
  if (client.value?.connected) {
    try { await client.value.disconnect() }
    catch (cause) { report(cause); return false }
  }
})
watch(() => info.value?.error, message => { if (message) record(message, true) })

function toggleTheme() {
  dark.value = !dark.value
  try {
    localStorage.setItem('brady-studio-theme', dark.value ? 'dark' : 'light')
  } catch (cause) {
    report(new Error(`Could not save theme preference: ${String(cause)}`))
  }
}

function connect() {
  if (!client.value) return
  // The SDK is loaded before this click so Bluetooth discovery retains user activation.
  void action('Connecting', () => client.value!.connect(), 'Connected. Check the installed media before printing.')
}
function disconnect() {
  if (!client.value) return
  void action('Disconnecting', () => client.value!.disconnect(), 'Disconnected.')
}

async function addImages(files: FileList | null) {
  if (!files || busy.value) return
  await action('Importing artwork', async () => {
    const ppi = rasterPpi.value
    if (renderPending.value) throw new Error('Apply preview settings before adding more images.')
    if (labels.value.length + files.length > 30) throw new Error('A job can contain at most 30 images.')
    const added: Label[] = []
    for (const file of Array.from(files)) {
      try {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
        const sources = isPdf
          ? await rasterizePdf(file, ppi, MAX_PAGES - labels.value.length - added.length)
          : [file]
        if (labels.value.length + added.length + sources.length > MAX_PAGES) {
          throw new Error(`A job can contain at most ${MAX_PAGES} images/pages.`)
        }
        for (const [page, source] of sources.entries()) {
          const image = await imageRenderer.render(source, options.value)
          added.push({ id: ++nextId, name: isPdf ? `${file.name} / page ${page + 1} @ ${ppi} PPI` : file.name,
            source, renderer: imageRenderer, image, sizing: 'fit' })
        }
      } catch (cause) {
        throw new Error(`${file.name}: ${cause instanceof Error ? cause.message : String(cause)}. No images from this selection were added.`)
      }
    }
    labels.value = [...labels.value, ...added]
    appliedOptions.value = { ...options.value }
    selected.value = added[0]?.id ?? selected.value
  }, 'Images added to the job. Preview the result before printing.')
  if (fileInput.value) fileInput.value.value = ''
}

async function loadTypstSource(event: Event) {
  if (!(event.target instanceof HTMLInputElement) || !event.target.files?.[0]) return
  const input = event.target
  const file = input.files![0]!
  await action('Loading Typst source', async () => {
    if (file.size > 1024 * 1024) throw new Error('Typst source must be at most 1 MiB.')
    typstSource.value = (await file.text()).replace(/\r\n?/g, '\n')
    savedTypst.value = typstSource.value
    typstFilename.value = file.name
  }, 'Typst source loaded. The document now defines the Typst print job.')
  input.value = ''
}

function updatePdfPpi(event: Event) {
  if (event.target instanceof HTMLInputElement) {
    pdfPpiOverride.value = event.target.value === '' ? undefined : event.target.valueAsNumber
  }
}

async function saveTypst() {
  if (savingTypst.value) return
  const source = typstSource.value
  savingTypst.value = true
  try {
    const result = await saveTypstSource(source, typstFilename.value)
    if (!result) return
    savedTypst.value = source
    typstFilename.value = result.filename
    record(result.downloaded
      ? 'Save As is unavailable in this browser. Downloaded the .typ source; your browser controls the save location.'
      : `Saved ${result.filename}.`)
  } catch (cause) {
    report(cause)
  } finally {
    savingTypst.value = false
  }
}

function saveShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && workflow.value === 'typst') {
    event.preventDefault()
    void saveTypst()
  }
}

async function compileTypst(
  ppi: number, progress: (message: string) => void, signal?: AbortSignal, maxPages = MAX_PAGES,
) {
  const source = typstSource.value
  const supporting = [...typstFiles.value]
  validatePpi(ppi)
  if (new TextEncoder().encode(source).length > 1024 * 1024) {
    throw new Error('Typst source must be at most 1 MiB.')
  }
  if (supporting.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024) {
    throw new Error('Supporting files must total at most 50 MiB.')
  }
  const files: ProjectFile[] = []
  const fonts: Uint8Array[] = []
  const paths = new Set<string>()
  for (const file of supporting) {
    const path = file.webkitRelativePath || file.name
    if (paths.has(path)) throw new Error(`Duplicate supporting filename: ${path}. Rename one of the files.`)
    paths.add(path)
    const data = new Uint8Array(await file.arrayBuffer())
    if (/\.(ttf|otf)$/i.test(file.name)) fonts.push(data)
    else files.push({ path, data })
  }
  signal?.throwIfAborted()
  return typstSession.render(source, ppi, files, fonts, progress, maxPages, signal)
}

function openPreview(image: HTMLImageElement, name: string, ppi = jobPpi.value) {
  viewer.value = { image, name, ppi }
}

watch([typstSource, typstFiles, rasterPpi, workflow, () => JSON.stringify(options.value)], () => {
  const revision = ++liveRevision
  liveController?.abort()
  liveStale.value = true
  liveError.value = ''
  liveStatus.value = ''
  if (workflow.value !== 'typst') return
  void updateLivePreview(revision)
}, { flush: 'sync' })

async function updateLivePreview(revision: number) {
  const controller = new AbortController()
  liveController = controller
  const ppi = rasterPpi.value
  const settings = { ...options.value }
  liveStatus.value = 'Rendering live preview...'
  try {
    const result = await compileTypst(ppi, message => {
      if (revision === liveRevision) liveStatus.value = message
    }, controller.signal)
    const images: HTMLImageElement[] = []
    for (const source of result.pages) {
      controller.signal.throwIfAborted()
      images.push(await imageRenderer.render(source, settings))
    }
    if (revision !== liveRevision || controller.signal.aborted) return
    liveImages.value = images
    liveDiagnostics.value = result.diagnostics
    livePpi.value = ppi
    liveStale.value = false
  } catch (cause) {
    if (!controller.signal.aborted && revision === liveRevision) {
      liveError.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    if (revision === liveRevision) liveStatus.value = ''
  }
}

async function clearCache() {
  if (!confirm('Clear the cached Typst compiler, fonts, and packages? They will download again on the next render.')) return
  await action('Clearing document cache', async () => {
    liveController?.abort()
    liveRevision++
    liveStale.value = true
    liveStatus.value = ''
    typstSession.dispose()
    typstSession = new TypstSession()
    await clearDocumentCache()
  }, 'Document asset caches cleared. Artwork remains in memory.')
  if (workflow.value === 'typst') void updateLivePreview(++liveRevision)
}

function onFiles(event: Event) {
  if (event.target instanceof HTMLInputElement) void addImages(event.target.files)
}
function onDrop(event: DragEvent) { void addImages(event.dataTransfer?.files ?? null) }

async function renderImages() {
  await action('Rendering preview', async () => {
    const rendered: Label[] = []
    for (const label of labels.value) {
      rendered.push({ ...label, image: await label.renderer.render(label.source, options.value) })
    }
    labels.value = rendered
    appliedOptions.value = { ...options.value }
  }, 'Preview updated. These exact raster images will be passed to the SDK.')
}

function removeLabel(id: number) {
  labels.value = labels.value.filter(label => label.id !== id)
  if (selected.value === id) selected.value = labels.value[0]?.id
}

function moveLabel(index: number, direction: -1 | 1) {
  const reordered = [...labels.value]
  const other = index + direction
  if (other < 0 || other >= reordered.length) return
  ;[reordered[index], reordered[other]] = [reordered[other]!, reordered[index]!]
  labels.value = reordered
}

function printJob() {
  if (busy.value || !ready.value || jobPending.value || buildingStrip.value || !printImages.value.length) return
  const job: PendingPrint = {
    images: printImages.value,
    settings: { copies: Number(copies.value), collate: collate.value, cut: cut.value },
    height: materialHeight.value, ppi: jobPpi.value,
  }
  if (!Number.isInteger(job.height) || job.height < 1 || job.height > 8192) {
    report(new Error('Material height is unavailable or invalid. Set a valid fallback label height in Images / PDF before printing.'))
    return
  }
  if (job.images.some(image => image.naturalHeight !== job.height)) {
    pendingPrint.value = job
  } else {
    void sendPrint(job)
  }
}

async function sendPrint(job: PendingPrint, sizing?: ImageSizing) {
  pendingPrint.value = undefined
  record('Starting print job. Preparing artwork for the printer...')
  await action('Sending print job', async () => {
    const images = []
    for (const image of job.images) {
      images.push(sizing && image.naturalHeight !== job.height
        ? await renderLabelImage(image, job.height, sizing, job.ppi, job.ppi) : image)
    }
    if (!ready.value || jobPending.value || buildingStrip.value || printImages.value !== job.images ||
        materialHeight.value !== job.height || jobPpi.value !== job.ppi) {
      throw new Error('Artwork or printer media changed. Review the current preview and print again.')
    }
    await client.value!.print(images, job.settings)
  }, 'The SDK accepted the print job. Verify physical output on the printer before sending another job.')
}

watch(pendingPrint, async job => {
  await nextTick()
  if (job && pendingPrint.value === job) heightDialog.value?.showModal()
  else heightDialog.value?.close()
})
watch([printImages, jobPending, buildingStrip, connected, detectedPpi, materialHeight,
  () => info.value?.supply, () => info.value?.dimensions, copies, cut, collate], () => {
  if (pendingPrint.value) {
    pendingPrint.value = undefined
    record('Print confirmation cancelled because the artwork, settings, or printer changed.')
  }
}, { flush: 'sync' })
watch([activeImages, combining, jobPending, marginPixels, () => JSON.stringify(stripOptions.value)], () => {
  const revision = ++stripRevision
  combinedImage.value = undefined
  combinedError.value = ''
  buildingStrip.value = false
  if (!combining.value || jobPending.value || !activeImages.value.length) return
  const settings: StripOptions = { ...stripOptions.value, margin: Math.round(marginPixels.value) }
  if (settings.autoTrim) settings.cropLeft = settings.cropRight = 0
  buildingStrip.value = true
  void combineImages(activeImages.value, settings).then(image => {
    if (revision === stripRevision) combinedImage.value = image
  }).catch((cause: unknown) => {
    if (revision === stripRevision) combinedError.value = cause instanceof Error ? cause.message : String(cause)
  }).finally(() => { if (revision === stripRevision) buildingStrip.value = false })
}, { flush: 'sync' })

function updateLabel(id: number, patch: Partial<Pick<Label, 'sizing' | 'ppi'>>) {
  labels.value = labels.value.map(label => label.id === id ? { ...label, ...patch } : label)
}

watch([labels, labelHeight, outputPpi], () => {
  const revision = ++preparationRevision
  preparing.value = true
  preparationError.value = ''
  prepared.value = []
  void (async () => {
    const result = []
    for (const label of labels.value) {
      const image = await renderLabelImage(label.image, labelHeight.value, label.sizing, label.ppi ?? outputPpi.value, outputPpi.value)
      if (revision !== preparationRevision) return
      result.push({ id: label.id, image })
    }
    if (revision === preparationRevision) prepared.value = result
  })().catch((cause: unknown) => {
    if (revision === preparationRevision) preparationError.value = cause instanceof Error ? cause.message : String(cause)
  }).finally(() => { if (revision === preparationRevision) preparing.value = false })
}, { flush: 'sync' })

function resultImage(id: number) { return prepared.value.find(label => label.id === id)?.image }
function feed() {
  if (!client.value || !confirm('Feed one blank label forward? This consumes label material.')) return
  void action('Feeding', () => client.value!.feed(), 'Forward feed command completed.')
}
function cutNow() {
  if (!client.value || !confirm('Cut the currently exposed label material?')) return
  void action('Cutting', () => client.value!.cut(), 'Cut command completed.')
}
</script>

<template>
  <div class="tool-page studio" :class="{ dark }">
    <header class="topbar">
      <div><span class="eyebrow">BRADY / WEB BLUETOOTH</span><h1>M211 Label Studio</h1></div>
      <div class="topbar-controls">
        <RouterLink to="/tools">All tools</RouterLink>
        <label>Units<select v-model="distanceUnit" aria-label="Measurement units">
          <option value="mm">mm</option><option value="in">inch</option><option value="px">pixel</option>
        </select></label>
        <button class="icon-btn" @click="toggleTheme" :aria-pressed="dark"
          :title="dark ? 'Switch to light mode' : 'Switch to dark mode'"
          :aria-label="dark ? 'Switch to light mode' : 'Switch to dark mode'">{{ dark ? '☀️' : '🌙' }}</button>
      </div>
    </header>
    <div class="tool-content">
      <p class="intro">From image to label. Prepare locally, preview, then print over Bluetooth.</p>
      <div v-if="!bluetoothSupported" class="banner warning">
        Printing requires Web Bluetooth over HTTPS or localhost. Use a supported browser such as
        Chrome or Edge with Bluetooth enabled. Safari and Firefox do not support this API.
        Image preparation still works here.
      </div>
      <div v-if="busy" class="banner" role="status" aria-live="polite">{{ busy }}...</div>

      <div class="workspace">
        <aside class="sidebar">
          <section class="panel">
            <div class="section-heading"><h2>01 / Printer</h2><span class="badge" :class="{ online: connected }">{{ connected ? 'Connected' : 'Offline' }}</span></div>
            <p class="hint" title="Turn on your M211 and close Express Labels or any other app using its Bluetooth connection.">Connect over Bluetooth.</p>
            <div class="actions">
              <button class="primary" :disabled="!!busy || sdkLoading || !client || !bluetoothSupported || connected" @click="connect">{{ sdkLoading ? 'Loading SDK...' : 'Connect M211' }}</button>
              <button :disabled="!!busy || !connected" @click="disconnect">Disconnect</button>
              <button v-if="!client && !sdkLoading" :disabled="!!busy" @click="initializeSdk">Retry SDK loading</button>
            </div>
            <dl v-if="connected && info" class="details">
              <dt>Printer</dt><dd>{{ info.name || info.model }}</dd>
              <dt>Status</dt><dd>{{ info.status || 'Not reported' }}</dd>
              <dt>Cartridge</dt><dd>{{ info.supply || 'Not reported' }}</dd>
              <dt>Media</dt><dd>{{ info.media || 'Not reported' }}</dd>
              <dt>Size (in)</dt><dd>{{ info.dimensions || 'Not reported' }}</dd>
              <dt>Resolution</dt><dd>{{ info.dpi ? `${info.dpi} dpi` : 'Not reported' }}</dd>
              <dt>Battery</dt><dd>{{ info.battery ? `${info.battery}%` : 'Not reported' }}</dd>
              <dt>Material left</dt><dd>{{ info.remaining ? `${info.remaining}%` : 'Not reported' }}</dd>
            </dl>
            <p v-if="connected && !ready" class="warning-text">Only M211 printing is enabled in this interface.</p>
            <p v-if="info?.error" class="warning-text" role="alert">{{ info.error }}</p>
            <details v-if="connected && info" class="help"><summary>SDK consumable diagnostics</summary>
              <p>Supply valid flag: {{ info.supplyValid ?? 'unreported' }}. Ribbon valid flag: {{ info.ribbonValid ?? 'unreported' }}.</p>
              <p>M211 Bluetooth flags can remain false even with a recognized cartridge. Explicit printer errors and the SDK print result determine failures; these flags alone do not block printing.</p>
            </details>
            <div class="actions printer-tools">
              <button :disabled="!!busy || !ready" @click="feed">Feed one blank label</button>
              <button :disabled="!!busy || !ready" @click="cutNow">Cut now</button>
            </div>
            <details class="help"><summary>Having trouble connecting?</summary><p>Allow Bluetooth access and enable your computer's Bluetooth radio. This SDK saves printer ownership in browser storage for reconnection. If the M211 light stays solid blue after losing ownership, Brady documents holding its power button for 5 seconds to release ownership, then pairing again.</p></details>
          </section>

          <section class="panel">
            <h2>02 / Print settings</h2>
            <fieldset class="print-settings" :disabled="!!busy">
              <label :title="combining ? 'Copies of the combined strip' : 'Copies of each image'">Copies<IntegerInput v-model="copies" label="Copies" :min="1" :max="100" /></label>
              <label>Cut behavior
                <select v-model="cut">
                  <option :value="0">At end of job</option>
                  <option :value="1">After each label</option>
                  <option :value="2">Never (cut manually)</option>
                </select>
              </label>
              <ToggleButton v-if="!combining" v-model="collate">Collate copies (A, B, A, B)</ToggleButton>
            </fieldset>
            <button class="primary print" :class="{ printing }" :aria-busy="printing"
              :disabled="!!busy || jobPending || buildingStrip || !ready || !printImages.length || !Number.isInteger(copies) || copies < 1 || copies > 100" @click="printJob">
              <template v-if="printing"><span class="spinner" aria-hidden="true"></span>Sending to printer...</template>
              <template v-else>Print {{ printImages.length * (Number(copies) || 0) }} {{ combining ? 'strips' : 'labels' }}</template>
            </button>
            <p v-if="printing" class="print-progress" role="status">Print started. Please wait while the SDK sends the job.</p>
            <p class="hint" title="The SDK preserves aspect ratio while fitting each bitmap to the first printable zone. The preview is not a calibrated physical-size proof. Combining does not set physical label length; continuous media is recommended.">Printer may scale artwork to fit the cartridge.</p>
            <p v-if="jobPending" class="warning-text">Artwork is updating or has errors. Printing is blocked.</p>
            <p class="hint">No automatic retries. Check output before retrying.</p>
          </section>
        </aside>

        <div class="editor">
          <section class="panel">
            <div class="section-heading"><h2>03 / Artwork</h2><span class="badge">{{ workflow === 'typst' ? 'Typst document job' : 'Images / PDF' }}</span></div>
            <div class="workflow-card">
            <div class="workflow-tabs" role="tablist" aria-label="Artwork source">
              <button id="upload-tab" role="tab" :aria-selected="workflow === 'upload'" aria-controls="upload-panel"
                :tabindex="workflow === 'upload' ? 0 : -1"
                :disabled="!!busy" @click="workflow = 'upload'"
                @keydown.right.prevent="workflow = 'typst'; (($event.currentTarget as HTMLElement).nextElementSibling as HTMLElement)?.focus()"
                @keydown.left.prevent="workflow = 'typst'; (($event.currentTarget as HTMLElement).nextElementSibling as HTMLElement)?.focus()">Images / PDF</button>
              <button id="typst-tab" role="tab" :aria-selected="workflow === 'typst'" aria-controls="typst-panel"
                :tabindex="workflow === 'typst' ? 0 : -1"
                :disabled="!!busy" @click="workflow = 'typst'"
                @keydown.left.prevent="workflow = 'upload'; (($event.currentTarget as HTMLElement).previousElementSibling as HTMLElement)?.focus()"
                @keydown.right.prevent="workflow = 'upload'; (($event.currentTarget as HTMLElement).previousElementSibling as HTMLElement)?.focus()">Typst</button>
            </div>
            <div class="workflow-content">
            <div v-show="workflow === 'upload'" id="upload-panel" role="tabpanel" aria-labelledby="upload-tab" tabindex="0">
            <div class="dropzone" @dragover.prevent @drop.prevent="onDrop">
              <strong>Drop label images or PDFs here</strong>
              <p class="hint" title="Images up to 20 MiB; PDFs up to 50 MiB; at most 30 images/pages per job.">PNG, JPEG, WebP, SVG, PDF</p>
              <button :disabled="!!busy" @click="fileInput?.click()">Choose images or PDFs</button>
              <input ref="fileInput" hidden type="file" aria-label="Choose images or PDFs" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.pdf" multiple :disabled="!!busy" @change="onFiles">
            </div>
            <fieldset class="document-settings" :disabled="!!busy">
              <div class="setting-toggle"><ToggleButton v-model="usePrinterHeight">Use printer label height</ToggleButton></div>
              <p v-if="usePrinterHeight && info?.mediaHeightInches" class="hint">Label height: {{ describePixels(labelHeight, outputPpi) }} ({{ info.mediaHeightInches }} in reported)</p>
              <DistanceInput v-else v-model="labelHeight" label="Label height" :unit="distanceUnit" :ppi="outputPpi" />
            </fieldset>
            <p class="hint" title="Label height follows the M211 tape width, with a 0.5 in offline fallback. Fit scales each item to this height. Fixed PPI keeps physical scale, centers vertical crops, and pads shorter items with white.">Choose fit or fixed PPI on each image below.</p>
            </div>
            <fieldset v-if="workflow === 'upload' || connected" class="resolution-settings" :disabled="!!busy">
              <template v-if="workflow === 'upload'">
                <label class="inline-field" title="Leave blank to follow the printer PPI, or enter an override for PDF import. Offline default: 203.">Raster PPI
                  <IntegerInput :model-value="pdfPpiOverride ?? NaN" label="Raster PPI"
                    :placeholder="String(detectedPpi ?? 203)" :min="72" :max="1200" @input="updatePdfPpi" />
                </label>
                <button v-if="pdfPpiOverride !== undefined" @click="pdfPpiOverride = undefined">Reset to printer PPI</button>
              </template>
              <span v-else-if="detectedPpi" class="badge online" title="Raster resolution follows the connected printer automatically.">Printer: {{ rasterPpi }} PPI</span>
              <label v-else class="inline-field">Raster PPI<IntegerInput v-model="manualPpi" label="Raster PPI" :min="72" :max="1200" /></label>
              <span v-if="connected && !detectedPpi" class="ppi-warning" role="status">{{ workflow === 'typst' ? `Printer PPI unavailable. Using manual ${rasterPpi} PPI until a resolution is reported.` : 'Printer PPI unavailable. Default: 203 PPI; enter an override if needed.' }}</span>
            </fieldset>
            <div v-show="workflow === 'typst'" id="typst-panel" role="tabpanel" aria-labelledby="typst-tab" tabindex="0" class="typst-editor">
              <fieldset :disabled="!!busy">
                <div class="typst-toolbar">
                  <button class="source-file-button" :disabled="savingTypst" @click="typstInput?.click()">Load .typ</button>
                  <input ref="typstInput" hidden type="file" aria-label="Load .typ document" accept=".typ,text/plain" @change="loadTypstSource">
                  <button class="source-file-button" :disabled="savingTypst" title="Save As a .typ source file (Ctrl+S / Cmd+S)" @click="saveTypst">{{ savingTypst ? 'Saving...' : 'Save .typ' }}</button>
                  <span class="hint source-filename" :title="typstFilename">{{ typstFilename }}{{ typstDirty ? ' *' : '' }}</span>
                  <div class="actions source-tools">
                    <button class="supporting-files-button" @click="filesOpen = true">Supporting files / fonts{{ typstFiles.length ? ` (${typstFiles.length})` : '' }}</button>
                    <button :disabled="savingTypst" title="Replace the source and local draft with the starter template; supporting uploads are kept." @click="resetTypst">Reset to template</button>
                  </div>
                </div>
                <p v-if="sourceStorageError" class="warning-text" role="alert">{{ sourceStorageError }}</p>
              </fieldset>
              <div class="typst-workspace">
              <fieldset :disabled="!!busy" class="typst-source">
                <div class="section-heading"><h3>Typst source</h3><span class="hint" title="Tab indents the current line or selected lines; Shift+Tab outdents. Enter inserts a plain newline. Press Esc then Tab to move focus out of the editor.">Tab / Shift+Tab</span></div>
                <TypstEditor v-model="typstSource" :dark="dark" :disabled="!!busy" />
              </fieldset>
              <div class="live-preview">
                <div class="section-heading">
                  <h3>Typst page preview</h3>
                  <span class="badge" :class="{ online: !liveStale }" role="status" :title="liveStatus || 'Edits automatically update the document job and combined strip.'">{{ liveStatus ? 'Rendering...' : liveError ? 'Error' : 'Live' }}</span>
                </div>
                <p v-if="liveError" class="warning-text diagnostics" role="alert">{{ liveError }}</p>
                <p v-if="liveStale && liveImages.length" class="warning-text">Previous preview is out of date.</p>
                <div class="live-pages" :aria-busy="!!liveStatus">
                  <figure v-for="(image, index) in liveImages" :key="index">
                    <button class="page-preview" :aria-label="`Open Typst page ${index + 1} preview`"
                      @click="openPreview(image, `Typst page ${index + 1}`, livePpi)">
                      <img :src="image.src" :alt="`Typst page ${index + 1}`"
                        :style="{ width: `${previewWidth(image.naturalWidth, image.naturalHeight, livePpi)}px` }">
                    </button>
                    <figcaption class="caption">Page {{ index + 1 }} / {{ describeSize(image.naturalWidth, image.naturalHeight, livePpi, distanceUnit) }}</figcaption>
                  </figure>
                </div>
                <pre v-if="liveDiagnostics.length && !liveStale" class="diagnostics">{{ liveDiagnostics.join('\n') }}</pre>
              </div>
              </div>
              <p class="hint" title="Edits use a retained incremental compiler. PDF export and rasterization take time; only the latest complete output is printable. Versioned @preview packages download on first use. Compiler, fonts, and packages are cached across reloads; private/local packages are not fetched automatically.">Rendered locally. Public packages and fonts cached.</p>
            </div>
            </div>
            </div>
            <fieldset class="render-settings" :disabled="!!busy">
              <label>Rotate
                <select v-model="options.rotation" @change="workflow === 'upload' && renderImages()">
                  <option :value="0">0 degrees</option><option :value="90">90 degrees</option>
                  <option :value="180">180 degrees</option><option :value="270">270 degrees</option>
                </select>
              </label>
              <div class="setting-toggle"><ToggleButton v-model="options.monochrome" @update:model-value="workflow === 'upload' && renderImages()">Black &amp; white</ToggleButton></div>
              <label>Threshold: {{ options.threshold }}<input v-model.number="options.threshold" type="range" min="0" max="255" :disabled="!options.monochrome" @change="workflow === 'upload' && renderImages()"></label>
            </fieldset>
            <button v-if="workflow === 'upload' && renderPending" :disabled="!!busy" @click="renderImages">Apply preview settings</button>
            <p class="hint" title="Transparent areas become white. Rotation and thresholding apply to all pages. With black & white off, the SDK performs its own conversion for printing.">Image settings apply to all pages.</p>
            <fieldset class="strip-settings" :disabled="!!busy">
              <div class="actions strip-toggles">
              <ToggleButton v-model="combining">Combine into one strip</ToggleButton>
              <template v-if="combining">
                <ToggleButton v-model="stripOptions.autoTrim">Auto trim left/right whitespace</ToggleButton>
                <ToggleButton v-model="stripOptions.separators" title="Full-height, one-pixel black separators between padded images.">Between separators</ToggleButton>
                <ToggleButton :model-value="!!stripOptions.edgeSeparators" title="Full-height, one-pixel black marks before the first and after the last image." @update:model-value="stripOptions.edgeSeparators = $event">Outer separators</ToggleButton>
              </template>
              </div>
              <template v-if="combining">
                <div class="render-settings strip-measurements">
                  <DistanceInput v-if="!stripOptions.autoTrim" v-model="stripOptions.cropLeft" label="Left crop" :unit="distanceUnit" :ppi="jobPpi" />
                  <DistanceInput v-if="!stripOptions.autoTrim" v-model="stripOptions.cropRight" label="Right crop" :unit="distanceUnit" :ppi="jobPpi" />
                  <DistanceInput v-model="marginPixels" label="Margin per image" :unit="distanceUnit" :ppi="jobPpi" />
                </div>
                <p class="hint" title="Auto trim removes white/near-white columns (RGB at least 250) and ignores manual crops. Disable it for manual crops. Images are vertically centered without resizing. Margins are horizontal only, rounded to raster pixels. Separators are one raster pixel before SDK scaling.">Horizontal margins only / {{ jobPpi }} PPI</p>
                <div class="actions">
                  <a v-if="combinedImage" :href="combinedImage.src" download="label-strip.png">Download strip PNG</a>
                </div>
              </template>
            </fieldset>
            <p v-if="buildingStrip" class="hint" role="status">Updating combined preview...</p>
            <p v-if="combinedError" class="warning-text" role="alert">{{ combinedError }}</p>
            <p v-if="preparationError && workflow === 'upload'" class="warning-text" role="alert">{{ preparationError }}</p>
            <div class="preview-stage">
              <button v-if="previewImage" class="page-preview" aria-label="Open full-size artwork preview"
                @click="openPreview(previewImage, combining ? 'Combined label strip' : workflow === 'typst' ? 'Typst page 1' : selectedName)">
                <img :src="previewImage.src" :alt="combining ? 'Combined label strip' : workflow === 'typst' ? 'Typst page 1' : `Rendered label: ${selectedName}`"
                  :style="{ width: `${previewWidth(previewImage.naturalWidth, previewImage.naturalHeight, jobPpi)}px` }">
              </button>
              <div v-else class="empty-preview"><strong>{{ combining ? 'Combined strip preview' : 'Your label goes here' }}</strong><p>{{ combining ? 'Preview updates automatically when artwork and settings are ready.' : 'Select an image below to see a print-ready preview.' }}</p></div>
            </div>
            <p v-if="previewImage" class="caption" title="Click the preview to zoom and pan. Physical dimensions are estimates before SDK scaling.">{{ combining ? 'Combined strip' : workflow === 'typst' ? 'Typst page 1' : selectedName }} / {{ describeSize(previewImage.naturalWidth, previewImage.naturalHeight, jobPpi, distanceUnit) }}</p>
          </section>

          <section v-if="workflow === 'upload'" class="panel">
            <div class="section-heading"><h2>04 / Image and PDF pages</h2><button :disabled="!!busy || !labels.length" @click="labels = []; selected = undefined">Clear job</button></div>
            <p v-if="!labels.length" class="hint">No images yet. Labels print in the order below. Successful jobs stay here for reuse.</p>
            <ol class="queue">
              <li v-for="(label, index) in labels" :key="label.id" :class="{ selected: selected === label.id }">
                <h3>{{ index + 1 }}. {{ label.name }}</h3>
                <button v-if="resultImage(label.id)" class="queue-item" @click="selected = label.id; openPreview(resultImage(label.id)!, label.name)" :aria-pressed="selected === label.id">
                  <img :src="resultImage(label.id)!.src" :alt="`Resulting label: ${label.name}`"
                    :style="{ width: `${previewWidth(resultImage(label.id)!.naturalWidth, resultImage(label.id)!.naturalHeight, outputPpi)}px` }">
                </button>
                <p v-else class="hint">Resulting label unavailable. {{ preparing ? 'Updating preview...' : 'Check the image settings.' }}</p>
                <fieldset :disabled="!!busy">
                  <label>Sizing
                    <select :value="label.sizing" :aria-label="`Sizing for ${label.name}`"
                      @change="updateLabel(label.id, { sizing: ($event.target as HTMLSelectElement).value as ImageSizing })">
                      <option value="fit">Fit to label height</option><option value="crop">Fixed PPI / crop to label height</option>
                    </select>
                  </label>
                  <label v-if="label.sizing === 'crop'">Image PPI (default: printer)
                    <IntegerInput :model-value="label.ppi ?? outputPpi" :min="72" :max="1200"
                      :label="`Image PPI for ${label.name}`" @input="updateLabel(label.id, { ppi: ($event.target as HTMLInputElement).valueAsNumber })" />
                    <button v-if="label.ppi !== undefined" @click="updateLabel(label.id, { ppi: undefined })">Use printer PPI</button>
                  </label>
                </fieldset>
                <p class="hint">Source: {{ describeSize(label.image.naturalWidth, label.image.naturalHeight, label.ppi ?? outputPpi, distanceUnit) }}.
                  Height: {{ Math.round(label.image.naturalHeight / (label.ppi ?? outputPpi) / heightInches * 100) }}% of label before fitting.</p>
                <p v-if="resultImage(label.id)" class="hint">Result: {{ describeSize(resultImage(label.id)!.naturalWidth, resultImage(label.id)!.naturalHeight, outputPpi, distanceUnit) }}</p>
                <div class="actions">
                  <button :disabled="!!busy || index === 0" :aria-label="`Move ${label.name} up`" @click="moveLabel(index, -1)">Up</button>
                  <button :disabled="!!busy || index === labels.length - 1" :aria-label="`Move ${label.name} down`" @click="moveLabel(index, 1)">Down</button>
                  <button :disabled="!!busy" :aria-label="`Remove ${label.name}`" @click="removeLabel(label.id)">Remove</button>
                </div>
              </li>
            </ol>
          </section>
        </div>
      </div>

      <ImageViewer v-if="viewer" :image="viewer.image" :name="viewer.name" :ppi="viewer.ppi" :unit="distanceUnit" @close="viewer = undefined" />
      <SupportingFilesDialog v-if="filesOpen" v-model:files="typstFiles" :busy="!!busy"
        @clear-cache="clearCache" @close="filesOpen = false" @error="report" />
      <dialog ref="heightDialog" class="studio-dialog print-height-dialog" aria-labelledby="height-title"
        aria-describedby="height-description" @close="pendingPrint = undefined" @cancel="pendingPrint = undefined"
        @keydown.esc.prevent="pendingPrint = undefined">
        <template v-if="pendingPrint">
          <h2 id="height-title">Artwork height does not match the label material</h2>
          <p id="height-description">The {{ combining ? 'strip' : 'job' }} contains artwork with a different height from the
            {{ info?.mediaHeightInches ? 'printer material' : 'configured label height (printer height unavailable)' }}:
            {{ describePixels(pendingPrint.height, pendingPrint.ppi) }}.</p>
          <p class="hint">Artwork heights: {{ [...new Set(pendingPrint.images.map(image => image.naturalHeight))].join(', ') }} px.
            Cancel to edit the source, or adjust this print only. Scaling keeps proportions and changes width.
            Cropping keeps width and centers vertically; shorter artwork is padded with white.</p>
          <div class="actions">
            <button autofocus @click="pendingPrint = undefined">Cancel</button>
            <button @click="sendPrint(pendingPrint, 'fit')">Scale to height &amp; print</button>
            <button @click="sendPrint(pendingPrint, 'crop')">Crop / pad to height &amp; print</button>
          </div>
        </template>
      </dialog>
      <div class="toast-stack" aria-label="Activity notifications">
        <div v-for="toast in toasts" :key="toast.id" class="toast" :class="{ 'toast-error': toast.error }"
          :role="toast.error ? 'alert' : 'status'">
          <span>{{ toast.message }}</span>
          <button :aria-label="`Dismiss: ${toast.message}`" @click="toasts = toasts.filter(item => item.id !== toast.id)">×</button>
        </div>
      </div>
      <footer>Images stay in browser memory and are sent to your printer, not uploaded. SDK print analytics are disabled.
        The selected workflow defines the active print job.
        <a :href="`${baseUrl}brady-sdk/LICENSE.md`">Brady SDK license</a>
        / <a :href="`${baseUrl}brady-sdk/typst-LICENSE`">Typst.ts license</a>
        / <a :href="`${baseUrl}brady-sdk/pdfjs-LICENSE`">PDF.js license</a>
      </footer>
    </div>
  </div>
</template>

<style src="./studio.css"></style>
