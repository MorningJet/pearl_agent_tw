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
 *   detailsMode: string,
 *   designId?: string,
 *   plazaPublishId?: string,
 *   designerId?: string,
 *   designFeeTwd?: number,
 *   designImageUrl?: string,
 *   beadsSubtotalTwd?: number,
 *   email?: string,
 * }} CheckoutMeta
 */

export function isNewebpayConfigured() {
  return Boolean(String(import.meta.env.VITE_NEWEBPAY_API_BASE || '').trim())
}

/**
 * @param {Array<{ productId: string, name: string, diameterMm: number, qty: number, unitPrice?: number, lineTotal?: number }>} bom
 * @param {CheckoutMeta} meta
 * @returns {Promise<
 *   | { ok: true, gatewayUrl: string, MerchantID: string, TradeInfo: string, TradeSha: string, Version: string, merchantOrderNo: string, amountTwd: number }
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
      error: '尚未設定藍新付款服務（VITE_NEWEBPAY_API_BASE）',
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
      }),
    })
    /** @type {any} */
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `付款服務錯誤（${res.status}）`,
      }
    }
    if (!data.gatewayUrl || !data.TradeInfo || !data.TradeSha || !data.MerchantID) {
      return { ok: false, error: '付款服務回傳不完整' }
    }
    return {
      ok: true,
      gatewayUrl: data.gatewayUrl,
      MerchantID: data.MerchantID,
      TradeInfo: data.TradeInfo,
      TradeSha: data.TradeSha,
      Version: data.Version || '2.0',
      merchantOrderNo: data.merchantOrderNo || '',
      amountTwd: Number(data.amountTwd) || beadsSubtotal + designFee + shipping,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || '網路錯誤')
    return { ok: false, error: `無法連接付款服務：${msg}` }
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
    return new URL(u.replace(/^\//, ''), base).href
  } catch {
    return u
  }
}
