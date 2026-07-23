import myDesignsHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import {
  deleteSavedDesign,
  getSavedDesign,
  listSavedDesigns,
  newDesignId,
  upsertSavedDesign,
} from '../../shared/state/savedDesignsStore.js'
import {
  deletePublishedPlazaDesign,
  getPublishedBySourceDesignId,
  getPublishedPlazaDesign,
  listPublishedPlazaDesigns,
  setPublishedPlazaImage,
  upsertPublishedPlazaDesign,
} from '../../shared/state/plazaPublishStore.js'
import { syncPlazaUnpublish } from '../../shared/api/plazaSync.js'
import {
  getActiveDesignId,
  setActiveDesignId,
  startNewDesign,
} from '../../shared/state/designStore.js'
import { showDiyPage, showHomePage } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import { bindTap } from '../../shared/ui/bindTap.js'
import { resolvePlazaPreviewUrl, testPhotoTile } from '../home/plazaData.js'
import { refreshPlazaPage } from '../plaza/index.js'
import { refreshHomePlaza } from '../home/index.js'
import { withBase } from '../../shared/assetUrl.js'

/** Legacy demo seeds that used empty “測試照片” previews. */
const LEGACY_MIA_SEED_IDS = ['mia-p1', 'mia-p7']

/**
 * @type {null | ((pub: import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign) => boolean)}
 */
let openPublishedDetails = null

/**
 * @type {null | ((design: import('../../shared/state/savedDesignsStore.js').SavedDesign) => boolean)}
 */
let openSavedDetails = null

/**
 * Wired from boot to avoid a circular import with details/index.js.
 * @param {(pub: import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign) => boolean} fn
 */
export function setOpenPublishedDetails(fn) {
  openPublishedDetails = fn
}

/**
 * @param {(design: import('../../shared/state/savedDesignsStore.js').SavedDesign) => boolean} fn
 */
export function setOpenSavedDesignDetails(fn) {
  openSavedDetails = fn
}

/**
 * @param {HTMLElement} host
 */
export function initMyDesignsPage(host) {
  mountFragment(myDesignsHtml, host)
  purgeLegacyMiaSeeds()
  syncPublishedPreviewsFromSaved()
  bindActions()
  bindUnpublishConfirm()
  renderMyDesigns()
}

export function refreshMyDesignsPage() {
  renderMyDesigns()
}

function purgeLegacyMiaSeeds() {
  for (const id of LEGACY_MIA_SEED_IDS) {
    deleteSavedDesign(id)
    if (getActiveDesignId() === id) setActiveDesignId(null)
  }
}

/**
 * Keep published previews identical to My Designs (no crop/zoom).
 * Also backfill beads when missing.
 */
function syncPublishedPreviewsFromSaved() {
  for (const p of listPublishedPlazaDesigns()) {
    const saved = getSavedDesign(p.sourceDesignId)
    if (!saved) continue
    const needsImage = Boolean(saved.imageDataUrl && saved.imageDataUrl !== p.imageDataUrl)
    const needsBeads = Boolean(!p.beads?.length && saved.beads?.length)
    if (!needsImage && !needsBeads) continue
    upsertPublishedPlazaDesign({
      sourceDesignId: p.sourceDesignId,
      title: p.title,
      author: p.author,
      designerId: p.designerId,
      tags: p.tags,
      usePriceTwd: p.usePriceTwd,
      beads: p.beads?.length ? p.beads : saved.beads,
      imageDataUrl: saved.imageDataUrl || p.imageDataUrl || undefined,
      preservePublishedAt: true,
      originPlazaPublishId: p.originPlazaPublishId || saved.originPlazaPublishId,
      originDesignFeeTwd:
        p.originDesignFeeTwd ?? saved.originDesignFeeTwd ?? 0,
    })
  }
}

/**
 * If this saved design is published, copy preview into the publish snapshot
 * so deleting My Designs does not blank the card.
 * Local only — do not hit /api/plaza/publish here (rewriting plazaDesigns.json
 * triggers Vite reload and flashes back to Home).
 * @param {string} sourceDesignId
 */
function preservePublishPreviewBeforeDelete(sourceDesignId) {
  const pub = getPublishedBySourceDesignId(sourceDesignId)
  const saved = getSavedDesign(sourceDesignId)
  if (!pub || !saved?.imageDataUrl) return
  if (!pub.imageDataUrl || pub.imageDataUrl !== saved.imageDataUrl) {
    setPublishedPlazaImage(pub.id, saved.imageDataUrl)
  }
}

function bindActions() {
  document.getElementById('my-designs-back')?.addEventListener('click', () => {
    showHomePage()
  })

  document.getElementById('my-designs-add')?.addEventListener('click', () => {
    startNewDesign()
    showDiyPage()
  })

  const savedRail = document.getElementById('my-designs-rail')
  if (savedRail) {
    bindTap(savedRail, '[data-continue-id]', (el, e) => {
      if (e.target instanceof Element && e.target.closest('[data-delete-id]')) return
      const id = el.dataset.continueId
      if (!id) return
      continueDesign(id)
    })
    savedRail.addEventListener('click', (e) => {
      const del = e.target instanceof Element ? e.target.closest('[data-delete-id]') : null
      if (!(del instanceof HTMLElement)) return
      e.preventDefault()
      e.stopPropagation()
      const id = del.dataset.deleteId
      if (!id) return
      preservePublishPreviewBeforeDelete(id)
      deleteSavedDesign(id)
      if (getActiveDesignId() === id) setActiveDesignId(null)
      renderMyDesigns()
    })
  }

  const publishedRail = document.getElementById('my-published-rail')
  if (publishedRail) {
    bindTap(publishedRail, '[data-modify-publish-id]', (el, e) => {
      if (e.target instanceof Element && e.target.closest('[data-unpublish-id]')) return
      const id = el.dataset.modifyPublishId
      if (!id) return
      modifyPublishedDesign(id)
    })
    publishedRail.addEventListener('click', (e) => {
      const unpublishBtn =
        e.target instanceof Element ? e.target.closest('[data-unpublish-id]') : null
      if (!(unpublishBtn instanceof HTMLElement)) return
      e.preventDefault()
      e.stopPropagation()
      const id = unpublishBtn.dataset.unpublishId
      if (!id) return
      openUnpublishConfirm(id)
    })
  }
}

/** @param {string} publishId */
function modifyPublishedDesign(publishId) {
  const pub = getPublishedPlazaDesign(publishId)
  if (!pub) return
  if (!openPublishedDetails) {
    showToast('無法開啟設計詳情')
    return
  }
  openPublishedDetails(pub)
}

/** @type {string | null} */
let pendingUnpublishId = null

function bindUnpublishConfirm() {
  const modal = document.getElementById('unpublish-confirm-modal')

  document.getElementById('unpublish-confirm-cancel')?.addEventListener('click', () => {
    closeUnpublishConfirm()
  })

  document.getElementById('unpublish-confirm-ok')?.addEventListener('click', () => {
    const id = pendingUnpublishId
    closeUnpublishConfirm()
    if (id) unpublishDesign(id)
  })

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeUnpublishConfirm()
  })
}

/** @param {string} publishId */
function openUnpublishConfirm(publishId) {
  const pub = getPublishedPlazaDesign(publishId)
  if (!pub) return

  pendingUnpublishId = publishId
  const desc = document.getElementById('unpublish-confirm-desc')
  if (desc) {
    desc.textContent = `確定要下架「${pub.title}」嗎？下架後將從設計廣場移除，並保留在「我的設計」中。`
  }

  const modal = document.getElementById('unpublish-confirm-modal')
  modal?.classList.remove('hidden')
  modal?.classList.add('flex')
}

function closeUnpublishConfirm() {
  pendingUnpublishId = null
  const modal = document.getElementById('unpublish-confirm-modal')
  modal?.classList.add('hidden')
  modal?.classList.remove('flex')
}

/** @param {string} publishId */
function unpublishDesign(publishId) {
  const pub = getPublishedPlazaDesign(publishId)
  if (!pub) return

  const beads = pub.beads?.length
    ? pub.beads
    : getSavedDesign(pub.sourceDesignId)?.beads || []
  const imageDataUrl =
    pub.imageDataUrl || getSavedDesign(pub.sourceDesignId)?.imageDataUrl || ''

  if (!beads.length) {
    showToast('無法下架：設計資料不完整')
    return
  }

  const existing = getSavedDesign(pub.sourceDesignId)
  const id = existing?.id || pub.sourceDesignId || newDesignId()
  const now = Date.now()

  upsertSavedDesign({
    id,
    name: pub.title,
    imageDataUrl,
    beads,
    createdAt: existing?.createdAt ?? pub.publishedAt ?? now,
    updatedAt: now,
    ...(pub.originPlazaPublishId || existing?.originPlazaPublishId
      ? {
          originPlazaPublishId:
            pub.originPlazaPublishId || existing?.originPlazaPublishId,
          originDesignFeeTwd:
            pub.originDesignFeeTwd ?? existing?.originDesignFeeTwd ?? 0,
        }
      : {}),
  })

  deletePublishedPlazaDesign(publishId)
  void syncPlazaUnpublish(publishId)
  refreshPlazaPage()
  refreshHomePlaza()
  renderMyDesigns()
  showToast(`已下架「${pub.title}」`)
}

/** @param {string} id */
function continueDesign(id) {
  const design = getSavedDesign(id)
  if (!design) return
  if (!openSavedDetails) {
    showToast('無法開啟設計詳情')
    return
  }
  openSavedDetails(design)
}

function renderMyDesigns() {
  renderSavedRail()
  renderPublishedRail()

  const footer = document.getElementById('my-designs-footer')
  if (footer) {
    footer.textContent = '已有 9,999 位設計師把靈感變成現實'
  }
}

function renderSavedRail() {
  const rail = document.getElementById('my-designs-rail')
  const empty = document.getElementById('my-designs-empty')
  if (!rail || !empty) return

  const designs = listSavedDesigns().filter((d) => !LEGACY_MIA_SEED_IDS.includes(d.id))

  if (!designs.length) {
    rail.innerHTML = ''
    rail.classList.add('hidden')
    empty.classList.remove('hidden')
  } else {
    empty.classList.add('hidden')
    rail.classList.remove('hidden')
    rail.innerHTML = designs.map(savedCardHtml).join('')
  }
}

function renderPublishedRail() {
  const rail = document.getElementById('my-published-rail')
  const empty = document.getElementById('my-published-empty')
  if (!rail || !empty) return

  const published = listPublishedPlazaDesigns()

  if (!published.length) {
    rail.innerHTML = ''
    rail.classList.add('hidden')
    empty.classList.remove('hidden')
  } else {
    empty.classList.add('hidden')
    rail.classList.remove('hidden')
    rail.innerHTML = published.map(publishedCardHtml).join('')
  }
}

/**
 * @param {import('../../shared/state/savedDesignsStore.js').SavedDesign} d
 */
function savedCardHtml(d) {
  const media = d.imageDataUrl
    ? `<img src="${escapeAttr(d.imageDataUrl)}" alt="" draggable="false" class="pointer-events-none h-full w-full select-none object-cover" />`
    : testPhotoTile()

  return `
  <article
    class="relative w-[9.5rem] shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-100"
    data-design-id="${escapeAttr(d.id)}"
  >
    <div class="aspect-square overflow-hidden bg-stone-50">${media}</div>
    <div class="px-2.5 pb-3 pt-2 text-center">
      <p class="truncate text-[0.75rem] font-medium text-stone-800">${escapeHtml(d.name)}</p>
      <p class="mt-0.5 text-[0.6rem] text-stone-400">${escapeHtml(formatTimestamp(d.updatedAt))}</p>
      <span class="mt-2 inline-block text-[0.7rem] font-semibold text-stone-900">繼續編輯</span>
    </div>
    <button
      type="button"
      class="absolute inset-0 z-[5] touch-manipulation bg-transparent"
      data-continue-id="${escapeAttr(d.id)}"
      aria-label="繼續編輯 ${escapeAttr(d.name)}"
    ></button>
    <button
      type="button"
      class="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/80"
      data-delete-id="${escapeAttr(d.id)}"
      aria-label="刪除設計"
    >
      <img src="${withBase('/icons/trash.svg')}" alt="" class="pointer-events-none h-3 w-3 opacity-40" width="12" height="12" />
    </button>
  </article>`
}

/**
 * @param {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign} p
 */
function publishedCardHtml(p) {
  const imageUrl = resolvePlazaPreviewUrl(p)
  const media = imageUrl
    ? `<img src="${escapeAttr(imageUrl)}" alt="" draggable="false" class="pointer-events-none h-full w-full select-none object-cover" />`
    : testPhotoTile()

  return `
  <article
    class="relative w-[9.5rem] shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-100"
    data-publish-id="${escapeAttr(p.id)}"
  >
    <div class="aspect-square overflow-hidden bg-stone-50">${media}</div>
    <div class="relative z-10 px-2.5 pb-3 pt-2 text-center">
      <p class="truncate text-[0.75rem] font-medium text-stone-800">${escapeHtml(p.title)}</p>
      <p class="mt-0.5 text-[0.6rem] text-stone-400">${escapeHtml(formatTimestamp(p.publishedAt))}</p>
      <div class="mt-2 flex items-center justify-center gap-3">
        <button
          type="button"
          class="touch-manipulation text-[0.7rem] font-semibold text-stone-900"
          data-modify-publish-id="${escapeAttr(p.id)}"
        >修改</button>
        <button
          type="button"
          class="touch-manipulation text-[0.7rem] font-semibold text-stone-500"
          data-unpublish-id="${escapeAttr(p.id)}"
        >下架</button>
      </div>
    </div>
    <button
      type="button"
      class="absolute inset-x-0 top-0 z-[5] aspect-square touch-manipulation bg-transparent"
      data-modify-publish-id="${escapeAttr(p.id)}"
      aria-label="修改 ${escapeAttr(p.title)}"
    ></button>
  </article>`
}

/** @param {number} ms */
function formatTimestamp(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
