/**
 * Catalog from master workbook data/commodity_idx.xlsx
 * (merged from incremental new_input/ batches via `npm run sync:catalog`).
 *
 * Excel columns:
 * id | category1 | category2 | name | size_mm | price_twd | picture
 *
 * - id: unique SKU id
 * - one name ↔ one picture file; different size/price rows = different SKUs sharing the image
 * - Taiwan market: Traditional Chinese names, prices in TWD (NT$)
 */

import catalog from './catalog.json'
import { withBase } from '../assetUrl.js'

/** @typedef {'bead' | 'accessory'} MaterialType */

/**
 * @typedef {object} Product
 * @property {string} id
 * @property {MaterialType} type
 * @property {string} category
 * @property {string} name
 * @property {number} diameterMm
 * @property {number} price
 * @property {string} color
 * @property {string} [image]
 */

/** @type {Product[]} */
export const PRODUCTS = catalog.products.map((p) => ({
  ...p,
  image: p.image ? withBase(p.image) : p.image,
}))

/**
 * @param {MaterialType} type
 * @returns {string[]}
 */
export function categoriesForType(type) {
  const set = new Set(
    PRODUCTS.filter((p) => p.type === type).map((p) => p.category),
  )
  return ['全部', ...set]
}

/**
 * @param {MaterialType} type
 * @param {string} category
 * @returns {Product[]}
 */
export function productsFor(type, category) {
  const filtered = PRODUCTS.filter(
    (p) => p.type === type && (category === '全部' || p.category === category),
  )
  // Preserve catalog product order (light→dark), but within each name sort 6→8→10mm.
  /** @type {Map<string, Product[]>} */
  const groups = new Map()
  for (const p of filtered) {
    const list = groups.get(p.name)
    if (list) list.push(p)
    else groups.set(p.name, [p])
  }
  /** @type {Product[]} */
  const out = []
  for (const items of groups.values()) {
    items.sort(
      (a, b) =>
        a.diameterMm - b.diameterMm || a.id.localeCompare(b.id),
    )
    out.push(...items)
  }
  return out
}

/**
 * @param {string} id
 * @returns {Product | undefined}
 */
export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id)
}

/** Pendants hang off the cord; track occupancy stays `diameterMm` (typically 2). */
export const PENDANT_BODY_MM = 8

/**
 * @param {{ category?: string, type?: string } | null | undefined} product
 */
export function isPendant(product) {
  if (!product) return false
  const c = String(product.category || '').trim()
  return c === '吊墜' || c === '吊坠'
}

/** Public URL for a product image filename from the Excel `picture` column. */
export function productImageUrl(pictureOrPath) {
  if (!pictureOrPath) return ''
  if (pictureOrPath.startsWith('http') || pictureOrPath.startsWith('data:')) {
    return pictureOrPath
  }
  if (pictureOrPath.startsWith('/')) return withBase(pictureOrPath)
  return withBase(`/products/${pictureOrPath}`)
}
