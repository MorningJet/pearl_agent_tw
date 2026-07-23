/**
 * Orders (local persistence). Populated when checkout ships; empty by default.
 */

import { withBase } from '../assetUrl.js'

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

const STORAGE_KEY = 'pearl-tw.orders.v1'

/** @type {Order[] | null} */
let cache = null

function readAll() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      cache = []
      return cache
    }
    const parsed = JSON.parse(raw)
    cache = Array.isArray(parsed) ? parsed : []
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
  ensureDemoOrders()
  return readAll()
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** @param {string} id */
export function getOrder(id) {
  ensureDemoOrders()
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

/** Seed one sample order per tab status (idempotent by demo ids). */
export function ensureDemoOrders() {
  const demos = buildDemoOrders()
  const withoutDemo = readAll().filter((o) => !String(o.id).startsWith('ord-demo-'))
  writeAll([...demos, ...withoutDemo])
}

function buildDemoOrders() {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const addr = {
    recipientName: '王小明',
    recipientPhone: '0912-345-678',
    recipientAddress: '台北市大安區忠孝東路四段 100 號 5 樓',
  }
  /** @type {Order[]} */
  return [
    {
      id: 'ord-demo-making',
      title: '捕夢網',
      status: 'making',
      amountTwd: 1025,
      createdAt: now - day * 0.3,
      paidAt: now - day * 0.3,
      imageUrl: withBase('/plaza/pub-dca45881-9c67-4dd0-b6f7-c1fcfbe3bcf4.png'),
      wristCm: 15.5,
      beadsSubtotalTwd: 926,
      designFeeTwd: 99,
      shippingTwd: 0,
      ...addr,
    },
    {
      id: 'ord-demo-shipping',
      title: '金色琉璃',
      status: 'shipping',
      amountTwd: 968,
      createdAt: now - day * 2,
      paidAt: now - day * 2,
      imageUrl: withBase('/plaza/pub-e08d746d-a3c1-4af2-b999-affff7c64ac5.png'),
      wristCm: 16.0,
      beadsSubtotalTwd: 879,
      designFeeTwd: 89,
      shippingTwd: 0,
      trackingNo: 'TW1234567890',
      ...addr,
    },
    {
      id: 'ord-demo-done',
      title: '漸變',
      status: 'done',
      amountTwd: 1137,
      createdAt: now - day * 7,
      paidAt: now - day * 7,
      imageUrl: withBase('/plaza/pub-029d61e7-facb-4963-9d7b-440fe70b8343.png'),
      wristCm: 14.8,
      beadsSubtotalTwd: 1118,
      designFeeTwd: 19,
      shippingTwd: 0,
      trackingNo: 'TW9876543210',
      ...addr,
    },
    {
      id: 'ord-demo-cancelled',
      title: '彩虹',
      status: 'cancelled',
      amountTwd: 860,
      createdAt: now - day * 4,
      paidAt: now - day * 4,
      imageUrl: withBase('/plaza/pub-283e7097-b146-47db-82be-84a7b0ab7d3e.png'),
      wristCm: 15.2,
      beadsSubtotalTwd: 771,
      designFeeTwd: 39,
      shippingTwd: 50,
      cancelReason: '買家取消',
      ...addr,
    },
  ]
}

function newOrderId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `ord-${crypto.randomUUID()}`
  return `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
