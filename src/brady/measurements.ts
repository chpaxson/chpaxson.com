export type DistanceUnit = 'mm' | 'in' | 'px'

export function parseDistance(input: string, unit: DistanceUnit, ppi: number) {
  const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(mm|in|inch|inches|px|pixel|pixels)?\s*$/i.exec(input)
  if (!match) return NaN
  const suffix = match[2]?.toLowerCase()
  const actualUnit = suffix === 'mm' ? 'mm' : suffix?.startsWith('in') ? 'in' : suffix?.startsWith('p') ? 'px' : unit
  return toPixels(Number(match[1]), actualUnit, ppi)
}

export function fromPixels(pixels: number, unit: DistanceUnit, ppi: number) {
  return unit === 'px' ? pixels : pixels / ppi * (unit === 'mm' ? 25.4 : 1)
}

export function toPixels(value: number, unit: DistanceUnit, ppi: number) {
  return unit === 'px' ? value : value * ppi / (unit === 'mm' ? 25.4 : 1)
}

export function formatDistance(value: number) {
  if (!Number.isFinite(value)) return 'Invalid'
  const nearest = Math.round(value)
  return String(Math.abs(value - nearest) < .0001 ? nearest : Number(value.toFixed(5)))
}

export function describePixels(pixels: number, ppi: number) {
  return `${formatDistance(fromPixels(pixels, 'mm', ppi))} mm / ${formatDistance(fromPixels(pixels, 'in', ppi))} in / ${formatDistance(pixels)} px`
}

export function describeSize(width: number, height: number, ppi: number, unit: DistanceUnit) {
  const pixels = `${width} x ${height} px`
  if (unit === 'px') return pixels
  return `${Number(fromPixels(width, unit, ppi).toFixed(3))} x ${Number(fromPixels(height, unit, ppi).toFixed(3))} ${unit} (${pixels})`
}

export function previewWidth(width: number, height: number, ppi: number) {
  return width * Math.min(203 / ppi, 600 / height)
}
