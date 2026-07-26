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
