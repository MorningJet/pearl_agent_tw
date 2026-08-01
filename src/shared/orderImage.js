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

  return absoluteOrderImageUrl(order?.imageUrl || '')
}

/**
 * Prefer stable relative path for localStorage / Worker.
 * @param {string} [url]
 */
export function canonicalOrderImageUrl(url) {
  const raw = String(url || '').trim()
  // Worker-stored order previews — keep API path so App Proxy can resolve later.
  if (/^\/api\/h5\/order-preview\//i.test(raw)) return raw
  if (/\/api\/h5\/order-preview\//i.test(raw)) {
    try {
      const u = new URL(raw)
      return `${u.pathname}${u.search}`
    } catch {
      /* fall through */
    }
  }
  const rel = toSiteRelativeAssetPath(raw)
  if (rel && !/^(data:|blob:)/i.test(rel)) return rel
  return raw
}

/**
 * Turn stored order image paths into a browser-loadable URL.
 * @param {string} [url]
 */
export function absoluteOrderImageUrl(url) {
  const raw = String(url || '').trim()
  if (!raw || /^(data:|blob:)/i.test(raw)) return normalizeAssetUrl(raw)

  if (/^\/api\//i.test(raw)) {
    const base = String(import.meta.env.VITE_NEWEBPAY_API_BASE || '')
      .trim()
      .replace(/\/$/, '')
    if (base) {
      try {
        return new URL(raw.replace(/^\//, ''), `${base}/`).href
      } catch {
        return `${base}${raw}`
      }
    }
  }

  return normalizeAssetUrl(raw)
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
