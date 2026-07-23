/**
 * Catalog SKU (product id) → Shopify variant GID.
 * Prefers static map; can refresh from Storefront when configured.
 */

import staticMap from './variantMap.json'
import { isShopifyConfigured } from './config.js'
import { storefrontGraphql } from './storefront.js'

const CACHE_KEY = 'pearl-tw.shopifyVariantMap.v1'

/** @type {Record<string, { variantGid: string, variantId?: string }> | null} */
let memory = null

/** @returns {Record<string, { variantGid: string, variantId?: string }>} */
function readCache() {
  if (memory) return memory
  /** @type {Record<string, { variantGid: string, variantId?: string }>} */
  const base = { ...(staticMap || {}) }
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (raw) Object.assign(base, JSON.parse(raw))
  } catch {
    /* ignore */
  }
  memory = base
  return memory
}

/** @param {Record<string, { variantGid: string, variantId?: string }>} map */
function writeCache(map) {
  memory = map
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} sku
 * @returns {string} variant GID or ''
 */
export function getVariantGidForSku(sku) {
  const row = readCache()[sku]
  return row?.variantGid || ''
}

/**
 * Pull all variant SKUs from the shop (paginated). Safe to call often — cached.
 * @returns {Promise<number>} mapped SKU count
 */
export async function refreshVariantMapFromStorefront() {
  if (!isShopifyConfigured()) return Object.keys(readCache()).length

  const query = `
    query VariantSkus($cursor: String) {
      products(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                }
              }
            }
          }
        }
      }
    }
  `

  /** @type {Record<string, { variantGid: string, variantId?: string }>} */
  const next = { ...readCache() }
  let cursor = null
  let guard = 0

  while (guard < 40) {
    guard += 1
    const data = await storefrontGraphql(query, { cursor })
    const conn = data?.products
    for (const edge of conn?.edges || []) {
      for (const vEdge of edge?.node?.variants?.edges || []) {
        const node = vEdge?.node
        const sku = String(node?.sku || '').trim()
        const gid = String(node?.id || '').trim()
        if (!sku || !gid) continue
        const numeric = gid.split('/').pop() || ''
        next[sku] = { variantGid: gid, variantId: numeric }
      }
    }
    if (!conn?.pageInfo?.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }

  writeCache(next)
  return Object.keys(next).length
}

/**
 * Ensure SKUs resolve; refresh from Storefront once if any miss.
 * @param {string[]} skus
 * @returns {Promise<{ ok: true } | { ok: false, missing: string[] }>}
 */
export async function ensureVariantsForSkus(skus) {
  const unique = [...new Set(skus.filter(Boolean))]
  let missing = unique.filter((s) => !getVariantGidForSku(s))
  if (!missing.length) return { ok: true }

  if (isShopifyConfigured()) {
    await refreshVariantMapFromStorefront()
    missing = unique.filter((s) => !getVariantGidForSku(s))
  }

  if (missing.length) return { ok: false, missing }
  return { ok: true }
}
