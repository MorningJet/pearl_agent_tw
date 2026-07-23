import homeHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showToast } from '../../shared/ui/toast.js'
import {
  showDesignerRulesPage,
  showDiyPage,
  showOrderGuidePage,
  showTab,
} from '../../shared/nav.js'
import { listHomePlazaFeed, plazaMediaTile } from './plazaData.js'
import { bindTap } from '../../shared/ui/bindTap.js'
import { withBase } from '../../shared/assetUrl.js'

const BANNER_AUTO_MS = 5000
const SWIPE_THRESHOLD_PX = 40

/** @type {{ src: string, label: string, action: string }[]} */
const BANNERS = [
  {
    src: withBase('/home/banner-order-guide.jpg'),
    label: '訂購須知',
    action: 'order-guide',
  },
  {
    src: withBase('/home/banner-designer.jpg'),
    label: '成為設計師',
    action: 'designer-rules',
  },
]

/** @type {null | ((publishId: string) => boolean)} */
let openPlazaDesign = null

/** @type {ReturnType<typeof setInterval> | null} */
let bannerAutoTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let bannerResumeTimer = null
let bannerIndex = 0
let bannerBound = false

/** Drag state */
let dragStartX = 0
let dragDeltaX = 0
let dragging = false
let dragWidth = 0

/** @param {(publishId: string) => boolean} fn */
export function setOpenHomePlazaDesign(fn) {
  openPlazaDesign = fn
}

/**
 * @param {HTMLElement} host
 */
export function initHomePage(host) {
  mountFragment(homeHtml, host)
  renderBanner()
  renderPlazaPlaceholders()
  bindActions()
  startBannerAutoplay()
}

export function refreshHomePlaza() {
  renderPlazaPlaceholders()
}

/** Pause/resume when leaving or returning to Home. */
export function setHomeBannerAutoplay(enabled) {
  if (enabled) startBannerAutoplay()
  else stopBannerAutoplay()
}

function renderBanner() {
  const track = document.getElementById('home-banner-track')
  const dots = document.getElementById('home-banner-dots')
  if (!track || !dots) return

  track.innerHTML = BANNERS.map(
    (b, i) => `
    <div
      class="home-banner-slide relative h-[9.5rem] w-full min-w-0 shrink-0 grow-0 basis-full overflow-hidden"
      data-banner-action="${escapeAttr(b.action)}"
      data-slide="${i}"
      role="button"
      tabindex="0"
      aria-label="${escapeAttr(b.label)}"
    >
      <img
        src="${escapeAttr(b.src)}"
        alt="${escapeAttr(b.label)}"
        class="pointer-events-none h-full w-full select-none object-cover"
        draggable="false"
      />
    </div>`,
  ).join('')

  dots.innerHTML = BANNERS.map(
    (_, i) =>
      `<span class="home-banner-dot h-1 w-1 rounded-full ${
        i === 0 ? 'bg-white' : 'bg-white/40'
      }" data-dot="${i}"></span>`,
  ).join('')

  bannerIndex = 0
  applyBannerTransform(false)
  bindBannerGestures(track)
}

/**
 * @param {HTMLElement} track
 */
function bindBannerGestures(track) {
  if (bannerBound) return
  bannerBound = true

  const onPointerDown = (e) => {
    if (!(e instanceof PointerEvent)) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    dragging = true
    dragStartX = e.clientX
    dragDeltaX = 0
    dragWidth = track.parentElement?.clientWidth || track.clientWidth || 1
    track.style.transition = 'none'
    pauseBannerAutoplayTemporarily()
    try {
      track.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onPointerMove = (e) => {
    if (!dragging || !(e instanceof PointerEvent)) return
    dragDeltaX = e.clientX - dragStartX
    const base = -bannerIndex * 100
    const pct = dragWidth > 0 ? (dragDeltaX / dragWidth) * 100 : 0
    track.style.transform = `translate3d(${base + pct}%, 0, 0)`
  }

  const onPointerUp = (e) => {
    if (!dragging) return
    dragging = false
    try {
      if (e instanceof PointerEvent) track.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    const moved = Math.abs(dragDeltaX) > SWIPE_THRESHOLD_PX
    if (moved) {
      if (dragDeltaX < 0) goToBanner(bannerIndex + 1)
      else goToBanner(bannerIndex - 1)
    } else {
      applyBannerTransform(true)
      // Treat as tap → open linked page
      const slide = e.target instanceof Element ? e.target.closest('[data-banner-action]') : null
      if (slide instanceof HTMLElement) openBannerAction(slide.dataset.bannerAction)
    }
    dragDeltaX = 0
  }

  track.addEventListener('pointerdown', onPointerDown)
  track.addEventListener('pointermove', onPointerMove)
  track.addEventListener('pointerup', onPointerUp)
  track.addEventListener('pointercancel', onPointerUp)

  track.addEventListener('keydown', (e) => {
    if (!(e instanceof KeyboardEvent)) return
    const slide = e.target instanceof Element ? e.target.closest('[data-banner-action]') : null
    if (!(slide instanceof HTMLElement)) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openBannerAction(slide.dataset.bannerAction)
    }
  })
}

/** @param {string | undefined} action */
function openBannerAction(action) {
  if (action === 'order-guide') {
    setHomeBannerAutoplay(false)
    showOrderGuidePage()
  } else if (action === 'designer-rules') {
    setHomeBannerAutoplay(false)
    showDesignerRulesPage()
  }
}

/** @param {boolean} [animate] */
function applyBannerTransform(animate = true) {
  const track = document.getElementById('home-banner-track')
  if (!track) return
  track.style.transition = animate ? 'transform 0.45s ease' : 'none'
  track.style.transform = `translate3d(${-bannerIndex * 100}%, 0, 0)`
  const dots = document.getElementById('home-banner-dots')
  if (dots) syncBannerDots(dots)
}

/** @param {HTMLElement} dots */
function syncBannerDots(dots) {
  dots.querySelectorAll('.home-banner-dot').forEach((el, idx) => {
    el.classList.toggle('bg-white', idx === bannerIndex)
    el.classList.toggle('bg-white/40', idx !== bannerIndex)
  })
}

/** @param {number} index */
function goToBanner(index) {
  if (!BANNERS.length) return
  bannerIndex = ((index % BANNERS.length) + BANNERS.length) % BANNERS.length
  applyBannerTransform(true)
}

function startBannerAutoplay() {
  stopBannerAutoplay()
  if (BANNERS.length < 2) return
  bannerAutoTimer = setInterval(() => {
    if (dragging) return
    goToBanner(bannerIndex + 1)
  }, BANNER_AUTO_MS)
}

function stopBannerAutoplay() {
  if (bannerAutoTimer != null) {
    clearInterval(bannerAutoTimer)
    bannerAutoTimer = null
  }
  if (bannerResumeTimer != null) {
    clearTimeout(bannerResumeTimer)
    bannerResumeTimer = null
  }
}

function pauseBannerAutoplayTemporarily() {
  stopBannerAutoplay()
  bannerResumeTimer = setTimeout(() => {
    startBannerAutoplay()
  }, BANNER_AUTO_MS)
}

function renderPlazaPlaceholders() {
  const grid = document.getElementById('home-plaza-grid')
  if (!grid) return

  grid.innerHTML = listHomePlazaFeed()
    .map(
      (d) => `
    <article
      class="home-plaza-card relative overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-stone-100"
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
        class="absolute inset-0 z-10 touch-manipulation"
        data-design-id="${escapeAttr(d.id)}"
        aria-label="查看 ${escapeAttr(d.title)}"
      ></button>
    </article>`,
    )
    .join('')
}

function bindActions() {
  document.getElementById('home-cta-bracelet')?.addEventListener('click', () => {
    showDiyPage()
  })

  document.getElementById('home-cta-charm')?.addEventListener('click', () => {
    showToast('手機吊飾設計器 — 即將推出')
  })

  const goPlaza = () => showTab('plaza')
  document.getElementById('home-plaza-more')?.addEventListener('click', goPlaza)
  document.getElementById('home-plaza-explore')?.addEventListener('click', goPlaza)

  const homeGrid = document.getElementById('home-plaza-grid')
  if (homeGrid) {
    bindTap(homeGrid, '[data-design-id]', (el) => {
      const id = el.dataset.designId
      if (!id) return
      openPlazaDesign?.(id)
    })
  }
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
  return escapeHtml(s).replaceAll("'", '&#39;')
}
