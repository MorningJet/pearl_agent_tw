/**
 * Normalize a product photo so the bead fills ~90% of a square transparent canvas.
 * Equal diameterMm SKUs then look equal on the bracelet and shelf.
 *
 * Used by `npm run sync:catalog` after copying images into public/products/.
 *
 * CLI:
 *   node scripts/normalize-product-image.mjs public/products
 *   node scripts/normalize-product-image.mjs public/products/pearl_baroque.png
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const PRODUCT_IMAGE_SIZE = 512
export const TARGET_CONTENT_FILL = 0.9

/**
 * @param {Uint8Array|Buffer} data
 * @param {number} channels
 * @param {number} i
 */
function pixel(data, channels, i) {
  return {
    r: data[i],
    g: data[i + 1],
    b: data[i + 2],
    a: channels === 4 ? data[i + 3] : 255,
    lum: (data[i] + data[i + 1] + data[i + 2]) / 3,
    chroma:
      Math.max(data[i], data[i + 1], data[i + 2]) -
      Math.min(data[i], data[i + 1], data[i + 2]),
  }
}

/**
 * True when corners are already punched out (prior normalize / PNG cutout).
 * @param {Buffer} data
 * @param {number} w
 * @param {number} h
 * @param {number} channels
 */
function hasTransparentCorners(data, w, h, channels) {
  const pts = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ]
  let clear = 0
  for (const [x, y] of pts) {
    const p = pixel(data, channels, (y * w + x) * channels)
    if (p.a < 16) clear += 1
  }
  return clear >= 3
}

/**
 * Alpha bbox — keeps dark beads (no luma gate).
 * @param {Buffer} data
 * @param {number} w
 * @param {number} h
 * @param {number} channels
 */
function alphaBBox(data, w, h, channels) {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = channels === 4 ? data[(y * w + x) * channels + 3] : 255
      if (a < 24) continue
      count += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (count < 16 || maxX < minX) return null
  return { minX, minY, maxX, maxY, count }
}

/**
 * For photos on opaque black/white backdrops: keep a disc around the subject
 * (seeded by non-flat pixels), so dark crystal rims are not discarded.
 * @param {Buffer} data
 * @param {number} w
 * @param {number} h
 * @param {number} channels
 */
function cutoutSubjectDisc(data, w, h, channels) {
  const out = Buffer.from(data)
  /** @type {number[]} */
  const xs = []
  /** @type {number[]} */
  const ys = []
  let sumX = 0
  let sumY = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels
      const p = pixel(out, channels, i)
      // Seed on anything that isn't a flat near-black backdrop
      if (p.a < 20) continue
      if (p.lum <= 18 && p.chroma <= 12) continue
      xs.push(x)
      ys.push(y)
      sumX += x
      sumY += y
    }
  }

  if (xs.length < 16) {
    // Fallback: any non-transparent pixel
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * channels
        const p = pixel(out, channels, i)
        if (p.a < 20) continue
        xs.push(x)
        ys.push(y)
        sumX += x
        sumY += y
      }
    }
  }

  if (xs.length < 16) return out

  const cx = sumX / xs.length
  const cy = sumY / ys.length
  let maxR = 0
  for (let i = 0; i < xs.length; i++) {
    const d = Math.hypot(xs[i] - cx, ys[i] - cy)
    if (d > maxR) maxR = d
  }
  // Include dark rim / anti-alias outside the bright seed
  const keepR = Math.max(2, maxR * 1.22)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels
      if (Math.hypot(x - cx, y - cy) > keepR) {
        out[i + 3] = 0
      }
    }
  }
  return out
}

/**
 * @param {Buffer} rgba
 * @param {number} w
 * @param {number} h
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} box
 * @param {number} size
 * @param {number} targetFill
 * @param {string} tmp
 */
async function writeFilledSquare(rgba, w, h, box, size, targetFill, tmp) {
  const bw = box.maxX - box.minX + 1
  const bh = box.maxY - box.minY + 1
  const side = Math.max(bw, bh)
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  let left = Math.floor(cx - side / 2)
  let top = Math.floor(cy - side / 2)
  let width = side
  let height = side
  if (left < 0) {
    width += left
    left = 0
  }
  if (top < 0) {
    height += top
    top = 0
  }
  if (left + width > w) width = w - left
  if (top + height > h) height = h - top
  width = Math.max(1, width)
  height = Math.max(1, height)

  const cleanedPng = await sharp(rgba, {
    raw: { width: w, height: h, channels: 4 },
  })
    .png()
    .toBuffer()

  const beadPx = Math.max(8, Math.round(size * targetFill))
  const subject = await sharp(cleanedPng)
    .extract({ left, top, width, height })
    .resize(beadPx, beadPx, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: subject, gravity: 'centre' }])
    .png()
    .toFile(tmp)
}

/**
 * @param {string} filePath absolute path to png/webp/jpeg in public/products/
 * @param {{ size?: number, targetFill?: number }} [opts]
 */
export async function normalizeProductImage(filePath, opts = {}) {
  const size = opts.size ?? PRODUCT_IMAGE_SIZE
  const targetFill = opts.targetFill ?? TARGET_CONTENT_FILL
  const tmp = `${filePath}.tmp.png`

  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height
  const channels = info.channels

  /** @type {Buffer} */
  let rgba
  /** @type {string} */
  let mode

  if (hasTransparentCorners(data, w, h, channels)) {
    rgba = Buffer.from(data)
    mode = 'alpha-refill'
  } else {
    rgba = cutoutSubjectDisc(data, w, h, channels)
    mode = 'disc-cutout'
  }

  const box = alphaBBox(rgba, w, h, 4)
  if (!box) {
    await sharp(filePath)
      .ensureAlpha()
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(tmp)
    fs.renameSync(tmp, filePath)
    return { ok: true, mode: 'contain-fallback', count: 0 }
  }

  await writeFilledSquare(rgba, w, h, box, size, targetFill, tmp)
  fs.renameSync(tmp, filePath)
  return {
    ok: true,
    mode,
    count: box.count,
    fill: targetFill,
    bbox: [box.maxX - box.minX + 1, box.maxY - box.minY + 1],
  }
}

/**
 * @param {string} dir
 */
export async function normalizeProductDir(dir) {
  if (!fs.existsSync(dir)) return []
  /** @type {string[]} */
  const done = []
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(png|webp|jpe?g)$/i.test(file)) continue
    if (file.startsWith('.')) continue
    await normalizeProductImage(path.join(dir, file))
    done.push(file)
  }
  return done
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node scripts/normalize-product-image.mjs <file-or-dir>')
    process.exit(1)
  }
  const abs = path.resolve(target)
  const st = fs.statSync(abs)
  if (st.isDirectory()) {
    const files = await normalizeProductDir(abs)
    console.log(`normalized ${files.length} image(s) in ${abs}`)
  } else {
    const r = await normalizeProductImage(abs)
    console.log(`normalized ${abs}`, r)
  }
}
