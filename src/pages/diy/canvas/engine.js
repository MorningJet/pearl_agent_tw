import { layoutBeads, gapInsertIndex } from './layout.js'
import { drawScene } from './render.js'
import {
  getResolvedBeads,
  removeBead,
  reorderBead,
  subscribe,
} from '../../../shared/state/designStore.js'
import { totalCircumferenceMm, trackRepresentedMm } from '../../../shared/domain/sizing.js'

/** Extra px beyond the ring before a drag-out counts as delete (reorder zone is wider). */
const DELETE_EXTRA = 48
const REORDER_SLACK = 88
const FLY_MS = 420

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createCanvasApp(canvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  /** @type {import('./layout.js').LayoutBead[]} */
  let layout = []
  let geo = { cx: 0, cy: 0, pathRadius: 0, mmToPx: 2.2, width: 0, height: 0 }

  /** @type {{ id: string, index: number, x: number, y: number, pointerId: number } | null} */
  let drag = null

  /** @type {Set<string>} */
  let knownIds = new Set()

  /**
   * Fly-in from shelf top-center → ring slot.
   * @type {Map<string, { fromX: number, fromY: number, toX: number, toY: number, start: number, duration: number }>}
   */
  const flyIns = new Map()
  let raf = 0

  function measureFrame() {
    const parent = canvas.parentElement
    const w = parent?.clientWidth ?? 320
    const h = parent?.clientHeight ?? 320
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const topEl = document.getElementById('top-bar')
    const midEl = document.getElementById('middle-bar')
    const topReserve = topEl ? topEl.offsetHeight + 16 : 48
    const bottomReserve = midEl ? midEl.offsetHeight + 52 : 88
    const usable = Math.max(h - topReserve - bottomReserve, 120)
    const pathRadius = Math.min(w * 0.32, usable * 0.38)
    geo = {
      width: w,
      height: h,
      cx: w / 2,
      cy: topReserve + usable / 2,
      pathRadius,
      mmToPx: geo.mmToPx,
    }
    syncScale()
  }

  function syncScale() {
    const totalMm = totalCircumferenceMm(getResolvedBeads())
    const representedMm = trackRepresentedMm(totalMm)
    geo.mmToPx = (Math.PI * 2 * geo.pathRadius) / representedMm
  }

  function rebuild() {
    syncScale()
    layout = layoutBeads(getResolvedBeads(), geo)
    // Keep in-flight targets aligned with latest ring slots
    for (const [id, anim] of flyIns) {
      const b = layout.find((x) => x.instanceId === id)
      if (b) {
        anim.toX = b.x
        anim.toY = b.y
      }
    }
  }

  /** Midpoint of canvas bottom edge = shelf top-center in canvas space. */
  function flyOrigin() {
    return { x: geo.width / 2, y: geo.height - 2 }
  }

  /** @param {number} t 0..1 */
  function easeOutCubic(t) {
    return 1 - (1 - t) ** 3
  }

  function flyOverrides(now = performance.now()) {
    /** @type {Record<string, { x: number, y: number }>} */
    const out = {}
    for (const [id, anim] of flyIns) {
      const t = Math.min(1, (now - anim.start) / anim.duration)
      const e = easeOutCubic(t)
      out[id] = {
        x: anim.fromX + (anim.toX - anim.fromX) * e,
        y: anim.fromY + (anim.toY - anim.fromY) * e,
      }
    }
    return out
  }

  function paint() {
    drawScene(
      ctx,
      geo,
      layout,
      drag ? { dragId: drag.id, dragX: drag.x, dragY: drag.y } : {},
      () => paint(),
      flyOverrides(),
    )
  }

  function tickFly(now) {
    raf = 0
    for (const [id, anim] of [...flyIns]) {
      if (now - anim.start >= anim.duration) flyIns.delete(id)
    }
    paint()
    if (flyIns.size) {
      raf = requestAnimationFrame(tickFly)
    }
  }

  function ensureFlyLoop() {
    if (!raf && flyIns.size) {
      raf = requestAnimationFrame(tickFly)
    }
  }

  /** @param {string} instanceId */
  function startFlyIn(instanceId) {
    const bead = layout.find((b) => b.instanceId === instanceId)
    if (!bead) return
    const from = flyOrigin()
    flyIns.set(instanceId, {
      fromX: from.x,
      fromY: from.y,
      toX: bead.x,
      toY: bead.y,
      start: performance.now(),
      duration: FLY_MS,
    })
    ensureFlyLoop()
  }

  function refresh() {
    rebuild()
    paint()
  }

  function eventPos(e) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width / (canvas.clientWidth || 1)
    const scaleY = rect.height / (canvas.clientHeight || 1)
    return {
      x: (e.clientX - rect.left) / scaleX,
      y: (e.clientY - rect.top) / scaleY,
    }
  }

  function pointerMeta(x, y) {
    const dx = x - geo.cx
    const dy = y - geo.cy
    return {
      x,
      y,
      angle: Math.atan2(dy, dx),
      dist: Math.hypot(dx, dy),
    }
  }

  /** Minimum touch target radius (CSS px) so small SKUs stay grabbable. */
  const MIN_HIT_RADIUS_PX = 16

  function hitTest(x, y) {
    // Prefer the closest hit. Tall pendant bodies used to win z-order and
    // swallow taps meant for neighboring beads on the cord.
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < layout.length; i++) {
      const b = layout[i]
      if (flyIns.has(b.instanceId)) continue
      let hit = false
      let dist = Math.hypot(x - b.x, y - b.y)
      if (b.pendant) {
        hit = hitTestPendant(b, x, y)
        if (hit) {
          // Distance to body midpoint along the outward radial.
          const mid = (b.bodyHeightPx || 0) * 0.45
          const bx = b.x + Math.cos(b.angle) * mid
          const by = b.y + Math.sin(b.angle) * mid
          dist = Math.min(dist, Math.hypot(x - bx, y - by))
        }
      } else {
        const hitR = Math.max(b.radiusPx, MIN_HIT_RADIUS_PX)
        hit = dist <= hitR * Math.sqrt(1.35)
      }
      if (!hit) continue
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

  /**
   * Pendant hit box: local coords with hook at origin and body along +Y (outward).
   * Width is intentionally much smaller than height (hook is only ~size_mm).
   * @param {import('./layout.js').LayoutBead} b
   * @param {number} x
   * @param {number} y
   */
  function hitTestPendant(b, x, y) {
    const dx = x - b.x
    const dy = y - b.y
    const rot = (b.angle ?? -Math.PI / 2) - Math.PI / 2
    const cos = Math.cos(-rot)
    const sin = Math.sin(-rot)
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos
    const h = b.bodyHeightPx || b.radiusPx * 8
    const halfW = Math.max(
      MIN_HIT_RADIUS_PX * 0.75,
      (b.bodyWidthPx || h * 0.45) * 0.5,
    )
    return lx >= -halfW && lx <= halfW && ly >= -b.radiusPx * 0.8 && ly <= h * 1.05
  }

  function onPointerDown(e) {
    const { x, y } = eventPos(e)
    const i = hitTest(x, y)
    if (i < 0) return
    e.preventDefault()
    const b = layout[i]
    drag = { id: b.instanceId, index: i, x, y, pointerId: e.pointerId }
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* ignore — some iframe/webview hosts reject capture */
    }
    paint()
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const { x, y } = eventPos(e)
    // Free drag — follow the finger, not the ring
    drag.x = x
    drag.y = y
    paint()
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const { x, y } = eventPos(e)
    const p = pointerMeta(x, y)

    const deleteLimit = geo.pathRadius + DELETE_EXTRA + REORDER_SLACK
    if (p.dist > deleteLimit) {
      removeBead(drag.id)
      drag = null
      return
    }

    const layoutIndex = layout.findIndex((b) => b.instanceId === drag.id)
    if (layoutIndex < 0) {
      drag = null
      return
    }

    const target = gapInsertIndex(layout, p.angle, layoutIndex)
    if (target !== layoutIndex) {
      reorderBead(layoutIndex, target)
    }
    drag = null
    refresh()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  const ro = new ResizeObserver(() => {
    measureFrame()
    refresh()
  })
  ro.observe(canvas.parentElement || canvas)

  const unsub = subscribe(() => {
    const prev = knownIds
    rebuild()
    const next = new Set(layout.map((b) => b.instanceId))
    const added = [...next].filter((id) => !prev.has(id))
    knownIds = next
    for (const id of added) startFlyIn(id)
    if (!added.length) paint()
    else ensureFlyLoop()
  })

  measureFrame()
  rebuild()
  knownIds = new Set(layout.map((b) => b.instanceId))
  paint()

  /**
   * Square PNG of the bracelet (ring + logo), for Design Details.
   * @returns {string} data URL
   */
  function exportImage() {
    rebuild()
    // Extra pad so hanging pendants (~8mm outward) are not clipped.
    const pad = geo.pathRadius * 0.55
    const size = Math.max(Math.ceil((geo.pathRadius + pad) * 2), 240)
    const dpr = 2
    const off = document.createElement('canvas')
    off.width = Math.floor(size * dpr)
    off.height = Math.floor(size * dpr)
    const octx = off.getContext('2d')
    if (!octx) return canvas.toDataURL('image/png')
    octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const exportGeo = {
      width: size,
      height: size,
      cx: size / 2,
      cy: size / 2,
      pathRadius: geo.pathRadius,
      mmToPx: geo.mmToPx,
    }
    const exportLayout = layoutBeads(getResolvedBeads(), exportGeo)
    drawScene(octx, exportGeo, exportLayout, {}, undefined, {})
    return off.toDataURL('image/png')
  }

  return {
    exportImage,
    destroy() {
      unsub()
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
    },
  }
}
