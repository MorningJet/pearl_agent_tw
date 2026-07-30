/**
 * Place beads on a fixed circular path.
 * Visual path radius stays constant. `mmToPx` maps real diameters onto the
 * circumference the track currently represents (≥13cm, or actual wrist when longer).
 * Angles always span a full 2π so beads spread evenly; bead *drawn* size stays true to mm.
 *
 * Size model (Excel → runtime):
 * - `size_mm` / `diameterMm`: max extent along the bracelet cord (track occupancy)
 * - `high_mm` / `highMm`: max extent perpendicular to the cord (radial / face)
 *
 * Beads are spherical (`highMm === diameterMm`) and keep uniform circular draw.
 * On-cord accessories (隔珠 / 字母 / …) stretch PNG to size_mm × high_mm.
 * Pendants (吊墜): size_mm = bail/hook width on the cord only; high_mm = tip-to-tip
 * height; body hangs outward with **uniform** scale (aspect preserved).
 */

import {
  faceMmOf,
  isPendant,
  isSpacer,
  trackMmOf,
} from '../../../shared/data/products.js'

/**
 * @typedef {object} LayoutBead
 * @property {string} instanceId
 * @property {string} productId
 * @property {number} diameterMm
 * @property {number} highMm
 * @property {string} color
 * @property {string} name
 * @property {string} [image]
 * @property {number} angle rad — bead center on the track
 * @property {number} halfLeftRad arc from center toward previous neighbor
 * @property {number} halfRightRad arc from center toward next neighbor
 * @property {number} x hook / bead center on the track
 * @property {number} y
 * @property {number} radiusPx draw radius (round beads: face/2; pendants: hook/2)
 * @property {boolean} pendant
 * @property {boolean} spacer
 * @property {boolean} accessory on-cord accessory (not pendant): stretch to size×high
 * @property {number} [trackWidthPx] cord-axis draw width (size_mm) for on-cord items
 * @property {number} [faceHeightPx] radial draw height (high_mm) for on-cord items
 * @property {number} [bodyHeightPx] pendant: high_mm in px (bail→tip)
 * @property {number} [bodyWidthPx] pendant hit width hint (hook-scale; draw uses aspect)
 */

/**
 * Cord occupancy for layout (mm) — always Excel `size_mm`.
 * @param {{ product: { diameterMm?: number } }} resolved
 */
function trackMm(resolved) {
  return trackMmOf(resolved.product)
}

/**
 * Equal gap on every adjacent pair: each item keeps its track half.
 *
 * @param {Array<{ product: { diameterMm?: number } }>} resolved
 * @returns {{ left: number, right: number }[]}
 */
function trackHalvesMm(resolved) {
  return resolved.map((b) => {
    const t = trackMm(b)
    return { left: t / 2, right: t / 2 }
  })
}

/**
 * @param {Array<{ instanceId: string, productId: string, product: { diameterMm: number, highMm?: number, color: string, name: string, image?: string, category?: string, type?: string } }>} resolved
 * @param {{ cx: number, cy: number, pathRadius: number, mmToPx: number }} geo
 * @returns {LayoutBead[]}
 */
export function layoutBeads(resolved, geo) {
  const { cx, cy, pathRadius, mmToPx } = geo
  if (!resolved.length) return []
  const safeRadius = Math.max(pathRadius, 1)
  const safeMmToPx = Number.isFinite(mmToPx) && mmToPx > 0 ? mmToPx : 2.2

  const halves = trackHalvesMm(resolved)
  const totalMm = halves.reduce((sum, h) => sum + h.left + h.right, 0)
  const naturalAngle = (totalMm * safeMmToPx) / safeRadius
  // Always fill the full loop so beads do not clump on one arc.
  const scale = naturalAngle > 0 ? (Math.PI * 2) / naturalAngle : 1

  let angle = -Math.PI / 2
  /** @type {LayoutBead[]} */
  const out = []

  for (let i = 0; i < resolved.length; i++) {
    const b = resolved[i]
    const track = trackMmOf(b.product)
    const face = faceMmOf(b.product)
    const halfLeft = ((halves[i].left * safeMmToPx) / safeRadius) * scale
    const halfRight = ((halves[i].right * safeMmToPx) / safeRadius) * scale
    angle += halfLeft
    const pendant = isPendant(b.product)
    const spacer = isSpacer(b.product)
    // Pendants are accessories in catalog type, but must not use stretch-to-box draw.
    const accessory = b.product.type === 'accessory' && !pendant
    // Cord occupancy always size_mm.
    // - On-cord accessories: stretch art to size_mm × high_mm
    // - Pendants: size_mm = bail on cord; high_mm = hanging height; uniform scale
    // - Beads: circular face from diameter (= high_mm)
    const trackWidthPx = track * safeMmToPx
    const faceHeightPx = face * safeMmToPx
    const radiusPx = pendant
      ? trackWidthPx / 2
      : Math.max(trackWidthPx, faceHeightPx) / 2
    const bodyHeightPx = pendant ? faceHeightPx : 0
    // Hit width stays hook-ish so tall bodies do not steal neighbor taps.
    const bodyWidthPx = pendant
      ? Math.max(trackWidthPx, faceHeightPx * 0.45)
      : 0
    out.push({
      instanceId: b.instanceId,
      productId: b.productId,
      diameterMm: b.product.diameterMm,
      highMm: face,
      color: b.product.color || '#d6d3d1',
      name: b.product.name,
      image: b.product.image || '',
      angle,
      halfLeftRad: halfLeft,
      halfRightRad: halfRight,
      x: cx + Math.cos(angle) * safeRadius,
      y: cy + Math.sin(angle) * safeRadius,
      radiusPx,
      pendant,
      spacer,
      accessory,
      trackWidthPx: pendant ? 0 : trackWidthPx,
      faceHeightPx: pendant ? 0 : faceHeightPx,
      bodyHeightPx,
      bodyWidthPx,
    })
    angle += halfRight
  }

  return out
}

/** Midpoint along the shorter arc from `start` to `end` (radians). */
function shortArcMid(start, end) {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start))
  return start + delta / 2
}

/** Shortest angular distance between two angles. */
function shortAngleDist(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

/**
 * Snap drop angle to the gap *between* two neighbors (mid-arc), not to a bead center.
 * Returns the original array index to insert before (for `reorderInsertIndex`).
 *
 * @param {LayoutBead[]} layout
 * @param {number} angle rad
 * @param {number} dragIndex
 */
export function gapInsertIndex(layout, angle, dragIndex) {
  const n = layout.length
  if (n <= 1) return 0

  /** @type {{ bead: LayoutBead, index: number }[]} */
  const others = []
  for (let i = 0; i < n; i++) {
    if (i === dragIndex) continue
    others.push({ bead: layout[i], index: i })
  }
  if (!others.length) return 0
  if (others.length === 1) {
    const delta = normalizeAngle(angle - others[0].bead.angle)
    return delta < 0 ? others[0].index : others[0].index + 1
  }

  let bestInsertBefore = others[0].index
  let bestDist = Infinity

  for (let i = 0; i < others.length; i++) {
    const left = others[i].bead
    const right = others[(i + 1) % others.length].bead
    const insertBefore = others[(i + 1) % others.length].index
    const gapStart = left.angle + (left.halfRightRad ?? 0)
    const gapEnd = right.angle - (right.halfLeftRad ?? 0)
    const mid = shortArcMid(gapStart, gapEnd)
    const d = shortAngleDist(angle, mid)
    if (d < bestDist) {
      bestDist = d
      bestInsertBefore = insertBefore
    }
  }

  return clampIndex(bestInsertBefore, n)
}

/**
 * Map “insert before original index” to `reorderBead(from, to)`'s `to` (final index).
 * @param {number} fromIndex
 * @param {number} insertBefore
 */
export function reorderInsertIndex(fromIndex, insertBefore) {
  if (fromIndex === insertBefore) return fromIndex
  if (fromIndex < insertBefore) return insertBefore - 1
  return insertBefore
}

/** @param {LayoutBead[]} layout @param {number} angle */
export function nearestIndexByAngle(layout, angle) {
  if (!layout.length) return -1
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < layout.length; i++) {
    let d = Math.abs(normalizeAngle(layout[i].angle - angle))
    if (d > Math.PI) d = Math.PI * 2 - d
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/** @param {number} a */
export function normalizeAngle(a) {
  let x = a
  while (x <= -Math.PI) x += Math.PI * 2
  while (x > Math.PI) x -= Math.PI * 2
  return x
}

/** @param {number} i @param {number} max inclusive upper bound */
function clampIndex(i, max) {
  if (max < 0) return 0
  return Math.max(0, Math.min(i, max))
}
