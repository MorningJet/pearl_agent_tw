/**
 * Shopify Storefront / cart config (Vite env).
 */

export function shopDomain() {
  const raw = String(import.meta.env.VITE_SHOPIFY_STORE_DOMAIN || '').trim()
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function storefrontToken() {
  return String(import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN || '').trim()
}

export function storefrontApiVersion() {
  return String(import.meta.env.VITE_SHOPIFY_API_VERSION || '2025-01').trim()
}

/**
 * 設計費專用 NT$1 變體 GID。
 * 有設計費時必填：購物車數量 = H5 設計費（整數 TWD）。
 */
export function designFeeUnitVariantGid() {
  return String(
    import.meta.env.VITE_SHOPIFY_DESIGN_FEE_UNIT_VARIANT_GID || '',
  ).trim()
}

export function isShopifyConfigured() {
  return Boolean(shopDomain() && storefrontToken())
}

export function storefrontEndpoint() {
  const domain = shopDomain()
  if (!domain) return ''
  return `https://${domain}/api/${storefrontApiVersion()}/graphql.json`
}
