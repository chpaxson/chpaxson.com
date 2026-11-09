export const MAX_PAGES = 30

export function printerPpi(dpi: string | undefined): number | undefined {
  const value = Number(dpi)
  return Number.isInteger(value) && value >= 72 && value <= 1200 ? value : undefined
}

export function validatePpi(ppi: number) {
  if (!Number.isInteger(ppi) || ppi < 72 || ppi > 1200) {
    throw new Error('Raster PPI must be a whole number from 72 to 1200.')
  }
}

export function pagePixels(widthPoints: number, heightPoints: number, ppi: number) {
  validatePpi(ppi)
  const width = Math.ceil(widthPoints * ppi / 72)
  const height = Math.ceil(heightPoints * ppi / 72)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new Error('Page raster exceeds 8192 pixels per side or 16 megapixels. Reduce PPI or page size.')
  }
  return { width, height }
}
