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

const STORAGE_KEY = 'pearl-tw.earningsOrders.v1'

/** @type {EarningsOrder[] | null} */
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
  ensureDemoEarningsOrders()
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

/**
 * Seed one sample per status for the signed-in designer (idempotent by demo ids).
 */
export function ensureDemoEarningsOrders() {
  const memberId = getMemberId()
  const demos = buildDemoEarningsOrders(memberId)
  const withoutDemo = readAll().filter((o) => !String(o.id).startsWith('earn-demo-'))
  writeAll([...demos, ...withoutDemo])
}

/** @param {string} designerId */
function buildDemoEarningsOrders(designerId) {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  /** @type {EarningsOrder[]} */
  return [
    {
      id: 'earn-demo-making',
      publishId: 'pub-demo-budream',
      designTitle: '捕夢網',
      unitPriceTwd: 99,
      buyerMemberId: '883401',
      designerId,
      status: 'making',
      settledNetTwd: 0,
      createdAt: now - day * 0.5,
      updatedAt: now - day * 0.5,
    },
    {
      id: 'earn-demo-shipping',
      publishId: 'pub-demo-liuli',
      designTitle: '金色琉璃',
      unitPriceTwd: 89,
      buyerMemberId: '774210',
      designerId,
      status: 'shipping',
      settledNetTwd: 0,
      createdAt: now - day * 2,
      updatedAt: now - day,
    },
    {
      id: 'earn-demo-pending',
      publishId: 'pub-demo-caihong',
      designTitle: '彩虹',
      unitPriceTwd: 60,
      buyerMemberId: '651088',
      designerId,
      status: 'pending_settle',
      settledNetTwd: 0,
      createdAt: now - day * 5,
      updatedAt: now - day * 3,
    },
    {
      id: 'earn-demo-settled',
      publishId: 'pub-demo-jinyu',
      designTitle: '金玉滿堂',
      unitPriceTwd: 120,
      buyerMemberId: '502933',
      designerId,
      status: 'settled',
      settledNetTwd: netAfterTax(120),
      createdAt: now - day * 10,
      updatedAt: now - day * 8,
    },
  ]
}

function newEarningsOrderId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `earn-${crypto.randomUUID()}`
  }
  return `earn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
