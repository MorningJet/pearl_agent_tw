/**
 * Native Shopify Admin Order `shipping_address` JSON.
 * H5 checkout → Worker → Shopify, and webhook/Admin → H5 share this shape.
 *
 * @typedef {{
 *   first_name: string,
 *   last_name: string,
 *   name?: string,
 *   phone: string,
 *   address1: string,
 *   address2?: string,
 *   city: string,
 *   province: string,
 *   country: string,
 *   country_code: string,
 *   zip: string,
 *   company?: string,
 *   province_code?: string,
 * }} ShopifyShippingAddress
 */

/**
 * Build Shopify-native shipping_address from Taiwan checkout fields.
 * @param {{
 *   lastName: string,
 *   firstName: string,
 *   phone: string,
 *   province: string,
 *   city: string,
 *   address1: string,
 *   zip: string,
 *   address2?: string,
 * }} input
 * @returns {ShopifyShippingAddress}
 */
export function buildShopifyShippingAddress(input) {
  const last_name = String(input.lastName || '').trim()
  const first_name = String(input.firstName || '').trim()
  const phone = String(input.phone || '')
    .trim()
    .replace(/[\s-]/g, '')
  const province = String(input.province || '').trim()
  const city = String(input.city || '').trim()
  const address1 = String(input.address1 || '').trim()
  const address2 = String(input.address2 || '').trim()
  const zip = String(input.zip || '').trim()

  return {
    last_name,
    first_name,
    name: `${last_name}${first_name}`,
    phone,
    company: '',
    address1,
    address2,
    city,
    province,
    country: 'Taiwan',
    country_code: 'TW',
    zip,
    province_code: '',
  }
}

/**
 * Normalize any partial / legacy address into Shopify shipping_address JSON.
 * @param {unknown} raw
 * @returns {ShopifyShippingAddress | null}
 */
export function normalizeShopifyShippingAddress(raw) {
  if (!raw || typeof raw !== 'object') return null
  const a = /** @type {Record<string, unknown>} */ (raw)

  const last_name = String(a.last_name || a.lastName || '').trim()
  const first_name = String(a.first_name || a.firstName || '').trim()
  const legacyName = String(a.name || '').trim()
  const phone = String(a.phone || '')
    .trim()
    .replace(/[\s-]/g, '')

  /** @type {string} */
  let province
  /** @type {string} */
  let city
  /** @type {string} */
  let address1

  // Legacy H5: { city: 縣市, district: 鄉鎮市區, detail/address1: 街道 }
  if (a.district && !a.province) {
    province = String(a.city || '').trim()
    city = String(a.district || '').trim()
    address1 = String(a.address1 || a.detail || a.address || '').trim()
  } else {
    // Native Shopify: province=縣市, city=鄉鎮市區, address1=街道
    province = String(a.province || '').trim()
    city = String(a.city || '').trim()
    address1 = String(a.address1 || a.detail || a.address || '').trim()
  }

  const address2 = String(a.address2 || '').trim()
  const zip = String(a.zip || a.postal_code || '').trim()
  const country_code = String(a.country_code || 'TW').trim().toUpperCase() || 'TW'
  const country =
    String(a.country || '').trim() ||
    (country_code === 'TW' ? 'Taiwan' : country_code)

  let resolvedLast = last_name
  let resolvedFirst = first_name
  if (!resolvedLast && !resolvedFirst && legacyName) {
    if (legacyName.length === 1) resolvedLast = legacyName
    else {
      resolvedLast = legacyName.slice(0, 1)
      resolvedFirst = legacyName.slice(1)
    }
  }

  if (!resolvedLast && !resolvedFirst && !address1 && !phone && !province) return null

  return {
    last_name: resolvedLast,
    first_name: resolvedFirst,
    name: `${resolvedLast}${resolvedFirst}` || legacyName,
    phone,
    company: String(a.company || '').trim(),
    address1,
    address2,
    city,
    province,
    country,
    country_code,
    zip,
    province_code: String(a.province_code || '').trim(),
  }
}

/**
 * One-line display for order cards / detail.
 * @param {ShopifyShippingAddress | null | undefined} addr
 * @returns {string}
 */
export function formatShopifyShippingAddress(addr) {
  const a = normalizeShopifyShippingAddress(addr)
  if (!a) return ''
  return [
    a.country_code === 'TW' || a.country === 'Taiwan' ? '台灣' : a.country,
    a.zip,
    a.province,
    a.city,
    a.address1,
    a.address2,
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * Recipient display name.
 * @param {ShopifyShippingAddress | null | undefined} addr
 * @returns {string}
 */
export function shippingRecipientName(addr) {
  const a = normalizeShopifyShippingAddress(addr)
  if (!a) return ''
  return a.name || `${a.last_name || ''}${a.first_name || ''}` || ''
}
