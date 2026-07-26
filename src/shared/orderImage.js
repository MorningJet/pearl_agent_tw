/**
 * Order thumbnail URL helpers (fix doubled base + plaza fallback).
 */

import plazaMaster from './data/plazaDesigns.json'
import {
  normalizeAssetUrl,
  toSiteRelativeAssetPath,
  withBase,
} from './assetUrl.js'

/**
 * @param {{ imageUrl?: string, plazaPublishId?: string, title?: string }} order
 */
export function resolveOrderThumbUrl(order) {
  // Plaza master wins (recovers doubled-base / missing thumbs for 金玉滿堂 etc.)
  const plaza = findPlazaImageForOrder({
    plazaPublishId: order?.plazaPublishId,
    title: order?.title,
  })
  if (plaza) return plaza

  return normalizeAssetUrl(order?.imageUrl || '')
}

/**
 * Prefer stable relative path for localStorage / Worker.
 * @param {string} [url]
 */
export function canonicalOrderImageUrl(url) {
  const rel = toSiteRelativeAssetPath(url || '')
  if (rel && !/^(data:|blob:)/i.test(rel)) return rel
  return String(url || '').trim()
}

/**
 * @param {{ plazaPublishId?: string, title?: string }} q
 */
function findPlazaImageForOrder(q) {
  const id = String(q.plazaPublishId || '').trim()
  const designs = Array.isArray(plazaMaster?.designs) ? plazaMaster.designs : []
  if (id) {
    const row = designs.find((d) => d.id === id)
    if (row?.image_path) return withBase(String(row.image_path))
  }
  const title = String(q.title || '').trim()
  if (title) {
    const row = designs.find(
      (d) => d.status === 'published' && String(d.title || '').trim() === title,
    )
    if (row?.image_path) return withBase(String(row.image_path))
  }
  return ''
}
