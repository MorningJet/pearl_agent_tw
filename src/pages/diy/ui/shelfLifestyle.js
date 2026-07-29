import {
  getProduct,
  productLifestyleUrlForProduct,
} from '../../../shared/data/products.js'

/** @type {HTMLElement | null} */
let modal = null
/** @type {HTMLImageElement | null} */
let imgEl = null
/** @type {HTMLElement | null} */
let titleEl = null

export function initShelfLifestyleModal() {
  modal = document.getElementById('shelf-lifestyle-modal')
  imgEl = /** @type {HTMLImageElement | null} */ (
    document.getElementById('shelf-lifestyle-img')
  )
  titleEl = document.getElementById('shelf-lifestyle-title')
  if (!modal) return

  document
    .getElementById('shelf-lifestyle-close')
    ?.addEventListener('click', closeLifestyleModal)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLifestyleModal()
  })
}

/**
 * @param {string} productId
 * @returns {boolean} whether a lifestyle image was shown
 */
export function openLifestyleModal(productId) {
  const product = getProduct(productId)
  if (!product) return false
  const url = productLifestyleUrlForProduct(product)
  if (!url || !modal || !imgEl) return false

  if (titleEl) titleEl.textContent = product.name
  imgEl.src = url
  imgEl.alt = `${product.name} 實拍`
  modal.classList.remove('hidden')
  modal.classList.add('flex')
  return true
}

function closeLifestyleModal() {
  if (!modal) return
  modal.classList.add('hidden')
  modal.classList.remove('flex')
  if (imgEl) imgEl.removeAttribute('src')
}
