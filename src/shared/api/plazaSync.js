/**
 * Sync Design Plaza publishes to the maintenance table (dev server API).
 * Outside `vite` (preview/production static), calls no-op gracefully.
 */

/**
 * @param {import('../state/plazaPublishStore.js').PlazaPublishedDesign} pub
 * @returns {Promise<{ ok: boolean, row?: Record<string, unknown> } | null>}
 */
export async function syncPlazaPublish(pub) {
  if (!pub?.id) return null
  return post('/api/plaza/publish', {
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
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function syncPlazaUnpublish(id) {
  if (!id) return false
  const data = await post('/api/plaza/unpublish', { id })
  return Boolean(data?.ok)
}

/**
 * @param {string} id
 * @param {number} useCount
 * @returns {Promise<boolean>}
 */
export async function syncPlazaUseCount(id, useCount) {
  if (!id) return false
  const data = await post('/api/plaza/use-count', { id, useCount })
  return Boolean(data?.ok)
}

/**
 * @param {string} path
 * @param {object} body
 * @returns {Promise<{ ok?: boolean, row?: Record<string, unknown> } | null>}
 */
async function post(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    return data && typeof data === 'object' ? data : null
  } catch {
    // Static preview / production without API — localStorage remains source of truth.
    return null
  }
}
