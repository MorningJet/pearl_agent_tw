/**
 * Catalog from master workbook data/commodity_idx.xlsx
 * (merged from incremental new_input/ batches via `npm run sync:catalog`).
 *
 * Excel columns:
 * id | category1 | category2 | name | size_mm | high_mm | price_twd | picture | supply
 *
 * - id: unique SKU id
 * - size_mm → diameterMm: occupancy along the bracelet cord
 * - high_mm → highMm: vertical / face size (beads: equals size_mm)
 * - supply: supplier name (ops; not shown on shelf)
 * - one name ↔ one picture file; different size/price rows = different SKUs sharing the image
 * - Taiwan market: Traditional Chinese names, prices in TWD (NT$)
 */

import catalog from './catalog.json'
import lifestyleMap from './productLifestyle.json'
import { withBase } from '../assetUrl.js'

/** @typedef {'bead' | 'accessory'} MaterialType */

/**
 * @typedef {object} Product
 * @property {string} id
 * @property {MaterialType} type
 * @property {string} category
 * @property {string} name
 * @property {number} diameterMm cord-track occupancy (Excel size_mm)
 * @property {number} highMm vertical / face size (Excel high_mm)
 * @property {number} price
 * @property {string} color
 * @property {string} [image]
 * @property {string} [supply]
 */

/** @type {Product[]} */
export const PRODUCTS = catalog.products.map((p) => ({
  ...p,
  highMm: Number(p.highMm) > 0 ? Number(p.highMm) : Number(p.diameterMm) || 0,
  supply: p.supply || '',
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

/**
 * Cord-track occupancy in mm (Excel `size_mm` / runtime `diameterMm`).
 * @param {{ diameterMm?: number } | null | undefined} product
 */
export function trackMmOf(product) {
  return Math.max(Number(product?.diameterMm) || 1, 1)
}

/**
 * Face / vertical size in mm (Excel `high_mm`). Beads fall back to diameterMm.
 * @param {{ diameterMm?: number, highMm?: number } | null | undefined} product
 */
export function faceMmOf(product) {
  const h = Number(product?.highMm)
  if (Number.isFinite(h) && h > 0) return h
  return trackMmOf(product)
}

/**
 * @param {{ category?: string, type?: string } | null | undefined} product
 */
export function isPendant(product) {
  if (!product) return false
  const c = String(product.category || '').trim()
  return c === '吊墜' || c === '吊坠'
}

/**
 * @param {{ category?: string, type?: string } | null | undefined} product
 */
export function isSpacer(product) {
  if (!product) return false
  const c = String(product.category || '').trim()
  return c === '隔珠'
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

/** Picture filename stem, e.g. `/products/白水晶.png` → `白水晶`. */
export function productPictureStem(imageOrPicture) {
  if (!imageOrPicture) return ''
  const base = imageOrPicture.split('/').pop() || imageOrPicture
  return base.replace(/\.[^.]+$/, '')
}

/** Lifestyle photo URL for a catalog product, or empty if none. */
export function productLifestyleUrlForProduct(product) {
  if (!product?.image) return ''
  const file = lifestyleMap[productPictureStem(product.image)]
  if (!file) return ''
  return withBase(`/products/${file}`)
}
