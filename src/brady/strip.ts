export interface StripOptions {
  autoTrim: boolean
  cropLeft: number
  cropRight: number
  margin: number
  separators: boolean
  edgeSeparators?: boolean
}

export function validateStripOptions(options: StripOptions) {
  for (const [name, value] of Object.entries({
    'Left crop': options.cropLeft, 'Right crop': options.cropRight, Margin: options.margin,
  })) {
    if (!Number.isInteger(value) || value < 0 || value > 8192) {
      throw new Error(`${name} must be a whole number from 0 to 8192 pixels.`)
    }
  }
}

export function horizontalBounds(
  pixels: Uint8ClampedArray, width: number, height: number, options: StripOptions,
) {
  validateStripOptions(options)
  let left = 0
  let right = width - 1
  if (options.autoTrim) {
    left = width
    right = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const alpha = pixels[i + 3]! / 255
        const ink = Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) * alpha +
          255 * (1 - alpha) < 250
        if (ink) {
          left = Math.min(left, x)
          right = Math.max(right, x)
        }
      }
    }
    if (right < left) throw new Error('Automatic trimming found no non-white content. Disable auto trim to include blank images.')
  }
  if (!options.autoTrim) {
    left += options.cropLeft
    right -= options.cropRight
  }
  if (right < left) throw new Error('Left/right crops remove the entire image. Reduce the crop values.')
  return { left, width: right - left + 1 }
}

export function stripLayout(sizes: { width: number; height: number }[], options: StripOptions) {
  validateStripOptions(options)
  if (!sizes.length) throw new Error('Add at least one image to build a strip.')
  const separatorWidth = options.separators ? 1 : 0
  const edge = options.edgeSeparators ? 1 : 0
  const width = sizes.reduce((sum, size) => sum + size.width + 2 * options.margin, 0) +
    (sizes.length - 1) * separatorWidth + 2 * edge
  const height = Math.max(...sizes.map(size => size.height))
  if (width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new Error('Combined image exceeds 8192 pixels per side or 16 megapixels. Reduce margins, image sizes, or the number of images.')
  }
  let offset = edge
  const positions = sizes.map((size, index) => {
    const x = offset + options.margin
    const y = Math.floor((height - size.height) / 2)
    offset += size.width + 2 * options.margin
    const separator = options.separators && index < sizes.length - 1 ? offset : undefined
    if (index < sizes.length - 1) offset += separatorWidth
    return { x, y, separator }
  })
  return { width, height, positions }
}
