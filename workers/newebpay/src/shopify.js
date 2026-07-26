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
 * Variant IDs come from bundled variantMap.json (Storefront sync). Admin
 * read_products is optional; app may only have write_orders.
 *
 * Auth: SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET 或 SHOPIFY_ADMIN_TOKEN
 */

import staticVariantMap from './variantMap.data.js'

/** @type {{ token: string, expiresAt: number } | null} */
let cachedToken = null

/** @type {Map<string, string> | null} */
let staticSkuMap = null

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

/** @returns {Map<string, string>} */
function getStaticSkuMap() {
  if (staticSkuMap) return staticSkuMap
  /** @type {Map<string, string>} */
  const map = new Map()
  const rawRoot =
    staticVariantMap && typeof staticVariantMap === 'object'
      ? /** @type {any} */ (staticVariantMap).default || staticVariantMap
      : {}
  const raw = rawRoot && typeof rawRoot === 'object' ? rawRoot : {}
  for (const [sku, row] of Object.entries(raw)) {
    let id = ''
    if (row && typeof row === 'object') {
      id = String(row.variantId || row.legacyResourceId || row.id || '')
    } else if (typeof row === 'string' || typeof row === 'number') {
      id = String(row)
    }
    const numeric = id.replace(/\D/g, '')
    if (sku && numeric) map.set(String(sku).trim(), numeric)
  }
  staticSkuMap = map
  console.log('[shopify] bundled variantMap size', map.size)
  return map
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
  const note = buildNote(record, pay)
  const noteAttributes = buildNoteAttributes(record, pay, 'scheduling')
  const putUrl = `https://${domain}/admin/api/${version}/orders/${id}.json`
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify({
      order: {
        id: Number(id) || id,
        tags: buildTags('scheduling'),
        note,
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

  const built = await buildOrderMerchandise(env, record, amt)
  const lineItems = built.lineItems
  if (!lineItems.length) throw new Error('沒有可寫入的商品列')

  const note = buildNote(record, pay)
  const noteAttributes = buildNoteAttributes(record, pay, opts.h5Status)

  /** @type {Record<string, unknown>} */
  const order = {
    email: record.email || undefined,
    currency: 'TWD',
    financial_status: opts.financialStatus,
    send_receipt: false,
    send_fulfillment_receipt: false,
    taxes_included: true,
    inventory_behaviour: 'decrement_obeying_policy',
    tags: buildTags(opts.h5Status),
    note,
    note_attributes: noteAttributes,
    line_items: lineItems,
  }

  if (built.shippingLines?.length) {
    order.shipping_lines = built.shippingLines
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
 * List Shopify orders for a buyer email (Admin API).
 * @param {any} env
 * @param {string} email
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listShopifyOrdersByEmail(env, email, opts = {}) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) return []
  if (!isShopifyAuthConfigured(env)) return []

  const domain = shopDomain(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim() || '2025-01'
  const token = await getAdminAccessToken(env)
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 50))
  const url = new URL(`https://${domain}/admin/api/${version}/orders.json`)
  url.searchParams.set('email', normalized)
  url.searchParams.set('status', 'any')
  url.searchParams.set('limit', String(limit))

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: adminHeaders(token),
  })
  const text = await res.text()
  /** @type {any} */
  let json
  try {
    json = JSON.parse(text)
  } catch {
    console.warn('[shopify] list by email non-JSON', res.status, text.slice(0, 200))
    return []
  }
  if (!res.ok) {
    console.warn('[shopify] list by email failed', res.status, json?.errors || text.slice(0, 200))
    return []
  }
  return Array.isArray(json?.orders) ? json.orders : []
}

/**
 * H5 BOM → real Shopify catalog lines + shipping_lines (not a shipping product).
 * - Beads/accessories: variant_id by SKU (= productId) so Admin shows product images
 * - Design fee:「設計費用」variant × quantity(= fee TWD), NT$1 unit
 * - Shipping: shipping_lines mirroring store rule（珠款 ≥1000 包郵，否則 50）
 *
 * @param {any} env
 * @param {object} record
 * @param {number} amt
 * @returns {Promise<{ lineItems: Array<Record<string, unknown>>, shippingLines: Array<Record<string, unknown>> }>}
 */
async function buildOrderMerchandise(env, record, amt) {
  /** @type {Array<Record<string, unknown>>} */
  const lineItems = []
  const bom = Array.isArray(record.bom) ? record.bom : []

  const fee = Math.max(0, Math.round(Number(record.designFee) || 0))
  const beadsSubtotal = Math.max(
    0,
    Math.round(
      Number(record.beadsSubtotal) ||
        bom.reduce((s, row) => {
          if (Number.isFinite(row.lineTotal)) return s + Number(row.lineTotal)
          return s + Number(row.unitPrice || 0) * Number(row.qty || 0)
        }, 0),
    ),
  )
  // Mirror H5 / Shopify rule: 滿 1000 包郵，否則 50（以珠款小計判斷，不含設計費）
  const shipping =
    beadsSubtotal >= 1000
      ? 0
      : Math.max(0, Math.round(Number(record.shipping) || 50))

  const skus = bom.map((row) => String(row.productId || '').trim()).filter(Boolean)
  const variantBySku = await resolveVariantIdsBySkus(env, skus)

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

    if (!variantId) {
      throw new Error(
        `Shopify 找不到對應變體 SKU「${sku || name}」。請執行 npm run sync:shopify-variants 後重新 deploy Worker。`,
      )
    }
    lineItems.push({
      variant_id: Number(variantId),
      quantity: qty,
      price: unit.toFixed(2),
      requires_shipping: true,
      taxable: false,
    })
  }

  if (fee > 0) {
    const designFeeVariantId = await resolveDesignFeeVariantId(env)
    if (!designFeeVariantId) {
      throw new Error(
        'Shopify 找不到「設計費用」產品變體。請確認後台有此產品（建議售價 NT$1），或設定 SHOPIFY_DESIGN_FEE_VARIANT_ID。',
      )
    }
    // Keep design fee in the same shipment group as beads (avoid「無需發貨」).
    lineItems.push({
      variant_id: Number(designFeeVariantId),
      quantity: fee,
      price: '1.00',
      requires_shipping: true,
      taxable: false,
    })
  }

  /** @type {Array<Record<string, unknown>>} */
  const shippingLines = [
    {
      title: shipping > 0 ? '標準發貨' : '滿額包郵',
      price: shipping.toFixed(2),
      code: shipping > 0 ? 'STANDARD_50' : 'FREE_SHIP_1000',
      source: 'pearl_h5',
    },
  ]

  const linesSum = lineItems.reduce((s, li) => {
    const q = Number(li.quantity || 1)
    if (li.price != null) return s + Math.round(Number(li.price) * q)
    // design fee: catalog NT$1 × qty
    return s + q
  }, 0)
  const expected = linesSum + shipping
  if (amt > 0 && Math.abs(expected - amt) > 1) {
    console.warn('[shopify] merchandise vs NewebPay amt', {
      linesSum,
      shipping,
      expected,
      amt,
    })
  }

  return { lineItems, shippingLines }
}

/** @type {{ map: Map<string, string>, loadedAt: number } | null} */
let variantSkuCache = null
const VARIANT_CACHE_TTL_MS = 10 * 60 * 1000

/**
 * Load all product variant SKUs once (paginated), then map H5 productId → variant id.
 * Falls back to per-SKU identifier lookup if catalog scan fails.
 * @param {any} env
 * @param {string[]} skus
 * @returns {Promise<Map<string, string>>}
 */
async function resolveVariantIdsBySkus(env, skus) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const unique = [...new Set(skus.map((s) => String(s || '').trim()).filter(Boolean))]
  if (!unique.length) return out

  const bundled = getStaticSkuMap()
  for (const sku of unique) {
    const id = bundled.get(sku)
    if (id) out.set(sku, id)
  }

  const missing = unique.filter((s) => !out.has(s))
  if (!missing.length) return out

  // Optional live refresh when app has read_products.
  const catalog = await loadVariantSkuCatalog(env)
  for (const sku of missing) {
    const id = catalog.get(sku) || (await lookupVariantIdBySku(env, sku))
    if (id) out.set(sku, id)
  }
  return out
}

/**
 * @param {any} env
 * @returns {Promise<Map<string, string>>}
 */
async function loadVariantSkuCatalog(env) {
  const now = Date.now()
  if (variantSkuCache && now - variantSkuCache.loadedAt < VARIANT_CACHE_TTL_MS) {
    return variantSkuCache.map
  }

  /** @type {Map<string, string>} */
  const map = new Map()
  const domain = shopDomain(env)
  const token = await getAdminAccessToken(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`

  let cursor = null
  for (let page = 0; page < 50; page++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({
        query: `query($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                variants(first: 100) {
                  edges {
                    node { sku legacyResourceId }
                  }
                }
              }
            }
          }
        }`,
        variables: { cursor },
      }),
    })
    const json = await res.json()
    if (!res.ok || json?.errors?.length) {
      const denied = json?.errors?.some((e) =>
        /ACCESS_DENIED|Access denied/i.test(String(e?.message || '')),
      )
      if (denied) {
        console.warn('[shopify] catalog scan skipped — app lacks read_products; using bundled variantMap')
      } else {
        console.warn('[shopify] catalog scan failed', json?.errors || res.status)
      }
      break
    }
    const conn = json?.data?.products
    for (const edge of conn?.edges || []) {
      for (const vEdge of edge?.node?.variants?.edges || []) {
        const sku = String(vEdge?.node?.sku || '').trim()
        const id = vEdge?.node?.legacyResourceId
        if (sku && id) map.set(sku, String(id))
      }
    }
    if (!conn?.pageInfo?.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }

  if (map.size) {
    variantSkuCache = { map, loadedAt: now }
    console.log('[shopify] variant catalog loaded', map.size)
  }
  return map
}

/**
 * @param {any} env
 * @param {string} sku
 * @returns {Promise<string|null>}
 */
async function lookupVariantIdBySku(env, sku) {
  const domain = shopDomain(env)
  const token = await getAdminAccessToken(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`

  // Prefer identifier API (2024-10+)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({
        query: `query($sku: String!) {
          productVariantByIdentifier(identifier: { sku: $sku }) {
            legacyResourceId
          }
        }`,
        variables: { sku },
      }),
    })
    const json = await res.json()
    const id = json?.data?.productVariantByIdentifier?.legacyResourceId
    if (id) return String(id)
    if (json?.errors?.length) {
      console.warn('[shopify] productVariantByIdentifier', sku, json.errors)
    }
  } catch (e) {
    console.warn('[shopify] identifier lookup failed', sku, e)
  }

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
            edges { node { legacyResourceId } }
          }
        }`,
        variables: { q: `sku:${sku}` },
      }),
    })
    const json = await res.json()
    const id = json?.data?.productVariants?.edges?.[0]?.node?.legacyResourceId
    if (id) return String(id)
  } catch (e) {
    console.warn('[shopify] productVariants search failed', sku, e)
  }
  return null
}

/**
 * Resolve「設計費用」variant — NT$1 unit product used as qty = fee TWD.
 * @param {any} env
 * @returns {Promise<string|null>}
 */
async function resolveDesignFeeVariantId(env) {
  const configured = String(env.SHOPIFY_DESIGN_FEE_VARIANT_ID || '').trim()
  if (configured) return configured.replace(/\D/g, '') || null

  const bundled = getStaticSkuMap()
  for (const key of ['design_fee', 'DESIGN_FEE']) {
    if (bundled.has(key)) return bundled.get(key) || null
  }

  const catalog = await loadVariantSkuCatalog(env)
  for (const key of ['design_fee', 'DESIGN_FEE', '设计费用', '設計費用']) {
    if (catalog.has(key)) return catalog.get(key) || null
  }

  const domain = shopDomain(env)
  const token = await getAdminAccessToken(env)
  const version = String(env.SHOPIFY_API_VERSION || '2025-01').trim()
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`

  const queries = [
    'sku:design_fee',
    'title:設計費用',
    'title:设计费用',
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
            productVariants(first: 5, query: $q) {
              edges {
                node {
                  legacyResourceId
                  sku
                  product { title }
                }
              }
            }
          }`,
          variables: { q },
        }),
      })
      const json = await res.json()
      if (json?.errors?.some((e) => /ACCESS_DENIED/i.test(String(e?.message || '')))) {
        break
      }
      const edges = json?.data?.productVariants?.edges || []
      for (const edge of edges) {
        const title = String(edge?.node?.product?.title || '')
        if (title === '設計費用' || title === '设计费用') {
          return String(edge.node.legacyResourceId)
        }
      }
      if (edges[0]?.node?.legacyResourceId) {
        return String(edges[0].node.legacyResourceId)
      }
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * 備註：藍新訂單號、手圍、商品編碼（編號每顆一行）.
 * @param {object} record
 * @param {{ tradeNo?: string, paymentType?: string, payTime?: string }} pay
 * @returns {string}
 */
function buildNote(record, pay = {}) {
  /** @type {string[]} */
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
  const codeLines = formatProductCodeLines(record)
  if (codeLines.length) {
    lines.push('商品編碼：')
    for (const row of codeLines) lines.push(row)
  }
  return lines.join('\n')
}

/**
 * Numbered product codes, one id per line (clockwise from top-right).
 * @param {object} record
 * @returns {string[]}
 */
function formatProductCodeLines(record) {
  const raw = String(record.beadProductCode || '').trim()
  /** @type {string[]} */
  let ids = []

  if (raw) {
    const normalized = raw
      .replace(/\r\n/g, '\n')
      .replace(/\u2028/g, '\n')
      .replace(/\s+(?=\d+\.\s*)/g, '\n')
    if (/^\d+\./m.test(normalized)) {
      ids = normalized
        .split('\n')
        .map((line) => {
          const m = String(line).trim().match(/^\d+\.\s*(.+)$/)
          return m ? m[1].trim() : ''
        })
        .filter(Boolean)
    } else if (raw.includes('+')) {
      ids = raw.split('+').map((s) => s.trim()).filter(Boolean)
    } else if (!raw.includes('\n')) {
      ids = [raw]
    }
  }

  if (!ids.length && Array.isArray(record.bom)) {
    for (const row of record.bom) {
      const id = String(row.productId || '').trim()
      const qty = Math.max(1, Math.round(Number(row.qty) || 1))
      if (!id) continue
      for (let i = 0; i < qty; i++) ids.push(id)
    }
  }

  return ids.map((id, i) => `${i + 1}. ${id}`)
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

  const shippingJson = buildShippingAddressJson(record.shippingAddress)

  return [
    { name: 'newebpay_merchant_order_no', value: String(record.merchantOrderNo || '') },
    { name: 'newebpay_trade_no', value: String(pay?.tradeNo || '') },
    { name: 'pearl_h5_status', value: String(h5Status || 'unpaid') },
    { name: 'pearl_design_name', value: String(record.designName || '') },
    { name: 'pearl_wrist_cm', value: wristValue },
    { name: 'pearl_details_mode', value: String(record.detailsMode || '') },
    { name: 'pearl_design_id', value: String(record.designId || '') },
    { name: 'pearl_plaza_publish_id', value: String(record.plazaPublishId || '') },
    { name: 'pearl_designer_id', value: String(record.designerId || '') },
    { name: 'pearl_amount_twd', value: String(record.amountTwd || 0) },
    { name: 'pearl_beads_subtotal_twd', value: String(record.beadsSubtotal ?? '') },
    { name: 'pearl_design_fee_twd', value: String(record.designFee ?? '') },
    { name: 'pearl_shipping_twd', value: String(record.shipping ?? '') },
    { name: 'pearl_member_email', value: String(record.email || '') },
    { name: 'pearl_payment_status', value: h5Status === 'scheduling' ? 'paid' : 'unpaid' },
    // Logistics-friendly structured address (JSON string)
    { name: 'pearl_shipping_address_json', value: shippingJson },
    { name: '收貨地址JSON', value: shippingJson },
  ].filter((a) => a.value)
}

/**
 * Flatten checkout shipping fields into a logistics-ready JSON string.
 * Keys are stable English + Traditional Chinese aliases for TW carriers.
 * @param {unknown} raw
 * @returns {string}
 */
function buildShippingAddressJson(raw) {
  if (!raw || typeof raw !== 'object') return ''
  const addr = /** @type {Record<string, unknown>} */ (raw)
  const lastName = String(addr.last_name || addr.lastName || '').trim()
  const firstName = String(addr.first_name || addr.firstName || '').trim()
  const name = String(addr.name || `${lastName}${firstName}` || '').trim()
  const phone = String(addr.phone || '').trim().replace(/[\s-]/g, '')
  const country = String(addr.country || '台灣').trim() || '台灣'
  const countryCode = String(addr.country_code || addr.countryCode || 'TW')
    .trim()
    .toUpperCase() || 'TW'
  // Checkout: province=縣市, city=鄉鎮市區, district=鄉鎮市區, address1=街道
  const city =
    String(addr.province || addr.city_county || '').trim() ||
    (!String(addr.district || '').trim() ? String(addr.city || '').trim() : '')
  const district =
    String(addr.district || '').trim() ||
    (String(addr.province || '').trim() ? String(addr.city || '').trim() : '')
  const zip = String(addr.zip || addr.postal_code || addr.postalCode || '').trim()
  const address = String(addr.address1 || addr.detail || addr.address || '').trim()
  if (!lastName && !firstName && !name && !phone && !city && !district && !address) {
    return ''
  }

  const payload = {
    version: 1,
    country,
    country_code: countryCode,
    last_name: lastName,
    first_name: firstName,
    name,
    phone,
    city,
    district,
    zip,
    address,
    // Traditional Chinese aliases for TW ops / carriers
    國家: country,
    姓氏: lastName,
    名字: firstName,
    手機號碼: phone,
    縣市: city,
    鄉鎮市區: district,
    郵遞區號: zip,
    地址: address,
  }
  try {
    return JSON.stringify(payload)
  } catch {
    return ''
  }
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
 * Shopify native shipping_address (also keep structured JSON in note_attributes).
 * @param {Record<string, string>} addr
 */
function mapAddress(addr) {
  const lastName = clip(addr.last_name || '', 40)
  const firstName = clip(addr.first_name || '', 40)
  const fullName = clip(addr.name || `${lastName}${firstName}` || 'Customer', 40)
  const province = clip(addr.province || addr.city_county || '', 40)
  const city = clip(addr.city || addr.district || '', 40)
  const address1 = clip(
    addr.address1 ||
      addr.detail ||
      [province, city, addr.district, addr.detail].filter(Boolean).join('') ||
      '',
    120,
  )
  return {
    last_name: lastName || undefined,
    first_name: firstName || fullName,
    phone: clip(addr.phone || '', 20) || undefined,
    address1,
    city: city || undefined,
    province: province || city || undefined,
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
