/**
 * Orders (local persistence). Populated when checkout ships; empty by default.
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   status: 'making' | 'shipping' | 'done' | 'cancelled' | 'pending' | 'paid',
 *   amountTwd: number,
 *   createdAt: number,
 *   imageUrl?: string,
 *   paidAt?: number,
 *   wristCm?: number,
 *   beadsSubtotalTwd?: number,
 *   designFeeTwd?: number,
 *   shippingTwd?: number,
 *   recipientName?: string,
 *   recipientPhone?: string,
 *   recipientAddress?: string,
 *   trackingNo?: string,
 *   cancelReason?: string,
 * }} Order
 */

/** v2: drop seeded demo orders from v1 localStorage */
const STORAGE_KEY = 'pearl-tw.orders.v2'

/** @type {Order[] | null} */
let cache = null

function isDemoOrderId(id) {
  return String(id).startsWith('ord-demo-')
}

function readAll() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      cache = []
      return cache
    }
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : []
    const cleaned = list.filter((o) => !isDemoOrderId(o?.id))
    if (cleaned.length !== list.length) {
      cache = cleaned
      writeAll(cleaned)
      return cache
    }
    cache = cleaned
  } catch {
    cache = []
  }
  return cache
}

/** @param {Order[]} list */
function writeAll(list) {
  cache = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/** Newest first. @returns {Order[]} */
export function listOrders() {
  return readAll()
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** @param {string} id */
export function getOrder(id) {
  return readAll().find((o) => o.id === id) || null
}

/**
 * @param {Omit<Order, 'id' | 'createdAt'> & { id?: string, createdAt?: number }} input
 */
export function upsertOrder(input) {
  const list = readAll().slice()
  const id = input.id || newOrderId()
  const idx = list.findIndex((o) => o.id === id)
  /** @type {Order} */
  const next = {
    id,
    title: input.title,
    status: input.status,
    amountTwd: Number(input.amountTwd) || 0,
    createdAt: input.createdAt || Date.now(),
    imageUrl: input.imageUrl || '',
    paidAt: input.paidAt ?? input.createdAt ?? Date.now(),
    wristCm: input.wristCm,
    beadsSubtotalTwd: input.beadsSubtotalTwd,
    designFeeTwd: input.designFeeTwd,
    shippingTwd: input.shippingTwd,
    recipientName: input.recipientName || '',
    recipientPhone: input.recipientPhone || '',
    recipientAddress: input.recipientAddress || '',
    trackingNo: input.trackingNo || '',
    cancelReason: input.cancelReason || '',
  }
  if (idx >= 0) list[idx] = { ...list[idx], ...next }
  else list.unshift(next)
  writeAll(list)
  return next
}

/** @param {Order['status']} status */
export function orderStatusLabel(status) {
  switch (status) {
    case 'making':
    case 'pending':
    case 'paid':
      return '製作中'
    case 'shipping':
      return '配送中'
    case 'done':
      return '已完成'
    case 'cancelled':
      return '已取消'
    default:
      return '處理中'
  }
}

function newOrderId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `ord-${crypto.randomUUID()}`
  return `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
