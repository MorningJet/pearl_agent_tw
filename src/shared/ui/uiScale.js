/**
 * Auto-fit UI (rem / Tailwind text) to the live CSS viewport.
 * Works for any phone brand/model — not limited to the studio iPhone list.
 *
 * Design reference: iPhone 17 Pro Max logical width (440 CSS px) → scale 1.
 */

/** @type {number} */
export const UI_BASE_WIDTH = 440

/** Narrow breakpoint — matches studio “real phone” layout. */
export const LIVE_PHONE_MQ = '(max-width: 900px)'

/**
 * Shopify / production: hide desktop studio shell.
 * - `?embed=1` or `?app=1` forces app chrome
 * - iframe (Shopify Page) auto-embeds
 * - `?studio=1` forces desktop preview even in an iframe
 */
export function isEmbedMode() {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('studio') === '1') return false
    if (q.get('embed') === '1' || q.get('app') === '1') return true
    return window.self !== window.top
  } catch {
    // Cross-origin iframe access edge cases → prefer user app chrome
    return true
  }
}

/** Apply before first paint helpers / studio init (also mirrored in index.html). */
export function applyEmbedClass() {
  if (isEmbedMode()) document.documentElement.classList.add('embed-app')
  else document.documentElement.classList.remove('embed-app')
}

export function isLivePhoneViewport() {
  return isEmbedMode() || window.matchMedia(LIVE_PHONE_MQ).matches
}

/**
 * Best-effort CSS viewport width (handles Safari toolbars / rotation).
 * @returns {number}
 */
export function measureViewportWidth() {
  const screenEl = document.getElementById('device-screen')
  const vv = window.visualViewport

  // Desktop embed letterbox: scale from the centered phone column, not the window.
  if (isEmbedMode() && !window.matchMedia(LIVE_PHONE_MQ).matches) {
    if (screenEl?.clientWidth > 0) return screenEl.clientWidth
    const h = vv?.height || window.innerHeight || 852
    const fromHeight = (h * 393) / 852
    return Math.max(280, Math.min(window.innerWidth || fromHeight, fromHeight, 440))
  }

  if (isLivePhoneViewport()) {
    /** @type {number[]} */
    const candidates = []
    if (vv?.width) candidates.push(vv.width)
    if (window.innerWidth) candidates.push(window.innerWidth)
    if (document.documentElement?.clientWidth) {
      candidates.push(document.documentElement.clientWidth)
    }
    if (screenEl?.clientWidth) candidates.push(screenEl.clientWidth)
    if (!candidates.length) return UI_BASE_WIDTH
    // Prefer the smallest positive width (avoids oversizing when chrome expands)
    return Math.max(280, Math.min(...candidates))
  }

  if (screenEl?.clientWidth > 0) return screenEl.clientWidth
  return window.innerWidth || UI_BASE_WIDTH
}

/**
 * @param {number} cssWidthPx
 */
export function applyUiScale(cssWidthPx) {
  const w = Math.max(280, cssWidthPx || UI_BASE_WIDTH)
  const scale = Math.min(1.12, Math.max(0.78, w / UI_BASE_WIDTH))
  document.documentElement.style.fontSize = `${(16 * scale).toFixed(4)}px`
  document.documentElement.style.setProperty('--ui-scale', String(scale))
  document.documentElement.style.setProperty('--ui-width', `${Math.round(w)}px`)
  const app = document.getElementById('app')
  if (app) {
    app.style.setProperty('--ui-scale', String(scale))
    app.dataset.uiWidth = String(Math.round(w))
  }
}

/**
 * Lock layout height to the visible viewport (fixes white band under tab bar
 * inside Shopify iframes / Instagram–Threads in-app browsers).
 */
export function syncAppHeight() {
  if (!isEmbedMode() && !isLivePhoneViewport()) return
  const vv = window.visualViewport
  const h = Math.round(
    (vv && vv.height) ||
      window.innerHeight ||
      document.documentElement?.clientHeight ||
      0,
  )
  if (h <= 0) return
  document.documentElement.style.setProperty('--app-height', `${h}px`)
}

/** Re-read the live viewport and apply scale. */
export function syncUiScaleFromScreen() {
  syncAppHeight()
  applyUiScale(measureViewportWidth())
}

/**
 * Keep scale in sync on load, rotate, resize, and Safari chrome show/hide.
 */
export function initUiAdaptive() {
  const run = () => syncUiScaleFromScreen()
  run()
  requestAnimationFrame(run)
  // Safari often settles viewport after address-bar animation
  setTimeout(run, 50)
  setTimeout(run, 300)

  window.addEventListener('resize', run)
  window.addEventListener('orientationchange', () => {
    setTimeout(run, 50)
    setTimeout(run, 300)
  })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', run)
    window.visualViewport.addEventListener('scroll', run)
  }
}
