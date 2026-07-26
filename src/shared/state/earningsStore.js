/**
 * Designer earnings from「使用設計」purchase orders.
 * Taiwan standard business tax (營業稅 / VAT) is 5%.
 */

import { getMemberId } from './userProfileStore.js'

/** Taiwan 加值型營業稅標準稅率 */
export const EARNINGS_TAX_RATE = 0.05

/**
 * @typedef {'making' | 'shipping' | 'pending_settle' | 'settled'} EarningsOrderStatus
 * making = 製作中
 * shipping = 配送中
 * pending_settle = 待結算
 * settled = 已結算（顯示結算價格）
 */

/**
 * @typedef {{
 *   id: string,
 *   publishId: string,
 *   designTitle: string,
 *   unitPriceTwd: number,
 *   buyerMemberId: string,
 *   designerId: string,
 *   status: EarningsOrderStatus,
 *   settledNetTwd: number,
 *   createdAt: number,
 *   updatedAt: number,
 * }} EarningsOrder
 */

/**
 * @typedef {{
 *   availableTwd: number,
 *   pendingTwd: number,
 *   totalTwd: number,
 *   orders: EarningsOrder[],
 * }} EarningsSummary
 */

/** v2: drop seeded demo / local test earnings from v1 localStorage */
const STORAGE_KEY = 'pearl-tw.earningsOrders.v2'

/** @type {EarningsOrder[] | null} */
let cache = null

function isDemoEarningsId(id) {
  return String(id).startsWith('earn-demo-')
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
    const cleaned = list.filter((o) => !isDemoEarningsId(o?.id))
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

/** @param {EarningsOrder[]} list */
function writeAll(list) {
  cache = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/**
 * Net amount after Taiwan 5% business tax.
 * @param {number} grossTwd
 */
export function netAfterTax(grossTwd) {
  const gross = Math.max(0, Math.round(Number(grossTwd) || 0))
  return Math.round(gross * (1 - EARNINGS_TAX_RATE))
}

/** @param {EarningsOrderStatus} status */
export function earningsStatusLabel(status) {
  switch (status) {
    case 'making':
      return '製作中'
    case 'shipping':
      return '配送中'
    case 'pending_settle':
      return '待結算'
    case 'settled':
      return '結算價格'
    default:
      return '處理中'
  }
}

/**
 * Record a use-design purchase for the designer’s earnings ledger.
 * New orders start as 製作中.
 * @param {{
 *   publishId: string,
 *   designTitle: string,
 *   unitPriceTwd: number,
 *   designerId: string,
 *   buyerMemberId: string,
 * }} input
 */
export function createEarningsOrder(input) {
  const unitPriceTwd = Math.max(0, Math.round(Number(input.unitPriceTwd) || 0))
  const now = Date.now()
  /** @type {EarningsOrder} */
  const order = {
    id: newEarningsOrderId(),
    publishId: input.publishId,
    designTitle: input.designTitle || '設計',
    unitPriceTwd,
    buyerMemberId: String(input.buyerMemberId || ''),
    designerId: String(input.designerId || ''),
    status: 'making',
    settledNetTwd: 0,
    createdAt: now,
    updatedAt: now,
  }
  const list = readAll().slice()
  list.unshift(order)
  writeAll(list)
  return order
}

/**
 * @param {string} id
 * @param {EarningsOrderStatus} status
 */
export function setEarningsOrderStatus(id, status) {
  const list = readAll().slice()
  const i = list.findIndex((o) => o.id === id)
  if (i < 0) return null
  const prev = list[i]
  const settledNetTwd =
    status === 'settled' ? netAfterTax(prev.unitPriceTwd) : 0
  const next = {
    ...prev,
    status,
    settledNetTwd,
    updatedAt: Date.now(),
  }
  list[i] = next
  writeAll(list)
  return next
}

/** Orders where the signed-in member is the designer. Newest first. */
export function listMyEarningsOrders() {
  const memberId = getMemberId()
  return readAll()
    .filter((o) => o.designerId === memberId)
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** @returns {EarningsSummary} */
export function getEarningsSummary() {
  const orders = listMyEarningsOrders()
  let availableTwd = 0
  let pendingTwd = 0
  for (const o of orders) {
    if (o.status === 'settled') {
      availableTwd += o.settledNetTwd || netAfterTax(o.unitPriceTwd)
    } else {
      pendingTwd += o.unitPriceTwd || 0
    }
  }
  return {
    availableTwd,
    pendingTwd,
    totalTwd: availableTwd + pendingTwd,
    orders,
  }
}

function newEarningsOrderId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `earn-${crypto.randomUUID()}`
  }
  return `earn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
