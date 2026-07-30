/**
 * Design Plaza — shared UGC store (KV) + preview images.
 *
 * GET  /api/h5/plaza/designs
 * GET  /api/h5/plaza/designs/:id
 * GET  /api/h5/plaza/preview/:id
 * POST /api/h5/plaza/publish
 * POST /api/h5/plaza/unpublish
 * POST /api/h5/plaza/use-count
 */

const MANIFEST_KEY = 'plaza:manifest'

/** @type {Map<string, string>} */
const memory = new Map()

/**
 * @param {any} env
 * @param {string} key
 */
async function kvGetText(env, key) {
  if (env.ORDERS) return env.ORDERS.get(key)
  return memory.get(key) || null
}

/**
 * @param {any} env
 * @param {string} key
 */
async function kvGetBinary(env, key) {
  if (env.ORDERS) return env.ORDERS.get(key, 'arrayBuffer')
  const raw = memory.get(key)
  return raw || null
}

/**
 * @param {any} env
 * @param {string} key
 * @param {string | ArrayBuffer | ArrayBufferView} value
 */
async function kvPut(env, key, value) {
  if (env.ORDERS) {
    await env.ORDERS.put(key, value)
  } else if (typeof value === 'string') {
    memory.set(key, value)
  } else {
    memory.set(key, value)
  }
}

/**
 * @param {any} env
 * @param {string} key
 */
async function kvDelete(env, key) {
  if (env.ORDERS) await env.ORDERS.delete(key)
  else memory.delete(key)
}

/**
 * @param {any} env
 * @returns {Promise<object[]>}
 */
async function readManifest(env) {
  const raw = await kvGetText(env, MANIFEST_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * @param {any} env
 * @param {object[]} designs
 */
async function writeManifest(env, designs) {
  await kvPut(env, MANIFEST_KEY, JSON.stringify(designs))
}

/** @param {string} id */
function imageKey(id) {
  return `plaza:img:${safeId(id)}`
}

/** @param {string} id */
function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * @param {any} env
 * @param {string} id
 */
export function previewUrl(env, id) {
  const base = String(env.PUBLIC_API_BASE || '').trim().replace(/\/$/, '')
  if (!base) return `/api/h5/plaza/preview/${encodeURIComponent(id)}`
  return `${base}/api/h5/plaza/preview/${encodeURIComponent(id)}`
}

/**
 * @param {string} [dataUrl]
 * @returns {{ bytes: Uint8Array, contentType: string } | null}
 */
function parseImageDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  const m = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  const contentType = m[1].toLowerCase()
  const binary = atob(m[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { bytes, contentType }
}

/**
 * @param {object} pub
 * @param {any} env
 */
function publishToRow(pub, env) {
  const author = String(pub.author || '').replace(/^@/, '') || 'designer'
  const beads = Array.isArray(pub.beads) ? pub.beads : []
  const publishedAt = pub.publishedAt
    ? new Date(pub.publishedAt).toISOString()
    : new Date().toISOString()
  return {
    id: String(pub.id || ''),
    source_design_id: String(pub.sourceDesignId || ''),
    title: String(pub.title || ''),
    designer_name: author,
    designer_id: String(pub.designerId || ''),
    blurb: String(pub.tags || ''),
    use_price_twd: Number(pub.usePriceTwd) || 0,
    use_count: Number(pub.useCount) || 0,
    status: 'published',
    source: 'user',
    image_path: previewUrl(env, pub.id),
    bead_product_ids: beads.map((b) => b.productId).filter(Boolean).join('|'),
    published_at: publishedAt,
    updated_at: new Date().toISOString(),
    beads: beads.map((b) => ({
      instanceId: String(b.instanceId || ''),
      productId: String(b.productId || ''),
    })),
    author: author.startsWith('@') ? author : `@${author}`,
    tags: String(pub.tags || ''),
    usePriceTwd: Number(pub.usePriceTwd) || 0,
    publishedAt: Date.parse(publishedAt) || Date.now(),
    useCount: Number(pub.useCount) || 0,
    sourceDesignId: String(pub.sourceDesignId || ''),
    designerId: String(pub.designerId || ''),
  }
}

/**
 * @param {object} row
 * @returns {object}
 */
export function rowToClientDesign(row) {
  const name = String(row.designer_name || row.author || 'designer').replace(/^@/, '')
  const beadIds = String(row.bead_product_ids || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
  const beads =
    Array.isArray(row.beads) && row.beads.length
      ? row.beads
      : beadIds.map((productId, i) => ({
          instanceId: `remote-${row.id}-${i}`,
          productId,
        }))
  return {
    id: String(row.id),
    sourceDesignId: String(row.source_design_id || row.sourceDesignId || ''),
    title: String(row.title || ''),
    author: String(row.author || `@${name}`),
    designerId: String(row.designer_id || row.designerId || ''),
    tags: String(row.blurb || row.tags || ''),
    usePriceTwd: Number(row.use_price_twd ?? row.usePriceTwd) || 0,
    publishedAt: Date.parse(String(row.published_at || '')) || Number(row.publishedAt) || 0,
    useCount: Number(row.use_count ?? row.useCount) || 0,
    beads,
    imageDataUrl: String(row.image_path || ''),
  }
}

/**
 * @param {URL} url
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handlePlazaDesignsList(url, env, cors) {
  const list = await readManifest(env)
  const published = list
    .filter((d) => String(d.status) === 'published')
    .map(rowToClientDesign)
    .sort((a, b) => {
      if (b.useCount !== a.useCount) return b.useCount - a.useCount
      return String(a.id).localeCompare(String(b.id))
    })
  return json({ ok: true, designs: published }, 200, cors)
}

/**
 * @param {string} id
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handlePlazaDesignGet(id, env, cors) {
  const list = await readManifest(env)
  const row = list.find((d) => String(d.id) === String(id) && String(d.status) === 'published')
  if (!row) return json({ ok: false, error: 'Not found' }, 404, cors)
  return json({ ok: true, design: rowToClientDesign(row) }, 200, cors)
}

/**
 * @param {string} id
 * @param {any} env
 */
export async function handlePlazaPreview(id, env) {
  const bytes = await kvGetBinary(env, imageKey(id))
  if (!bytes) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handlePlazaPublish(request, env, cors) {
  const body = await request.json().catch(() => null)
  if (!body?.id || !body?.title) {
    return json({ ok: false, error: 'Missing id/title' }, 400, cors)
  }

  const parsed = parseImageDataUrl(body.imageDataUrl)
  if (parsed?.bytes?.length) {
    await kvPut(env, imageKey(body.id), parsed.bytes)
  }

  const list = await readManifest(env)
  const row = publishToRow(body, env)
  const i = list.findIndex((d) => String(d.id) === String(row.id))
  if (i >= 0) {
    const prev = list[i]
    list[i] = {
      ...row,
      published_at: prev.published_at || row.published_at,
      use_count: Number(body.useCount ?? prev.use_count) || 0,
      // Keep previous preview URL if this request had no image bytes.
      image_path: parsed?.bytes?.length
        ? row.image_path
        : prev.image_path || (parsed?.bytes?.length ? row.image_path : ''),
    }
  } else {
    list.unshift({
      ...row,
      // Don't advertise a preview URL until bytes are in KV (avoids 404 thumbs).
      image_path: parsed?.bytes?.length ? row.image_path : '',
    })
  }

  await writeManifest(env, list)
  const saved = list.find((d) => String(d.id) === String(row.id))
  return json(
    {
      ok: true,
      row: saved,
      design: rowToClientDesign(saved),
    },
    200,
    cors,
  )
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handlePlazaUnpublish(request, env, cors) {
  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  if (!id) return json({ ok: false, error: 'Missing id' }, 400, cors)

  const list = await readManifest(env)
  const i = list.findIndex((d) => String(d.id) === id)
  if (i < 0) return json({ ok: false, error: 'Not found' }, 404, cors)

  list[i] = {
    ...list[i],
    status: 'unpublished',
    updated_at: new Date().toISOString(),
  }
  await writeManifest(env, list)
  return json({ ok: true }, 200, cors)
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handlePlazaUseCount(request, env, cors) {
  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  if (!id) return json({ ok: false, error: 'Missing id' }, 400, cors)

  const useCount = Number(body.useCount) || 0
  const list = await readManifest(env)
  const i = list.findIndex((d) => String(d.id) === id)
  if (i < 0) return json({ ok: false, error: 'Not found' }, 404, cors)

  list[i] = {
    ...list[i],
    use_count: useCount,
    useCount,
    updated_at: new Date().toISOString(),
  }
  await writeManifest(env, list)
  return json({ ok: true, useCount }, 200, cors)
}

/**
 * @param {unknown} data
 * @param {number} status
 * @param {Record<string, string>} [cors]
 */
function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors,
    },
  })
}
