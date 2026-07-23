/**
 * Aggregate design beads into BOM line items (by product SKU).
 *
 * @param {Array<{ productId: string, product: { name: string, diameterMm: number, price: number } }>} resolvedBeads
 * @returns {Array<{ productId: string, name: string, diameterMm: number, qty: number, unitPrice: number, lineTotal: number }>}
 */
export function buildBom(resolvedBeads) {
  /** @type {Map<string, { productId: string, name: string, diameterMm: number, qty: number, unitPrice: number, lineTotal: number }>} */
  const map = new Map()
  for (const bead of resolvedBeads) {
    const existing = map.get(bead.productId)
    if (existing) {
      existing.qty += 1
      existing.lineTotal += bead.product.price
      continue
    }
    map.set(bead.productId, {
      productId: bead.productId,
      name: bead.product.name,
      diameterMm: bead.product.diameterMm,
      qty: 1,
      unitPrice: bead.product.price,
      lineTotal: bead.product.price,
    })
  }
  return [...map.values()]
}
