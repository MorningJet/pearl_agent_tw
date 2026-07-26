/**
 * Orders (local persistence + Shopify / Worker status sync).
 */

/**
 * @typedef {
 *   | 'unpaid'
 *   | 'scheduling'
 *   | 'designing'
 *   | 'shipping'
 *   | 'pickup'
 *   | 'done'
 *   | 'closed'
 * } OrderStatus
 */

/**
 * @typedef {{
 *   productId?: string,
 *   name: string,
 *   diameterMm: number,
 *   qty: number,
 *   unitPrice?: number,
 *   lineTotal: number,
 * }} OrderBomLine
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   status: OrderStatus,
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
 *   shopifyOrderId?: string,
 *   shopifyOrderName?: string,
 *   merchantOrderNo?: string,
 *   email?: string,
 *   bomDisplay?: 'fee' | 'sku',
 *   bom?: OrderBomLine[],
 *   paymentType?: string,
 * }} Order
 */

/** v4: real Shopify/NewebPay orders only (no demo seeds). */
const STORAGE_KEY = 'pearl-tw.orders.v4'
const LEGACY_STORAGE_KEY = 'pearl-tw.orders.v3'

/** @type {Order[] | null} */
let cache = null

/** Paid / 排單中 — may request refund. */
export const REFUNDABLE_STATUSES = /** @type {const} */ (['scheduling'])

/**
 * Custom-goods note（排單中 → 已完成；已關閉無）。
 * @type {ReadonlySet<OrderStatus>}
 */
export const CUSTOM_NOTE_STATUSES = new Set([
  'scheduling',
  'designing',
  'shipping',
  'pickup',
  'done',
])

export const CUSTOM_GOODS_NOTE =
  '訂製商品不適用七日鑑賞期，品質疑慮請洽客服'

/** Filter tab order (excluding「全部」). */
export const ORDER_STATUS_FILTERS = /** @type {const} */ ([
  'unpaid',
  'scheduling',
  'designing',
  'shipping',
  'pickup',
  'done',
  'closed',
])

function readAll() {
  if (cache) return cache
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacy) {
        const parsed = JSON.parse(legacy)
        const list = (Array.isArray(parsed) ? parsed : [])
          .map(normalizeOrder)
          .filter((o) => o && !isDemoOrderId(o.id))
        cache = list
        writeAll(list)
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch {
          /* ignore */
        }
        return cache
      }
      cache = []
      return cache
    }
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : []
    cache = list.map(normalizeOrder).filter((o) => o && !isDemoOrderId(o.id))
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

/** @param {string} id */
function isDemoOrderId(id) {
  return String(id || '').startsWith('ord-demo-')
}

/**
 * @param {unknown} raw
 * @returns {Order | null}
 */
function normalizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const id = String(o.id || '')
  if (!id || isDemoOrderId(id)) return null
  return {
    id,
    title: String(o.title || '手鍊設計'),
    status: normalizeStatus(String(o.status || '')),
    amountTwd: Number(o.amountTwd) || 0,
    createdAt: Number(o.createdAt) || Date.now(),
    imageUrl: typeof o.imageUrl === 'string' ? o.imageUrl : '',
    paidAt: o.paidAt != null ? Number(o.paidAt) : undefined,
    wristCm: o.wristCm != null ? Number(o.wristCm) : undefined,
    beadsSubtotalTwd:
      o.beadsSubtotalTwd != null ? Number(o.beadsSubtotalTwd) : undefined,
    designFeeTwd: o.designFeeTwd != null ? Number(o.designFeeTwd) : undefined,
    shippingTwd: o.shippingTwd != null ? Number(o.shippingTwd) : undefined,
    recipientName: String(o.recipientName || ''),
    recipientPhone: String(o.recipientPhone || ''),
    recipientAddress: String(o.recipientAddress || ''),
    trackingNo: String(o.trackingNo || ''),
    cancelReason: String(o.cancelReason || ''),
    shopifyOrderId: o.shopifyOrderId != null ? String(o.shopifyOrderId) : '',
    shopifyOrderName: String(o.shopifyOrderName || ''),
    merchantOrderNo: String(o.merchantOrderNo || ''),
    email: String(o.email || ''),
    bomDisplay: o.bomDisplay === 'fee' || o.bomDisplay === 'sku' ? o.bomDisplay : undefined,
    bom: normalizeBomLines(o.bom),
    paymentType: String(o.paymentType || ''),
  }
}

/**
 * @param {unknown} raw
 * @returns {OrderBomLine[]}
 */
function normalizeBomLines(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {OrderBomLine[]} */
  const out = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = /** @type {Record<string, unknown>} */ (row)
    const name = String(r.name || '').trim()
    if (!name) continue
    out.push({
      productId: r.productId != null ? String(r.productId) : '',
      name,
      diameterMm: Number(r.diameterMm) || 0,
      qty: Math.max(1, Math.round(Number(r.qty) || 1)),
      unitPrice: Number(r.unitPrice) || 0,
      lineTotal: Number(r.lineTotal) || 0,
    })
  }
  return out
}

/**
 * Map legacy / unknown → current 7 statuses.
 * @param {string} status
 * @returns {OrderStatus}
 */
export function normalizeStatus(status) {
  switch (status) {
    case 'unpaid':
    case 'scheduling':
    case 'designing':
    case 'shipping':
    case 'pickup':
    case 'done':
    case 'closed':
      return status
    case 'pending':
      return 'unpaid'
    case 'paid':
      return 'scheduling'
    case 'making':
      return 'designing'
    case 'cancelled':
      return 'closed'
    default:
      return 'scheduling'
  }
}

/** Newest first. */
export function listOrders() {
  return readAll()
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** @param {string} id */
export function getOrder(id) {
  return listOrders().find((o) => o.id === id) || null
}

/**
 * Stable local id from Shopify / NewebPay keys.
 * @param {{ shopifyOrderId?: string | number | null, merchantOrderNo?: string | null, id?: string }} keys
 */
export function orderIdFromKeys(keys) {
  const sid = String(keys.shopifyOrderId || '').trim()
  if (sid) return `shopify-${sid}`
  const mno = String(keys.merchantOrderNo || '').trim()
  if (mno) return `np-${mno}`
  if (keys.id) return String(keys.id)
  return newOrderId()
}

/**
 * @param {Omit<Order, 'id' | 'createdAt'> & { id?: string, createdAt?: number }} input
 */
export function upsertOrder(input) {
  const list = readAll().slice()
  const id =
    input.id ||
    orderIdFromKeys({
      shopifyOrderId: input.shopifyOrderId,
      merchantOrderNo: input.merchantOrderNo,
    })
  const idx = findOrderIndex(list, {
    id,
    shopifyOrderId: input.shopifyOrderId,
    merchantOrderNo: input.merchantOrderNo,
  })
  /** @type {Order} */
  const next = {
    id,
    title: input.title,
    status: normalizeStatus(input.status),
    amountTwd: Number(input.amountTwd) || 0,
    createdAt: input.createdAt || Date.now(),
    imageUrl: input.imageUrl || '',
    paidAt: input.paidAt,
    wristCm: input.wristCm,
    beadsSubtotalTwd: input.beadsSubtotalTwd,
    designFeeTwd: input.designFeeTwd,
    shippingTwd: input.shippingTwd,
    recipientName: input.recipientName || '',
    recipientPhone: input.recipientPhone || '',
    recipientAddress: input.recipientAddress || '',
    trackingNo: input.trackingNo || '',
    cancelReason: input.cancelReason || '',
    shopifyOrderId: input.shopifyOrderId != null ? String(input.shopifyOrderId) : '',
    shopifyOrderName: input.shopifyOrderName || '',
    merchantOrderNo: input.merchantOrderNo || '',
    email: input.email || '',
    bomDisplay: input.bomDisplay === 'fee' || input.bomDisplay === 'sku' ? input.bomDisplay : undefined,
    bom: normalizeBomLines(input.bom),
    paymentType: input.paymentType || '',
  }
  if (idx >= 0) {
    const prev = list[idx]
    list[idx] = {
      ...prev,
      ...next,
      id: prev.id,
      createdAt: prev.createdAt || next.createdAt,
      imageUrl: next.imageUrl || prev.imageUrl || '',
      recipientName: next.recipientName || prev.recipientName || '',
      recipientPhone: next.recipientPhone || prev.recipientPhone || '',
      recipientAddress: next.recipientAddress || prev.recipientAddress || '',
      wristCm: next.wristCm ?? prev.wristCm,
      beadsSubtotalTwd: next.beadsSubtotalTwd ?? prev.beadsSubtotalTwd,
      designFeeTwd: next.designFeeTwd ?? prev.designFeeTwd,
      shippingTwd: next.shippingTwd ?? prev.shippingTwd,
      email: next.email || prev.email || '',
      shopifyOrderId: next.shopifyOrderId || prev.shopifyOrderId || '',
      shopifyOrderName: next.shopifyOrderName || prev.shopifyOrderName || '',
      merchantOrderNo: next.merchantOrderNo || prev.merchantOrderNo || '',
      bomDisplay: next.bomDisplay || prev.bomDisplay,
      bom: next.bom?.length ? next.bom : prev.bom || [],
      paymentType: next.paymentType || prev.paymentType || '',
    }
    writeAll(list)
    return list[idx]
  }
  list.unshift(next)
  writeAll(list)
  return next
}

/**
 * Apply remote status fields onto a local order.
 * @param {string} id
 * @param {{
 *   status?: string,
 *   trackingNo?: string,
 *   shopifyOrderId?: string,
 *   shopifyOrderName?: string,
 *   merchantOrderNo?: string,
 *   title?: string,
 *   amountTwd?: number,
 *   beadsSubtotalTwd?: number | null,
 *   designFeeTwd?: number | null,
 *   shippingTwd?: number | null,
 *   wristCm?: number | null,
 *   imageUrl?: string,
 *   bomDisplay?: 'fee' | 'sku',
 *   bom?: import('./ordersStore.js').OrderBomLine[],
 *   paymentType?: string,
 * }} patch
 */
export function patchOrderFromRemote(id, patch) {
  const list = readAll().slice()
  const idx = list.findIndex((o) => o.id === id)
  if (idx < 0) return null
  const prev = list[idx]
  const bom = normalizeBomLines(patch.bom)
  list[idx] = {
    ...prev,
    status: patch.status != null ? normalizeStatus(patch.status) : prev.status,
    trackingNo:
      patch.trackingNo != null && String(patch.trackingNo)
        ? String(patch.trackingNo)
        : prev.trackingNo,
    shopifyOrderId: patch.shopifyOrderId
      ? String(patch.shopifyOrderId)
      : prev.shopifyOrderId,
    shopifyOrderName: patch.shopifyOrderName
      ? String(patch.shopifyOrderName)
      : prev.shopifyOrderName,
    merchantOrderNo: patch.merchantOrderNo
      ? String(patch.merchantOrderNo)
      : prev.merchantOrderNo,
    title: patch.title ? String(patch.title) : prev.title,
    amountTwd:
      patch.amountTwd != null && Number(patch.amountTwd) > 0
        ? Number(patch.amountTwd)
        : prev.amountTwd,
    beadsSubtotalTwd:
      patch.beadsSubtotalTwd != null && Number.isFinite(Number(patch.beadsSubtotalTwd))
        ? Number(patch.beadsSubtotalTwd)
        : prev.beadsSubtotalTwd,
    designFeeTwd:
      patch.designFeeTwd != null && Number.isFinite(Number(patch.designFeeTwd))
        ? Number(patch.designFeeTwd)
        : prev.designFeeTwd,
    shippingTwd:
      patch.shippingTwd != null && Number.isFinite(Number(patch.shippingTwd))
        ? Number(patch.shippingTwd)
        : prev.shippingTwd,
    wristCm:
      patch.wristCm != null && Number.isFinite(Number(patch.wristCm))
        ? Number(patch.wristCm)
        : prev.wristCm,
    imageUrl:
      patch.imageUrl != null && String(patch.imageUrl).trim()
        ? String(patch.imageUrl)
        : prev.imageUrl,
    bomDisplay:
      patch.bomDisplay === 'fee' || patch.bomDisplay === 'sku'
        ? patch.bomDisplay
        : prev.bomDisplay,
    bom: bom.length ? bom : prev.bom || [],
    paymentType:
      patch.paymentType != null && String(patch.paymentType).trim()
        ? String(patch.paymentType)
        : prev.paymentType,
  }
  writeAll(list)
  return list[idx]
}

/**
 * @param {Order[]} list
 * @param {{ id: string, shopifyOrderId?: string | number | null, merchantOrderNo?: string | null }} keys
 */
function findOrderIndex(list, keys) {
  const byId = list.findIndex((o) => o.id === keys.id)
  if (byId >= 0) return byId
  const sid = String(keys.shopifyOrderId || '').trim()
  if (sid) {
    const i = list.findIndex((o) => String(o.shopifyOrderId || '') === sid)
    if (i >= 0) return i
  }
  const mno = String(keys.merchantOrderNo || '').trim()
  if (mno) {
    const i = list.findIndex((o) => String(o.merchantOrderNo || '') === mno)
    if (i >= 0) return i
  }
  return -1
}

/** @param {string} status */
export function orderStatusLabel(status) {
  switch (normalizeStatus(status)) {
    case 'unpaid':
      return '未付款'
    case 'scheduling':
      return '排單中'
    case 'designing':
      return '設計中'
    case 'shipping':
      return '運送中'
    case 'pickup':
      return '待提貨'
    case 'done':
      return '已完成'
    case 'closed':
      return '已關閉'
    default:
      return '處理中'
  }
}

/** @param {string} status */
export function canRequestRefund(status) {
  const s = normalizeStatus(status)
  return REFUNDABLE_STATUSES.includes(/** @type {'scheduling'} */ (s))
}

/** @param {string} status */
export function canContinuePayment(status) {
  return normalizeStatus(status) === 'unpaid'
}

/** @param {string} status */
export function showsCustomGoodsNote(status) {
  return CUSTOM_NOTE_STATUSES.has(normalizeStatus(status))
}

/** True when member has at least one「已完成」order (designer features gate). */
export function hasCompletedOrder() {
  return listOrders().some((o) => normalizeStatus(o.status) === 'done')
}

/** Taiwan Traditional copy when gated designer features are tapped. */
export const DESIGNER_FEATURE_LOCKED_TOAST =
  '設計師功能僅限購買過商品的會員使用，敬請期待。'

function newOrderId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `ord-${crypto.randomUUID()}`
  return `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
