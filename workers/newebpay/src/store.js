/**
 * Pending / paid order records (KV with in-memory fallback for local dev).
 */

/** @type {Map<string, string>} */
const memory = new Map()

/** @param {string} merchantOrderNo */
function keyOf(merchantOrderNo) {
  return `order:${merchantOrderNo}`
}

/**
 * @param {any} env
 * @param {string} merchantOrderNo
 * @param {object} record
 */
export async function putOrder(env, merchantOrderNo, record) {
  const key = keyOf(merchantOrderNo)
  const raw = JSON.stringify(record)
  if (env.ORDERS) {
    await env.ORDERS.put(key, raw, { expirationTtl: 60 * 60 * 24 * 45 })
  } else {
    memory.set(key, raw)
  }
}

/**
 * @param {any} env
 * @param {string} merchantOrderNo
 * @returns {Promise<object | null>}
 */
export async function getOrder(env, merchantOrderNo) {
  const key = keyOf(merchantOrderNo)
  let raw = null
  if (env.ORDERS) {
    raw = await env.ORDERS.get(key)
  } else {
    raw = memory.get(key) || null
  }
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
