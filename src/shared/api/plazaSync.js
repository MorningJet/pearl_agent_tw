/**
 * Sync Design Plaza publishes to shared storage.
 * - Production: Cloudflare Worker (`VITE_NEWEBPAY_API_BASE`)
 * - Local dev: Vite middleware (`/api/plaza/*`) when API base unset
 */

import {
  removeRemotePlazaDesign,
  upsertRemotePlazaDesign,
} from '../state/plazaRemoteStore.js'

function apiBase() {
  return String(import.meta.env.VITE_NEWEBPAY_API_BASE || '').trim().replace(/\/$/, '')
}

/**
 * @param {'publish' | 'unpublish' | 'use-count'} action
 */
function plazaEndpoint(action) {
  const base = apiBase()
  if (base) return `${base}/api/h5/plaza/${action}`
  return `/api/plaza/${action}`
}

/**
 * @param {import('../state/plazaPublishStore.js').PlazaPublishedDesign} pub
 * @returns {Promise<{ ok: boolean, row?: Record<string, unknown>, design?: import('../state/plazaPublishStore.js').PlazaPublishedDesign } | null>}
 */
export async function syncPlazaPublish(pub) {
  if (!pub?.id) return null
  const result = await post(plazaEndpoint('publish'), {
    id: pub.id,
    sourceDesignId: pub.sourceDesignId,
    title: pub.title,
    author: pub.author,
    designerId: pub.designerId,
    tags: pub.tags,
    usePriceTwd: pub.usePriceTwd,
    publishedAt: pub.publishedAt,
    useCount: pub.useCount || 0,
    beads: (pub.beads || []).map((b) => ({
      instanceId: b.instanceId,
      productId: b.productId,
    })),
    imageDataUrl: pub.imageDataUrl || '',
  })
  if (result?.ok && result.design) {
    upsertRemotePlazaDesign(result.design)
  }
  return result
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function syncPlazaUnpublish(id) {
  if (!id) return false
  const data = await post(plazaEndpoint('unpublish'), { id })
  if (data?.ok) removeRemotePlazaDesign(id)
  return Boolean(data?.ok)
}

/**
 * @param {string} id
 * @param {number} useCount
 * @returns {Promise<boolean>}
 */
export async function syncPlazaUseCount(id, useCount) {
  if (!id) return false
  const data = await post(plazaEndpoint('use-count'), { id, useCount })
  return Boolean(data?.ok)
}

/**
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{ ok?: boolean, row?: Record<string, unknown>, design?: import('../state/plazaPublishStore.js').PlazaPublishedDesign } | null>}
 */
async function post(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}
