#!/usr/bin/env node
/**
 * Merge incremental uploads from new_input/ into the full catalog.
 *
 * new_input/  — temporary drop zone for THIS batch only:
 *   - commodity_idx.xlsx  (new/updated SKU rows only)
 *   - <picture>.png       (product images referenced by those rows)
 *
 * data/commodity_idx.xlsx — full master SKU workbook (always maintained)
 * public/products/        — all product images
 * public/brand|icons/     — UI assets (NOT via new_input)
 * src/shared/data/catalog.json — generated runtime catalog
 *
 * new_input/commodity_idx.xlsx sheets:
 *   - catalog: new SKU rows (headers only after sync)
 *   - categories: existing category1 + category2 pairs (reference for filling)
 *
 * Columns: id | category1 | category2 | name | size_mm | price_twd | picture
 * Taiwan market: Traditional Chinese names; prices in TWD (NT$).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import XLSX from 'xlsx'
import { normalizeProductImage } from './normalize-product-image.mjs'

const COLUMNS = ['id', 'category1', 'category2', 'name', 'size_mm', 'price_twd', 'picture']
const CATEGORY_COLUMNS = ['category1', 'category2']
const SHEET_CATALOG = 'catalog'
const SHEET_CATEGORIES = 'categories'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dropDir = path.join(root, 'new_input')
const dataXlsx = path.join(root, 'data', 'commodity_idx.xlsx')
const dropXlsx = path.join(dropDir, 'commodity_idx.xlsx')
const outJson = path.join(root, 'src', 'shared', 'data', 'catalog.json')
const productsDir = path.join(root, 'public', 'products')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * @param {string} filePath
 * @param {string} [preferredSheet]
 */
function readRows(filePath, preferredSheet = SHEET_CATALOG) {
  if (!fs.existsSync(filePath)) return []
  const wb = XLSX.readFile(filePath)
  const name =
    wb.SheetNames.includes(preferredSheet) ? preferredSheet : wb.SheetNames[0]
  const sheet = wb.Sheets[name]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

/**
 * Unique category1 + category2 pairs from master SKU rows.
 * @param {object[]} rows
 */
function uniqueCategories(rows) {
  /** @type {Map<string, { category1: string, category2: string }>} */
  const map = new Map()
  for (const row of rows) {
    const category1 = normalizeCategory1(row.category1)
    const category2 = String(row.category2 ?? '').trim()
    if (!category2) continue
    const key = `${category1}::${category2}`
    map.set(key, { category1, category2 })
  }
  return [...map.values()].sort((a, b) =>
    a.category1 === b.category1
      ? a.category2.localeCompare(b.category2)
      : a.category1.localeCompare(b.category1),
  )
}

/**
 * Write new_input workbook: empty catalog sheet + categories reference sheet.
 * @param {object[]} masterRows
 */
function writeDropZoneWorkbook(masterRows) {
  ensureDir(dropDir)
  const wb = XLSX.utils.book_new()

  const catalogSheet = XLSX.utils.aoa_to_sheet([COLUMNS])
  XLSX.utils.book_append_sheet(wb, catalogSheet, SHEET_CATALOG)

  const cats = uniqueCategories(masterRows)
  const catSheet = XLSX.utils.json_to_sheet(cats, { header: CATEGORY_COLUMNS })
  XLSX.utils.book_append_sheet(wb, catSheet, SHEET_CATEGORIES)

  XLSX.writeFile(wb, dropXlsx)
  console.log(
    `reset new_input/commodity_idx.xlsx (catalog headers + ${cats.length} category pairs)`,
  )
}


/** @param {object[]} rows */
function normalizeRows(rows) {
  /** @type {Map<string, object>} */
  const byId = new Map()
  for (const row of rows) {
    const id = String(row.id ?? '').trim()
    if (!id) continue
    byId.set(id, {
      id,
      category1: normalizeCategory1(row.category1),
      category2: String(row.category2 ?? '').trim(),
      name: String(row.name ?? id).trim(),
      size_mm: Number(row.size_mm) || 0,
      price_twd: Number(row.price_twd ?? row.price_usd) || 0,
      picture: String(row.picture ?? '').trim(),
    })
  }
  return byId
}

/**
 * Shelf order: light colors first → dark later; same product by 6 → 8 → 10mm.
 * `luminanceByPicture` map (0–255, higher = brighter) is filled from product PNGs.
 * @type {Map<string, number>}
 */
let luminanceByPicture = new Map()

/**
 * @param {string} picture filename or /products/ path
 */
function pictureKey(picture) {
  const s = String(picture || '').trim()
  if (!s) return ''
  return s.includes('/') ? path.basename(s) : s
}

/**
 * @param {object} row
 */
function rowLuminance(row) {
  const key = pictureKey(row.picture || row.image)
  if (key && luminanceByPicture.has(key)) return luminanceByPicture.get(key)
  return 128
}

/**
 * Average perceived luminance of opaque pixels in a product PNG (0–255).
 * @param {string} filePath
 */
async function measureLuminance(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const ch = info.channels
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += ch) {
    const a = ch >= 4 ? data[i + 3] : 255
    if (a < 24) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    sum += 0.299 * r + 0.587 * g + 0.114 * b
    count += 1
  }
  return count ? sum / count : 128
}

/**
 * @param {Iterable<string>} pictures filenames in public/products
 */
async function buildLuminanceMap(pictures) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const file of pictures) {
    const key = pictureKey(file)
    if (!key || map.has(key)) continue
    const abs = path.join(productsDir, key)
    if (!fs.existsSync(abs)) continue
    try {
      map.set(key, await measureLuminance(abs))
    } catch {
      map.set(key, 128)
    }
  }
  luminanceByPicture = map
  return map
}

/**
 * @param {object} a
 * @param {object} b
 */
function compareCatalogRows(a, b) {
  const lumA = rowLuminance(a)
  const lumB = rowLuminance(b)
  // Brighter products first (same picture → same luminance → stay contiguous).
  if (lumA !== lumB) return lumB - lumA
  const nameA = String(a.name || '')
  const nameB = String(b.name || '')
  const byName = nameA.localeCompare(nameB, 'zh-Hant')
  if (byName !== 0) return byName
  // Same product: 6 → 8 → 10mm (never id string order like _10 before _6).
  const sizeA = Number(a.size_mm ?? a.diameterMm) || 0
  const sizeB = Number(b.size_mm ?? b.diameterMm) || 0
  if (sizeA !== sizeB) return sizeA - sizeB
  return String(a.id || '').localeCompare(String(b.id || ''))
}

/** @param {Map<string, object>} byId */
function writeMasterWorkbook(byId) {
  const rows = [...byId.values()].sort(compareCatalogRows)
  const sheet = XLSX.utils.json_to_sheet(rows, { header: COLUMNS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'catalog')
  ensureDir(path.dirname(dataXlsx))
  XLSX.writeFile(wb, dataXlsx)
  return rows
}

function isProductImage(filename) {
  if (filename === 'logo.png') return false
  return /\.(png|webp|jpe?g)$/i.test(filename)
}

async function syncProductImages() {
  if (!fs.existsSync(dropDir)) return []
  ensureDir(productsDir)
  /** @type {string[]} */
  const copied = []
  for (const file of fs.readdirSync(dropDir)) {
    if (!isProductImage(file)) continue
    const from = path.join(dropDir, file)
    const to = path.join(productsDir, file)
    fs.copyFileSync(from, to)
    try {
      const result = await normalizeProductImage(to)
      console.log(
        `product image → public/products/${file} (normalized: ${result.mode})`,
      )
    } catch (err) {
      console.warn(
        `product image → public/products/${file} (copied, normalize failed: ${err instanceof Error ? err.message : err})`,
      )
    }
    copied.push(file)
  }
  return copied
}

function mergeIncrementalWorkbook() {
  const master = normalizeRows(readRows(dataXlsx))
  const incoming = fs.existsSync(dropXlsx) ? normalizeRows(readRows(dropXlsx)) : new Map()

  if (!incoming.size && !master.size) {
    throw new Error(
      'No catalog yet. Place a full workbook at data/commodity_idx.xlsx, or upload the first batch to new_input/.',
    )
  }

  let added = 0
  let updated = 0
  for (const [id, row] of incoming) {
    if (master.has(id)) updated += 1
    else added += 1
    master.set(id, row)
  }

  const rows = writeMasterWorkbook(master)
  if (incoming.size) {
    console.log(
      `merged new_input workbook → data/commodity_idx.xlsx (+${added} new, ~${updated} updated, ${rows.length} total)`,
    )
  } else {
    console.log(`master workbook re-sorted (${rows.length} SKUs in data/commodity_idx.xlsx)`)
  }
  return rows
}

function mapType(category1) {
  const v = String(category1 || '').trim().toLowerCase()
  // accept common typo "Accssory"; TW / CN labels
  if (
    v === 'accessory' ||
    v === 'accessories' ||
    v === 'accssory' ||
    v === '配饰' ||
    v === '配件'
  ) {
    return 'accessory'
  }
  return 'bead'
}

/** Normalize category1 spelling for the master workbook (TW Traditional Chinese). */
function normalizeCategory1(category1) {
  return mapType(category1) === 'accessory' ? '配件' : '珠子'
}

/** @param {object[]} rows */
function buildCatalogJson(rows) {
  const missingImages = new Set()
  const sorted = [...rows].sort(compareCatalogRows)
  const products = sorted.map((row) => {
    const picture = row.picture
    if (picture && !fs.existsSync(path.join(productsDir, picture))) {
      missingImages.add(picture)
    }
    return {
      id: row.id,
      type: mapType(row.category1),
      category: row.category2 || '未分類',
      name: row.name,
      diameterMm: row.size_mm,
      price: row.price_twd,
      image: picture ? `/products/${picture}` : '',
      color: '#d6d3d1',
    }
  })

  ensureDir(path.dirname(outJson))
  fs.writeFileSync(outJson, JSON.stringify({ products }, null, 2) + '\n')
  console.log(`wrote ${products.length} SKUs → src/shared/data/catalog.json`)

  if (missingImages.size) {
    console.warn('missing images in public/products/:', [...missingImages].join(', '))
  }

  // Drop obsolete product images not referenced by the new catalog
  const keep = new Set(products.map((p) => path.basename(p.image)).filter(Boolean))
  if (fs.existsSync(productsDir)) {
    for (const file of fs.readdirSync(productsDir)) {
      if (!isProductImage(file)) continue
      if (keep.has(file)) continue
      fs.unlinkSync(path.join(productsDir, file))
      console.log(`removed obsolete product image: ${file}`)
    }
  }
}

/** Reset drop zone after sync: empty catalog sheet + category reference; remove batch images. */
function clearDropZone(copiedImages, masterRows) {
  if (!fs.existsSync(dropDir)) ensureDir(dropDir)

  writeDropZoneWorkbook(masterRows)

  for (const file of copiedImages) {
    const p = path.join(dropDir, file)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  if (copiedImages.length) {
    console.log(`cleared ${copiedImages.length} product image(s) from new_input/`)
  }

  for (const file of fs.readdirSync(dropDir)) {
    if (file === 'commodity_idx.xlsx' || file.startsWith('.')) continue
    if (/\.svg$/i.test(file) || file === 'logo.png') {
      console.warn(
        `note: ${file} in new_input/ is ignored — keep UI assets in public/brand or public/icons`,
      )
    }
  }
}

const copiedImages = await syncProductImages()
let rows = mergeIncrementalWorkbook()
await buildLuminanceMap(rows.map((r) => r.picture))
rows = writeMasterWorkbook(new Map(rows.map((r) => [r.id, r])))
console.log(
  `shelf order: light→dark by image luminance (${luminanceByPicture.size} pictures scored)`,
)
buildCatalogJson(rows)
clearDropZone(copiedImages, rows)
