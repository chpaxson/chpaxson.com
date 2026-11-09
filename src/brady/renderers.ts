import { horizontalBounds, stripLayout, validateStripOptions, type StripOptions } from './strip'
import { labelLayout, type ImageSizing } from './image-layout'

export interface RenderOptions {
  rotation: 0 | 90 | 180 | 270
  monochrome: boolean
  threshold: number
}

// Document renderers rasterize pages to PNG Blobs, then reuse this artwork renderer.
export interface LabelRenderer {
  id: string
  render(source: Blob, options: RenderOptions): Promise<HTMLImageElement>
}

export async function decodeImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  // decode() can wait indefinitely for a rendering opportunity in a hidden tab.
  await new Promise<void>((resolve, reject) => {
    image.onload = () => {
      image.onload = image.onerror = null
      if (image.naturalWidth && image.naturalHeight) resolve()
      else reject(new Error('The image has no drawable dimensions.'))
    }
    image.onerror = () => {
      image.onload = image.onerror = null
      reject(new Error('The image could not be loaded. Check that the file is a supported image.'))
    }
    image.src = url
  })
  return image
}

export const imageRenderer: LabelRenderer = {
  id: 'image',
  async render(source, options) {
    if (source.size > 20 * 1024 * 1024) throw new Error('Images must be at most 20 MiB.')
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(source.type)) {
      throw new Error('Choose a PNG, JPEG, WebP, or SVG image.')
    }

    if (![0, 90, 180, 270].includes(options.rotation) ||
        !Number.isInteger(options.threshold) || options.threshold < 0 || options.threshold > 255) {
      throw new Error('Invalid image rendering settings.')
    }
    const url = URL.createObjectURL(source)
    try {
      const image = await decodeImage(url)
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height || width * height > 16_000_000 || width > 8192 || height > 8192) {
        throw new Error('Images must be at most 16 megapixels and 8192 pixels per side.')
      }
      const canvas = document.createElement('canvas')
      const sideways = options.rotation === 90 || options.rotation === 270
      canvas.width = sideways ? height : width
      canvas.height = sideways ? width : height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Your browser could not create an image canvas.')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(options.rotation * Math.PI / 180)
      ctx.drawImage(image, -width / 2, -height / 2)
      if (options.monochrome) {
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = pixels.data
        for (let i = 0; i < data.length; i += 4) {
          const luminance = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
          const value = luminance < options.threshold ? 0 : 255
          data[i] = data[i + 1] = data[i + 2] = value
        }
        ctx.putImageData(pixels, 0, 0)
      }
      return await decodeImage(canvas.toDataURL('image/png'))
    } finally {
      URL.revokeObjectURL(url)
    }
  },
}
export async function renderLabelImage(image: HTMLImageElement, height: number,
  mode: ImageSizing, ppi: number, printerPpi: number): Promise<HTMLImageElement> {
  const layout = labelLayout(image.naturalWidth, image.naturalHeight, height, mode, ppi, printerPpi)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create a label canvas.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, layout.y, layout.width, layout.drawnHeight)
  return decodeImage(canvas.toDataURL('image/png'))
}

export async function combineImages(images: HTMLImageElement[], options: StripOptions): Promise<HTMLImageElement> {
  validateStripOptions(options)
  const crops = images.map((image, index) => {
    if (!image.complete || !image.naturalWidth) throw new Error(`Image ${index + 1} is not decoded.`)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser could not create an image canvas.')
    ctx.drawImage(image, 0, 0)
    try {
      const bounds = horizontalBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width, canvas.height, options)
      return { ...bounds, height: canvas.height }
    } catch (cause) {
      throw new Error(`Image ${index + 1}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  })
  const layout = stripLayout(crops, options)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create an image canvas.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => {
    const crop = crops[index]!
    const position = layout.positions[index]!
    ctx.drawImage(image, crop.left, 0, crop.width, crop.height, position.x, position.y, crop.width, crop.height)
    if (position.separator !== undefined) {
      ctx.fillStyle = '#000'
      ctx.fillRect(position.separator, 0, 1, canvas.height)
    }
  })
  if (options.edgeSeparators) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1, canvas.height)
    ctx.fillRect(canvas.width - 1, 0, 1, canvas.height)
  }
  return decodeImage(canvas.toDataURL('image/png'))
}
