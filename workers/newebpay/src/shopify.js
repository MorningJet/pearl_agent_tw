/**
 * Shopify Admin order sync for NewebPay MPG.
 *
 * H5 → Shopify field mapping (Admin 訂單列表):
 *   備註 note     → 藍新訂單號、手圍、商品編碼（順時針編號，每顆一行）
 *   客戶 email    → 會員 email
 *   總計          → 與藍新一致（BOM 珠款 + 設計費 + 運費）
 *   商品 line_items → H5 BOM 對應後台產品（SKU=productId → variant_id）；另含設計費/運費
 *   支付狀態      → pending（待付款）→ 藍新成功後 paid
 *   發貨狀態      → 未發貨（預設）；後台上傳物流單號後變更
 *   標記 tags     → H5「我的訂單」狀態中文（起初「未付款」）
 *
 * Auth: SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET 或 SHOPIFY_ADMIN_TOKEN
 */

/** @type {{ token: string, expiresAt: number } | null} */
let cachedToken = null

/** H5 status → Shopify tag（與「我的訂單」文案一致） */
const H5_STATUS_TAG = {
  unpaid: '未付款',
  scheduling: '排單中',
  designing: '設計中',
  shipping: '運送中',
  pickup: '待提貨',
  done: '已完成',
  closed: '已關閉',
}

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
        tags: buildTags('scheduling'),
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

  const lineItems = await buildLineItems(env, record, amt)
  if (!lineItems.length) throw new Error('沒有可寫入的商品列')

  const noteParts = buildNoteParts(record, pay)
  const noteAttributes = buildNoteAttributes(record, pay, opts.h5Status)

  /** @type {Record<string, unknown>} */
  const order = {
    email: record.email || undefined,
    currency: 'TWD',
    financial_status: opts.financialStatus,
    send_receipt: false,
    send_fulfillment_receipt: false,
    taxes_included: true,
    tags: buildTags(opts.h5Status),
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
 * H5 BOM → Shopify line items（與後台產品嚴格對應）.
 * Prefer variant_id resolved by catalog SKU (= H5 productId); fall back to custom line with same SKU.
 * @param {any} env
 * @param {object} record
 * @param {number} amt — NewebPay total (sanity-check)
 */
async function buildLineItems(env, record, amt) {
  /** @type {Array<Record<string, unknown>>} */
  const lines = []
  const bom = Array.isArray(record.bom) ? record.bom : []

  /** @type {string[]} */
  const skus = []
  for (const row of bom) {
    const sku = String(row.productId || '').trim()
    if (sku) skus.push(sku)
  }

  const fee = Math.max(0, Math.round(Number(record.designFee) || 0))
  const shipping = Math.max(0, Math.round(Number(record.shipping) || 0))

  const variantBySku = await resolveVariantIdsBySkus(env, skus)
  const designFeeVariantId = fee > 0 ? await resolveDesignFeeVariantId(env) : null

  for (const row of bom) {
    const qty = Math.max(1, Math.round(Number(row.qty) || 1))
    let unit = Number(row.unitPrice)
    if (!Number.isFinite(unit) && Number.isFinite(row.lineTotal)) {
      unit = Number(row.lineTotal) / qty
    }
    unit = Math.max(0, Math.round(unit || 0))
    const sku = clip(String(row.productId || ''), 64)
    const name = String(row.name || sku || '珠款').trim()
    const mm = row.diameterMm != null ? ` ${row.diameterMm}mm` : ''
    const variantId = sku ? variantBySku.get(sku) : null

    if (variantId) {
      lines.push({
        variant_id: Number(variantId),
        quantity: qty,
        price: unit.toFixed(2),
        requires_shipping: true,
        taxable: false,
      })
    } else {
      lines.push({
        title: clip(`${name}${mm}`, 255),
        price: unit.toFixed(2),
        quantity: qty,
        sku: sku || undefined,
        requires_shipping: true,
        taxable: false,
      })
      if (sku) {
        console.warn('[shopify] no variant for SKU, using custom line', sku)
      }
    }
  }

  if (fee > 0) {
    if (designFeeVariantId) {
      lines.push({
        variant_id: Number(designFeeVariantId),
        quantity: 1,
        price: fee.toFixed(2),
        requires_shipping: false,
        taxable: false,
      })
    } else {
      lines.push({
        title: '設計費用',
        price: fee.toFixed(2),
        quantity: 1,
        sku: 'design_fee',
        requires_shipping: false,
        taxable: false,
      })
    }
  }

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

  const sum = lines.reduce(
    (s, li) => s + Math.round(Number(li.price) * Number(li.quantity || 1)),
    0,
  )
  if (amt > 0 && sum > 0 && Math.abs(sum - amt) > 1) {
    console.warn('[shopify] line sum vs NewebPay amt', { sum, amt })
  }

  return lines
}

/**
 * Admin GraphQL: SKU → legacy variant id.
 * @param {any} env
 * @param {string[]} skus
 * @returns {Promise<Map<string, string>>}
 */
async function resolveVariantIdsBySkus(env, skus) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const unique = [...new Set(skus.map((s) => String(s || '').trim()).filter(Boolean))]
  if (!unique.length) return out

  const domain = shopDomain(env)
  const token = await getAdminAccessToken(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`

  const chunkSize = 20
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const parts = chunk.map((sku, idx) => {
      const alias = `v${idx}`
      const q = JSON.stringify(`sku:${sku}`)
      return `${alias}: productVariants(first: 1, query: ${q}) { edges { node { legacyResourceId sku } } }`
    })
    const query = `query { ${parts.join('\n')} }`
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query }),
      })
      const json = await res.json()
      if (!res.ok || json?.errors?.length) {
        console.warn('[shopify] variant lookup errors', json?.errors || res.status)
        continue
      }
      for (let idx = 0; idx < chunk.length; idx++) {
        const sku = chunk[idx]
        const edges = json?.data?.[`v${idx}`]?.edges || []
        const id = edges[0]?.node?.legacyResourceId
        if (id) out.set(sku, String(id))
      }
    } catch (e) {
      console.warn('[shopify] variant lookup failed', e)
    }
  }
  return out
}

/**
 * Resolve「設計費用」variant (by env id, SKU, or product title).
 * @param {any} env
 * @returns {Promise<string|null>}
 */
async function resolveDesignFeeVariantId(env) {
  const configured = String(env.SHOPIFY_DESIGN_FEE_VARIANT_ID || '').trim()
  if (configured) return configured.replace(/\D/g, '') || null

  const domain = shopDomain(env)
  const token = await getAdminAccessToken(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`

  const queries = [
    'sku:design_fee',
    'product_title:設計費用',
    'product_title:设计费用',
  ]
  for (const q of queries) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({
          query: `query($q: String!) {
            productVariants(first: 1, query: $q) {
              edges { node { legacyResourceId sku } }
            }
          }`,
          variables: { q },
        }),
      })
      const json = await res.json()
      const id = json?.data?.productVariants?.edges?.[0]?.node?.legacyResourceId
      if (id) return String(id)
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * 備註：藍新訂單號、手圍、商品編碼（編號每顆一行）. 不含商品明細/配方.
 * @param {object} record
 * @param {{ tradeNo?: string, paymentType?: string, payTime?: string }} pay
 */
function buildNoteParts(record, pay = {}) {
  const lines = []
  if (record.merchantOrderNo) {
    lines.push(`藍新訂單：${record.merchantOrderNo}`)
  }
  if (pay.tradeNo) {
    lines.push(`藍新交易號：${pay.tradeNo}`)
  }
  if (record.wristCm) {
    lines.push(`手圍：${record.wristCm}cm`)
  }
  const codeBlock = formatProductCodeForNote(record)
  if (codeBlock) {
    lines.push('商品編碼：')
    lines.push(codeBlock)
  }
  return lines
}

/**
 * Prefer client multiline `1. id`; else expand BOM / + joined string in clockwise order.
 * @param {object} record
 */
function formatProductCodeForNote(record) {
  const raw = String(record.beadProductCode || '').trim()
  if (raw && /^\d+\./m.test(raw)) {
    return clip(raw, 5000)
  }

  /** @type {string[]} */
  let ids = []
  if (raw.includes('+')) {
    ids = raw.split('+').map((s) => s.trim()).filter(Boolean)
  } else if (raw && !raw.includes('\n')) {
    ids = [raw]
  }

  if (!ids.length && Array.isArray(record.bom)) {
    // BOM is aggregated by SKU — fall back only if no sequential code was sent.
    for (const row of record.bom) {
      const id = String(row.productId || '').trim()
      const qty = Math.max(1, Math.round(Number(row.qty) || 1))
      if (!id) continue
      for (let i = 0; i < qty; i++) ids.push(id)
    }
  }

  if (!ids.length) return ''
  return ids.map((id, i) => `${i + 1}. ${id}`).join('\n')
}

/**
 * @param {string} h5Status
 */
function buildTags(h5Status) {
  const label = H5_STATUS_TAG[h5Status] || H5_STATUS_TAG.unpaid
  return label
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

  const codeAttr = String(record.beadProductCode || '')
    .replace(/\n/g, ' | ')
    .slice(0, 500)

  return [
    { name: 'newebpay_merchant_order_no', value: String(record.merchantOrderNo || '') },
    { name: 'newebpay_trade_no', value: String(pay?.tradeNo || '') },
    { name: 'pearl_h5_status', value: String(h5Status || 'unpaid') },
    { name: 'pearl_design_name', value: String(record.designName || '') },
    { name: 'pearl_wrist_cm', value: wristValue },
    { name: 'pearl_bead_product_code', value: codeAttr },
    { name: 'pearl_details_mode', value: String(record.detailsMode || '') },
    { name: 'pearl_design_id', value: String(record.designId || '') },
    { name: 'pearl_plaza_publish_id', value: String(record.plazaPublishId || '') },
    { name: 'pearl_designer_id', value: String(record.designerId || '') },
    { name: 'pearl_amount_twd', value: String(record.amountTwd || 0) },
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
