#!/usr/bin/env node
/**
 * Copy product lifestyle photos from new_input/ → public/products/
 * and generate src/shared/data/productLifestyle.json.
 *
 * Naming: <picture-stem>1.<ext>  e.g. 白水晶1.jpeg ↔ catalog picture 白水晶.png
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dropDir = path.join(root, 'new_input')
const productsDir = path.join(root, 'public', 'products')
const outJson = path.join(root, 'src', 'shared', 'data', 'productLifestyle.json')

const LIFESTYLE_RE = /^(.+)1\.(png|jpe?g|webp)$/i

/** @param {string} dir */
function listLifestyleFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => LIFESTYLE_RE.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

fs.mkdirSync(productsDir, { recursive: true })

/** @type {Record<string, string>} picture stem → lifestyle filename */
const map = {}
let copied = 0

for (const file of listLifestyleFiles(dropDir)) {
  const m = file.match(LIFESTYLE_RE)
  if (!m) continue
  const stem = m[1]
  const src = path.join(dropDir, file)
  const dest = path.join(productsDir, file)
  fs.copyFileSync(src, dest)
  copied += 1
  map[stem] = file
}

fs.writeFileSync(outJson, `${JSON.stringify(map, null, 2)}\n`)
console.log(
  `synced ${copied} lifestyle photo(s) → public/products/, wrote ${path.relative(root, outJson)}`,
)
