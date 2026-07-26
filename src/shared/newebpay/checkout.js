/**
 * NewebPay MPG checkout from design BOM (replaces Shopify cart checkout).
 * HashKey / HashIV live only on the Cloudflare Worker — never in this H5 bundle.
 */

const FREE_SHIPPING_MIN_TWD = 1000
const STANDARD_SHIPPING_TWD = 50

/**
 * @typedef {{
 *   designName: string,
 *   wristCm: string,
 *   wristCmNum?: number,
 *   beadProductCode?: string,
 *   detailsMode: string,
 *   designId?: string,
 *   plazaPublishId?: string,
 *   designerId?: string,
 *   designFeeTwd?: number,
 *   designImageUrl?: string,
 *   beadsSubtotalTwd?: number,
 *   email?: string,
 *   shippingAddress?: Record<string, unknown> | null,
 * }} CheckoutMeta
 */

export function isNewebpayConfigured() {
  return Boolean(String(import.meta.env.VITE_NEWEBPAY_API_BASE || '').trim())
}

/**
 * @param {Array<{ productId: string, name: string, diameterMm: number, qty: number, unitPrice?: number, lineTotal?: number }>} bom
 * @param {CheckoutMeta} meta
 * @returns {Promise<
 *   | {
 *       ok: true,
 *       paymentReady: true,
 *       gatewayUrl: string,
 *       MerchantID: string,
 *       TradeInfo: string,
 *       TradeSha: string,
 *       Version: string,
 *       merchantOrderNo: string,
 *       amountTwd: number,
 *       shopifyOrderId?: number | string | null,
 *       shopifyOrderName?: string | null,
 *     }
 *   | {
 *       ok: true,
 *       paymentReady: false,
 *       merchantOrderNo: string,
 *       amountTwd: number,
 *       shopifyOrderId?: number | string | null,
 *       shopifyOrderName?: string | null,
 *       paymentError?: string | null,
 *     }
 *   | { ok: false, error: string }
 * >}
 */
export async function createNewebpayCheckout(bom, meta) {
  if (!bom?.length) {
    return { ok: false, error: '設計中沒有珠子，無法下單' }
  }
  const base = String(import.meta.env.VITE_NEWEBPAY_API_BASE || '')
    .trim()
    .replace(/\/$/, '')
  if (!base) {
    return {
      ok: false,
      error: '尚未設定結帳服務（VITE_NEWEBPAY_API_BASE）',
    }
  }

  const beadsSubtotal = resolveBeadsSubtotal(bom, meta)
  const designFee = Math.max(0, Math.round(Number(meta.designFeeTwd) || 0))
  const shipping =
    beadsSubtotal >= FREE_SHIPPING_MIN_TWD ? 0 : STANDARD_SHIPPING_TWD

  try {
    const res = await fetch(`${base}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bom,
        designName: meta.designName || '',
        wristCm: meta.wristCm || '',
        wristCmNum:
          meta.wristCmNum != null && Number.isFinite(Number(meta.wristCmNum))
            ? Number(meta.wristCmNum)
            : undefined,
        beadProductCode: meta.beadProductCode || '',
        detailsMode: meta.detailsMode || 'normal',
        designId: meta.designId || '',
        plazaPublishId: meta.plazaPublishId || '',
        designerId: meta.designerId || '',
        designFeeTwd: designFee,
        beadsSubtotalTwd: beadsSubtotal,
        shippingTwd: shipping,
        designImageUrl: publicDesignImageUrl(meta.designImageUrl || ''),
        recipe: formatRecipe(bom),
        email: meta.email || '',
        shippingAddress: meta.shippingAddress || null,
      }),
    })
    /** @type {any} */
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `結帳服務錯誤（${res.status}）`,
      }
    }

    const amountTwd =
      Number(data.amountTwd) || beadsSubtotal + designFee + shipping
    const baseOrder = {
      merchantOrderNo: data.merchantOrderNo || '',
      amountTwd,
      shopifyOrderId: data.shopifyOrderId ?? null,
      shopifyOrderName: data.shopifyOrderName || null,
      h5Status: data.h5Status || 'unpaid',
    }

    // Shopify 未付款單已建立；藍新參數齊全才導向付款頁。
    if (
      data.paymentReady !== false &&
      data.gatewayUrl &&
      data.TradeInfo &&
      data.TradeSha &&
      data.MerchantID
    ) {
      return {
        ok: true,
        paymentReady: true,
        gatewayUrl: data.gatewayUrl,
        MerchantID: data.MerchantID,
        TradeInfo: data.TradeInfo,
        TradeSha: data.TradeSha,
        Version: data.Version || '2.0',
        ...baseOrder,
      }
    }

    return {
      ok: true,
      paymentReady: false,
      paymentError: data.paymentError || '藍新付款尚未就緒',
      ...baseOrder,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || '網路錯誤')
    return { ok: false, error: `無法連接結帳服務：${msg}` }
  }
}

/**
 * POST hidden form to NewebPay MPG (top-level, breaks out of Shopify iframe).
 * @param {{
 *   gatewayUrl: string,
 *   MerchantID: string,
 *   TradeInfo: string,
 *   TradeSha: string,
 *   Version?: string,
 * }} payload
 */
export function submitNewebpayForm(payload) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = payload.gatewayUrl
  form.acceptCharset = 'UTF-8'
  form.style.display = 'none'
  form.target = '_top'

  /** @type {Record<string, string>} */
  const fields = {
    MerchantID: payload.MerchantID,
    TradeInfo: payload.TradeInfo,
    TradeSha: payload.TradeSha,
    Version: payload.Version || '2.0',
  }
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

/**
 * @param {Array<{ lineTotal?: number, unitPrice?: number, qty: number }>} bom
 * @param {CheckoutMeta} meta
 */
function resolveBeadsSubtotal(bom, meta) {
  if (Number.isFinite(meta.beadsSubtotalTwd)) {
    return Math.max(0, Math.round(Number(meta.beadsSubtotalTwd)))
  }
  return Math.round(
    bom.reduce((sum, row) => {
      if (Number.isFinite(row.lineTotal)) return sum + Number(row.lineTotal)
      return sum + Number(row.unitPrice || 0) * row.qty
    }, 0),
  )
}

/** @param {Array<{ productId: string, name: string, diameterMm: number, qty: number }>} bom */
function formatRecipe(bom) {
  return bom
    .map((r) => `${r.name} ${r.diameterMm}mm×${r.qty}(${r.productId})`)
    .join(', ')
}

/** @param {string} url */
function publicDesignImageUrl(url) {
  const u = String(url || '').trim()
  if (!u) return ''
  if (/^data:/i.test(u)) return ''
  if (/^https?:\/\//i.test(u)) return u
  try {
    const base = new URL(import.meta.env.BASE_URL || '/', window.location.origin)
    // Avoid double-prefix when caller already applied withBase()/BASE_URL.
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
    if (u.startsWith(basePath) || u.startsWith(base.href)) {
      return new URL(u, window.location.origin).href
    }
    return new URL(u.replace(/^\//, ''), base).href
  } catch {
    return u
  }
}
