#!/usr/bin/env node
/**
 * Export selected catalog rows (+ images) from master data/ into new_input/.
 *
 * Usage:
 *   node scripts/export-to-new-input.mjs 隔珠 吊墜
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const COLUMNS = [
  'id',
  'category1',
  'category2',
  'name',
  'size_mm',
  'high_mm',
  'price_twd',
  'picture',
  'supply',
]
const CATEGORY_COLUMNS = ['category1', 'category2']
const SHEET_CATALOG = 'catalog'
const SHEET_CATEGORIES = 'categories'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataXlsx = path.join(root, 'data', 'commodity_idx.xlsx')
const dropDir = path.join(root, 'new_input')
const dropXlsx = path.join(dropDir, 'commodity_idx.xlsx')
const productsDir = path.join(root, 'public', 'products')

const categoryFilters = process.argv.slice(2)
if (!categoryFilters.length) {
  console.error('usage: node scripts/export-to-new-input.mjs <category2> [...]')
  process.exit(1)
}

const filterSet = new Set(categoryFilters)

function readRows(filePath) {
  const wb = XLSX.readFile(filePath)
  const name = wb.SheetNames.includes(SHEET_CATALOG)
    ? SHEET_CATALOG
    : wb.SheetNames[0]
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
}

function uniqueCategories(rows) {
  const map = new Map()
  for (const row of rows) {
    const category1 = String(row.category1 ?? '').trim()
    const category2 = String(row.category2 ?? '').trim()
    if (!category2) continue
    map.set(`${category1}::${category2}`, { category1, category2 })
  }
  return [...map.values()].sort((a, b) =>
    a.category1 === b.category1
      ? a.category2.localeCompare(b.category2, 'zh-Hant')
      : a.category1.localeCompare(b.category1, 'zh-Hant'),
  )
}

const masterRows = readRows(dataXlsx)
const exported = masterRows
  .filter((row) => filterSet.has(String(row.category2 ?? '').trim()))
  .map((row) => {
    const sizeMm = Number(row.size_mm) || 0
    const highRaw = Number(row.high_mm)
    const highMm =
      Number.isFinite(highRaw) && highRaw > 0 ? highRaw : sizeMm
    return {
      id: String(row.id ?? '').trim(),
      category1: String(row.category1 ?? '').trim(),
      category2: String(row.category2 ?? '').trim(),
      name: String(row.name ?? '').trim(),
      size_mm: sizeMm,
      high_mm: highMm,
      price_twd: Number(row.price_twd) || 0,
      picture: String(row.picture ?? '').trim(),
      supply: String(row.supply ?? '').trim(),
    }
  })
  .sort((a, b) => {
    const byCat = a.category2.localeCompare(b.category2, 'zh-Hant')
    if (byCat !== 0) return byCat
    return a.name.localeCompare(b.name, 'zh-Hant')
  })

if (!exported.length) {
  console.error(`no rows matched category2: ${[...filterSet].join(', ')}`)
  process.exit(1)
}

fs.mkdirSync(dropDir, { recursive: true })

const wb = XLSX.utils.book_new()
const catalogSheet = XLSX.utils.json_to_sheet(exported, { header: COLUMNS })
XLSX.utils.book_append_sheet(wb, catalogSheet, SHEET_CATALOG)

const catSheet = XLSX.utils.json_to_sheet(uniqueCategories(masterRows), {
  header: CATEGORY_COLUMNS,
})
XLSX.utils.book_append_sheet(wb, catSheet, SHEET_CATEGORIES)
XLSX.writeFile(wb, dropXlsx)

let copied = 0
const missing = []
for (const row of exported) {
  if (!row.picture) continue
  const src = path.join(productsDir, row.picture)
  const dest = path.join(dropDir, row.picture)
  if (!fs.existsSync(src)) {
    missing.push(row.picture)
    continue
  }
  fs.copyFileSync(src, dest)
  copied += 1
}

console.log(
  `exported ${exported.length} SKU(s) (${[...filterSet].join(', ')}) → new_input/commodity_idx.xlsx`,
)
console.log(`copied ${copied} image(s) → new_input/`)
if (missing.length) {
  console.warn(`missing images (${missing.length}):`, missing.join(', '))
}
