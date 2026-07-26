/**
 * Pearl Pearl — NewebPay MPG + Shopify Admin order sync.
 *
 * Flow:
 *   立即付款 → create unpaid Shopify order + NewebPay MPG
 *   支付成功 → mark Shopify paid → H5 排單中 (pearl:scheduling)
 *   支付失敗 → Shopify 維持未付款
 *
 * Secrets (.dev.vars / wrangler secret):
 *   NEWEBPAY_MERCHANT_ID, NEWEBPAY_HASH_KEY, NEWEBPAY_HASH_IV
 *   SHOPIFY_ADMIN_TOKEN / SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET
 *   SHOPIFY_WEBHOOK_SECRET
 * Vars:
 *   NEWEBPAY_ENV, PUBLIC_API_BASE, H5_RETURN_URL, CORS_ORIGINS
 *   SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION
 *   ALLOW_DEV_SIMULATE=1  → enables POST /api/dev/simulate-paid (pre-NewebPay QA)
 * Bindings:
 *   ORDERS (KV) — optional locally (falls back to memory)
 *
 * Shopify order status webhooks:
 *   POST /api/webhooks/shopify
 *   GET  /api/h5/order-status
 *   POST /api/h5/order-status/batch
 *   GET  /api/h5/orders?email=
 *   GET  /api/h5/shipping-address?email=
 *   GET/POST /api/h5/designer-count
 */

import { getOrder, putOrder, getDesignerCount, incrementDesignerCount } from './store.js'
import {
  createPaidShopifyOrder,
  createUnpaidShopifyOrder,
  isShopifyAuthConfigured,
  markShopifyOrderPaid,
} from './shopify.js'
import {
  handleH5OrderStatus,
  handleH5OrderStatusBatch,
  handleH5OrdersByEmail,
  handleH5ShippingAddress,
  handleShopifyWebhook,
  mirrorFromCheckoutRecord,
} from './shopifyWebhook.js'

const GATEWAYS = {
  sandbox: 'https://ccore.newebpay.com/MPG/mpg_gateway',
  production: 'https://core.newebpay.com/MPG/mpg_gateway',
}

const MPG_VERSION = '2.0'
const FREE_SHIPPING_MIN_TWD = 1000
const STANDARD_SHIPPING_TWD = 50

export default {
  /**
   * @param {Request} request
   * @param {any} env
   * @param {ExecutionContext} [ctx]
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      if (url.pathname === '/health') {
        const domain = String(env.SHOPIFY_STORE_DOMAIN || '')
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/$/, '')
        return json(
          {
            ok: true,
            shopifyConfigured: isShopifyAuthConfigured(env),
            shopify: {
              hasDomain: Boolean(domain),
              hasAdminToken: Boolean(String(env.SHOPIFY_ADMIN_TOKEN || '').trim()),
              hasClientId: Boolean(String(env.SHOPIFY_CLIENT_ID || '').trim()),
              hasClientSecret: Boolean(String(env.SHOPIFY_CLIENT_SECRET || '').trim()),
            },
            shopifyWebhookConfigured: Boolean(String(env.SHOPIFY_WEBHOOK_SECRET || '').trim()),
            ordersKv: Boolean(env.ORDERS),
            allowDevSimulate: isDevSimulateEnabled(env),
          },
          200,
          cors,
        )
      }

      if (url.pathname === '/api/webhooks/shopify' && request.method === 'POST') {
        return await handleShopifyWebhook(request, env)
      }

      if (url.pathname === '/api/h5/order-status' && request.method === 'GET') {
        return await handleH5OrderStatus(url, env, cors)
      }

      if (url.pathname === '/api/h5/orders' && request.method === 'GET') {
        return await handleH5OrdersByEmail(url, env, cors)
      }

      if (url.pathname === '/api/h5/shipping-address' && request.method === 'GET') {
        return await handleH5ShippingAddress(url, env, cors)
      }

      if (url.pathname === '/api/h5/designer-count' && request.method === 'GET') {
        const count = await getDesignerCount(env)
        return json({ ok: true, count }, 200, cors)
      }

      if (url.pathname === '/api/h5/designer-count' && request.method === 'POST') {
        const count = await incrementDesignerCount(env)
        return json({ ok: true, count }, 200, cors)
      }

      if (url.pathname === '/api/h5/order-status/batch' && request.method === 'POST') {
        return await handleH5OrderStatusBatch(request, env, cors)
      }

      if (url.pathname === '/api/checkout' && request.method === 'POST') {
        return await handleCheckout(request, env, cors, ctx)
      }

      if (url.pathname === '/api/notify' && request.method === 'POST') {
        return await handleNotify(request, env)
      }

      if (
        (url.pathname === '/api/return' || url.pathname === '/api/return/') &&
        (request.method === 'GET' || request.method === 'POST')
      ) {
        return await handleReturn(request, env)
      }

      const orderMatch = url.pathname.match(/^\/api\/order\/([^/]+)\/?$/)
      if (orderMatch && request.method === 'GET') {
        const record = await getOrder(env, decodeURIComponent(orderMatch[1]))
        if (!record) return json({ ok: false, error: '找不到訂單' }, 404, cors)
        return json({ ok: true, order: publicOrderView(record) }, 200, cors)
      }

      if (url.pathname === '/api/dev/simulate-paid' && request.method === 'POST') {
        return await handleSimulatePaid(request, env, cors)
      }

      if (url.pathname === '/api/admin/retry-sync' && request.method === 'POST') {
        return await handleRetrySync(request, env, cors)
      }

      return json({ ok: false, error: 'Not found' }, 404, cors)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[newebpay]', msg)
      return json({ ok: false, error: msg }, 500, cors)
    }
  },
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {Record<string, string>} cors
 * @param {ExecutionContext} [ctx]
 */
async function handleCheckout(request, env, cors, ctx) {
  /** @type {any} */
  const body = await request.json()
  const bom = Array.isArray(body?.bom) ? body.bom : []
  if (!bom.length) {
    return json({ ok: false, error: '設計中沒有珠子，無法下單' }, 400, cors)
  }

  const beadsSubtotal = Math.max(
    0,
    Math.round(Number(body?.beadsSubtotalTwd) || sumBom(bom)),
  )
  const designFee = Math.max(0, Math.round(Number(body?.designFeeTwd) || 0))
  const shipping =
    beadsSubtotal >= FREE_SHIPPING_MIN_TWD ? 0 : STANDARD_SHIPPING_TWD
  const amt = beadsSubtotal + designFee + shipping
  if (amt < 1) {
    return json({ ok: false, error: '金額無效' }, 400, cors)
  }

  const designName = clip(String(body?.designName || '手鍊設計'), 40)
  const merchantOrderNo = makeOrderNo()

  const email =
    clip(String(body?.email || env.NEWEBPAY_DEFAULT_EMAIL || ''), 50) ||
    'buyer@pearl-diy.local'
  const recipe = clip(String(body?.recipe || formatRecipe(bom)), 500)
  const beadProductCode = clip(String(body?.beadProductCode || ''), 2000)
  const wristCmRaw = body?.wristCmNum != null ? body.wristCmNum : body?.wristCm
  const wristCmNum = Number(wristCmRaw)
  const wristCm = Number.isFinite(wristCmNum)
    ? String(Math.round(wristCmNum * 10) / 10)
    : clip(String(body?.wristCm || ''), 32)

  /** @type {object} */
  const record = {
    merchantOrderNo,
    status: 'pending',
    h5Status: 'unpaid',
    amountTwd: amt,
    beadsSubtotal,
    designFee,
    shipping,
    designName,
    wristCm,
    wristCmNum: Number.isFinite(wristCmNum) ? wristCmNum : null,
    beadProductCode,
    detailsMode: clip(String(body?.detailsMode || 'normal'), 32),
    designId: clip(String(body?.designId || ''), 64),
    plazaPublishId: clip(String(body?.plazaPublishId || ''), 64),
    designerId: clip(String(body?.designerId || ''), 64),
    designImageUrl: clip(String(body?.designImageUrl || ''), 500),
    recipe,
    email,
    bom: bom.map((row) => ({
      productId: String(row.productId || ''),
      name: String(row.name || ''),
      diameterMm: Number(row.diameterMm) || 0,
      qty: Math.max(1, Math.round(Number(row.qty) || 1)),
      unitPrice: Number(row.unitPrice) || 0,
      lineTotal: Number(row.lineTotal) || 0,
    })),
    shippingAddress: body?.shippingAddress || null,
    createdAt: Date.now(),
    shopifyOrderId: null,
    shopifyOrderName: null,
    shopifyError: null,
    newebpay: null,
  }

  if (!isShopifyAuthConfigured(env)) {
    return json(
      {
        ok: false,
        error:
          '未設定 Shopify 憑證（SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET，或舊版 SHOPIFY_ADMIN_TOKEN）',
      },
      500,
      cors,
    )
  }

  // Shopify 建單與藍新參數並行，縮短「建立訂單…」等待。
  /** @type {Awaited<ReturnType<typeof createUnpaidShopifyOrder>> | null} */
  let created = null
  /** @type {string | null} */
  let paymentError = null
  /** @type {Record<string, unknown> | null} */
  let paymentPayload = null

  const shopifyPromise = createUnpaidShopifyOrder(env, record, {
    waitUntil: ctx?.waitUntil?.bind(ctx),
  })
  const paymentPromise = prepareNewebpayPayload(env, {
    merchantOrderNo,
    amt,
    designName,
    email,
  })

  const [shopifyResult, paymentResult] = await Promise.allSettled([
    shopifyPromise,
    paymentPromise,
  ])

  if (shopifyResult.status === 'rejected') {
    const msg =
      shopifyResult.reason instanceof Error
        ? shopifyResult.reason.message
        : String(shopifyResult.reason)
    console.error('[shopify] unpaid create failed', msg)
    return json(
      { ok: false, error: `Shopify 建立未付款訂單失敗：${msg}` },
      502,
      cors,
    )
  }

  created = shopifyResult.value
  record.shopifyOrderId = created.id
  record.shopifyOrderName = created.name
  record.shopifyAdminUrl = created.adminUrl
  record.shopifyError = null
  record.h5Status = 'unpaid'
  console.log('[shopify] unpaid order created', created)

  if (paymentResult.status === 'fulfilled') {
    paymentPayload = paymentResult.value
  } else {
    paymentError =
      paymentResult.reason instanceof Error
        ? paymentResult.reason.message
        : String(paymentResult.reason)
    console.warn('[newebpay] payment prepare failed (Shopify unpaid kept)', paymentError)
  }

  await putOrder(env, merchantOrderNo, record)

  const mirrorTask = mirrorFromCheckoutRecord(env, record, 'checkout/unpaid').catch((e) => {
    console.warn('[shopify] mirror unpaid failed', e instanceof Error ? e.message : e)
  })
  if (typeof ctx?.waitUntil === 'function') {
    ctx.waitUntil(mirrorTask)
  } else {
    await mirrorTask
  }

  console.log('[newebpay] checkout', {
    merchantOrderNo,
    amt,
    beadsSubtotal,
    designFee,
    shipping,
    shopifyOrderId: record.shopifyOrderId,
    paymentReady: Boolean(paymentPayload),
  })

  return json(
    {
      ok: true,
      merchantOrderNo,
      amountTwd: amt,
      breakdown: { beadsSubtotal, designFee, shipping },
      shopifyOrderId: record.shopifyOrderId,
      shopifyOrderName: record.shopifyOrderName,
      h5Status: record.h5Status || 'unpaid',
      paymentReady: Boolean(paymentPayload),
      paymentError,
      ...(paymentPayload || {}),
    },
    200,
    cors,
  )
}

/**
 * Build NewebPay MPG fields (independent of Shopify order id).
 * @param {any} env
 * @param {{ merchantOrderNo: string, amt: number, designName: string, email: string }} input
 */
async function prepareNewebpayPayload(env, input) {
  assertNewebpaySecrets(env)
  const publicBase = String(env.PUBLIC_API_BASE || '').replace(/\/$/, '')
  if (!publicBase) {
    throw new Error('伺服器未設定 PUBLIC_API_BASE（Notify/Return 需要公網網址）')
  }

  const tradePlain = {
    MerchantID: env.NEWEBPAY_MERCHANT_ID,
    RespondType: 'JSON',
    TimeStamp: String(Math.floor(Date.now() / 1000)),
    Version: MPG_VERSION,
    MerchantOrderNo: input.merchantOrderNo,
    Amt: String(input.amt),
    ItemDesc: clip(`Pearl Pearl｜${input.designName}`, 50),
    Email: input.email,
    ReturnURL: `${publicBase}/api/return`,
    NotifyURL: `${publicBase}/api/notify`,
    ClientBackURL: String(env.H5_RETURN_URL || publicBase),
    CREDIT: '1',
    VACC: '1',
    CVS: '1',
    LINEPAY: '1',
  }

  const tradeInfo = await encryptTradeInfo(tradePlain, env)
  const tradeSha = await tradeShaOf(tradeInfo, env)
  const envName = String(env.NEWEBPAY_ENV || 'sandbox').toLowerCase()
  const gatewayUrl = GATEWAYS[envName] || GATEWAYS.sandbox

  return {
    gatewayUrl,
    MerchantID: env.NEWEBPAY_MERCHANT_ID,
    TradeInfo: tradeInfo,
    TradeSha: tradeSha,
    Version: MPG_VERSION,
  }
}

/**
 * @param {Request} request
 * @param {any} env
 */
async function handleNotify(request, env) {
  assertNewebpaySecrets(env)
  const form = await request.formData()
  const tradeInfo = String(form.get('TradeInfo') || '')
  const tradeSha = String(form.get('TradeSha') || '')
  if (!tradeInfo || !tradeSha) {
    return new Response('MISSING', { status: 400 })
  }

  const expectSha = await tradeShaOf(tradeInfo, env)
  if (expectSha !== tradeSha.toUpperCase()) {
    console.error('[newebpay] notify bad sha')
    return new Response('FAIL', { status: 400 })
  }

  const raw = await decryptTradeInfo(tradeInfo, env)
  /** @type {any} */
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    console.error('[newebpay] notify bad json', raw)
    return new Response('FAIL', { status: 400 })
  }

  const result = payload?.Result || {}
  const merchantOrderNo = String(result.MerchantOrderNo || '')
  const status = String(payload?.Status || '')

  console.log('[newebpay] notify', {
    Status: status,
    MerchantOrderNo: merchantOrderNo,
    TradeNo: result.TradeNo,
    Amt: result.Amt,
    PaymentType: result.PaymentType,
  })

  if (status === 'SUCCESS' && merchantOrderNo) {
    await markPaidAndSyncShopify(env, merchantOrderNo, {
      tradeNo: String(result.TradeNo || ''),
      paymentType: String(result.PaymentType || ''),
      payTime: String(result.PayTime || ''),
      amt: result.Amt,
    })
  }

  // Always OK after valid signature so NewebPay stops retrying.
  return new Response('OK', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Dev-only: pretend NewebPay paid (for Shopify sync QA before merchant approval).
 * @param {Request} request
 * @param {any} env
 * @param {Record<string, string>} cors
 */
async function handleSimulatePaid(request, env, cors) {
  if (!isDevSimulateEnabled(env)) {
    return json({ ok: false, error: 'DEV simulate 未開啟' }, 403, cors)
  }
  /** @type {any} */
  const body = await request.json().catch(() => ({}))
  const merchantOrderNo = String(body?.merchantOrderNo || '').trim()
  if (!merchantOrderNo) {
    return json({ ok: false, error: '缺少 merchantOrderNo' }, 400, cors)
  }
  const synced = await markPaidAndSyncShopify(env, merchantOrderNo, {
    tradeNo: `SIM-${Date.now()}`,
    paymentType: 'SIMULATE',
    payTime: new Date().toISOString(),
    amt: body?.amt,
  })
  return json({ ok: true, order: publicOrderView(synced) }, 200, cors)
}

/**
 * Retry Shopify sync for a paid order that failed earlier.
 * @param {Request} request
 * @param {any} env
 * @param {Record<string, string>} cors
 */
async function handleRetrySync(request, env, cors) {
  const secret = String(env.ADMIN_SYNC_SECRET || '').trim()
  if (secret) {
    const got = request.headers.get('X-Admin-Sync-Secret') || ''
    if (got !== secret) {
      return json({ ok: false, error: '未授權' }, 401, cors)
    }
  } else if (!isDevSimulateEnabled(env)) {
    return json(
      { ok: false, error: '請設定 ADMIN_SYNC_SECRET 或 ALLOW_DEV_SIMULATE' },
      403,
      cors,
    )
  }

  /** @type {any} */
  const body = await request.json().catch(() => ({}))
  const merchantOrderNo = String(body?.merchantOrderNo || '').trim()
  if (!merchantOrderNo) {
    return json({ ok: false, error: '缺少 merchantOrderNo' }, 400, cors)
  }
  const record = await getOrder(env, merchantOrderNo)
  if (!record) return json({ ok: false, error: '找不到訂單' }, 404, cors)
  if (record.status === 'shopify_synced' && record.h5Status === 'scheduling') {
    return json({ ok: true, order: publicOrderView(record), skipped: true }, 200, cors)
  }
  if (
    record.status !== 'paid' &&
    record.status !== 'shopify_failed' &&
    record.status !== 'shopify_synced'
  ) {
    return json(
      { ok: false, error: `訂單狀態不可重試：${record.status}` },
      400,
      cors,
    )
  }
  const synced = await syncShopifyFromRecord(env, record, record.newebpay || {})
  return json({ ok: true, order: publicOrderView(synced) }, 200, cors)
}

/**
 * @param {any} env
 * @param {string} merchantOrderNo
 * @param {{ tradeNo?: string, paymentType?: string, payTime?: string, amt?: number|string }} pay
 */
async function markPaidAndSyncShopify(env, merchantOrderNo, pay) {
  let record = await getOrder(env, merchantOrderNo)
  if (!record) {
    console.error('[newebpay] paid but no pending record', merchantOrderNo)
    record = {
      merchantOrderNo,
      status: 'paid',
      h5Status: 'unpaid',
      amountTwd: Math.round(Number(pay.amt) || 0),
      beadsSubtotal: 0,
      designFee: 0,
      shipping: 0,
      designName: '未知設計',
      bom: [],
      email: '',
      createdAt: Date.now(),
      shopifyOrderId: null,
      shopifyError: 'checkout record missing',
      newebpay: pay,
    }
    await putOrder(env, merchantOrderNo, record)
  }

  // Already marked paid + Shopify updated → idempotent.
  if (record.status === 'shopify_synced' && record.h5Status === 'scheduling') {
    return record
  }

  const paidAmt = Math.round(Number(pay.amt != null ? pay.amt : record.amountTwd) || 0)
  if (paidAmt && record.amountTwd && paidAmt !== record.amountTwd) {
    console.warn('[newebpay] amount mismatch', {
      expected: record.amountTwd,
      paid: paidAmt,
      merchantOrderNo,
    })
  }

  record.status = 'paid'
  record.newebpay = {
    tradeNo: pay.tradeNo || '',
    paymentType: pay.paymentType || '',
    payTime: pay.payTime || '',
    amt: paidAmt || record.amountTwd,
  }
  record.paidAt = Date.now()
  await putOrder(env, merchantOrderNo, record)

  return syncShopifyFromRecord(env, record, record.newebpay)
}

/**
 * After NewebPay SUCCESS: mark existing unpaid Shopify order paid → 排單中.
 * Fallback: create paid order if unpaid create was skipped (legacy / no auth at checkout).
 * @param {any} env
 * @param {object} record
 * @param {object} pay
 */
async function syncShopifyFromRecord(env, record, pay) {
  if (!isShopifyAuthConfigured(env)) {
    record.status = 'shopify_failed'
    record.shopifyError =
      '未設定 Shopify 憑證（SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET，或舊版 SHOPIFY_ADMIN_TOKEN）'
    await putOrder(env, record.merchantOrderNo, record)
    console.error('[shopify]', record.shopifyError)
    return record
  }

  try {
    if (record.shopifyOrderId) {
      const updated = await markShopifyOrderPaid(env, record.shopifyOrderId, record, pay)
      record.shopifyOrderName = updated.name || record.shopifyOrderName
      record.shopifyAdminUrl = updated.adminUrl || record.shopifyAdminUrl
      record.h5Status = 'scheduling'
      record.shopifyError = null
      record.status = 'shopify_synced'
      record.syncedAt = Date.now()
      await putOrder(env, record.merchantOrderNo, record)
      try {
        await mirrorFromCheckoutRecord(env, record, 'newebpay/paid')
      } catch (e) {
        console.warn('[shopify] mirror paid failed', e instanceof Error ? e.message : e)
      }
      console.log('[shopify] order marked paid → scheduling', updated)
    } else {
      const created = await createPaidShopifyOrder(env, record, pay)
      record.shopifyOrderId = created.id
      record.shopifyOrderName = created.name
      record.shopifyAdminUrl = created.adminUrl
      record.h5Status = 'scheduling'
      record.shopifyError = null
      record.status = 'shopify_synced'
      record.syncedAt = Date.now()
      await putOrder(env, record.merchantOrderNo, record)
      try {
        await mirrorFromCheckoutRecord(env, record, 'newebpay/paid-create')
      } catch (e) {
        console.warn('[shopify] mirror paid-create failed', e instanceof Error ? e.message : e)
      }
      console.log('[shopify] paid order created (fallback)', created)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    record.status = 'shopify_failed'
    record.shopifyError = msg
    await putOrder(env, record.merchantOrderNo, record)
    console.error('[shopify] sync failed', msg)
  }
  return record
}

/**
 * @param {Request} request
 * @param {any} env
 */
async function handleReturn(request, env) {
  const h5 = String(env.H5_RETURN_URL || '/').trim() || '/'
  let status = 'unknown'
  let orderNo = ''
  let amt = ''
  let shopifyName = ''

  try {
    assertNewebpaySecrets(env)
    let tradeInfo = ''
    let tradeSha = ''
    if (request.method === 'POST') {
      const form = await request.formData()
      tradeInfo = String(form.get('TradeInfo') || '')
      tradeSha = String(form.get('TradeSha') || '')
    } else {
      const url = new URL(request.url)
      tradeInfo = url.searchParams.get('TradeInfo') || ''
      tradeSha = url.searchParams.get('TradeSha') || ''
    }
    if (tradeInfo && tradeSha) {
      const expectSha = await tradeShaOf(tradeInfo, env)
      if (expectSha === tradeSha.toUpperCase()) {
        const raw = await decryptTradeInfo(tradeInfo, env)
        const payload = JSON.parse(raw)
        status = payload?.Status === 'SUCCESS' ? 'success' : 'failed'
        orderNo = String(payload?.Result?.MerchantOrderNo || '')
        amt = String(payload?.Result?.Amt || '')
        if (status === 'success' && orderNo) {
          // Best-effort sync if notify is slow (idempotent).
          const synced = await markPaidAndSyncShopify(env, orderNo, {
            tradeNo: String(payload?.Result?.TradeNo || ''),
            paymentType: String(payload?.Result?.PaymentType || ''),
            payTime: String(payload?.Result?.PayTime || ''),
            amt: payload?.Result?.Amt,
          })
          shopifyName = synced?.shopifyOrderName || ''
        }
      } else {
        status = 'bad_signature'
      }
    }
  } catch (e) {
    console.error('[newebpay] return', e)
    status = 'error'
  }

  let redirectTo = h5
  try {
    if (/^https?:\/\//i.test(h5)) {
      const u = new URL(h5)
      u.searchParams.set('pay', status)
      if (orderNo) u.searchParams.set('order', orderNo)
      if (amt) u.searchParams.set('amt', amt)
      if (shopifyName) u.searchParams.set('shopify', shopifyName)
      redirectTo = u.toString()
    }
  } catch {
    /* keep h5 */
  }

  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>付款結果</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafaf9;color:#1c1917}
.card{max-width:22rem;padding:1.5rem;background:#fff;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
a{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;background:#1c1917;color:#fff;border-radius:999px;text-decoration:none;font-size:.875rem}</style></head>
<body><div class="card"><h1 style="font-size:1.125rem;margin:0 0 .5rem">${
    status === 'success' ? '付款成功' : '付款結束'
  }</h1>
<p style="margin:0;font-size:.875rem;color:#78716c">${
    status === 'success'
      ? `訂單 ${escapeHtml(orderNo)}${
          shopifyName ? `｜Shopify ${escapeHtml(shopifyName)}` : ''
        }｜NT$${escapeHtml(amt)}`
      : '若已扣款，請稍後在訂單列表確認，或聯繫客服。'
  }</p>
<a href="${escapeHtml(redirectTo)}">返回商店</a>
<script>setTimeout(function(){location.replace(${JSON.stringify(
    redirectTo,
  )})},1600)</script>
</div></body></html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** @param {object} record */
function publicOrderView(record) {
  return {
    merchantOrderNo: record.merchantOrderNo,
    status: record.status,
    h5Status: record.h5Status || null,
    amountTwd: record.amountTwd,
    beadsSubtotal: record.beadsSubtotal,
    designFee: record.designFee,
    shipping: record.shipping,
    designName: record.designName,
    shopifyOrderId: record.shopifyOrderId,
    shopifyOrderName: record.shopifyOrderName,
    shopifyAdminUrl: record.shopifyAdminUrl,
    shopifyError: record.shopifyError,
    trackingNo: record.trackingNo || '',
    newebpay: record.newebpay,
    createdAt: record.createdAt,
    paidAt: record.paidAt,
    syncedAt: record.syncedAt,
  }
}

/** @param {any} env */
function isDevSimulateEnabled(env) {
  return String(env.ALLOW_DEV_SIMULATE || '') === '1'
}

/** @param {any} env */
function shopDomain(env) {
  return String(env.SHOPIFY_STORE_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}

/** @param {any} env */
function assertNewebpaySecrets(env) {
  if (!env.NEWEBPAY_MERCHANT_ID || !env.NEWEBPAY_HASH_KEY || !env.NEWEBPAY_HASH_IV) {
    throw new Error('缺少 NEWEBPAY_MERCHANT_ID / HASH_KEY / HASH_IV')
  }
}

/**
 * @param {Record<string, string>} fields
 * @param {any} env
 */
async function encryptTradeInfo(fields, env) {
  const query = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const key = await importAesKey(env.NEWEBPAY_HASH_KEY)
  const iv = te().encode(env.NEWEBPAY_HASH_IV)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    te().encode(query),
  )
  return bufferToHex(encrypted)
}

/**
 * @param {string} tradeInfoHex
 * @param {any} env
 */
async function decryptTradeInfo(tradeInfoHex, env) {
  const key = await importAesKey(env.NEWEBPAY_HASH_KEY)
  const iv = te().encode(env.NEWEBPAY_HASH_IV)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    key,
    hexToBuffer(tradeInfoHex),
  )
  return td().decode(decrypted)
}

/**
 * @param {string} tradeInfo
 * @param {any} env
 */
async function tradeShaOf(tradeInfo, env) {
  const raw = `HashKey=${env.NEWEBPAY_HASH_KEY}&${tradeInfo}&HashIV=${env.NEWEBPAY_HASH_IV}`
  const digest = await crypto.subtle.digest('SHA-256', te().encode(raw))
  return bufferToHex(digest).toUpperCase()
}

/** @param {string} hashKey */
async function importAesKey(hashKey) {
  return crypto.subtle.importKey(
    'raw',
    te().encode(hashKey),
    { name: 'AES-CBC' },
    false,
    ['encrypt', 'decrypt'],
  )
}

function makeOrderNo() {
  const t = Date.now().toString(36).toUpperCase()
  const r = Math.random().toString(36).slice(2, 8).toUpperCase()
  return clip(`P${t}${r}`, 30)
}

/** @param {Array<{ lineTotal?: number, unitPrice?: number, qty: number }>} bom */
function sumBom(bom) {
  return Math.round(
    bom.reduce((sum, row) => {
      if (Number.isFinite(row.lineTotal)) return sum + Number(row.lineTotal)
      return sum + Number(row.unitPrice || 0) * Number(row.qty || 0)
    }, 0),
  )
}

/** @param {Array<{ name?: string, diameterMm?: number, qty?: number, productId?: string }>} bom */
function formatRecipe(bom) {
  return bom
    .map(
      (r) =>
        `${r.name || ''} ${r.diameterMm || ''}mm×${r.qty || 0}(${r.productId || ''})`,
    )
    .join(', ')
}

/** @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || '')
  return t.length <= n ? t : t.slice(0, n)
}

function te() {
  return new TextEncoder()
}
function td() {
  return new TextDecoder()
}

/** @param {ArrayBuffer} buf */
function bufferToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** @param {string} hex */
function hexToBuffer(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out.buffer
}

/**
 * @param {Request} request
 * @param {any} env
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allow = String(env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  let value = '*'
  if (allow.includes('*')) value = origin || '*'
  else if (origin && allow.includes(origin)) value = origin
  else if (allow[0] && allow[0] !== '*') value = allow[0]

  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Sync-Secret',
    'Access-Control-Max-Age': '86400',
  }
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

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
