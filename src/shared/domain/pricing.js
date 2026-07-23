/**
 * @param {{ product: { price: number } }[]} resolvedBeads
 * @returns {number}
 */
export function totalPrice(resolvedBeads) {
  return resolvedBeads.reduce((sum, b) => sum + b.product.price, 0)
}

/**
 * Format TWD amount (no decimals — Taiwan market convention).
 * @param {number} amount
 * @returns {string}
 */
export function formatPrice(amount) {
  return Math.round(amount).toLocaleString('zh-TW')
}
