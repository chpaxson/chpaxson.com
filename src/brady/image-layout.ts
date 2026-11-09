export type ImageSizing = 'fit' | 'crop'

export function labelLayout(width: number, height: number, labelHeight: number,
  mode: ImageSizing, sourcePpi: number, printerPpi: number) {
  if (![width, height, labelHeight, sourcePpi, printerPpi].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Image size, label height, and PPI must be positive numbers.')
  }
  if (!Number.isInteger(sourcePpi) || sourcePpi < 72 || sourcePpi > 1200) {
    throw new Error('Image PPI must be a whole number from 72 to 1200.')
  }
  const scale = mode === 'fit' ? labelHeight / height : printerPpi / sourcePpi
  const outputWidth = Math.max(1, Math.round(width * scale))
  const outputHeight = Math.round(labelHeight)
  if (outputWidth > 8192 || outputHeight > 8192 || outputWidth * outputHeight > 16_000_000) {
    throw new Error('Label raster exceeds 8192 pixels per side or 16 megapixels. Reduce label size or source width.')
  }
  const drawnHeight = mode === 'fit' ? outputHeight : height * scale
  return { width: outputWidth, height: outputHeight, drawnHeight,
    y: (outputHeight - drawnHeight) / 2, scale }
}
