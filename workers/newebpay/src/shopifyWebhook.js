/**
 * Shopify Admin webhooks → H5「我的訂單」7 狀態鏡像（KV）。
 *
 * Subscribe (Admin → Settings → Notifications → Webhooks, or App webhooks):
 *   orders/create, orders/updated, orders/paid, orders/cancelled,
 *   fulfillments/create, fulfillments/update, refunds/create
 * Endpoint: POST {PUBLIC_API_BASE}/api/webhooks/shopify
 * Secret:   SHOPIFY_WEBHOOK_SECRET (= webhook signing secret)
 */

import { getOrder, putOrder, getShopifyOrderMirror, putShopifyOrderMirror } from './store.js'

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
  await putShopifyOrderMirror(env, mirror)

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
            order: {
              merchantOrderNo: record.merchantOrderNo,
              shopifyOrderId: record.shopifyOrderId || null,
              shopifyOrderName: record.shopifyOrderName || null,
              h5Status: record.h5Status || mapNewebpayRecordStatus(record),
              trackingNo: record.trackingNo || '',
              amountTwd: record.amountTwd,
              title: record.designName || '',
              updatedAt: record.shopifyWebhookAt || record.syncedAt || record.paidAt || record.createdAt,
            },
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
        orders.push({
          merchantOrderNo: record.merchantOrderNo,
          shopifyOrderId: record.shopifyOrderId || null,
          shopifyOrderName: record.shopifyOrderName || null,
          h5Status: record.h5Status || mapNewebpayRecordStatus(record),
          trackingNo: record.trackingNo || '',
          amountTwd: record.amountTwd,
          title: record.designName || '',
          updatedAt: record.shopifyWebhookAt || record.syncedAt || record.paidAt || record.createdAt,
        })
      }
      continue
    }
    orders.push(publicMirror(m))
  }

  return json({ ok: true, orders }, 200, cors)
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
    email: String(order.email || ''),
    topic,
    updatedAt: Date.now(),
    shopifyUpdatedAt: order.updated_at || null,
  }
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
    updatedAt: mirror.updatedAt,
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
