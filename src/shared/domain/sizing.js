/** Circumference helpers — sum of diameters along the string. */

/** Wrist fit targets in mm: <13cm too short, 13–25cm ok, >25cm too long. */
export const WRIST = {
  tooShortBelow: 130,
  tooLongAbove: 250,
}

/**
 * Circumference the fixed gray track *represents* (mm).
 * ≤13cm → locked to 13cm; above 13cm → equals actual wrist sum.
 * @param {number} totalMm
 */
export function trackRepresentedMm(totalMm) {
  return Math.max(totalMm, WRIST.tooShortBelow)
}

/**
 * @param {{ product: { diameterMm: number } }[]} resolvedBeads
 * @returns {number} total circumference in mm
 */
export function totalCircumferenceMm(resolvedBeads) {
  return resolvedBeads.reduce((sum, b) => sum + b.product.diameterMm, 0)
}

/**
 * @param {number} totalMm
 * @returns {'too_short' | 'ok' | 'too_long' | 'empty'}
 */
export function circumferenceStatus(totalMm) {
  if (totalMm <= 0) return 'empty'
  if (totalMm < WRIST.tooShortBelow) return 'too_short'
  if (totalMm > WRIST.tooLongAbove) return 'too_long'
  return 'ok'
}

/**
 * @param {number} totalMm
 * @returns {string} cm display with 1 decimal
 */
export function formatCm(totalMm) {
  return (totalMm / 10).toFixed(1)
}

/**
 * @param {'too_short' | 'ok' | 'too_long' | 'empty'} status
 * @returns {string}
 */
export function statusLabel(status) {
  switch (status) {
    case 'too_short':
      return '過短'
    case 'too_long':
      return '過長'
    default:
      // ok / empty — no label when fit is moderate
      return ''
  }
}
