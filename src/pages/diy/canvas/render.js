/**
 * Canvas drawing for track + center logo + beads (images or color fallback).
 */

import { contentZoom, getContentBBox } from './imageMetrics.js'

/** @type {Map<string, HTMLImageElement>} */
const imageCache = new Map()

const BRAND_LOGO_SRC = `${import.meta.env.BASE_URL || '/'}brand/logo-black.png?v=5`

/**
 * @param {string} src
 * @param {() => void} [onLoad]
 * @returns {HTMLImageElement | null}
 */
export function getProductImage(src, onLoad) {
  if (!src) return null
  const cached = imageCache.get(src)
  if (cached) return cached.complete ? cached : null

  const img = new Image()
  img.decoding = 'async'
  img.onload = () => onLoad?.()
  img.onerror = () => onLoad?.()
  img.src = src
  imageCache.set(src, img)
  return null
}

/**
 * @typedef {{ dragId?: string | null, dragX?: number, dragY?: number }} DragState
 * @typedef {Record<string, { x: number, y: number }>} FlyOverrides
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, cy: number, pathRadius: number, width: number, height: number }} geo
 * @param {import('./layout.js').LayoutBead[]} layout
 * @param {DragState} [drag]
 * @param {() => void} [onImageLoad]
 * @param {FlyOverrides} [fly]
 */
export function drawScene(ctx, geo, layout, drag = {}, onImageLoad, fly = {}) {
  const { width, height, cx, cy, pathRadius } = geo
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f9f9f9'
  ctx.fillRect(0, 0, width, height)

  ctx.beginPath()
  ctx.arc(cx, cy, pathRadius, 0, Math.PI * 2)
  ctx.strokeStyle = '#e7e5e4'
  ctx.lineWidth = 1.5
  ctx.stroke()

  drawBrandLogo(ctx, cx, cy, pathRadius, onImageLoad)

  for (const bead of layout) {
    if (bead.instanceId === drag.dragId) continue
    const override = fly[bead.instanceId]
    const x = override ? override.x : bead.x
    const y = override ? override.y : bead.y
    drawItem(ctx, bead, x, y, 1, onImageLoad, { shadow: true })
  }

  if (drag.dragId) {
    const bead = layout.find((b) => b.instanceId === drag.dragId)
    if (bead) {
      drawItem(
        ctx,
        bead,
        drag.dragX ?? bead.x,
        drag.dragY ?? bead.y,
        0.9,
        onImageLoad,
        { shadow: true },
      )
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} pathRadius
 * @param {() => void} [onImageLoad]
 */
function drawBrandLogo(ctx, cx, cy, pathRadius, onImageLoad) {
  const img = getProductImage(BRAND_LOGO_SRC, onImageLoad)
  if (!img) return
  const size = pathRadius * 0.78
  ctx.save()
  ctx.globalAlpha = 1
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size)
  ctx.restore()
}

/**
 * Soft floating drop-shadow (light from top-left → shadow bottom-right),
 * matching the reference DIY app. No white halo.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} r
 */
function drawBeadShadow(ctx, x, y, r) {
  const ox = r * 0.14
  const oy = r * 0.22
  const supportsFilter = typeof ctx.filter === 'string'

  ctx.save()
  if (supportsFilter) {
    // Soft outer pool
    ctx.filter = `blur(${Math.max(4, r * 0.48)}px)`
    ctx.globalAlpha = 0.1
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(x + ox * 1.1, y + oy * 1.15, r * 0.95, r * 0.72, 0, 0, Math.PI * 2)
    ctx.fill()
    // Tighter contact shadow
    ctx.filter = `blur(${Math.max(2, r * 0.28)}px)`
    ctx.globalAlpha = 0.14
    ctx.beginPath()
    ctx.ellipse(x + ox, y + oy, r * 0.78, r * 0.55, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.filter = 'none'
  } else {
    // Fallback: layered radial gradients
    const layers = [
      { dx: 0.18, dy: 0.35, rx: 1.0, ry: 0.72, a: 0.05 },
      { dx: 0.12, dy: 0.26, rx: 0.85, ry: 0.58, a: 0.08 },
      { dx: 0.08, dy: 0.18, rx: 0.68, ry: 0.45, a: 0.1 },
    ]
    for (const L of layers) {
      const cx = x + r * L.dx
      const cy = y + r * L.dy
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * L.rx)
      grd.addColorStop(0, `rgba(0,0,0,${L.a})`)
      grd.addColorStop(0.5, `rgba(0,0,0,${L.a * 0.4})`)
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath()
      ctx.ellipse(cx, cy, r * L.rx, r * L.ry, 0, 0, Math.PI * 2)
      ctx.fillStyle = grd
      ctx.fill()
    }
  }
  ctx.restore()
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./layout.js').LayoutBead} bead
 * @param {number} x
 * @param {number} y
 * @param {number} alpha
 * @param {() => void} [onImageLoad]
 * @param {{ shadow?: boolean }} [opts]
 */
function drawItem(ctx, bead, x, y, alpha, onImageLoad, opts = {}) {
  if (bead.pendant) {
    drawPendant(ctx, bead, x, y, alpha, onImageLoad, opts)
  } else {
    drawBead(ctx, bead, x, y, alpha, onImageLoad, opts)
  }
}

/**
 * Pendant: hook sits on the cord at (x,y); body hangs radially outward.
 * Product art is assumed hook-at-top (image +Y = body).
 * Accessories stretch to size_mm (tangent width) × high_mm (outward max height).
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./layout.js').LayoutBead} bead
 * @param {number} x
 * @param {number} y
 * @param {number} alpha
 * @param {() => void} [onImageLoad]
 * @param {{ shadow?: boolean }} [opts]
 */
function drawPendant(ctx, bead, x, y, alpha, onImageLoad, opts = {}) {
  // size_mm × high_mm — anisotropic stretch to catalog max extents.
  const drawW = bead.bodyWidthPx || bead.radiusPx * 2
  const drawH = bead.bodyHeightPx || bead.radiusPx * 8
  // Map local +Y (down in image) onto outward radial (cos θ, sin θ).
  const outwardRot = (bead.angle ?? -Math.PI / 2) - Math.PI / 2

  const img = bead.image ? getProductImage(bead.image, onImageLoad) : null
  /** @type {{ x: number, y: number, w: number, h: number } | null} */
  let src = null
  if (img) {
    const box = getContentBBox(img)
    src = { x: box.x, y: box.y, w: box.w, h: box.h }
  }

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.rotate(outwardRot)

  if (opts.shadow !== false) {
    drawPendantShadow(ctx, drawW, drawH)
  }

  if (img && src) {
    // Bail sits on the cord; stretch opaque content to size_mm × high_mm.
    const hookInset = drawH * 0.08
    ctx.drawImage(
      img,
      src.x,
      src.y,
      src.w,
      src.h,
      -drawW / 2,
      -hookInset,
      drawW,
      drawH,
    )
  } else if (!img) {
    const color = bead.color || '#d6d3d1'
    const w = drawW
    const h = drawH
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(w * 0.35, h * 0.2)
    ctx.lineTo(w * 0.28, h)
    ctx.lineTo(-w * 0.28, h)
    ctx.lineTo(-w * 0.35, h * 0.2)
    ctx.closePath()
    ctx.fill()
  }

  ctx.restore()
}

/**
 * Soft shadow for a hanging pendant (local coords: hook at 0, body +Y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
function drawPendantShadow(ctx, w, h) {
  const supportsFilter = typeof ctx.filter === 'string'
  ctx.save()
  // Keep pendant shadows very light — dark blobs hide silver/crystal detail.
  if (supportsFilter) {
    ctx.filter = `blur(${Math.max(3, h * 0.1)}px)`
    ctx.globalAlpha = 0.08
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(w * 0.06, h * 0.58, w * 0.32, h * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.filter = 'none'
  } else {
    ctx.globalAlpha = 0.06
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(w * 0.06, h * 0.58, w * 0.3, h * 0.28, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./layout.js').LayoutBead} bead
 * @param {number} x
 * @param {number} y
 * @param {number} alpha
 * @param {() => void} [onImageLoad]
 * @param {{ shadow?: boolean }} [opts]
 */
/**
 * On-cord item (bead or accessory).
 * Accessories: anisotropic stretch of opaque content to size_mm × high_mm
 * (tangent × radial max). Beads: uniform scale into a circle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./layout.js').LayoutBead} bead
 * @param {number} x
 * @param {number} y
 * @param {number} alpha
 * @param {() => void} [onImageLoad]
 * @param {{ shadow?: boolean }} [opts]
 */
function drawBead(ctx, bead, x, y, alpha, onImageLoad, opts = {}) {
  const boxW = bead.trackWidthPx > 0 ? bead.trackWidthPx : bead.radiusPx * 2
  const boxH = bead.faceHeightPx > 0 ? bead.faceHeightPx : bead.radiusPx * 2
  const halfW = boxW / 2
  const halfH = boxH / 2
  const shadowR = Math.max(halfW, halfH)
  const accessory = Boolean(bead.accessory)

  ctx.save()
  ctx.globalAlpha = alpha

  if (opts.shadow !== false) {
    drawBeadShadow(ctx, x, y, shadowR)
  }

  // Rotate so the bead’s horizontal cord-hole aligns with the ring tangent
  // (θ = -π/2 at top → rotation 0; elsewhere the cord forms a continuous circle).
  const tangentRot = (bead.angle ?? -Math.PI / 2) + Math.PI / 2

  const img = bead.image ? getProductImage(bead.image, onImageLoad) : null
  ctx.translate(x, y)
  ctx.rotate(tangentRot)

  if (accessory) {
    // Fill the full size_mm × high_mm rect (max extents). No uniform-only scale.
    if (img) {
      const box = getContentBBox(img)
      ctx.drawImage(
        img,
        box.x,
        box.y,
        box.w,
        box.h,
        -halfW,
        -halfH,
        boxW,
        boxH,
      )
    } else {
      const color = bead.color || '#d6d3d1'
      const grd = ctx.createRadialGradient(
        -shadowR * 0.35,
        -shadowR * 0.35,
        shadowR * 0.1,
        0,
        0,
        shadowR,
      )
      grd.addColorStop(0, lighten(color, 0.35))
      grd.addColorStop(0.55, color)
      grd.addColorStop(1, darken(color, 0.25))
      ctx.beginPath()
      ctx.rect(-halfW, -halfH, boxW, boxH)
      ctx.fillStyle = grd
      ctx.fill()
    }
    ctx.restore()
    return
  }

  // Beads: circular clip + uniform content zoom (preserve aspect).
  ctx.beginPath()
  ctx.arc(0, 0, halfW, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  if (img) {
    const zoom = contentZoom(img)
    const drawR = halfW * zoom
    ctx.drawImage(img, -drawR, -drawR, drawR * 2, drawR * 2)
  } else {
    const color = bead.color || '#d6d3d1'
    const r = halfW
    const grd = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r)
    grd.addColorStop(0, lighten(color, 0.35))
    grd.addColorStop(0.55, color)
    grd.addColorStop(1, darken(color, 0.25))
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fillStyle = grd
    ctx.fill()
  }

  ctx.restore()
}

/** @param {string} hex @param {number} amount */
function lighten(hex, amount) {
  const { r, g, b } = parseHex(hex)
  return `rgb(${lift(r, amount)},${lift(g, amount)},${lift(b, amount)})`
}

/** @param {string} hex @param {number} amount */
function darken(hex, amount) {
  const { r, g, b } = parseHex(hex)
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`
}

function lift(c, amount) {
  return Math.min(255, Math.round(c + (255 - c) * amount))
}

/** @param {string} hex */
function parseHex(hex) {
  const h = hex.replace('#', '')
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    }
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}
