import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachedAsset, clearDocumentCache, ASSET_CACHE, PACKAGE_CACHE } from '../asset-cache.ts'

test('persistent cache hits avoid downloads across independent calls; failed responses are not saved', async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const entries = new Map()
  let fetches = 0
  const deletions = []
  globalThis.caches = {
    async open(name) {
      return {
        async match(url) { return entries.get(`${name}:${url}`)?.clone() },
        async put(url, response) { entries.set(`${name}:${url}`, response) },
      }
    },
    async delete(name) { deletions.push(name); return true },
  }
  globalThis.fetch = async url => {
    fetches++
    return new Response(url.endsWith('missing') ? 'not found' : 'asset', { status: url.endsWith('missing') ? 404 : 200 })
  }
  try {
    assert.equal(await (await cachedAsset('https://example.test/compiler.wasm')).text(), 'asset')
    assert.equal(await (await cachedAsset('https://example.test/compiler.wasm')).text(), 'asset')
    assert.equal(fetches, 1)
    await cachedAsset('https://example.test/pkg.tar.gz', PACKAGE_CACHE)
    await cachedAsset('https://example.test/pkg.tar.gz', PACKAGE_CACHE)
    assert.equal(fetches, 2)
    await assert.rejects(cachedAsset('https://example.test/missing'), /HTTP 404/)
    assert.equal(entries.has(`${ASSET_CACHE}:https://example.test/missing`), false)
    await clearDocumentCache()
    assert.deepEqual(deletions.sort(), [ASSET_CACHE, PACKAGE_CACHE].sort())
  } finally {
    globalThis.fetch = originalFetch
    if (originalCaches === undefined) delete globalThis.caches
    else globalThis.caches = originalCaches
  }
})

test('unavailable persistent storage is an explicit error, not an uncached fallback', async () => {
  const original = globalThis.caches
  delete globalThis.caches
  try {
    await assert.rejects(cachedAsset('https://example.test/compiler.wasm'), /Persistent asset caching requires/)
  } finally {
    if (original !== undefined) globalThis.caches = original
  }
})
