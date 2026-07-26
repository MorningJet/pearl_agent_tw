/**
 * Create a paid Shopify order via Admin REST API (outside Checkout → no 3P checkout fee).
 */

/**
 * @param {any} env
 * @param {object} record — pending order from KV
 * @param {{ tradeNo?: string, paymentType?: string, payTime?: string, amt?: number|string }} pay
 * @returns {Promise<{ id: number, name: string, adminUrl: string }>}
 */
export async function createPaidShopifyOrder(env, record, pay = {}) {
  const domain = shopDomain(env)
  const token = String(env.SHOPIFY_ADMIN_TOKEN || '').trim()
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  if (!domain || !token) {
    throw new Error('未設定 SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN')
  }

  const amt = Math.round(Number(pay.amt || record.amountTwd) || 0)
  if (amt < 1) throw new Error('訂單金額無效')

  const lineItems = buildLineItems(record)
  if (!lineItems.length) throw new Error('沒有可寫入的商品列')

  const noteParts = [
    `藍新訂單：${record.merchantOrderNo}`,
    pay.tradeNo ? `藍新交易號：${pay.tradeNo}` : '',
    pay.paymentType ? `付款方式：${pay.paymentType}` : '',
    record.designName ? `設計：${record.designName}` : '',
    record.wristCm ? `腕圍 ≈ ${record.wristCm}cm` : '',
    record.recipe ? `配方：${clip(record.recipe, 400)}` : '',
  ].filter(Boolean)

  const noteAttributes = [
    { name: 'newebpay_merchant_order_no', value: String(record.merchantOrderNo || '') },
    { name: 'newebpay_trade_no', value: String(pay.tradeNo || '') },
    { name: 'pearl_design_name', value: String(record.designName || '') },
    { name: 'pearl_wrist_cm', value: String(record.wristCm || '') },
    { name: 'pearl_details_mode', value: String(record.detailsMode || '') },
    { name: 'pearl_design_id', value: String(record.designId || '') },
    { name: 'pearl_plaza_publish_id', value: String(record.plazaPublishId || '') },
    { name: 'pearl_designer_id', value: String(record.designerId || '') },
    { name: 'pearl_beads_subtotal_twd', value: String(record.beadsSubtotal || 0) },
    { name: 'pearl_design_fee_twd', value: String(record.designFee || 0) },
    { name: 'pearl_shipping_twd', value: String(record.shipping || 0) },
  ].filter((a) => a.value)

  /** @type {Record<string, unknown>} */
  const order = {
    email: record.email || undefined,
    currency: 'TWD',
    financial_status: 'paid',
    send_receipt: false,
    send_fulfillment_receipt: false,
    taxes_included: true,
    tags: 'newebpay,pearl-diy,headless',
    note: noteParts.join('\n'),
    note_attributes: noteAttributes,
    line_items: lineItems,
    transactions: [
      {
        kind: 'sale',
        status: 'success',
        amount: amt.toFixed(2),
        currency: 'TWD',
        gateway: 'NewebPay',
        source_name: 'newebpay_mpg',
        authorization: String(pay.tradeNo || record.merchantOrderNo || ''),
      },
    ],
  }

  if (record.shippingAddress && typeof record.shippingAddress === 'object') {
    order.shipping_address = mapAddress(record.shippingAddress)
  }

  const url = `https://${domain}/admin/api/${version}/orders.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Shopify-Access-Token': token,
    },
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
  return {
    first_name: clip(addr.name || addr.first_name || 'Customer', 40),
    phone: clip(addr.phone || '', 20) || undefined,
    address1: clip(
      [addr.city, addr.district, addr.detail].filter(Boolean).join('') ||
        addr.address1 ||
        '',
      120,
    ),
    city: clip(addr.city || '', 40) || undefined,
    province: clip(addr.city || addr.province || '', 40) || undefined,
    country: 'TW',
    country_code: 'TW',
    zip: clip(addr.zip || '', 12) || undefined,
  }
}

/** @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || '')
  return t.length <= n ? t : t.slice(0, n)
}
