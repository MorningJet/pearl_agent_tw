/**
 * Pending / paid order records (KV with in-memory fallback for local dev).
 * Also mirrors Shopify order → H5 status for「我的訂單」.
 */

/** @type {Map<string, string>} */
const memory = new Map()

/** @param {string} merchantOrderNo */
function keyOf(merchantOrderNo) {
  return `order:${merchantOrderNo}`
}

/** @param {string} shopifyOrderId */
function shopifyIdKey(shopifyOrderId) {
  return `shopify-order:${shopifyOrderId}`
}

/** @param {string} name */
function shopifyNameKey(name) {
  return `shopify-order-name:${name}`
}

/** @param {string} merchantOrderNo */
function shopifyMerchantKey(merchantOrderNo) {
  return `shopify-by-merchant:${merchantOrderNo}`
}

/** @param {string} merchantOrderNo */
function orderPreviewKey(merchantOrderNo) {
  return `order-preview:${merchantOrderNo}`
}

/** @param {string} merchantOrderNo */
function orderPreviewMetaKey(merchantOrderNo) {
  return `order-preview-meta:${merchantOrderNo}`
}

/**
 * Stable path stored on order records (H5 resolves via App Proxy base).
 * @param {string} merchantOrderNo
 */
export function orderPreviewPath(merchantOrderNo) {
  return `/api/h5/order-preview/${encodeURIComponent(String(merchantOrderNo || '').trim())}`
}

/**
 * @param {any} env
 * @param {string} merchantOrderNo
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {string} [contentType]
 */
export async function putOrderPreview(env, merchantOrderNo, bytes, contentType = 'image/jpeg') {
  const id = String(merchantOrderNo || '').trim()
  if (!id || !bytes) return
  const ttl = 60 * 60 * 24 * 180
  const body =
    bytes instanceof Uint8Array
      ? bytes
      : bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : null
  if (!body?.byteLength) return
  if (env.ORDERS) {
    await env.ORDERS.put(orderPreviewKey(id), body, { expirationTtl: ttl })
    await env.ORDERS.put(
      orderPreviewMetaKey(id),
      JSON.stringify({ contentType: String(contentType || 'image/jpeg') }),
      { expirationTtl: ttl },
    )
  } else {
    memory.set(orderPreviewKey(id), body)
    memory.set(
      orderPreviewMetaKey(id),
      JSON.stringify({ contentType: String(contentType || 'image/jpeg') }),
    )
  }
}

/**
 * @param {any} env
 * @param {string} merchantOrderNo
 * @returns {Promise<{ bytes: ArrayBuffer, contentType: string } | null>}
 */
export async function getOrderPreview(env, merchantOrderNo) {
  const id = String(merchantOrderNo || '').trim()
  if (!id) return null
  /** @type {ArrayBuffer | null} */
  let bytes = null
  if (env.ORDERS) {
    bytes = await env.ORDERS.get(orderPreviewKey(id), 'arrayBuffer')
  } else {
    const raw = memory.get(orderPreviewKey(id))
    if (raw instanceof Uint8Array) {
      bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    } else if (raw instanceof ArrayBuffer) {
      bytes = raw
    }
  }
  if (!bytes || !bytes.byteLength) return null
  let contentType = 'image/jpeg'
  try {
    const metaRaw = env.ORDERS
      ? await env.ORDERS.get(orderPreviewMetaKey(id))
      : memory.get(orderPreviewMetaKey(id))
    if (typeof metaRaw === 'string' && metaRaw) {
      const meta = JSON.parse(metaRaw)
      if (meta?.contentType) contentType = String(meta.contentType)
    }
  } catch {
    /* default jpeg */
  }
  return { bytes, contentType }
}

/**
 * @param {any} env
 * @param {string} key
 * @param {string} raw
 * @param {number} [ttl]
 */
async function kvPut(env, key, raw, ttl = 60 * 60 * 24 * 120) {
  if (env.ORDERS) {
    await env.ORDERS.put(key, raw, { expirationTtl: ttl })
  } else {
    memory.set(key, raw)
  }
}

/**
 * @param {any} env
 * @param {string} key
 */
async function kvGet(env, key) {
  if (env.ORDERS) return env.ORDERS.get(key)
  return memory.get(key) || null
}

const DESIGNER_COUNT_KEY = 'stats:designer-count'
const DESIGNER_COUNT_BASE = 2000

/**
 * Absolute designer social-proof count (min base 2000).
 * @param {any} env
 * @returns {Promise<number>}
 */
export async function getDesignerCount(env) {
  const raw = await kvGet(env, DESIGNER_COUNT_KEY)
  if (raw == null || raw === '') return DESIGNER_COUNT_BASE
  const n = Number(raw)
  return Number.isFinite(n) && n >= DESIGNER_COUNT_BASE
    ? Math.floor(n)
    : DESIGNER_COUNT_BASE
}

/**
 * +1 designer count (each「立即付款」click).
 * @param {any} env
 * @returns {Promise<number>}
 */
export async function incrementDesignerCount(env) {
  const next = (await getDesignerCount(env)) + 1
  // No TTL — permanent counter.
  if (env.ORDERS) {
    await env.ORDERS.put(DESIGNER_COUNT_KEY, String(next))
  } else {
    memory.set(DESIGNER_COUNT_KEY, String(next))
  }
  return next
}

/**
 * @param {any} env
 * @param {string} merchantOrderNo
 * @param {object} record
 */
export async function putOrder(env, merchantOrderNo, record) {
  await kvPut(env, keyOf(merchantOrderNo), JSON.stringify(record))
}

/**
 * @param {any} env
 * @param {string} merchantOrderNo
 * @returns {Promise<object | null>}
 */
export async function getOrder(env, merchantOrderNo) {
  const raw = await kvGet(env, keyOf(merchantOrderNo))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * @param {any} env
 * @param {object} mirror
 */
export async function putShopifyOrderMirror(env, mirror) {
  const raw = JSON.stringify(mirror)
  if (mirror.shopifyOrderId) {
    await kvPut(env, shopifyIdKey(String(mirror.shopifyOrderId)), raw)
  }
  if (mirror.shopifyOrderName) {
    await kvPut(env, shopifyNameKey(String(mirror.shopifyOrderName)), raw)
  }
  if (mirror.merchantOrderNo) {
    await kvPut(env, shopifyMerchantKey(String(mirror.merchantOrderNo)), raw)
  }
  await indexShopifyOrderByEmail(env, mirror)
}

/**
 * @param {any} env
 * @param {{ shopifyOrderId?: string, shopifyOrderName?: string, merchantOrderNo?: string }} q
 * @returns {Promise<object | null>}
 */
export async function getShopifyOrderMirror(env, q) {
  let raw = null
  if (q.shopifyOrderId) raw = await kvGet(env, shopifyIdKey(String(q.shopifyOrderId)))
  else if (q.shopifyOrderName) raw = await kvGet(env, shopifyNameKey(String(q.shopifyOrderName)))
  else if (q.merchantOrderNo) raw = await kvGet(env, shopifyMerchantKey(String(q.merchantOrderNo)))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** @param {string} email */
function emailOrdersKey(email) {
  return `email-orders:${String(email || '').trim().toLowerCase()}`
}

/**
 * Index mirror under buyer email for H5「我的訂單」list-by-email.
 * @param {any} env
 * @param {object} mirror
 */
export async function indexShopifyOrderByEmail(env, mirror) {
  const email = String(mirror?.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return
  const shopifyOrderId = String(mirror.shopifyOrderId || '').trim()
  const merchantOrderNo = String(mirror.merchantOrderNo || '').trim()
  if (!shopifyOrderId && !merchantOrderNo) return

  const key = emailOrdersKey(email)
  const raw = await kvGet(env, key)
  /** @type {object[]} */
  let list = []
  try {
    const parsed = raw ? JSON.parse(raw) : []
    list = Array.isArray(parsed) ? parsed : []
  } catch {
    list = []
  }

  const next = {
    shopifyOrderId: shopifyOrderId || null,
    shopifyOrderName: mirror.shopifyOrderName || null,
    merchantOrderNo: merchantOrderNo || null,
    updatedAt: Number(mirror.updatedAt) || Date.now(),
  }
  list = list.filter((row) => {
    if (!row || typeof row !== 'object') return false
    if (shopifyOrderId && String(row.shopifyOrderId || '') === shopifyOrderId) return false
    if (merchantOrderNo && String(row.merchantOrderNo || '') === merchantOrderNo) return false
    return true
  })
  list.unshift(next)
  list = list.slice(0, 80)
  await kvPut(env, key, JSON.stringify(list))
}

/**
 * @param {any} env
 * @param {string} email
 * @returns {Promise<object[]>}
 */
export async function listShopifyOrderIndexByEmail(env, email) {
  const key = emailOrdersKey(email)
  const raw = await kvGet(env, key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Replace email → order index (Shopify Admin is source of truth).
 * @param {any} env
 * @param {string} email
 * @param {object[]} rows
 */
export async function replaceShopifyOrderIndexByEmail(env, email, rows) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) return
  const key = emailOrdersKey(normalized)
  const list = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      shopifyOrderId: row.shopifyOrderId ? String(row.shopifyOrderId) : null,
      shopifyOrderName: row.shopifyOrderName || null,
      merchantOrderNo: row.merchantOrderNo ? String(row.merchantOrderNo) : null,
      updatedAt: Number(row.updatedAt) || Date.now(),
    }))
    .filter((row) => row.shopifyOrderId || row.merchantOrderNo)
    .slice(0, 80)
  await kvPut(env, key, JSON.stringify(list))
}

/**
 * Drop one order from every email index entry that matches its keys.
 * @param {any} env
 * @param {{ shopifyOrderId?: string, merchantOrderNo?: string, email?: string }} keys
 */
export async function removeShopifyOrderFromEmailIndex(env, keys) {
  const shopifyOrderId = String(keys?.shopifyOrderId || '').trim()
  const merchantOrderNo = String(keys?.merchantOrderNo || '').trim()
  if (!shopifyOrderId && !merchantOrderNo) return

  const email = String(keys?.email || '').trim().toLowerCase()
  /** @type {string[]} */
  const emails = email && email.includes('@') ? [email] : []

  // If email unknown, try resolve from existing mirror then still need that key's index.
  if (!emails.length && shopifyOrderId) {
    const mirror = await getShopifyOrderMirror(env, { shopifyOrderId })
    const mirroredEmail = String(mirror?.email || '').trim().toLowerCase()
    if (mirroredEmail && mirroredEmail.includes('@')) emails.push(mirroredEmail)
  }

  for (const em of emails) {
    const key = emailOrdersKey(em)
    const raw = await kvGet(env, key)
    if (!raw) continue
    /** @type {object[]} */
    let list = []
    try {
      const parsed = JSON.parse(raw)
      list = Array.isArray(parsed) ? parsed : []
    } catch {
      continue
    }
    const next = list.filter((row) => {
      if (!row || typeof row !== 'object') return false
      if (shopifyOrderId && String(row.shopifyOrderId || '') === shopifyOrderId) return false
      if (merchantOrderNo && String(row.merchantOrderNo || '') === merchantOrderNo) return false
      return true
    })
    if (next.length !== list.length) {
      await kvPut(env, key, JSON.stringify(next))
    }
  }
}

/**
 * Delete Shopify order mirror keys (and email index entry).
 * @param {any} env
 * @param {{ shopifyOrderId?: string, shopifyOrderName?: string, merchantOrderNo?: string, email?: string }} keys
 */
export async function deleteShopifyOrderMirror(env, keys) {
  let shopifyOrderId = String(keys?.shopifyOrderId || '').trim()
  let shopifyOrderName = String(keys?.shopifyOrderName || '').trim()
  let merchantOrderNo = String(keys?.merchantOrderNo || '').trim()
  let email = String(keys?.email || '').trim().toLowerCase()

  if (shopifyOrderId) {
    const existing = await getShopifyOrderMirror(env, { shopifyOrderId })
    if (existing) {
      if (!email || !email.includes('@')) {
        email = String(existing.email || '').trim().toLowerCase()
      }
      if (!shopifyOrderName) shopifyOrderName = String(existing.shopifyOrderName || '').trim()
      if (!merchantOrderNo) merchantOrderNo = String(existing.merchantOrderNo || '').trim()
    }
  }

  await removeShopifyOrderFromEmailIndex(env, {
    shopifyOrderId,
    merchantOrderNo,
    email,
  })

  if (env.ORDERS) {
    if (shopifyOrderId) await env.ORDERS.delete(shopifyIdKey(shopifyOrderId))
    if (shopifyOrderName) await env.ORDERS.delete(shopifyNameKey(shopifyOrderName))
    if (merchantOrderNo) await env.ORDERS.delete(shopifyMerchantKey(merchantOrderNo))
  } else {
    if (shopifyOrderId) memory.delete(shopifyIdKey(shopifyOrderId))
    if (shopifyOrderName) memory.delete(shopifyNameKey(shopifyOrderName))
    if (merchantOrderNo) memory.delete(shopifyMerchantKey(merchantOrderNo))
  }
}
