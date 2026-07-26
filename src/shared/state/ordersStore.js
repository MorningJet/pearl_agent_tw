/**
 * Orders (local persistence). Demo seeds illustrate the 7 status flow.
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
 * }} Order
 */

/** v3: 7-status model + demo seeds */
const STORAGE_KEY = 'pearl-tw.orders.v3'

/** @type {Order[] | null} */
let cache = null

/** Statuses that may apply for refund. */
export const REFUNDABLE_STATUSES = /** @type {const} */ (['unpaid', 'scheduling'])

/**
 * Custom-goods note (排單中 → 已完成).
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
  '（訂製商品不支援 7 日鑑賞期，如有品質問題退貨請聯繫客服處理）'

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
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      cache = []
      return cache
    }
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : []
    cache = list.map(normalizeOrder).filter(Boolean)
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

/**
 * @param {unknown} raw
 * @returns {Order | null}
 */
function normalizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const id = String(o.id || '')
  if (!id) return null
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
  }
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

/** Newest first. Includes in-memory demo seeds (overridden by same-id persisted rows). */
export function listOrders() {
  /** @type {Map<string, Order>} */
  const map = new Map()
  for (const o of buildDemoOrders()) map.set(o.id, o)
  for (const o of readAll()) map.set(o.id, o)
  return [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** @param {string} id */
export function getOrder(id) {
  return listOrders().find((o) => o.id === id) || null
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
  }
  if (idx >= 0) list[idx] = { ...list[idx], ...next }
  else list.unshift(next)
  writeAll(list)
  return next
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
  return REFUNDABLE_STATUSES.includes(/** @type {'unpaid' | 'scheduling'} */ (s))
}

/** @param {string} status */
export function showsCustomGoodsNote(status) {
  return CUSTOM_NOTE_STATUSES.has(normalizeStatus(status))
}

function newOrderId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `ord-${crypto.randomUUID()}`
  return `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** @returns {Order[]} */
function buildDemoOrders() {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const addr = {
    recipientName: '王小明',
    recipientPhone: '0912-345-678',
    recipientAddress: '台北市大安區忠孝東路四段 100 號 5 樓',
  }
  return [
    {
      id: 'ord-demo-unpaid',
      title: '星光粉晶',
      status: /** @type {OrderStatus} */ ('unpaid'),
      amountTwd: 1280,
      createdAt: now - day * 0.2,
      imageUrl: '/plaza/pub-dca45881-9c67-4dd0-b6f7-c1fcfbe3bcf4.png',
      wristCm: 15.2,
      beadsSubtotalTwd: 1230,
      designFeeTwd: 0,
      shippingTwd: 50,
      ...addr,
    },
    {
      id: 'ord-demo-scheduling',
      title: '捕夢網',
      status: /** @type {OrderStatus} */ ('scheduling'),
      amountTwd: 1025,
      createdAt: now - day * 0.8,
      paidAt: now - day * 0.8,
      imageUrl: '/plaza/pub-e08d746d-a3c1-4af2-b999-affff7c64ac5.png',
      wristCm: 15.5,
      beadsSubtotalTwd: 926,
      designFeeTwd: 99,
      shippingTwd: 0,
      ...addr,
    },
    {
      id: 'ord-demo-designing',
      title: '漸變',
      status: /** @type {OrderStatus} */ ('designing'),
      amountTwd: 1656,
      createdAt: now - day * 2,
      paidAt: now - day * 2,
      imageUrl: '/plaza/pub-029d61e7-facb-4963-9d7b-440fe70b8343.png',
      wristCm: 14.4,
      beadsSubtotalTwd: 1617,
      designFeeTwd: 39,
      shippingTwd: 0,
      ...addr,
    },
    {
      id: 'ord-demo-shipping',
      title: '金色琉璃',
      status: /** @type {OrderStatus} */ ('shipping'),
      amountTwd: 968,
      createdAt: now - day * 4,
      paidAt: now - day * 4,
      imageUrl: '/plaza/pub-a81f6111-a00b-4f28-8b16-8eb95c21fd44.png',
      wristCm: 16.0,
      beadsSubtotalTwd: 879,
      designFeeTwd: 89,
      shippingTwd: 0,
      trackingNo: 'TW1234567890',
      ...addr,
    },
    {
      id: 'ord-demo-pickup',
      title: '彩虹',
      status: /** @type {OrderStatus} */ ('pickup'),
      amountTwd: 1695,
      createdAt: now - day * 6,
      paidAt: now - day * 6,
      imageUrl: '/plaza/pub-283e7097-b146-47db-82be-84a7b0ab7d3e.png',
      wristCm: 14.8,
      beadsSubtotalTwd: 1656,
      designFeeTwd: 39,
      shippingTwd: 0,
      trackingNo: 'TW5556667778',
      ...addr,
    },
    {
      id: 'ord-demo-done',
      title: '月光石串',
      status: /** @type {OrderStatus} */ ('done'),
      amountTwd: 1137,
      createdAt: now - day * 12,
      paidAt: now - day * 12,
      imageUrl: '/plaza/pub-bf77b5cd-cf3b-489e-9e91-e777c28c1d4c.png',
      wristCm: 15.0,
      beadsSubtotalTwd: 1118,
      designFeeTwd: 19,
      shippingTwd: 0,
      trackingNo: 'TW9876543210',
      ...addr,
    },
    {
      id: 'ord-demo-closed',
      title: '紫金砂',
      status: /** @type {OrderStatus} */ ('closed'),
      amountTwd: 860,
      createdAt: now - day * 5,
      paidAt: now - day * 5,
      imageUrl: '/plaza/pub-dd0a48cc-474f-4cfe-99bf-33b84fa8558d.png',
      wristCm: 15.2,
      beadsSubtotalTwd: 771,
      designFeeTwd: 39,
      shippingTwd: 50,
      cancelReason: '買家申請退款',
      ...addr,
    },
  ]
}
