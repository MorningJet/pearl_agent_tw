#!/usr/bin/env node
/**
 * Fetch Shopify variant SKUs via Storefront API → src/shared/shopify/variantMap.json
 *
 * Usage:
 *   VITE_SHOPIFY_STORE_DOMAIN=xxx.myshopify.com \
 *   VITE_SHOPIFY_STOREFRONT_TOKEN=xxx \
 *   node scripts/sync-shopify-variants.mjs
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outPath = join(root, 'src/shared/shopify/variantMap.json')

const domain = String(process.env.VITE_SHOPIFY_STORE_DOMAIN || '')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '')
const token = String(process.env.VITE_SHOPIFY_STOREFRONT_TOKEN || '').trim()
const version = String(process.env.VITE_SHOPIFY_API_VERSION || '2025-01').trim()

if (!domain || !token) {
  console.error('Missing VITE_SHOPIFY_STORE_DOMAIN or VITE_SHOPIFY_STOREFRONT_TOKEN')
  process.exit(1)
}

const endpoint = `https://${domain}/api/${version}/graphql.json`

const query = `
  query VariantSkus($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          variants(first: 100) {
            edges {
              node { id sku }
            }
          }
        }
      }
    }
  }
`

/** @type {Record<string, { variantGid: string, variantId: string }>} */
const map = {}
let cursor = null
let pages = 0

while (pages < 40) {
  pages += 1
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
    },
    body: JSON.stringify({ query, variables: { cursor } }),
  })
  if (!res.ok) {
    console.error('HTTP', res.status, await res.text())
    process.exit(1)
  }
  const json = await res.json()
  if (json.errors?.length) {
    console.error(json.errors)
    process.exit(1)
  }
  const conn = json.data?.products
  for (const edge of conn?.edges || []) {
    for (const vEdge of edge?.node?.variants?.edges || []) {
      const node = vEdge?.node
      const sku = String(node?.sku || '').trim()
      const gid = String(node?.id || '').trim()
      if (!sku || !gid) continue
      map[sku] = { variantGid: gid, variantId: gid.split('/').pop() || '' }
    }
  }
  if (!conn?.pageInfo?.hasNextPage) break
  cursor = conn.pageInfo.endCursor
}

writeFileSync(outPath, `${JSON.stringify(map, null, 2)}\n`)

// Worker bundles a JS module copy (JSON import is unreliable in CF Workers builds).
const workerJson = join(root, 'workers/newebpay/src/variantMap.json')
const workerData = join(root, 'workers/newebpay/src/variantMap.data.js')
writeFileSync(workerJson, `${JSON.stringify(map, null, 2)}\n`)
writeFileSync(workerData, `export default ${JSON.stringify(map)}\n`)

console.log(`Wrote ${Object.keys(map).length} SKUs → ${outPath}`)
console.log(`Updated Worker bundle → ${workerData}`)
