#!/usr/bin/env node
/**
 * Copy product lifestyle photos from new_input/ → public/products/
 * and generate src/shared/data/productLifestyle.json.
 *
 * Naming:
 * - Per product: <picture-stem>1.<ext>  e.g. 白水晶1.jpeg ↔ 白水晶.png
 * - Shared category: 星座1.* / 字母1.* / 数字1.* → all SKUs in that category2
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dropDir = path.join(root, 'new_input')
const productsDir = path.join(root, 'public', 'products')
const catalogPath = path.join(root, 'src', 'shared', 'data', 'catalog.json')
const outJson = path.join(root, 'src', 'shared', 'data', 'productLifestyle.json')

const LIFESTYLE_RE = /^(.+)1\.(png|jpe?g|webp)$/i

/** Lifestyle file stem → catalog category2 */
const SHARED_CATEGORY_STEMS = new Map([
  ['星座', '星座'],
  ['字母', '字母'],
  ['数字', '數字'],
])

/** @param {string} dir */
function listLifestyleFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => LIFESTYLE_RE.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

/** @param {string} image */
function pictureStemFromImage(image) {
  const base = String(image || '').split('/').pop() || ''
  return base.replace(/\.[^.]+$/, '')
}

fs.mkdirSync(productsDir, { recursive: true })

let copied = 0
for (const file of listLifestyleFiles(dropDir)) {
  fs.copyFileSync(path.join(dropDir, file), path.join(productsDir, file))
  copied += 1
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

/** @type {Record<string, string>} picture stem → lifestyle filename */
const map = {}

for (const file of listLifestyleFiles(productsDir)) {
  const m = file.match(LIFESTYLE_RE)
  if (!m) continue
  const stem = m[1]
  const category = SHARED_CATEGORY_STEMS.get(stem)
  if (category) {
    for (const p of catalog.products) {
      if (p.category !== category) continue
      map[pictureStemFromImage(p.image)] = file
    }
    continue
  }
  map[stem] = file
}

fs.writeFileSync(outJson, `${JSON.stringify(map, null, 2)}\n`)
console.log(
  `synced ${copied} new file(s) from new_input; ${Object.keys(map).length} lifestyle mapping(s) → ${path.relative(root, outJson)}`,
)
