import {
  getPlazaUseCount,
  listPublishedPlazaDesigns,
} from '../../shared/state/plazaPublishStore.js'
import {
  getRemotePlazaDesign,
  listRemotePlazaDesigns,
} from '../../shared/state/plazaRemoteStore.js'
import { getSavedDesign } from '../../shared/state/savedDesignsStore.js'
import plazaMaster from '../../shared/data/plazaDesigns.json'
import { withBase } from '../../shared/assetUrl.js'

/** Design Plaza feed entries (real preview when `imageUrl` is set). */

export const HOME_PLAZA_SLOT_COUNT = 6

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   tags: string,
 *   author: string,
 *   uses: string,
 *   useCount: number,
 *   imageUrl?: string,
 * }} PlazaPlaceholder
 */

/**
 * Master-table published rows (seed + synced UGC).
 * @returns {PlazaPlaceholder[]}
 */
function listMasterPublished() {
  return (plazaMaster.designs || [])
    .filter((d) => d.status === 'published')
    .map((d) => {
      const useCount = getPlazaUseCount(d.id, Number(d.use_count) || 0)
      return {
        id: d.id,
        title: d.title,
        tags: d.blurb || '',
        author: d.designer_name
          ? `@${String(d.designer_name).replace(/^@/, '')}`
          : '@designer',
        useCount,
        uses: `${useCount} 次使用`,
        imageUrl: d.image_path ? withBase(d.image_path) : undefined,
      }
    })
}

/**
 * Preview path from maintenance table (synced /plaza/*.png).
 * @param {string} id
 */
export function getMasterPlazaImagePath(id) {
  const row = (plazaMaster.designs || []).find((d) => d.id === id)
  const path = row?.image_path
  return typeof path === 'string' && path ? path : ''
}

/**
 * Turn a stored plaza image ref into a browser-loadable URL.
 * - data/blob/https: unchanged
 * - `/api/h5/plaza/preview/...`: prefix `VITE_NEWEBPAY_API_BASE`
 * - `/plaza/...`: GitHub Pages `withBase`
 * @param {string} raw
 */
export function normalizePlazaImageSrc(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^(https?:|data:|blob:)/i.test(s)) return s

  const apiBase = String(import.meta.env.VITE_NEWEBPAY_API_BASE || '')
    .trim()
    .replace(/\/$/, '')

  // Worker preview path (relative) — must not go through Pages `withBase`.
  if (s.includes('/api/h5/plaza/preview/') || /^\/api\/h5\//.test(s)) {
    const path = s.startsWith('/') ? s : `/${s}`
    if (!apiBase) return path
    if (/^https?:\/\//i.test(apiBase)) return `${apiBase}${path}`
    // Vite proxy prefix e.g. `/newebpay-api`
    return `${apiBase}${path}`
  }

  return withBase(s)
}

/**
 * Resolve preview for a publish: saved data-URL → publish snapshot → master table.
 * Prefer local `data:` thumbs over remote preview URLs (remote can 404 after KV miss
 * and must not blank「我的發佈」cards).
 * @param {{ id: string, sourceDesignId?: string, imageDataUrl?: string }} p
 */
export function resolvePlazaPreviewUrl(p) {
  const saved = p.sourceDesignId ? getSavedDesign(p.sourceDesignId) : null
  const candidates = [
    saved?.imageDataUrl,
    p.imageDataUrl,
    getMasterPlazaImagePath(p.id),
  ].filter((u) => typeof u === 'string' && u.trim())

  // Prefer any data-URL first (reliable local thumb).
  const dataUrl = candidates.find((u) => u.startsWith('data:'))
  if (dataUrl) return dataUrl

  for (const raw of candidates) {
    const src = normalizePlazaImageSrc(raw)
    if (src) return src
  }
  return ''
}
export function getSeedPlazaDesignRow(id) {
  return (plazaMaster.designs || []).find((d) => d.id === id && d.status === 'published') || null
}

/**
 * Adapt a master row to the same shape as user publishes (for details / use-design).
 * @param {string} id
 * @returns {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign | null}
 */
export function getSeedPlazaAsPublished(id) {
  const d = getSeedPlazaDesignRow(id)
  if (!d) return null
  const name = String(d.designer_name || 'designer').replace(/^@/, '')
  const beadIds = String(d.bead_product_ids || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
  const beads = beadIds.map((productId, i) => ({
    instanceId: `seed-${d.id}-${i}`,
    productId,
  }))
  const baseCount = Number(d.use_count) || 0
  return {
    id: d.id,
    sourceDesignId: String(d.source_design_id || ''),
    title: d.title,
    author: `@${name}`,
    designerId: String(d.designer_id || ''),
    tags: d.blurb || '',
    usePriceTwd: Number(d.use_price_twd) || 0,
    publishedAt: Date.parse(String(d.published_at || '')) || 0,
    useCount: getPlazaUseCount(d.id, baseCount),
    beads,
    imageDataUrl: d.image_path ? withBase(d.image_path) : '',
  }
}

/**
 * Remote → local publish store → static seed row.
 * @param {string} id
 * @returns {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign | null}
 */
export function getPlazaDesignAsPublished(id) {
  return (
    getRemotePlazaDesign(id) ||
    listPublishedPlazaDesigns().find((p) => p.id === id) ||
    getSeedPlazaAsPublished(id)
  )
}

/**
 * @param {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign} p
 * @returns {PlazaPlaceholder}
 */
function publishedToPlaceholder(p) {
  const tags = isAutoGeneratedIntro(p.tags) ? '' : p.tags || ''
  const useCount = p.useCount || 0
  const imageUrl = resolvePlazaPreviewUrl(p) || undefined
  return {
    id: p.id,
    title: p.title,
    tags,
    author: p.author,
    useCount,
    uses: `${useCount} 次使用`,
    imageUrl,
  }
}

/**
 * Full plaza feed sorted by use count (desc). Remote UGC wins on id clash.
 * @returns {PlazaPlaceholder[]}
 */
export function listPlazaFeed() {
  const remote = listRemotePlazaDesigns().map(publishedToPlaceholder)
  const remoteIds = new Set(remote.map((p) => p.id))
  const localOnly = listPublishedPlazaDesigns()
    .filter((p) => !remoteIds.has(p.id))
    .map(publishedToPlaceholder)
  const coveredIds = new Set([...remoteIds, ...localOnly.map((p) => p.id)])
  const fromMaster = listMasterPublished().filter((d) => !coveredIds.has(d.id))
  return [...remote, ...localOnly, ...fromMaster].sort((a, b) => {
    if (b.useCount !== a.useCount) return b.useCount - a.useCount
    return String(a.id).localeCompare(String(b.id))
  })
}

/** Legacy publishes filled tags with a price fallback when blurb was empty. */
function isAutoGeneratedIntro(tags) {
  return typeof tags === 'string' && tags.startsWith('原創設計')
}

/** Home grid: top N by use count. */
export function listHomePlazaFeed() {
  return listPlazaFeed().slice(0, HOME_PLAZA_SLOT_COUNT)
}

/** Shared “test photo” tile markup for banner / plaza image slots. */
export function testPhotoTile(extraClass = '') {
  return `<div class="flex h-full w-full items-center justify-center bg-stone-200 ${extraClass}">
    <span class="text-[0.65rem] text-stone-400">測試照片</span>
  </div>`
}

/**
 * Plaza / home card media: real preview when `imageUrl` is set, else test tile.
 * @param {PlazaPlaceholder} d
 * @param {string} [extraClass]
 */
export function plazaMediaTile(d, extraClass = '') {
  if (d.imageUrl) {
    return `<img src="${escapeAttr(d.imageUrl)}" alt="" draggable="false" class="pointer-events-none block h-full w-full select-none object-cover object-center ${extraClass}" />`
  }
  return testPhotoTile(extraClass)
}

/** @param {string} s */
function escapeAttr(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
