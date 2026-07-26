/**
 * Shopify Admin order sync for NewebPay MPG.
 *
 * Flow:
 *   1. Checkout click → createUnpaidShopifyOrder (financial_status: pending, H5: unpaid)
 *   2. NewebPay SUCCESS → markShopifyOrderPaid (transaction + H5: scheduling)
 *
 * Auth (Dev Dashboard apps — preferred):
 *   SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET → client_credentials (token ~24h, auto-refresh)
 * Legacy (admin-created custom apps):
 *   SHOPIFY_ADMIN_TOKEN (static shpat_…)
 */

/** @type {{ token: string, expiresAt: number } | null} */
let cachedToken = null

/**
 * Create an unpaid Shopify order at「立即付款」(before NewebPay redirect).
 * @param {any} env
 * @param {object} record — pending order from KV
 * @returns {Promise<{ id: number, name: string, adminUrl: string }>}
 */
export async function createUnpaidShopifyOrder(env, record) {
  return createShopifyOrder(env, record, {
    financialStatus: 'pending',
    h5Status: 'unpaid',
    pay: null,
  })
}

/**
 * Legacy / fallback: create an already-paid order (when unpaid create was skipped).
 * @param {any} env
 * @param {object} record
 * @param {{ tradeNo?: string, paymentType?: string, payTime?: string, amt?: number|string }} pay
 * @returns {Promise<{ id: number, name: string, adminUrl: string }>}
 */
export async function createPaidShopifyOrder(env, record, pay = {}) {
  return createShopifyOrder(env, record, {
    financialStatus: 'paid',
    h5Status: 'scheduling',
    pay,
  })
}

/**
 * Mark an existing unpaid Shopify order as paid after NewebPay SUCCESS.
 * @param {any} env
 * @param {number|string} shopifyOrderId
 * @param {object} record
 * @param {{ tradeNo?: string, paymentType?: string, payTime?: string, amt?: number|string }} pay
 * @returns {Promise<{ id: number, name: string, adminUrl: string }>}
 */
export async function markShopifyOrderPaid(env, shopifyOrderId, record, pay = {}) {
  const domain = shopDomain(env)
  const token = await getAdminAccessToken(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  const id = String(shopifyOrderId || '').trim()
  if (!domain) throw new Error('未設定 SHOPIFY_STORE_DOMAIN')
  if (!id) throw new Error('缺少 shopifyOrderId')

  const amt = Math.round(Number(pay.amt || record.amountTwd) || 0)
  if (amt < 1) throw new Error('訂單金額無效')

  // 1) Capture payment via sale transaction (moves pending → paid).
  const txUrl = `https://${domain}/admin/api/${version}/orders/${id}/transactions.json`
  const txRes = await fetch(txUrl, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({
      transaction: {
        kind: 'sale',
        status: 'success',
        amount: amt.toFixed(2),
        currency: 'TWD',
        gateway: 'NewebPay',
        source_name: 'newebpay_mpg',
        authorization: String(pay.tradeNo || record.merchantOrderNo || ''),
      },
    }),
  })
  const txText = await txRes.text()
  if (!txRes.ok) {
    // Idempotent: already paid / duplicate transaction — still update H5 status below.
    const soft =
      /already been paid|order is already paid|Transaction error/i.test(txText) ||
      txRes.status === 422
    if (!soft) {
      throw new Error(`Shopify 標記付款失敗（${txRes.status}）：${clip(txText, 400)}`)
    }
    console.warn('[shopify] transaction soft-fail (likely already paid)', clip(txText, 200))
  }

  // 2) Refresh note / tags → 排單中
  const noteParts = buildNoteParts(record, pay)
  const noteAttributes = buildNoteAttributes(record, pay, 'scheduling')
  const putUrl = `https://${domain}/admin/api/${version}/orders/${id}.json`
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify({
      order: {
        id: Number(id) || id,
        tags: 'newebpay,pearl-diy,headless,pearl:scheduling',
        note: noteParts.join('\n'),
        note_attributes: noteAttributes,
      },
    }),
  })
  const putText = await putRes.text()
  /** @type {any} */
  let putJson
  try {
    putJson = JSON.parse(putText)
  } catch {
    throw new Error(`Shopify 更新訂單非 JSON（${putRes.status}）：${clip(putText, 200)}`)
  }
  if (!putRes.ok) {
    const msg =
      putJson?.errors != null
        ? typeof putJson.errors === 'string'
          ? putJson.errors
          : JSON.stringify(putJson.errors)
        : putText
    throw new Error(`Shopify 更新訂單失敗（${putRes.status}）：${clip(String(msg), 400)}`)
  }

  const updated = putJson?.order
  return {
    id: Number(updated?.id || id),
    name: updated?.name || String(updated?.id || id),
    adminUrl: `https://${domain}/admin/orders/${updated?.id || id}`,
  }
}

/**
 * @param {any} env
 * @param {object} record
 * @param {{
 *   financialStatus: 'pending' | 'paid',
 *   h5Status: 'unpaid' | 'scheduling',
 *   pay: { tradeNo?: string, paymentType?: string, payTime?: string, amt?: number|string } | null,
 * }} opts
 */
async function createShopifyOrder(env, record, opts) {
  const domain = shopDomain(env)
  const token = await getAdminAccessToken(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  if (!domain) {
    throw new Error('未設定 SHOPIFY_STORE_DOMAIN')
  }

  const pay = opts.pay || {}
  const amt = Math.round(Number(pay.amt || record.amountTwd) || 0)
  if (amt < 1) throw new Error('訂單金額無效')

  const lineItems = buildLineItems(record)
  if (!lineItems.length) throw new Error('沒有可寫入的商品列')

  const noteParts = buildNoteParts(record, pay)
  const noteAttributes = buildNoteAttributes(record, pay, opts.h5Status)
  const pearlTag = opts.h5Status === 'scheduling' ? 'pearl:scheduling' : 'pearl:unpaid'

  /** @type {Record<string, unknown>} */
  const order = {
    email: record.email || undefined,
    currency: 'TWD',
    financial_status: opts.financialStatus,
    send_receipt: false,
    send_fulfillment_receipt: false,
    taxes_included: true,
    tags: `newebpay,pearl-diy,headless,${pearlTag}`,
    note: noteParts.join('\n'),
    note_attributes: noteAttributes,
    line_items: lineItems,
  }

  if (opts.financialStatus === 'paid') {
    order.transactions = [
      {
        kind: 'sale',
        status: 'success',
        amount: amt.toFixed(2),
        currency: 'TWD',
        gateway: 'NewebPay',
        source_name: 'newebpay_mpg',
        authorization: String(pay.tradeNo || record.merchantOrderNo || ''),
      },
    ]
  }

  if (record.shippingAddress && typeof record.shippingAddress === 'object') {
    order.shipping_address = mapAddress(record.shippingAddress)
  }

  const url = `https://${domain}/admin/api/${version}/orders.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ order }),
  })

  const text = await res.text()
  /** @type {any} */
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Shopify 回應非 JSON（${res.status}）：${clip(text, 200)}`)
  }

  if (!res.ok) {
    const msg =
      json?.errors != null
        ? typeof json.errors === 'string'
          ? json.errors
          : JSON.stringify(json.errors)
        : text
    throw new Error(`Shopify 建單失敗（${res.status}）：${clip(String(msg), 400)}`)
  }

  const created = json?.order
  if (!created?.id) throw new Error('Shopify 未回傳 order.id')

  return {
    id: created.id,
    name: created.name || String(created.id),
    adminUrl: `https://${domain}/admin/orders/${created.id}`,
  }
}

/**
 * Dev Dashboard apps: client_credentials (~24h). Legacy: static SHOPIFY_ADMIN_TOKEN.
 * @param {any} env
 * @returns {Promise<string>}
 */
export async function getAdminAccessToken(env) {
  const staticToken = String(env.SHOPIFY_ADMIN_TOKEN || '').trim()
  const clientId = String(env.SHOPIFY_CLIENT_ID || '').trim()
  const clientSecret = String(env.SHOPIFY_CLIENT_SECRET || '').trim()
  const domain = shopDomain(env)

  if (clientId && clientSecret && domain) {
    const now = Date.now()
    if (cachedToken && cachedToken.expiresAt > now + 60_000) {
      return cachedToken.token
    }
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const text = await res.text()
    /** @type {any} */
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Shopify token 回應非 JSON（${res.status}）：${clip(text, 200)}`)
    }
    if (!res.ok || !data?.access_token) {
      throw new Error(
        `Shopify 換取 access_token 失敗（${res.status}）：${clip(
          JSON.stringify(data),
          300,
        )}`,
      )
    }
    const expiresIn = Number(data.expires_in) || 86399
    cachedToken = {
      token: String(data.access_token),
      expiresAt: now + expiresIn * 1000,
    }
    return cachedToken.token
  }

  if (staticToken) return staticToken

  throw new Error(
    '未設定 Shopify 憑證：請填 SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET（Dev Dashboard），或舊版 SHOPIFY_ADMIN_TOKEN',
  )
}

/**
 * @param {any} env
 */
export function isShopifyAuthConfigured(env) {
  const domain = shopDomain(env)
  if (!domain) return false
  if (String(env.SHOPIFY_ADMIN_TOKEN || '').trim()) return true
  return Boolean(
    String(env.SHOPIFY_CLIENT_ID || '').trim() &&
      String(env.SHOPIFY_CLIENT_SECRET || '').trim(),
  )
}

/**
 * BOM rows map 1:1 to Shopify catalog SKUs (productId = SKU).
 * Custom line items keep price/qty when Admin inventory linking is not required.
 * @param {object} record
 * @returns {Array<{ title: string, price: string, quantity: number, sku?: string, requires_shipping?: boolean, taxable?: boolean }>}
 */
function buildLineItems(record) {
  /** @type {Array<{ title: string, price: string, quantity: number, sku?: string, requires_shipping?: boolean, taxable?: boolean }>} */
  const lines = []
  const bom = Array.isArray(record.bom) ? record.bom : []

  for (const row of bom) {
    const qty = Math.max(1, Math.round(Number(row.qty) || 1))
    let unit = Number(row.unitPrice)
    if (!Number.isFinite(unit) && Number.isFinite(row.lineTotal)) {
      unit = Number(row.lineTotal) / qty
    }
    unit = Math.max(0, Math.round(unit || 0))
    const name = String(row.name || row.productId || '珠款').trim()
    const mm = row.diameterMm != null ? ` ${row.diameterMm}mm` : ''
    lines.push({
      title: clip(`${name}${mm}`, 255),
      price: unit.toFixed(2),
      quantity: qty,
      sku: clip(String(row.productId || ''), 64) || undefined,
      requires_shipping: true,
      taxable: false,
    })
  }

  const fee = Math.max(0, Math.round(Number(record.designFee) || 0))
  if (fee > 0) {
    lines.push({
      title: '設計費用',
      price: fee.toFixed(2),
      quantity: 1,
      sku: 'design_fee',
      requires_shipping: false,
      taxable: false,
    })
  }

  const shipping = Math.max(0, Math.round(Number(record.shipping) || 0))
  if (shipping > 0) {
    lines.push({
      title: '運費',
      price: shipping.toFixed(2),
      quantity: 1,
      sku: 'shipping',
      requires_shipping: false,
      taxable: false,
    })
  }

  return lines
}

/**
 * @param {object} record
 * @param {{ tradeNo?: string, paymentType?: string, payTime?: string }} pay
 */
function buildNoteParts(record, pay = {}) {
  return [
    `藍新訂單：${record.merchantOrderNo}`,
    pay.tradeNo ? `藍新交易號：${pay.tradeNo}` : '',
    pay.paymentType ? `付款方式：${pay.paymentType}` : '',
    record.designName ? `設計：${record.designName}` : '',
    record.wristCm ? `手圍 ≈ ${record.wristCm}cm` : '',
    record.beadProductCode ? `商品編碼：${clip(record.beadProductCode, 400)}` : '',
    record.recipe ? `配方：${clip(record.recipe, 400)}` : '',
  ].filter(Boolean)
}

/**
 * @param {object} record
 * @param {{ tradeNo?: string }} pay
 * @param {'unpaid' | 'scheduling' | string} h5Status
 */
function buildNoteAttributes(record, pay, h5Status) {
  const wristValue =
    record.wristCmNum != null && Number.isFinite(Number(record.wristCmNum))
      ? String(Number(record.wristCmNum))
      : String(record.wristCm || '')

  return [
    { name: 'newebpay_merchant_order_no', value: String(record.merchantOrderNo || '') },
    { name: 'newebpay_trade_no', value: String(pay?.tradeNo || '') },
    { name: 'pearl_h5_status', value: String(h5Status || 'unpaid') },
    { name: 'pearl_design_name', value: String(record.designName || '') },
    { name: 'pearl_wrist_cm', value: wristValue },
    { name: 'pearl_bead_product_code', value: String(record.beadProductCode || '') },
    { name: 'pearl_details_mode', value: String(record.detailsMode || '') },
    { name: 'pearl_design_id', value: String(record.designId || '') },
    { name: 'pearl_plaza_publish_id', value: String(record.plazaPublishId || '') },
    { name: 'pearl_designer_id', value: String(record.designerId || '') },
    { name: 'pearl_beads_subtotal_twd', value: String(record.beadsSubtotal || 0) },
    { name: 'pearl_design_fee_twd', value: String(record.designFee || 0) },
    { name: 'pearl_shipping_twd', value: String(record.shipping || 0) },
    { name: 'pearl_member_email', value: String(record.email || '') },
    { name: 'pearl_payment_status', value: h5Status === 'scheduling' ? 'paid' : 'unpaid' },
  ].filter((a) => a.value)
}

/** @param {string} token */
function adminHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Shopify-Access-Token': token,
  }
}

/** @param {any} env */
function shopDomain(env) {
  return String(env.SHOPIFY_STORE_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}

/**
 * @param {Record<string, string>} addr
 */
function mapAddress(addr) {
  const address1 = clip(
    addr.address1 ||
      [addr.city, addr.district, addr.detail].filter(Boolean).join('') ||
      '',
    120,
  )
  return {
    first_name: clip(addr.name || addr.first_name || 'Customer', 40),
    phone: clip(addr.phone || '', 20) || undefined,
    address1,
    city: clip(addr.city || '', 40) || undefined,
    province: clip(addr.province || addr.city || '', 40) || undefined,
    country: 'Taiwan',
    country_code: clip(addr.country_code || 'TW', 2) || 'TW',
    zip: clip(addr.zip || '', 12) || undefined,
  }
}

/** @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || '')
  return t.length <= n ? t : t.slice(0, n)
}
