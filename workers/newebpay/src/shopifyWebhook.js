/**
 * Shopify Admin webhooks → H5「我的訂單」7 狀態鏡像（KV）。
 *
 * Subscribe (Admin → Settings → Notifications → Webhooks, or App webhooks):
 *   orders/create, orders/updated, orders/paid, orders/cancelled,
 *   fulfillments/create, fulfillments/update, refunds/create
 * Endpoint: POST {PUBLIC_API_BASE}/api/webhooks/shopify
 * Secret:   SHOPIFY_WEBHOOK_SECRET (= webhook signing secret)
 */

import { getOrder, putOrder, getShopifyOrderMirror, putShopifyOrderMirror, listShopifyOrderIndexByEmail } from './store.js'
import { isShopifyAuthConfigured, listShopifyOrdersByEmail } from './shopify.js'

/** @typedef {'unpaid'|'scheduling'|'designing'|'shipping'|'pickup'|'done'|'closed'} H5OrderStatus */

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleShopifyWebhook(request, env) {
  const rawBody = await request.text()
  const hmacHeader = request.headers.get('X-Shopify-Hmac-Sha256') || ''
  const topic = request.headers.get('X-Shopify-Topic') || ''
  const shop = request.headers.get('X-Shopify-Shop-Domain') || ''
  const webhookId = request.headers.get('X-Shopify-Webhook-Id') || ''

  const secret = String(env.SHOPIFY_WEBHOOK_SECRET || '').trim()
  if (!secret) {
    console.error('[shopify-webhook] missing SHOPIFY_WEBHOOK_SECRET')
    return json({ ok: false, error: 'webhook secret not configured' }, 500)
  }

  const valid = await verifyShopifyHmac(rawBody, hmacHeader, secret)
  if (!valid) {
    console.warn('[shopify-webhook] invalid hmac', { topic, shop, webhookId })
    return json({ ok: false, error: 'invalid hmac' }, 401)
  }

  /** @type {any} */
  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400)
  }

  const order = await resolveOrderPayload(topic, payload, env)
  if (!order?.id) {
    // Still 200 so Shopify does not retry forever on topics we ignore
    return json({ ok: true, ignored: true, topic }, 200)
  }

  const mirror = buildMirror(order, topic)
  await putShopifyOrderMirror(env, await mergeMirrorPreservingBom(env, mirror))

  // Keep NewebPay checkout record in sync when we can resolve merchant order no
  if (mirror.merchantOrderNo) {
    const record = await getOrder(env, mirror.merchantOrderNo)
    if (record) {
      record.h5Status = mirror.h5Status
      record.shopifyOrderId = mirror.shopifyOrderId
      record.shopifyOrderName = mirror.shopifyOrderName
      record.shopifyFinancialStatus = mirror.financialStatus
      record.shopifyFulfillmentStatus = mirror.fulfillmentStatus
      record.trackingNo = mirror.trackingNo || record.trackingNo || ''
      record.shopifyWebhookAt = mirror.updatedAt
      await putOrder(env, mirror.merchantOrderNo, record)
    }
  }

  console.log('[shopify-webhook]', {
    topic,
    id: mirror.shopifyOrderId,
    name: mirror.shopifyOrderName,
    h5Status: mirror.h5Status,
  })

  return json({ ok: true, topic, h5Status: mirror.h5Status, shopifyOrderId: mirror.shopifyOrderId }, 200)
}

/**
 * Public status for H5「我的訂單」polling.
 * @param {URL} url
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handleH5OrderStatus(url, env, cors) {
  const shopifyOrderId = String(url.searchParams.get('shopifyOrderId') || '').trim()
  const shopifyOrderName = String(url.searchParams.get('shopifyOrderName') || '').trim()
  const merchantOrderNo = String(url.searchParams.get('merchantOrderNo') || '').trim()

  let mirror = null
  if (shopifyOrderId) {
    mirror = await getShopifyOrderMirror(env, { shopifyOrderId })
  } else if (shopifyOrderName) {
    mirror = await getShopifyOrderMirror(env, { shopifyOrderName })
  } else if (merchantOrderNo) {
    mirror = await getShopifyOrderMirror(env, { merchantOrderNo })
    if (!mirror) {
      const record = await getOrder(env, merchantOrderNo)
      if (record) {
        return json(
          {
            ok: true,
            order: publicFromCheckoutRecord(record),
          },
          200,
          cors,
        )
      }
    }
  } else {
    return json(
      { ok: false, error: '需要 shopifyOrderId / shopifyOrderName / merchantOrderNo' },
      400,
      cors,
    )
  }

  if (!mirror) return json({ ok: false, error: '找不到訂單狀態' }, 404, cors)
  return json({ ok: true, order: publicMirror(mirror) }, 200, cors)
}

/**
 * Batch lookup for H5 list refresh.
 * POST { shopifyOrderIds?: string[], merchantOrderNos?: string[] }
 * @param {Request} request
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handleH5OrderStatusBatch(request, env, cors) {
  /** @type {any} */
  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body?.shopifyOrderIds)
    ? body.shopifyOrderIds.map(String).slice(0, 50)
    : []
  const nos = Array.isArray(body?.merchantOrderNos)
    ? body.merchantOrderNos.map(String).slice(0, 50)
    : []

  /** @type {object[]} */
  const orders = []
  for (const id of ids) {
    const m = await getShopifyOrderMirror(env, { shopifyOrderId: id })
    if (m) orders.push(publicMirror(m))
  }
  for (const no of nos) {
    let m = await getShopifyOrderMirror(env, { merchantOrderNo: no })
    if (!m) {
      const record = await getOrder(env, no)
      if (record) {
        orders.push(publicFromCheckoutRecord(record))
      }
      continue
    }
    orders.push(publicMirror(m))
  }

  return json({ ok: true, orders }, 200, cors)
}

/**
 * List H5 order status mirrors for a member email.
 * Prefers KV index; backfills from Shopify Admin when configured.
 * GET /api/h5/orders?email=
 * @param {URL} url
 * @param {any} env
 * @param {Record<string, string>} cors
 */
export async function handleH5OrdersByEmail(url, env, cors) {
  const email = String(url.searchParams.get('email') || '')
    .trim()
    .toLowerCase()
  if (!email || !email.includes('@')) {
    return json({ ok: false, error: '需要 email' }, 400, cors)
  }

  /** @type {Map<string, object>} */
  const byId = new Map()

  const index = await listShopifyOrderIndexByEmail(env, email)
  for (const row of index) {
    const id = String(row?.shopifyOrderId || '').trim()
    const mno = String(row?.merchantOrderNo || '').trim()
    let mirror = null
    if (id) mirror = await getShopifyOrderMirror(env, { shopifyOrderId: id })
    if (!mirror && mno) mirror = await getShopifyOrderMirror(env, { merchantOrderNo: mno })
    if (!mirror && mno) {
      const record = await getOrder(env, mno)
      if (record) {
        byId.set(mno, { ...publicFromCheckoutRecord(record), email })
      }
      continue
    }
    if (mirror) {
      const key = String(mirror.shopifyOrderId || mirror.merchantOrderNo || '')
      if (key) byId.set(key, publicMirror(mirror))
    }
  }

  if (isShopifyAuthConfigured(env)) {
    try {
      const adminOrders = await listShopifyOrdersByEmail(env, email, { limit: 50 })
      for (const order of adminOrders) {
        const mirror = buildMirror(order, 'admin/list')
        const merged = await mergeMirrorPreservingBom(env, mirror)
        // Prefer checkout record BOM when Admin list has no line breakdown
        if ((!merged.bom || !merged.bom.length) && merged.merchantOrderNo) {
          const record = await getOrder(env, merged.merchantOrderNo)
          if (record && Array.isArray(record.bom) && record.bom.length) {
            merged.bom = record.bom
            const detailsMode = String(record.detailsMode || 'normal')
            merged.bomDisplay =
              detailsMode === 'plaza' || detailsMode === 'plaza-edit' ? 'fee' : 'sku'
            if (merged.beadsSubtotalTwd == null && record.beadsSubtotal != null) {
              merged.beadsSubtotalTwd = Number(record.beadsSubtotal)
            }
            if (merged.designFeeTwd == null && record.designFee != null) {
              merged.designFeeTwd = Number(record.designFee)
            }
            if (merged.shippingTwd == null && record.shipping != null) {
              merged.shippingTwd = Number(record.shipping)
            }
          }
        }
        await putShopifyOrderMirror(env, merged)
        const key = String(merged.shopifyOrderId || merged.merchantOrderNo || '')
        if (key) byId.set(key, publicMirror(merged))
      }
    } catch (e) {
      console.warn('[h5-orders] admin list failed', e instanceof Error ? e.message : e)
    }
  }

  const orders = [...byId.values()].sort(
    (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),
  )
  return json({ ok: true, orders }, 200, cors)
}

/**
 * Build + store mirror from a NewebPay checkout record (after Shopify create / paid).
 * @param {any} env
 * @param {object} record
 * @param {string} [topic]
 */
export async function mirrorFromCheckoutRecord(env, record, topic = 'checkout') {
  if (!record?.shopifyOrderId) return null
  const detailsMode = String(record.detailsMode || 'normal')
  const bomDisplay =
    detailsMode === 'plaza' || detailsMode === 'plaza-edit' ? 'fee' : 'sku'
  const mirror = {
    shopifyOrderId: String(record.shopifyOrderId),
    shopifyOrderName: String(record.shopifyOrderName || ''),
    merchantOrderNo: String(record.merchantOrderNo || ''),
    h5Status: record.h5Status || 'unpaid',
    financialStatus: record.h5Status === 'scheduling' ? 'paid' : 'pending',
    fulfillmentStatus: null,
    tags: '',
    trackingNo: record.trackingNo || '',
    title: record.designName || '',
    amountTwd: Number(record.amountTwd) || 0,
    beadsSubtotalTwd:
      record.beadsSubtotal != null ? Number(record.beadsSubtotal) : null,
    designFeeTwd: record.designFee != null ? Number(record.designFee) : null,
    shippingTwd: record.shipping != null ? Number(record.shipping) : null,
    wristCm:
      record.wristCmNum != null && Number.isFinite(Number(record.wristCmNum))
        ? Number(record.wristCmNum)
        : null,
    email: String(record.email || ''),
    imageUrl: String(record.designImageUrl || ''),
    bomDisplay,
    bom: Array.isArray(record.bom) ? record.bom : [],
    paymentType: String(record.newebpay?.paymentType || record.paymentType || ''),
    topic,
    updatedAt: Date.now(),
    shopifyUpdatedAt: null,
  }
  await putShopifyOrderMirror(env, mirror)
  return mirror
}

/**
 * Map Shopify order JSON → H5 status.
 * Explicit tag `pearl:designing` etc. wins over auto rules (except cancel/refund).
 *
 * @param {any} order
 * @returns {H5OrderStatus}
 */
export function mapShopifyOrderToH5Status(order) {
  if (order?.cancelled_at) return 'closed'

  const fin = String(order?.financial_status || '').toLowerCase()
  if (fin === 'refunded' || fin === 'voided') return 'closed'

  const tagged = readPearlStatusTag(order)
  if (tagged) return tagged

  const attr = readNoteAttr(order, 'pearl_h5_status')
  if (attr) {
    const n = normalizeH5Status(attr)
    if (n) return n
  }

  if (fin === 'pending' || fin === 'authorized' || fin === 'partially_paid') {
    return 'unpaid'
  }

  const ful = String(order?.fulfillment_status || '').toLowerCase()
  if (ful === 'fulfilled') return 'done'
  if (ful === 'partial') return 'shipping'

  if (fin === 'paid' || fin === 'partially_refunded') return 'scheduling'

  return 'unpaid'
}

/**
 * @param {any} order
 * @param {string} topic
 */
function buildMirror(order, topic) {
  const shopifyOrderId = String(order.id)
  const shopifyOrderName = String(order.name || '')
  const merchantOrderNo =
    readNoteAttr(order, 'newebpay_merchant_order_no') ||
    readNoteAttr(order, 'pearl_merchant_order_no') ||
    ''
  const trackingNo = extractTracking(order)
  const h5Status = mapShopifyOrderToH5Status(order)
  const title =
    readNoteAttr(order, 'pearl_design_name') ||
    firstLineItemTitle(order) ||
    shopifyOrderName ||
    '手鍊設計'
  const amountTwd = Math.round(Number(order.total_price || order.current_total_price || 0))
  const beadsSubtotalTwd = Number(
    readNoteAttr(order, 'pearl_beads_subtotal_twd') || '',
  )
  const designFeeTwd = Number(readNoteAttr(order, 'pearl_design_fee_twd') || '')
  const shippingTwd = Number(readNoteAttr(order, 'pearl_shipping_twd') || '')
  const wristCm = Number(readNoteAttr(order, 'pearl_wrist_cm') || '')

  return {
    shopifyOrderId,
    shopifyOrderName,
    merchantOrderNo,
    h5Status,
    financialStatus: String(order.financial_status || ''),
    fulfillmentStatus: String(order.fulfillment_status || ''),
    tags: String(order.tags || ''),
    trackingNo,
    title,
    amountTwd,
    beadsSubtotalTwd: Number.isFinite(beadsSubtotalTwd) ? beadsSubtotalTwd : null,
    designFeeTwd: Number.isFinite(designFeeTwd) ? designFeeTwd : null,
    shippingTwd: Number.isFinite(shippingTwd) ? shippingTwd : null,
    wristCm: Number.isFinite(wristCm) ? wristCm : null,
    email: String(order.email || readNoteAttr(order, 'pearl_member_email') || ''),
    imageUrl: String(readNoteAttr(order, 'pearl_design_image_url') || ''),
    paymentType: String(readNoteAttr(order, 'newebpay_payment_type') || ''),
    topic,
    updatedAt: Date.now(),
    shopifyUpdatedAt: order.updated_at || null,
  }
}

/**
 * Keep checkout BOM / fee fields when Shopify webhook only sends status.
 * @param {any} env
 * @param {object} mirror
 */
async function mergeMirrorPreservingBom(env, mirror) {
  const existing = await getShopifyOrderMirror(env, {
    shopifyOrderId: mirror.shopifyOrderId,
  })
  if (!existing) return mirror
  if (!mirror.bom?.length && Array.isArray(existing.bom) && existing.bom.length) {
    mirror.bom = existing.bom
  }
  if (!mirror.bomDisplay && existing.bomDisplay) mirror.bomDisplay = existing.bomDisplay
  if (mirror.beadsSubtotalTwd == null && existing.beadsSubtotalTwd != null) {
    mirror.beadsSubtotalTwd = existing.beadsSubtotalTwd
  }
  if (mirror.designFeeTwd == null && existing.designFeeTwd != null) {
    mirror.designFeeTwd = existing.designFeeTwd
  }
  if (mirror.shippingTwd == null && existing.shippingTwd != null) {
    mirror.shippingTwd = existing.shippingTwd
  }
  if (mirror.wristCm == null && existing.wristCm != null) mirror.wristCm = existing.wristCm
  if (!mirror.imageUrl && existing.imageUrl) mirror.imageUrl = existing.imageUrl
  if (!mirror.paymentType && existing.paymentType) mirror.paymentType = existing.paymentType
  return mirror
}

/** @param {object} mirror */
function publicMirror(mirror) {
  return {
    shopifyOrderId: mirror.shopifyOrderId,
    shopifyOrderName: mirror.shopifyOrderName,
    merchantOrderNo: mirror.merchantOrderNo || null,
    h5Status: mirror.h5Status,
    financialStatus: mirror.financialStatus,
    fulfillmentStatus: mirror.fulfillmentStatus,
    trackingNo: mirror.trackingNo || '',
    title: mirror.title || '',
    amountTwd: mirror.amountTwd,
    beadsSubtotalTwd: mirror.beadsSubtotalTwd ?? null,
    designFeeTwd: mirror.designFeeTwd ?? null,
    shippingTwd: mirror.shippingTwd ?? null,
    wristCm: mirror.wristCm ?? null,
    email: mirror.email || '',
    imageUrl: mirror.imageUrl || '',
    bomDisplay: mirror.bomDisplay || null,
    bom: Array.isArray(mirror.bom) ? mirror.bom : [],
    paymentType: mirror.paymentType || '',
    updatedAt: mirror.updatedAt,
  }
}

/** @param {object} record */
function publicFromCheckoutRecord(record) {
  const detailsMode = String(record.detailsMode || 'normal')
  return {
    merchantOrderNo: record.merchantOrderNo,
    shopifyOrderId: record.shopifyOrderId || null,
    shopifyOrderName: record.shopifyOrderName || null,
    h5Status: record.h5Status || mapNewebpayRecordStatus(record),
    trackingNo: record.trackingNo || '',
    amountTwd: record.amountTwd,
    beadsSubtotalTwd: record.beadsSubtotal ?? null,
    designFeeTwd: record.designFee ?? null,
    shippingTwd: record.shipping ?? null,
    wristCm: record.wristCmNum ?? null,
    title: record.designName || '',
    imageUrl: record.designImageUrl || '',
    bomDisplay:
      detailsMode === 'plaza' || detailsMode === 'plaza-edit' ? 'fee' : 'sku',
    bom: Array.isArray(record.bom) ? record.bom : [],
    paymentType: String(record.newebpay?.paymentType || ''),
    updatedAt: record.shopifyWebhookAt || record.syncedAt || record.paidAt || record.createdAt,
  }
}

/**
 * @param {string} topic
 * @param {any} payload
 * @param {any} env
 */
async function resolveOrderPayload(topic, payload, env) {
  if (!topic.startsWith('orders/') && !topic.startsWith('fulfillments/') && !topic.startsWith('refunds/')) {
    return null
  }

  if (topic.startsWith('orders/')) {
    return payload
  }

  // fulfillments/* / refunds/* — payload may be fulfillment/refund with order_id
  const orderId = payload?.order_id || payload?.order?.id
  if (payload?.order && payload.order.id) return payload.order
  if (!orderId) return payload?.id ? payload : null

  // Prefer reusing last mirror + overlay; fetch Admin order if credentials exist
  const existing = await getShopifyOrderMirror(env, { shopifyOrderId: String(orderId) })
  if (topic.startsWith('fulfillments/')) {
    const tracking = extractTrackingFromFulfillment(payload)
    if (existing) {
      return {
        id: existing.shopifyOrderId,
        name: existing.shopifyOrderName,
        financial_status: existing.financialStatus || 'paid',
        fulfillment_status: payload.status === 'success' ? 'fulfilled' : 'partial',
        tags: existing.tags || '',
        cancelled_at: null,
        note_attributes: [
          { name: 'newebpay_merchant_order_no', value: existing.merchantOrderNo || '' },
          { name: 'pearl_design_name', value: existing.title || '' },
        ],
        fulfillments: tracking ? [{ tracking_number: tracking }] : [],
        total_price: existing.amountTwd,
      }
    }
  }

  return {
    id: orderId,
    name: existing?.shopifyOrderName || '',
    financial_status: existing?.financialStatus || 'paid',
    fulfillment_status: existing?.fulfillmentStatus || null,
    tags: existing?.tags || '',
    cancelled_at: topic.includes('cancelled') ? new Date().toISOString() : null,
    note_attributes: existing?.merchantOrderNo
      ? [{ name: 'newebpay_merchant_order_no', value: existing.merchantOrderNo }]
      : [],
    total_price: existing?.amountTwd,
  }
}

/** @param {any} order */
function readPearlStatusTag(order) {
  const tags = String(order?.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const zhMap = {
    未付款: 'unpaid',
    排單中: 'scheduling',
    设计中: 'designing',
    設計中: 'designing',
    运送中: 'shipping',
    運送中: 'shipping',
    待提貨: 'pickup',
    待提货: 'pickup',
    已完成: 'done',
    已關閉: 'closed',
    已关闭: 'closed',
  }

  for (const t of tags) {
    if (zhMap[t]) return /** @type {H5OrderStatus} */ (zhMap[t])
    const low = t.toLowerCase()
    const m = low.match(/^pearl:(unpaid|scheduling|designing|shipping|pickup|done|closed)$/)
    if (m) return /** @type {H5OrderStatus} */ (m[1])
  }
  return null
}

/** @param {any} order @param {string} name */
function readNoteAttr(order, name) {
  const list = Array.isArray(order?.note_attributes) ? order.note_attributes : []
  const hit = list.find((a) => String(a?.name || '') === name)
  return hit ? String(hit.value || '').trim() : ''
}

/** @param {string} raw */
function normalizeH5Status(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  const allowed = new Set([
    'unpaid',
    'scheduling',
    'designing',
    'shipping',
    'pickup',
    'done',
    'closed',
  ])
  return allowed.has(s) ? /** @type {H5OrderStatus} */ (s) : null
}

/** @param {any} order */
function extractTracking(order) {
  const fulfills = Array.isArray(order?.fulfillments) ? order.fulfillments : []
  for (const f of fulfills) {
    const n = extractTrackingFromFulfillment(f)
    if (n) return n
  }
  return ''
}

/** @param {any} f */
function extractTrackingFromFulfillment(f) {
  if (!f) return ''
  if (f.tracking_number) return String(f.tracking_number)
  const nums = f.tracking_numbers
  if (Array.isArray(nums) && nums[0]) return String(nums[0])
  return ''
}

/** @param {any} order */
function firstLineItemTitle(order) {
  const items = Array.isArray(order?.line_items) ? order.line_items : []
  return items[0]?.title ? String(items[0].title) : ''
}

/** @param {object} record */
function mapNewebpayRecordStatus(record) {
  if (record.h5Status) return record.h5Status
  if (record.status === 'pending') return 'unpaid'
  if (record.status === 'paid' || record.status === 'shopify_synced') return 'scheduling'
  if (record.status === 'shopify_failed') return 'scheduling'
  return 'unpaid'
}

/**
 * @param {string} rawBody
 * @param {string} hmacHeader
 * @param {string} secret
 */
async function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const digest = bufferToBase64(sig)
  return timingSafeEqual(digest, hmacHeader)
}

/** @param {ArrayBuffer} buf */
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** @param {string} a @param {string} b */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
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
      ...cors,
    },
  })
}
