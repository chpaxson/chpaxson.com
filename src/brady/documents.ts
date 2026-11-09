import { cachedAsset, clearDocumentCache } from './asset-cache'
import { MAX_PAGES, pagePixels, validatePpi } from './document-settings'
import type { ProjectFile, TypstRequest, TypstResponse } from './typst-protocol'

export interface DocumentPages {
  pages: Blob[]
  diagnostics: string[]
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      cause => { signal.removeEventListener('abort', abort); reject(cause) },
    )
    if (signal.aborted) {
      signal.removeEventListener('abort', abort)
      abort()
    }
  })
}

export async function rasterizePdf(file: Blob, ppi: number, maxPages = MAX_PAGES, signal?: AbortSignal): Promise<Blob[]> {
  signal?.throwIfAborted()
  validatePpi(ppi)
  if (file.size > 50 * 1024 * 1024) throw new Error('PDFs must be at most 50 MiB.')
  const data = new Uint8Array(await abortable(file.arrayBuffer(), signal))
  const pdfjs = await abortable(import('pdfjs-dist'), signal)
  // Fetch the versioned worker through our persistent cache, then start it locally.
  const response = await abortable(cachedAsset(`${location.origin}${import.meta.env.BASE_URL}brady-sdk/pdfjs-6.5.438.worker.mjs`), signal)
  signal?.throwIfAborted()
  const workerData = await abortable(response.arrayBuffer(), signal)
  signal?.throwIfAborted()
  const workerUrl = URL.createObjectURL(new Blob([workerData], { type: 'text/javascript' }))
  let port: Worker | undefined
  let worker: import('pdfjs-dist').PDFWorker | undefined
  let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined
  let rendering: import('pdfjs-dist').RenderTask | undefined
  const abort = () => {
    rendering?.cancel()
    void task?.destroy().catch(() => {})
  }
  try {
    port = new Worker(workerUrl, { type: 'module' })
    worker = pdfjs.PDFWorker.create({ port })
    const loading = pdfjs.getDocument({
      data, worker,
      useSystemFonts: false,
      standardFontDataUrl: `${location.origin}${import.meta.env.BASE_URL}brady-sdk/pdf-fonts/`,
      wasmUrl: `${location.origin}${import.meta.env.BASE_URL}brady-sdk/pdf-wasm/`,
      cMapUrl: `${location.origin}${import.meta.env.BASE_URL}brady-sdk/pdf-cmaps/`,
      cMapPacked: true,
    })
    task = loading
    signal?.addEventListener('abort', abort, { once: true })
    signal?.throwIfAborted()
    const pdf = await abortable(new Promise<import('pdfjs-dist').PDFDocumentProxy>((resolve, reject) => {
      loading.onPassword = () => reject(new Error('Password-protected PDFs are not supported. Export an unlocked PDF first.'))
      loading.promise.then(resolve, reject)
    }), signal)
    if (!pdf.numPages || pdf.numPages > maxPages) {
      throw new Error(`Document has ${pdf.numPages} pages; this job has room for ${maxPages}.`)
    }
    const pages: Blob[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted()
      const page = await abortable(pdf.getPage(number), signal)
      const canvas = document.createElement('canvas')
      try {
        const physical = page.getViewport({ scale: 1 })
        const size = pagePixels(physical.width, physical.height, ppi)
        canvas.width = size.width
        canvas.height = size.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Your browser could not create a PDF canvas.')
        // Print intent avoids PDF.js's requestAnimationFrame scheduling in hidden tabs.
        rendering = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: ppi / 72 }),
          intent: 'print', background: 'rgb(255,255,255)' })
        await abortable(rendering.promise, signal)
        signal?.throwIfAborted()
        pages.push(await abortable(new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(`Could not rasterize PDF page ${number}.`)), 'image/png')
        }), signal))
        signal?.throwIfAborted()
      } finally {
        rendering = undefined
        try { page.cleanup() }
        finally { canvas.width = canvas.height = 0 }
      }
    }
    return pages
  } catch (cause) {
    signal?.throwIfAborted()
    throw cause
  } finally {
    signal?.removeEventListener('abort', abort)
    try {
      await task?.destroy().catch(cause => {
        if (!signal?.aborted) throw cause
      })
    } finally {
      try { worker?.destroy() }
      finally {
        port?.terminate()
        URL.revokeObjectURL(workerUrl)
      }
    }
  }
}

type Compiled = Extract<TypstResponse, { type: 'result' }>

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/**
 * One retained compiler per editor. render() immediately supersedes the previous
 * render; abort obsoletes its result, not the compiler. Asset changes reset it.
 * Call dispose() when the editor closes. PDF export/rasterization is still full-page.
 * Synchronous WASM cannot be interrupted; newer edits run serially after it.
 * A compiler timeout/crash restarts the worker on the next render.
 */
export class TypstSession {
  private worker?: Worker
  private files: ProjectFile[] = []
  private fonts: Uint8Array[] = []
  private nextId = 0
  private current?: AbortController
  private disposed = false
  private pending?: {
    id: number
    resolve: (result: Compiled) => void
    reject: (cause: unknown) => void
    progress: (message: string) => void
  }

  private stopWorker() {
    this.worker?.terminate()
    this.worker = undefined
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.current?.abort(new DOMException('Typst session disposed.', 'AbortError'))
    this.stopWorker()
    this.files = []
    this.fonts = []
  }

  async render(
    source: string, ppi: number, files: ProjectFile[], fonts: Uint8Array[],
    progress: (message: string) => void, maxPages = MAX_PAGES, signal?: AbortSignal,
  ): Promise<DocumentPages> {
    if (this.disposed) throw new Error('Typst session has been disposed.')
    this.current?.abort(new DOMException('Superseded by a newer Typst render.', 'AbortError'))
    const controller = new AbortController()
    this.current = controller
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const id = ++this.nextId
    try {
      controller.signal.throwIfAborted()
      validatePpi(ppi)
      if (!source.trim()) throw new Error('Paste a Typst document first.')
      if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('Page limit must be a positive integer.')
      for (const file of files) {
        if (!file.path || file.path.startsWith('/') || file.path.includes('\\') ||
            file.path.split('/').some(part => part === '..' || part === '.' || !part)) {
          throw new Error(`Invalid project file path: ${file.path}`)
        }
        if (file.path === 'main.typ') throw new Error('main.typ is reserved for the pasted source. Rename this supporting file.')
      }
      const changed = files.length !== this.files.length || fonts.length !== this.fonts.length ||
        files.some((file, i) => file.path !== this.files[i]?.path || !sameBytes(file.data, this.files[i]!.data)) ||
        fonts.some((font, i) => !sameBytes(font, this.fonts[i]!))
      if (changed) this.stopWorker()
      const initialize = !this.worker
      if (initialize) {
        this.files = files.map(file => ({ path: file.path, data: file.data.slice() }))
        this.fonts = fonts.map(font => font.slice())
        const worker = new Worker(new URL('./typst.worker.ts', import.meta.url), { type: 'module' })
        this.worker = worker
        const failed = (message: string) => {
          if (this.worker !== worker) return
          this.stopWorker()
          this.pending?.reject(new Error(message))
        }
        worker.onerror = event => failed(event.message || 'Typst worker failed.')
        worker.onmessageerror = () => failed('Could not decode the Typst worker response.')
        worker.onmessage = (event: MessageEvent<TypstResponse>) => {
          const pending = this.pending
          const message = event.data
          if (this.worker !== worker || !pending || message.id !== pending.id) return
          if (message.type === 'progress') {
            try { pending.progress(message.message) } catch (cause) { pending.reject(cause) }
          } else if (message.type === 'error') pending.reject(new Error(message.message))
          else pending.resolve(message)
        }
      }
      const worker = this.worker!
      const compiled = await new Promise<Compiled>((resolve, reject) => {
        const finish = (cause?: unknown, result?: Compiled) => {
          clearTimeout(timer)
          controller.signal.removeEventListener('abort', cancelled)
          if (this.pending?.id === id) this.pending = undefined
          if (result) resolve(result)
          else reject(cause)
        }
        const cancelled = () => {
          try { worker.postMessage({ type: 'cancel', id } satisfies TypstRequest) }
          catch { /* A crashed worker may already be unavailable. */ }
          finish(controller.signal.reason)
        }
        const timer = setTimeout(() => {
          this.stopWorker()
          finish(new Error('Typst rendering exceeded 120 seconds. The compiler was stopped; retry to restart it.'))
        }, 120_000)
        this.pending = { id, resolve: result => finish(undefined, result), reject: cause => finish(cause), progress }
        controller.signal.addEventListener('abort', cancelled, { once: true })
        try {
          worker.postMessage({
            type: 'compile', id, source, baseUrl: `${location.origin}${import.meta.env.BASE_URL}`,
            ...(initialize ? { files: this.files, fonts: this.fonts } : {}),
          } satisfies TypstRequest)
        } catch (cause) {
          this.stopWorker()
          finish(cause)
        }
      })
      controller.signal.throwIfAborted()
      progress('Rasterizing Typst pages at the selected PPI...')
      const pages = await rasterizePdf(new Blob([compiled.pdf.slice().buffer], { type: 'application/pdf' }),
        ppi, maxPages, controller.signal)
      controller.signal.throwIfAborted()
      return { pages, diagnostics: compiled.diagnostics }
    } finally {
      signal?.removeEventListener('abort', abort)
      if (this.current === controller) this.current = undefined
    }
  }
}

/** One-shot compatibility API; editors should retain a TypstSession instead. */
export async function renderTypst(
  source: string, ppi: number, files: ProjectFile[], fonts: Uint8Array[],
  progress: (message: string) => void, maxPages = MAX_PAGES, signal?: AbortSignal,
): Promise<DocumentPages> {
  const session = new TypstSession()
  try { return await session.render(source, ppi, files, fonts, progress, maxPages, signal) }
  finally { session.dispose() }
}

export { clearDocumentCache }
