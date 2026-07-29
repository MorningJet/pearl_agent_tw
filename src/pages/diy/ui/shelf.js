import { categoriesForType, productsFor } from '../../../shared/data/products.js'
import {
  addBead,
  getState,
  setShelfCategory,
  setShelfType,
  subscribe,
} from '../../../shared/state/designStore.js'

export function initShelf() {
  const catsEl = document.getElementById('shelf-categories')
  const gridEl = document.getElementById('shelf-grid')
  const countEl = document.getElementById('shelf-count')
  const tabs = document.querySelectorAll('.shelf-tab')

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const type = /** @type {'bead'|'accessory'} */ (tab.getAttribute('data-type'))
      setShelfType(type)
    })
  })

  function usageCount(productId) {
    return getState().beads.filter((b) => b.productId === productId).length
  }

  function render() {
    const { shelfType, shelfCategory } = getState()
    const categories = categoriesForType(shelfType)
    const products = productsFor(shelfType, shelfCategory)

    tabs.forEach((tab) => {
      const active = tab.getAttribute('data-type') === shelfType
      tab.classList.toggle('shelf-tab-active', active)
      tab.classList.toggle('text-stone-900', active)
      tab.classList.toggle('font-semibold', active)
      tab.classList.toggle('text-stone-400', !active)
    })

    if (catsEl) {
      catsEl.innerHTML = categories
        .map((c) => {
          const active = c === shelfCategory
          return `<button type="button" data-cat="${escapeAttr(c)}" class="block w-full px-2.5 py-3.5 text-left leading-snug ${
            active
              ? 'border-l-[3px] border-stone-900 bg-white font-medium text-stone-900'
              : 'border-l-[3px] border-transparent text-stone-500'
          }">${escapeHtml(c)}</button>`
        })
        .join('')

      catsEl.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          setShelfCategory(btn.getAttribute('data-cat') || '全部')
        })
      })
    }

    if (countEl) countEl.textContent = String(products.length)

    if (gridEl) {
      // Showcase thumbs are uniform size; diameter is shown as text only.
      // Bracelet canvas scales by diameterMm vs track circumference.
      gridEl.innerHTML = products
        .map((p) => {
          const n = usageCount(p.id)
          return `
          <button type="button" data-id="${escapeAttr(p.id)}" class="relative flex aspect-square flex-col items-center rounded-xl bg-white px-2 pb-2 pt-2.5 text-center ring-1 ring-stone-200 transition active:scale-95">
            ${n ? `<span class="absolute right-1.5 top-1.5 rounded bg-stone-900/80 px-1.5 py-0.5 text-[0.65rem] leading-none text-white">x${n}</span>` : ''}
            <span class="flex aspect-square w-[52%] shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-200">
              ${
                p.image
                  ? `<img src="${escapeAttr(p.image)}" alt="" class="h-full w-full object-cover" />`
                  : `<span class="block h-[70%] w-[70%] rounded-full shadow-inner ring-1 ring-black/10" style="background:${p.color || '#d6d3d1'}"></span>`
              }
            </span>
            <span class="mt-1.5 w-full truncate text-xs font-medium leading-snug text-stone-800">${escapeHtml(p.name)}</span>
            <span class="mt-auto flex w-full items-end justify-between pt-1 text-[0.65rem] leading-none text-stone-500">
              <span>${p.diameterMm}mm</span>
              <span>NT$${Math.round(p.price).toLocaleString('zh-TW')}</span>
            </span>
          </button>`
        })
        .join('')

      gridEl.querySelectorAll('button[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id')
          if (id) addBead(id)
        })
      })
    }
  }

  subscribe(render)
  render()
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s)
}
