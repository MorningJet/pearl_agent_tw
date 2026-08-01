/**
 * NewebPay MPG checkout from design BOM (replaces Shopify cart checkout).
 * HashKey / HashIV live only on the Cloudflare Worker — never in this H5 bundle.
 */

import { normalizeAssetUrl, withBase } from '../assetUrl.js'

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
    const timeoutMs = 45000
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

    // Shopify 未付款單已同步建立；藍新參數齊全才導向付款頁。
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
 * DIY iframe / in-app browsers: Cloudflare challenges & cross-origin fetch
 * often fail inside the embed (Safari reports "Load failed").
 */
export function needsCheckoutBreakout() {
  try {
    if (window.self !== window.top) return true
  } catch {
    return true
  }
  const ua = navigator.userAgent || ''
  // Threads / IG / FB / Line / WeChat / TikTok-style WebViews block or break CORS fetch.
  return /MicroMessenger|Line\/|FBAN|FBAV|Instagram|Threads|Barcelona|BytedanceWebview|musical_ly|TikTok/i.test(
    ua,
  )
}

/**
 * Absolute API base (relative `/newebpay-api` must resolve against the H5 origin).
 * @returns {string}
 */
function newebpayApiBase() {
  const raw = String(import.meta.env.VITE_NEWEBPAY_API_BASE || '')
    .trim()
    .replace(/\/$/, '')
  if (!raw) return ''
  try {
    return new URL(raw, window.location.href).href.replace(/\/$/, '')
  } catch {
    return raw
  }
}

/**
 * Same-origin handoff page (GitHub Pages). Opening workers.dev directly from a
 * Shopify iframe popup often leaves a stuck `about:blank` tab.
 * @returns {string}
 */
function payBridgeUrl() {
  try {
    return new URL(withBase('pay-bridge.html'), window.location.href).href
  } catch {
    return withBase('pay-bridge.html')
  }
}

/**
 * @param {string} actionUrl
 * @param {Record<string, unknown>} payload
 * @param {string} target
 */
function postCheckoutForm(actionUrl, payload, target) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = actionUrl
  form.acceptCharset = 'UTF-8'
  form.style.display = 'none'
  form.target = target

  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'payload'
  input.value = JSON.stringify(payload)
  form.appendChild(input)
  document.body.appendChild(form)
  form.submit()
  window.setTimeout(() => {
    try {
      form.remove()
    } catch {
      /* ignore */
    }
  }, 0)
}

/**
 * Hand payload to same-origin pay-bridge.html until it acknowledges.
 * @param {Window} win
 * @param {string} checkoutAction
 * @param {Record<string, unknown>} payload
 */
function beginSameOriginHandoff(win, checkoutAction, payload) {
  const pageOrigin = window.location.origin
  let done = false
  /** @type {ReturnType<typeof window.setInterval> | null} */
  let timer = null

  const cleanup = () => {
    done = true
    window.removeEventListener('message', onMsg)
    if (timer != null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  const send = () => {
    if (done) return
    try {
      if (!win || win.closed) {
        cleanup()
        return
      }
      win.postMessage(
        {
          type: 'pearl-checkout-payload',
          checkoutAction,
          payload,
        },
        pageOrigin,
      )
    } catch {
      /* ignore */
    }
  }

  /** @param {MessageEvent} e */
  const onMsg = (e) => {
    if (e.origin !== pageOrigin) return
    const type = /** @type {{ type?: string }} */ (e.data || {}).type
    if (type === 'pearl-checkout-bridge-ready') {
      send()
      return
    }
    if (type === 'pearl-checkout-received') {
      cleanup()
    }
  }

  window.addEventListener('message', onMsg)
  send()
  timer = window.setInterval(send, 400)
  window.setTimeout(cleanup, 120000)
}

/**
 * Start NewebPay checkout in a top-level browsing context.
 *
 * Inside Shopify iframe: open same-origin `pay-bridge.html` (avoids stuck
 * about:blank when cross-origin window.open is blocked), postMessage the
 * order, then that page top-level POSTs to the Worker so Cloudflare can render.
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
  const base = newebpayApiBase()
  if (!base) {
    return {
      ok: false,
      error: '尚未設定結帳服務（VITE_NEWEBPAY_API_BASE）',
    }
  }

  try {
    // Validate absolute API URL early.
    void new URL(base)
  } catch {
    return { ok: false, error: '結帳服務網址無效' }
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

  const checkoutAction = `${base}/api/checkout-browser`
  const handoffUrl = payBridgeUrl()

  if (needsCheckoutBreakout()) {
    /** @type {Window | null} */
    let checkoutWindow = null
    try {
      // Same-origin first: cross-origin open from Shopify iframe often stays about:blank.
      checkoutWindow = window.open(handoffUrl, CHECKOUT_WINDOW_NAME)
    } catch {
      checkoutWindow = null
    }

    // Some WebViews return a Window but never navigate — force location once.
    if (checkoutWindow && !checkoutWindow.closed) {
      try {
        if (
          !checkoutWindow.location.href ||
          checkoutWindow.location.href === 'about:blank'
        ) {
          checkoutWindow.location.href = handoffUrl
        }
      } catch {
        /* cross-origin after navigate — fine */
      }
      beginSameOriginHandoff(checkoutWindow, checkoutAction, payload)
      try {
        checkoutWindow.focus()
      } catch {
        /* ignore */
      }
      return { ok: true, mode: 'popup', checkoutWindow }
    }

    // Popup blocked — leave the Shopify page entirely.
    postCheckoutForm(checkoutAction, payload, '_top')
    return { ok: true, mode: 'top', checkoutWindow: null }
  }

  postCheckoutForm(checkoutAction, payload, '_self')
  return { ok: true, mode: 'self', checkoutWindow: null }
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
