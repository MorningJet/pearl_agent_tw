/**
 * NewebPay MPG checkout from design BOM (replaces Shopify cart checkout).
 * HashKey / HashIV live only on the Cloudflare Worker — never in this H5 bundle.
 */

import { normalizeAssetUrl } from '../assetUrl.js'

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
    const controller = new AbortController()
    const timeoutMs = 25000
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(`${base}/api/checkout`, {
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
        signal: controller.signal,
      })
    } finally {
      window.clearTimeout(timer)
    }
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
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: '建立訂單逾時，請稍後再試' }
    }
    const msg = e instanceof Error ? e.message : String(e || '網路錯誤')
    return { ok: false, error: `無法連接結帳服務：${msg}` }
  }
}

const CHECKOUT_WINDOW_NAME = 'pearl_newebpay_checkout'

/**
 * DIY iframe / in-app browsers: Cloudflare challenges never finish inside the embed.
 */
function needsCheckoutBreakout() {
  try {
    if (window.self !== window.top) return true
  } catch {
    return true
  }
  const ua = navigator.userAgent || ''
  return /MicroMessenger|Line\/|FBAN|FBAV|Instagram/i.test(ua)
}

/**
 * Open a visible top-level window so Cloudflare Turnstile / JS challenge can render.
 * Must run synchronously inside the click handler (user gesture).
 * @returns {Window | null}
 */
function openCheckoutBreakoutWindow() {
  let win = null
  try {
    win = window.open('about:blank', CHECKOUT_WINDOW_NAME)
  } catch {
    win = null
  }
  if (!win || win.closed) return null

  try {
    win.document.open()
    win.document.write(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>前往付款</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#f7f7f7;color:#292524;padding:1.25rem;text-align:center}
    p{margin:0.4rem 0;font-size:0.95rem;line-height:1.5}
    .muted{color:#78716c;font-size:0.8rem}
  </style>
</head>
<body>
  <div>
    <p>正在前往付款頁…</p>
    <p class="muted">若出現人機驗證，請在本視窗完成驗證後繼續</p>
  </div>
</body>
</html>`)
    win.document.close()
  } catch {
    /* cross-origin or restricted document — form target still works by name */
  }
  try {
    win.focus()
  } catch {
    /* ignore */
  }
  return win
}

/**
 * Start NewebPay checkout by navigating a top-level browsing context to the Worker.
 * Fetching / posting to workers.dev from inside the Shopify iframe hangs on Cloudflare
 * challenges (verification UI never appears). Prefer a named popup opened on click;
 * fall back to `_top` when popups are blocked.
 *
 * @param {Array<{ productId: string, name: string, diameterMm: number, qty: number, unitPrice?: number, lineTotal?: number }>} bom
 * @param {CheckoutMeta} meta
 * @returns {{
 *   ok: true,
 *   mode: 'popup' | 'top' | 'self',
 *   checkoutWindow: Window | null,
 * } | { ok: false, error: string }}
 */
export function startNewebpayCheckoutBrowser(bom, meta) {
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

  const payload = {
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
  }

  /** @type {'popup' | 'top' | 'self'} */
  let mode = 'self'
  /** @type {Window | null} */
  let checkoutWindow = null

  if (needsCheckoutBreakout()) {
    checkoutWindow = openCheckoutBreakoutWindow()
    if (checkoutWindow) {
      mode = 'popup'
    } else {
      // Popup blocked — leave the Shopify iframe so CF can render on the parent tab.
      mode = 'top'
    }
  }

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `${base}/api/checkout-browser`
  form.acceptCharset = 'UTF-8'
  form.style.display = 'none'
  form.target =
    mode === 'popup' ? CHECKOUT_WINDOW_NAME : mode === 'top' ? '_top' : '_self'

  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'payload'
  input.value = JSON.stringify(payload)
  form.appendChild(input)
  document.body.appendChild(form)
  form.submit()
  // Form can be removed after submit queues navigation.
  window.setTimeout(() => {
    try {
      form.remove()
    } catch {
      /* ignore */
    }
  }, 0)

  return { ok: true, mode, checkoutWindow }
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
  if (!u || /^data:/i.test(u)) return ''
  try {
    const pathOrAbs = normalizeAssetUrl(u)
    if (/^https?:\/\//i.test(pathOrAbs)) return pathOrAbs
    return new URL(pathOrAbs, window.location.origin).href
  } catch {
    return u
  }
}
