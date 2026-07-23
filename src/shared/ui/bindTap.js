/**
 * Reliable mobile tap for scrollable lists / cards with images.
 * Uses pointer + click, ignores scrolls past a small threshold.
 */

/**
 * @param {HTMLElement} root
 * @param {string} itemSelector
 * @param {(el: HTMLElement, e: Event) => void} onTap
 */
export function bindTap(root, itemSelector, onTap) {
  /** @type {{ x: number, y: number, id: number } | null} */
  let origin = null
  let suppressClick = false

  root.addEventListener(
    'pointerdown',
    (e) => {
      if (!(e instanceof PointerEvent)) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const item = e.target instanceof Element ? e.target.closest(itemSelector) : null
      if (!(item instanceof HTMLElement)) {
        origin = null
        return
      }
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId }
    },
    { passive: true },
  )

  root.addEventListener(
    'pointerup',
    (e) => {
      if (!(e instanceof PointerEvent) || !origin) return
      if (e.pointerId !== origin.id) return
      const start = origin
      origin = null
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (Math.hypot(dx, dy) > 12) return
      const item = e.target instanceof Element ? e.target.closest(itemSelector) : null
      if (!(item instanceof HTMLElement)) return
      suppressClick = true
      onTap(item, e)
      window.setTimeout(() => {
        suppressClick = false
      }, 350)
    },
    { passive: true },
  )

  root.addEventListener(
    'pointercancel',
    () => {
      origin = null
    },
    { passive: true },
  )

  root.addEventListener('click', (e) => {
    if (suppressClick) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const item = e.target instanceof Element ? e.target.closest(itemSelector) : null
    if (!(item instanceof HTMLElement)) return
    onTap(item, e)
  })
}
