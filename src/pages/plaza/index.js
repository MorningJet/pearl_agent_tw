import plazaHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showHomePage } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import { bindTap } from '../../shared/ui/bindTap.js'
import { listPlazaFeed, plazaMediaTile } from '../home/plazaData.js'

/** @type {null | ((publishId: string) => boolean)} */
let openPlazaDesign = null

/** @param {(publishId: string) => boolean} fn */
export function setOpenPlazaDesign(fn) {
  openPlazaDesign = fn
}

/**
 * @param {HTMLElement} host
 */
export function initPlazaPage(host) {
  mountFragment(plazaHtml, host)
  renderGrid(listPlazaFeed())
  bindBack()
  bindSearch()
  bindCardClicks()
}

export function refreshPlazaPage() {
  const input = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-search')
  )
  renderGrid(filterDesigns(input?.value || ''))
}

function bindBack() {
  document.getElementById('plaza-back')?.addEventListener('click', () => {
    showHomePage()
  })
}

/** @param {import('../home/plazaData.js').PlazaPlaceholder[]} designs */
function renderGrid(designs) {
  const grid = document.getElementById('plaza-grid')
  const empty = document.getElementById('plaza-empty')
  if (!grid || !empty) return

  if (designs.length === 0) {
    grid.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }

  empty.classList.add('hidden')
  grid.innerHTML = designs
    .map(
      (d) => `
    <article
      class="plaza-card relative overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-stone-100"
      data-design-id="${escapeAttr(d.id)}"
    >
      <div class="aspect-square overflow-hidden">${plazaMediaTile(d)}</div>
      <div class="px-2.5 pb-2.5 pt-2">
        <p class="truncate text-[0.8rem] font-semibold text-stone-900">${escapeHtml(d.title)}</p>
        <p class="mt-0.5 h-[1em] truncate text-[0.65rem] leading-[1em] text-stone-400">${
          d.tags ? escapeHtml(d.tags) : '&nbsp;'
        }</p>
        <div class="mt-1.5 flex items-center justify-between gap-1 text-[0.65rem] text-stone-400">
          <span class="truncate">${escapeHtml(d.author)}</span>
          <span class="shrink-0">${escapeHtml(d.uses)}</span>
        </div>
      </div>
      <button
        type="button"
        class="absolute inset-0 z-10 touch-manipulation bg-transparent"
        data-design-id="${escapeAttr(d.id)}"
        aria-label="查看 ${escapeAttr(d.title)}"
      ></button>
    </article>`,
    )
    .join('')
}

function bindSearch() {
  const input = document.getElementById('plaza-search')
  if (!(input instanceof HTMLInputElement)) return

  input.addEventListener('input', () => {
    renderGrid(filterDesigns(input.value))
  })
}

function bindCardClicks() {
  const grid = document.getElementById('plaza-grid')
  if (!grid) return

  bindTap(grid, '[data-design-id]', (el) => {
    const id = el.dataset.designId
    if (!id) return
    try {
      if (!openPlazaDesign) {
        showToast('詳情尚未就緒，請稍後再試')
        return
      }
      const ok = openPlazaDesign(id)
      if (ok === false) showToast('此設計暫無法預覽')
    } catch (err) {
      console.error(err)
      showToast('開啟詳情失敗')
    }
  })
}

/**
 * Match title or author (case-insensitive). Tags are not searched.
 * @param {string} query
 */
function filterDesigns(query) {
  const feed = listPlazaFeed()
  const q = query.trim().toLowerCase()
  if (!q) return feed
  return feed.filter((d) => {
    const title = d.title.toLowerCase()
    const author = d.author.toLowerCase()
    return title.includes(q) || author.includes(q) || author.replace(/^@/, '').includes(q)
  })
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s)
}
