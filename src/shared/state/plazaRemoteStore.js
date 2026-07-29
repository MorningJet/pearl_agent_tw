/**
 * Design Plaza feed from the shared Worker API (all users).
 */

/** @typedef {import('./plazaPublishStore.js').PlazaPublishedDesign} PlazaPublishedDesign */

/** @type {Map<string, PlazaPublishedDesign>} */
let byId = new Map()
/** @type {Promise<void> | null} */
let loadPromise = null
let lastFetchedAt = 0

function apiBase() {
  return String(import.meta.env.VITE_NEWEBPAY_API_BASE || '').trim().replace(/\/$/, '')
}

export function isPlazaRemoteEnabled() {
  return Boolean(apiBase())
}

/**
 * @param {object} raw
 * @returns {PlazaPublishedDesign}
 */
function normalizeRemoteDesign(raw) {
  const author = String(raw.author || '@designer')
  const beads = Array.isArray(raw.beads) ? raw.beads : []
  return {
    id: String(raw.id || ''),
    sourceDesignId: String(raw.sourceDesignId || ''),
    title: String(raw.title || ''),
    author: author.startsWith('@') ? author : `@${author}`,
    designerId: String(raw.designerId || ''),
    tags: String(raw.tags || ''),
    usePriceTwd: Number(raw.usePriceTwd) || 0,
    publishedAt: Number(raw.publishedAt) || 0,
    useCount: Number(raw.useCount) || 0,
    beads: beads.map((b) => ({
      instanceId: String(b.instanceId || ''),
      productId: String(b.productId || ''),
    })),
    imageDataUrl: String(raw.imageDataUrl || ''),
  }
}

/** @returns {PlazaPublishedDesign[]} */
export function listRemotePlazaDesigns() {
  return [...byId.values()].sort((a, b) => {
    const bu = b.useCount || 0
    const au = a.useCount || 0
    if (bu !== au) return bu - au
    return String(a.id).localeCompare(String(b.id))
  })
}

/** @param {string} id */
export function getRemotePlazaDesign(id) {
  return byId.get(id) || null
}

/** @param {PlazaPublishedDesign} design */
export function upsertRemotePlazaDesign(design) {
  if (!design?.id) return
  byId.set(design.id, design)
}

/** @param {string} id */
export function removeRemotePlazaDesign(id) {
  byId.delete(id)
}

/**
 * @param {string} id
 * @param {number} useCount
 */
export function patchRemotePlazaUseCount(id, useCount) {
  const design = byId.get(id)
  if (!design) return
  byId.set(id, { ...design, useCount })
}

/**
 * Fetch published designs from Worker. No-op when API base unset.
 * @param {{ force?: boolean }} [opts]
 */
export async function refreshPlazaRemote(opts = {}) {
  const base = apiBase()
  if (!base) return

  const staleMs = 30_000
  if (!opts.force && loadPromise && Date.now() - lastFetchedAt < staleMs) {
    return loadPromise
  }

  loadPromise = (async () => {
    try {
      const res = await fetch(`${base}/api/h5/plaza/designs`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      const list = Array.isArray(data?.designs) ? data.designs : []
      const next = new Map()
      for (const row of list) {
        const design = normalizeRemoteDesign(row)
        if (design.id) next.set(design.id, design)
      }
      byId = next
      lastFetchedAt = Date.now()
    } catch (err) {
      console.warn('[plaza] remote fetch failed', err)
    }
  })()

  return loadPromise
}
