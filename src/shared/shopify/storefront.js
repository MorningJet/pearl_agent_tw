/**
 * Minimal Storefront GraphQL client.
 */

import { storefrontEndpoint, storefrontToken } from './config.js'

/**
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 */
export async function storefrontGraphql(query, variables = {}) {
  const endpoint = storefrontEndpoint()
  const token = storefrontToken()
  if (!endpoint || !token) {
    throw new Error('尚未設定 Shopify Storefront（VITE_SHOPIFY_STORE_DOMAIN / TOKEN）')
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}`)
  }

  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; ') || 'Shopify GraphQL error')
  }
  return json.data
}
