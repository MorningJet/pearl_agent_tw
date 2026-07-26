/**
 * Bracelet product codes for Shopify 備註.
 * Bead array order matches canvas layout: index 0 is top-center-right,
 * then clockwise (layout starts at -π/2 and advances with increasing angle).
 */

/**
 * @param {Array<{ productId?: string } | string>} beads
 * @returns {string} multiline `1. id\\n2. id\\n…`
 */
export function formatBeadProductCodeLines(beads) {
  const ids = (Array.isArray(beads) ? beads : [])
    .map((b) => (typeof b === 'string' ? b : String(b?.productId || '')).trim())
    .filter(Boolean)
  return ids.map((id, i) => `${i + 1}. ${id}`).join('\r\n')
}

/**
 * Compact one-line form (legacy / note_attributes length).
 * @param {Array<{ productId?: string } | string>} beads
 * @returns {string}
 */
export function formatBeadProductCodeJoined(beads) {
  const ids = (Array.isArray(beads) ? beads : [])
    .map((b) => (typeof b === 'string' ? b : String(b?.productId || '')).trim())
    .filter(Boolean)
  return ids.join('+')
}
