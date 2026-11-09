export const ASSET_CACHE = 'brady-label-assets-v1-typst-0.7.0'
export const PACKAGE_CACHE = 'brady-label-typst-packages-v1'

export async function cachedAsset(url: string, cacheName = ASSET_CACHE): Promise<Response> {
  if (!('caches' in globalThis)) throw new Error('Persistent asset caching requires HTTPS or localhost and browser storage access.')
  const cache = await caches.open(cacheName)
  const cached = await cache.match(url)
  if (cached) return cached
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}.`)
  await cache.put(url, response.clone())
  return response
}

export async function clearDocumentCache() {
  await Promise.all([caches.delete(ASSET_CACHE), caches.delete(PACKAGE_CACHE)])
}
