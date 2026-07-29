/**
 * Place beads on a fixed circular path.
 * Visual path radius stays constant. `mmToPx` maps real diameters onto the
 * circumference the track currently represents (≥13cm, or actual wrist when longer).
 * Angles always span a full 2π so beads spread evenly; bead *drawn* size stays true to mm.
 *
 * Pendants (吊墜): only the hook occupies `diameterMm` on the cord; the body hangs
 * radially outward (~PENDANT_BODY_MM tall).
 *
 * Spacers (隔珠): catalog `diameterMm` is face size; only ~SPACER_TRACK_MM sits on the
 * cord for layout. Saved arc is redistributed to round-to-round gaps only (when present).
 * Product images are always uniformly scaled — never stretched.
 */

import {
  isPendant,
  isSpacer,
  PENDANT_BODY_MM,
  SPACER_TRACK_MM,
} from '../../../shared/data/products.js'

/**
 * @typedef {object} LayoutBead
 * @property {string} instanceId
 * @property {string} productId
 * @property {number} diameterMm
 * @property {string} color
 * @property {string} name
 * @property {string} [image]
 * @property {number} angle rad
 * @property {number} x hook / bead center on the track
 * @property {number} y
 * @property {number} radiusPx bead draw radius (half of diameter); pendants use hook radius
 * @property {boolean} pendant
 * @property {boolean} spacer
 * @property {number} [bodyHeightPx] pendant body length along outward radial
 * @property {number} [bodyWidthPx] pendant draw width
 */

/**
 * @param {Array<{ instanceId: string, productId: string, product: { diameterMm: number, color: string, name: string, image?: string, category?: string, type?: string } }>} resolved
 * @returns {{ left: number, right: number }[]}
 */
function trackHalvesMm(resolved) {
  const n = resolved.length
  /** @type {number[]} */
  const diameters = resolved.map((b) => Math.max(b.product?.diameterMm || 1, 1))
  const wristSum = diameters.reduce((a, b) => a + b, 0)
  const isSpc = (idx) => isSpacer(resolved[idx]?.product)

  let roundRoundJunctions = 0
  for (let i = 0; i < n; i++) {
    if (!isSpc(i) && !isSpc((i + 1) % n)) roundRoundJunctions += 1
  }

  // Pure R-S alternation has no round-round joints — keep catalog spacer arc.
  const useSpacerTrack = roundRoundJunctions > 0

  /** @type {number[]} */
  const trackBase = diameters.map((d, i) => {
    if (useSpacerTrack && isSpc(i)) return SPACER_TRACK_MM
    return d
  })
  const trackSum = trackBase.reduce((a, b) => a + b, 0)
  const slack = wristSum - trackSum
  const slackPerHalf =
    useSpacerTrack && roundRoundJunctions > 0
      ? slack / (2 * roundRoundJunctions)
      : 0

  /** @type {{ left: number, right: number }[]} */
  const halves = []
  for (let i = 0; i < n; i++) {
    const d = diameters[i]
    if (useSpacerTrack && isSpc(i)) {
      halves.push({ left: SPACER_TRACK_MM / 2, right: SPACER_TRACK_MM / 2 })
    } else {
      halves.push({
        left: d / 2 + (isSpc((i - 1 + n) % n) ? 0 : slackPerHalf),
        right: d / 2 + (isSpc((i + 1) % n) ? 0 : slackPerHalf),
      })
    }
  }
  return halves
}

/**
 * @param {Array<{ instanceId: string, productId: string, product: { diameterMm: number, color: string, name: string, image?: string, category?: string, type?: string } }>} resolved
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
    const d = Math.max(b.product?.diameterMm || 1, 1)
    const halfLeft = ((halves[i].left * safeMmToPx) / safeRadius) * scale
    angle += halfLeft
    const radiusPx = (d * safeMmToPx) / 2
    const pendant = isPendant(b.product)
    const spacer = isSpacer(b.product)
    const bodyHeightPx = pendant ? PENDANT_BODY_MM * safeMmToPx : 0
    const bodyWidthPx = pendant ? bodyHeightPx : 0
    out.push({
      instanceId: b.instanceId,
      productId: b.productId,
      diameterMm: b.product.diameterMm,
      color: b.product.color || '#d6d3d1',
      name: b.product.name,
      image: b.product.image || '',
      angle,
      x: cx + Math.cos(angle) * safeRadius,
      y: cy + Math.sin(angle) * safeRadius,
      radiusPx,
      pendant,
      spacer,
      bodyHeightPx,
      bodyWidthPx,
    })
    const halfRight = ((halves[i].right * safeMmToPx) / safeRadius) * scale
    angle += halfRight
  }

  return out
}

/**
 * Snap drop angle to the gap *between* two neighbors (mid-arc), not to a bead center.
 * Returns the `toIndex` for `reorderBead` (insert index after removing `dragIndex`).
 *
 * @param {LayoutBead[]} layout
 * @param {number} angle rad
 * @param {number} dragIndex
 */
export function gapInsertIndex(layout, angle, dragIndex) {
  const n = layout.length
  if (n <= 1) return 0

  /** @type {{ angle: number, index: number }[]} */
  const others = []
  for (let i = 0; i < n; i++) {
    if (i === dragIndex) continue
    others.push({ angle: layout[i].angle, index: i })
  }
  if (!others.length) return 0
  if (others.length === 1) {
    let delta = normalizeAngle(angle - others[0].angle)
    const insertBeforeOriginal = delta < 0 ? others[0].index : others[0].index + 1
    let to = insertBeforeOriginal
    if (dragIndex < insertBeforeOriginal) to -= 1
    return clampIndex(to, n - 1)
  }

  let bestSlot = 0
  let bestDist = Infinity

  for (let i = 0; i < others.length; i++) {
    const a0 = others[i].angle
    const a1 = others[(i + 1) % others.length].angle
    let span = a1 - a0
    while (span <= 0) span += Math.PI * 2
    const mid = a0 + span / 2
    let d = Math.abs(normalizeAngle(angle - mid))
    if (d > Math.PI) d = Math.PI * 2 - d
    if (d < bestDist) {
      bestDist = d
      bestSlot = (i + 1) % others.length
    }
  }

  const insertBeforeOriginal = others[bestSlot].index
  let to = insertBeforeOriginal
  if (dragIndex < insertBeforeOriginal) to -= 1
  return clampIndex(to, n - 1)
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

/** @param {number} i @param {number} max */
function clampIndex(i, max) {
  if (max < 0) return 0
  return Math.max(0, Math.min(i, max))
}
