/**
 * Measure how much of a product PNG is actual bead (vs empty padding).
 * Uses alpha only so dark crystals are not treated as empty.
 */

/** @type {WeakMap<HTMLImageElement, number>} */
const fillCache = new WeakMap()

/**
 * @typedef {{ x: number, y: number, w: number, h: number, aspect: number }} ContentBBox
 * @type {WeakMap<HTMLImageElement, ContentBBox>}
 */
const bboxCache = new WeakMap()

/** Target content extent as fraction of image side (leave a tiny margin). */
export const TARGET_CONTENT_FILL = 0.92

/**
 * Opaque alpha bounding box in image pixel space (natural size).
 * @param {HTMLImageElement} img
 * @returns {ContentBBox}
 */
export function getContentBBox(img) {
  const cached = bboxCache.get(img)
  if (cached) return cached

  const nw = img.naturalWidth || img.width
  const nh = img.naturalHeight || img.height
  if (!nw || !nh) {
    const fallback = { x: 0, y: 0, w: 1, h: 1, aspect: 1 }
    bboxCache.set(img, fallback)
    return fallback
  }

  const size = Math.min(96, nw, nh)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    const fallback = { x: 0, y: 0, w: nw, h: nh, aspect: nw / nh }
    bboxCache.set(img, fallback)
    return fallback
  }

  ctx.drawImage(img, 0, 0, size, size)
  let data
  try {
    data = ctx.getImageData(0, 0, size, size).data
  } catch {
    const fallback = { x: 0, y: 0, w: nw, h: nh, aspect: nw / nh }
    bboxCache.set(img, fallback)
    return fallback
  }

  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = data[(y * size + x) * 4 + 3]
      if (a < 24) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX) {
    const fallback = { x: 0, y: 0, w: nw, h: nh, aspect: nw / nh }
    bboxCache.set(img, fallback)
    return fallback
  }

  const scaleX = nw / size
  const scaleY = nh / size
  const x = minX * scaleX
  const y = minY * scaleY
  const w = Math.max(1, (maxX - minX + 1) * scaleX)
  const h = Math.max(1, (maxY - minY + 1) * scaleY)
  const result = { x, y, w, h, aspect: w / h }
  bboxCache.set(img, result)

  const fill = Math.max(maxX - minX + 1, maxY - minY + 1) / size
  fillCache.set(img, Math.min(1, Math.max(0.2, fill)))

  return result
}

/**
 * @param {HTMLImageElement} img
 * @returns {number} max(bboxW, bboxH) / min(imgW, imgH), clamped
 */
export function getContentFill(img) {
  const cached = fillCache.get(img)
  if (cached != null) return cached
  getContentBBox(img)
  return fillCache.get(img) ?? 1
}

/**
 * Zoom factor so bead content fills the destination circle.
 * @param {HTMLImageElement} img
 */
export function contentZoom(img) {
  const fill = getContentFill(img)
  return TARGET_CONTENT_FILL / fill
}
