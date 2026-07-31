/**
 * H5「我的訂單」↔ Worker / Shopify status sync.
 */

import { getMemberId, isEmailMemberId } from '../state/userProfileStore.js'
import { canonicalOrderImageUrl } from '../orderImage.js'
import {
  listOrders,
  normalizeStatus,
  orderIdFromKeys,
  patchOrderFromRemote,
  pruneOrdersMissingShopifyId,
  reconcileOrdersForEmail,
  upsertOrder,
} from '../state/ordersStore.js'

/**
 * @typedef {{
 *   shopifyOrderId?: string | null,
 *   shopifyOrderName?: string | null,
 *   merchantOrderNo?: string | null,
 *   h5Status?: string,
 *   trackingNo?: string,
 *   title?: string,
 *   amountTwd?: number,
 *   beadsSubtotalTwd?: number | null,
 *   designFeeTwd?: number | null,
 *   shippingTwd?: number | null,
 *   wristCm?: number | null,
 *   email?: string,
 *   imageUrl?: string,
 *   updatedAt?: number,
 *   bomDisplay?: 'fee' | 'sku',
 *   bom?: Array<{
 *     productId?: string,
 *     name: string,
 *     diameterMm: number,
 *     qty: number,
 *     unitPrice?: number,
 *     lineTotal?: number,
 *   }>,
 *   paymentType?: string,
 * }} RemoteOrder
 */

function apiBase() {
  return String(import.meta.env.VITE_NEWEBPAY_API_BASE || '').trim().replace(/\/$/, '')
}

/**
 * Persist unpaid Shopify order right after checkout create (before NewebPay redirect).
 * @param {{
 *   merchantOrderNo?: string,
 *   shopifyOrderId?: string | number | null,
 *   shopifyOrderName?: string | null,
 *   amountTwd?: number,
 *   h5Status?: string,
 * }} result
 * @param {{
 *   designName?: string,
 *   designImageUrl?: string,
 *   wristCmNum?: number,
 *   wristCm?: string,
 *   beadsSubtotalTwd?: number,
 *   designFeeTwd?: number,
 *   email?: string,
 *   shippingAddress?: Record<string, unknown> | null,
 *   bomDisplay?: 'fee' | 'sku',
 *   bom?: Array<{
 *     productId?: string,
 *     name: string,
 *     diameterMm: number,
 *     qty: number,
 *     unitPrice?: number,
 *     lineTotal?: number,
 *   }>,
 *   plazaPublishId?: string,
 * }} meta
 * @param {{ beadsSubtotal?: number, designFee?: number, shipping?: number }} [breakdown]
 */
export function persistCheckoutOrder(result, meta, breakdown = {}) {
  const shopifyOrderId = result.shopifyOrderId != null ? String(result.shopifyOrderId) : ''
  const merchantOrderNo = String(result.merchantOrderNo || '').trim()
  // Shopify Admin is source of truth — never keep H5-only unpaid ghosts.
  if (!shopifyOrderId || !merchantOrderNo) return null

  const addr = meta.shippingAddress && typeof meta.shippingAddress === 'object' ? meta.shippingAddress : {}
  const shipping =
    breakdown.shipping != null
      ? Number(breakdown.shipping)
      : meta.beadsSubtotalTwd != null && Number(meta.beadsSubtotalTwd) >= 1000
        ? 0
        : 50
  const bomDisplay =
    meta.bomDisplay === 'fee' || meta.bomDisplay === 'sku'
      ? meta.bomDisplay
      : Number(meta.designFeeTwd) > 0
        ? 'fee'
        : 'sku'

  return upsertOrder({
    id: orderIdFromKeys({ shopifyOrderId, merchantOrderNo }),
    title: String(meta.designName || '手鍊設計'),
    status: normalizeStatus(result.h5Status || 'unpaid'),
    amountTwd: Number(result.amountTwd) || 0,
    imageUrl: String(meta.designImageUrl || ''),
    wristCm:
      meta.wristCmNum != null && Number.isFinite(Number(meta.wristCmNum))
        ? Number(meta.wristCmNum)
        : meta.wristCm
          ? Number(meta.wristCm)
          : undefined,
    beadsSubtotalTwd:
      breakdown.beadsSubtotal != null
        ? Number(breakdown.beadsSubtotal)
        : meta.beadsSubtotalTwd,
    designFeeTwd:
      breakdown.designFee != null ? Number(breakdown.designFee) : meta.designFeeTwd,
    shippingTwd: shipping,
    recipientName: String(addr.name || addr.recipientName || ''),
    recipientPhone: String(addr.phone || addr.recipientPhone || ''),
    recipientAddress: formatAddress(addr),
    shopifyOrderId,
    shopifyOrderName: String(result.shopifyOrderName || ''),
    merchantOrderNo,
    email: String(meta.email || '').trim().toLowerCase(),
    bomDisplay,
    bom: Array.isArray(meta.bom) ? meta.bom : [],
    plazaPublishId: String(meta.plazaPublishId || ''),
  })
}

/** @param {Record<string, unknown>} addr */
function formatAddress(addr) {
  const parts = [
    addr.country,
    addr.zip || addr.postal_code,
    addr.province || addr.city,
    addr.district || (addr.province ? addr.city : ''),
    addr.address1 || addr.address || addr.detail,
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
  // Deduplicate adjacent same tokens (e.g. city reused)
  /** @type {string[]} */
  const deduped = []
  for (const p of parts) {
    if (deduped[deduped.length - 1] !== p) deduped.push(p)
  }
  return deduped.join(' ')
}

/**
 * Refresh local orders from Worker (email list + batch status).
 * @returns {Promise<{ ok: boolean, count: number, error?: string }>}
 */
export async function syncOrdersFromServer() {
  const base = apiBase()
  if (!base) return { ok: false, count: 0, error: '未設定結帳服務' }

  // Clear legacy H5-only unpaid rows (created before sync Shopify checkout).
  pruneOrdersMissingShopifyId()

  const email = resolveMemberEmail()
  let remoteCount = 0
  /** @type {string[] | null} */
  let emailListShopifyIds = null
  /** @type {string[] | null} */
  let emailListMerchantNos = null

  if (email) {
    try {
      const res = await fetch(
        `${base}/api/h5/orders?email=${encodeURIComponent(email)}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      )
      /** @type {any} */
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok && Array.isArray(data.orders)) {
        emailListShopifyIds = []
        emailListMerchantNos = []
        for (const remote of data.orders) {
          applyRemoteOrder(remote)
          remoteCount += 1
          const sid = remote.shopifyOrderId != null ? String(remote.shopifyOrderId).trim() : ''
          const mno = remote.merchantOrderNo != null ? String(remote.merchantOrderNo).trim() : ''
          if (sid) emailListShopifyIds.push(sid)
          if (mno) emailListMerchantNos.push(mno)
        }
        // Shopify (via Worker) is source of truth — drop local ghosts for this email.
        reconcileOrdersForEmail(email, {
          shopifyOrderIds: emailListShopifyIds,
          merchantOrderNos: emailListMerchantNos,
        })
      }
    } catch (e) {
      console.warn('[orders-sync] email list failed', e)
    }
  }

  const local = listOrders()
  const shopifyOrderIds = local
    .map((o) => String(o.shopifyOrderId || '').trim())
    .filter(Boolean)
  const merchantOrderNos = local
    .map((o) => String(o.merchantOrderNo || '').trim())
    .filter(Boolean)

  if (shopifyOrderIds.length || merchantOrderNos.length) {
    try {
      const res = await fetch(`${base}/api/h5/order-status/batch`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopifyOrderIds, merchantOrderNos }),
      })
      /** @type {any} */
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok && Array.isArray(data.orders)) {
        for (const remote of data.orders) {
          applyRemoteOrder(remote)
          remoteCount += 1
        }
      }
    } catch (e) {
      console.warn('[orders-sync] batch status failed', e)
    }
  }

  return { ok: true, count: remoteCount }
}

/**
 * Sync a single order (detail page).
 * @param {string} orderId
 */
export async function syncOneOrderFromServer(orderId) {
  const base = apiBase()
  const order = listOrders().find((o) => o.id === orderId)
  if (!base || !order) return null

  const params = new URLSearchParams()
  if (order.shopifyOrderId) params.set('shopifyOrderId', String(order.shopifyOrderId))
  else if (order.merchantOrderNo) params.set('merchantOrderNo', String(order.merchantOrderNo))
  else if (order.shopifyOrderName) params.set('shopifyOrderName', String(order.shopifyOrderName))
  else return null

  try {
    const res = await fetch(`${base}/api/h5/order-status?${params}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    /** @type {any} */
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok || !data.order) return null
    applyRemoteOrder(data.order)
    return listOrders().find((o) => o.id === orderId) || null
  } catch (e) {
    console.warn('[orders-sync] one failed', e)
    return null
  }
}

/** @returns {string} */
function resolveMemberEmail() {
  const mid = getMemberId()
  if (isEmailMemberId(mid)) return mid.trim().toLowerCase()
  return ''
}

/** @param {RemoteOrder} remote */
function applyRemoteOrder(remote) {
  if (!remote || typeof remote !== 'object') return
  const shopifyOrderId = remote.shopifyOrderId != null ? String(remote.shopifyOrderId) : ''
  const merchantOrderNo = remote.merchantOrderNo != null ? String(remote.merchantOrderNo) : ''
  if (!shopifyOrderId && !merchantOrderNo) return

  const id = orderIdFromKeys({ shopifyOrderId, merchantOrderNo })
  const existing = listOrders().find(
    (o) =>
      o.id === id ||
      (shopifyOrderId && String(o.shopifyOrderId || '') === shopifyOrderId) ||
      (merchantOrderNo && String(o.merchantOrderNo || '') === merchantOrderNo),
  )

  if (existing) {
    patchOrderFromRemote(existing.id, {
      status: remote.h5Status,
      trackingNo: remote.trackingNo,
      shopifyOrderId,
      shopifyOrderName: remote.shopifyOrderName || undefined,
      merchantOrderNo,
      title: remote.title,
      amountTwd: remote.amountTwd,
      beadsSubtotalTwd: remote.beadsSubtotalTwd,
      designFeeTwd: remote.designFeeTwd,
      shippingTwd: remote.shippingTwd,
      wristCm: remote.wristCm,
      imageUrl: canonicalOrderImageUrl(remote.imageUrl || ''),
      bomDisplay: remote.bomDisplay,
      bom: remote.bom,
      paymentType: remote.paymentType,
    })
    return
  }

  upsertOrder({
    id,
    title: String(remote.title || '手鍊設計'),
    status: normalizeStatus(remote.h5Status || 'unpaid'),
    amountTwd: Number(remote.amountTwd) || 0,
    createdAt: Number(remote.updatedAt) || Date.now(),
    imageUrl: canonicalOrderImageUrl(remote.imageUrl || ''),
    trackingNo: String(remote.trackingNo || ''),
    beadsSubtotalTwd:
      remote.beadsSubtotalTwd != null ? Number(remote.beadsSubtotalTwd) : undefined,
    designFeeTwd: remote.designFeeTwd != null ? Number(remote.designFeeTwd) : undefined,
    shippingTwd: remote.shippingTwd != null ? Number(remote.shippingTwd) : undefined,
    wristCm: remote.wristCm != null ? Number(remote.wristCm) : undefined,
    shopifyOrderId,
    shopifyOrderName: String(remote.shopifyOrderName || ''),
    merchantOrderNo,
    email: String(remote.email || ''),
    bomDisplay: remote.bomDisplay,
    bom: remote.bom,
    paymentType: remote.paymentType || '',
  })
}
