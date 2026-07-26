import {
  DEFAULT_DESIGN_NAME,
  clearAppliedDesignFee,
  getActiveDesignId,
  getAppliedDesignFeeTwd,
  getAppliedPlazaPublishId,
  getDesignName,
  getResolvedBeads,
  getState,
  replaceBeads,
  setActiveDesignId,
  setAppliedDesignFee,
  setDesignName,
} from '../../shared/state/designStore.js'
import {
  getSavedDesign,
  isPlazaDerivedSavedDesign,
  newDesignId,
  renameSavedDesign,
  upsertSavedDesign,
} from '../../shared/state/savedDesignsStore.js'
import { buildBom } from './bom.js'
import { formatPrice, totalPrice } from '../../shared/domain/pricing.js'
import {
  circumferenceStatus,
  formatCm,
  statusLabel,
  totalCircumferenceMm,
} from '../../shared/domain/sizing.js'
import { showToast } from '../../shared/ui/toast.js'
import { showDiyPage, showDetailsPage, showTab, showCheckoutPage } from '../../shared/nav.js'
import { mountFragment } from '../../shared/mount.js'
import detailsHtml from './page.html?raw'
import {
  getPublishedBySourceDesignId,
  getPublishedPlazaDesign,
  incrementPlazaUseCount,
  setPublishedPlazaImage,
  upsertPublishedPlazaDesign,
} from '../../shared/state/plazaPublishStore.js'
import { getMemberId } from '../../shared/state/userProfileStore.js'
import { createEarningsOrder } from '../../shared/state/earningsStore.js'
import { syncPlazaPublish, syncPlazaUseCount } from '../../shared/api/plazaSync.js'
import { getSeedPlazaAsPublished, resolvePlazaPreviewUrl } from '../home/plazaData.js'
import { refreshPlazaPage } from '../plaza/index.js'
import { refreshHomePlaza } from '../home/index.js'
import { refreshMyDesignsPage } from '../myDesigns/index.js'
import { isNewebpayConfigured } from '../../shared/newebpay/checkout.js'
import { openCheckout } from '../checkout/index.js'

/** @type {string} */
let designImageUrl = ''

/** @type {null | (() => string)} */
let getDesignImage = null

/** @type {number} */
let longPressTimer = 0

/**
 * Design Details — three named variants (see docs/details-modes.md):
 *
 * | Mode          | 中文名                 | Entry                                      |
 * |---------------|------------------------|--------------------------------------------|
 * | `normal`      | 普通詳情               | DIY 立即製作 / 我的設計 / 我的發佈·修改     |
 * | `plaza`       | 廣場設計詳情           | 廣場 / 首頁卡片點進（訪客）                 |
 * | `plaza-edit`  | 廣場修改後設計詳情     | 使用設計 → 畫布增減珠 → 立即製作            |
 *
 * @typedef {'normal' | 'plaza' | 'plaza-edit'} DetailsMode
 */

/** @type {DetailsMode} */
let detailsMode = 'normal'

/** Plaza visitor payload (`plaza` mode only). */
/** @type {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign | null} */
let plazaViewPub = null

/** Prefill when re-publishing from「我的發佈 → 修改」(`normal` mode). */
/** @type {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign | null} */
let ownerRepublishPub = null

/** Free shipping when bracelet (beads) total ≥ this amount. */
const FREE_SHIPPING_MIN_TWD = 1000
/** Charged when below free-shipping threshold. */
const STANDARD_SHIPPING_TWD = 50

/**
 * @param {number} braceletPriceTwd
 * @returns {{ free: boolean, priceBadge: string, rowNote: string, amount: number }}
 */
function resolveShipping(braceletPriceTwd) {
  const free = braceletPriceTwd >= FREE_SHIPPING_MIN_TWD
  return {
    free,
    priceBadge: free ? '（包郵）' : '（含運費）',
    rowNote: free ? '滿1000包郵' : '標準配送',
    amount: free ? 0 : STANDARD_SHIPPING_TWD,
  }
}

/**
 * @param {{ rowNote: string, amount: number }} shipping
 */
function shippingBomRowHtml(shipping) {
  return `
      <li class="flex items-start justify-between gap-3 py-2.5 text-sm">
        <div class="min-w-0">
          <p class="truncate font-medium text-stone-800">運費</p>
          <p class="mt-0.5 text-xs text-stone-400">${escapeHtml(shipping.rowNote)}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-stone-600">×1</p>
          <p class="mt-0.5 font-medium text-stone-800">NT$${formatPrice(shipping.amount)}</p>
        </div>
      </li>`
}

/**
 * @param {HTMLElement} host
 * @param {{ getDesignImage: () => string }} options
 */
export function initDetailsPage(host, options) {
  mountFragment(detailsHtml, host)
  getDesignImage = options.getDesignImage

  bindNav()
  bindNameEdit()
  bindShares()
  bindActions()
  bindImagePreview()
  bindWristGuide()
  bindPlazaPublish()
}

/**
 * 普通詳情 or 廣場修改後設計詳情 — from DIY「立即製作」.
 * Plaza-derived designs (origin from「使用設計」) always open as `plaza-edit`.
 */
export function openDesignDetails() {
  const beads = getResolvedBeads()
  if (!beads.length) {
    showToast('請至少加入一顆珠子')
    return false
  }

  plazaViewPub = null
  ownerRepublishPub = null
  designImageUrl = safeDesignImage('')
  restorePlazaOriginFromActiveSaved()
  detailsMode = resolveOwnerDetailsMode()
  persistCurrentDesign()
  applyDetailsModeChrome()
  renderDetails()
  showDetailsPage()
  return true
}

/**
 * 普通詳情 or 廣場修改後設計詳情 — from「我的設計」.
 * @param {import('../../shared/state/savedDesignsStore.js').SavedDesign} design
 */
export function openDesignDetailsFromSaved(design) {
  try {
    if (!design?.beads?.length) {
      showToast('無法開啟：設計資料不完整')
      return false
    }

    plazaViewPub = null
    ownerRepublishPub = getPublishedBySourceDesignId(design.id)
    applyPlazaOriginFromSaved(design)
    detailsMode = isPlazaDerivedSavedDesign(design) ? 'plaza-edit' : 'normal'
    replaceBeads(design.beads, { silent: true })
    setDesignName(design.name)
    setActiveDesignId(design.id)
    designImageUrl = safeDesignImage(design.imageDataUrl)
    applyDetailsModeChrome()
    renderDetails()
    showDetailsPage()
    return true
  } catch (err) {
    console.error(err)
    showToast(`開啟詳情失敗：${shortErr(err)}`)
    return false
  }
}

/**
 * 普通詳情 or 廣場修改後設計詳情 — from「我的發佈 → 修改」.
 * @param {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign} pub
 */
export function openDesignDetailsFromPublish(pub) {
  try {
    const saved = getSavedDesign(pub.sourceDesignId)
    const beads = pub.beads?.length ? pub.beads : saved?.beads
    if (!beads?.length) {
      showToast('無法開啟：設計資料不完整')
      return false
    }

    plazaViewPub = null
    ownerRepublishPub = pub
    applyPlazaOriginFromPublishOrSaved(pub, saved)
    detailsMode = isPlazaDerivedPublishOrSaved(pub, saved) ? 'plaza-edit' : 'normal'
    replaceBeads(beads, { silent: true })
    setDesignName(pub.title)
    setActiveDesignId(pub.sourceDesignId)
    designImageUrl = resolvePlazaPreviewUrl(pub)
    applyDetailsModeChrome()
    renderDetails()
    showDetailsPage()
    return true
  } catch (err) {
    console.error(err)
    showToast(`開啟詳情失敗：${shortErr(err)}`)
    return false
  }
}

/**
 * 廣場設計詳情 — visitor opens a card from Design Plaza / Home.
 * @param {string} publishId
 */
export function openDesignDetailsFromPlaza(publishId) {
  try {
    const pub = getPublishedPlazaDesign(publishId) || getSeedPlazaAsPublished(publishId)
    if (!pub) {
      showToast('此設計暫無法預覽')
      return false
    }
    const saved = pub.sourceDesignId ? getSavedDesign(pub.sourceDesignId) : null
    const beads = pub.beads?.length ? pub.beads : saved?.beads || []

    detailsMode = 'plaza'
    plazaViewPub = pub
    ownerRepublishPub = null
    replaceBeads(beads, { silent: true })
    setDesignName(pub.title)
    setActiveDesignId(null)
    designImageUrl = resolvePlazaPreviewUrl(pub)
    applyDetailsModeChrome()
    renderDetails()
    showDetailsPage()
    return true
  } catch (err) {
    console.error(err)
    showToast(`開啟詳情失敗：${shortErr(err)}`)
    return false
  }
}

/** @param {unknown} err */
function shortErr(err) {
  const msg = err instanceof Error ? err.message : String(err || '')
  return (msg || '未知錯誤').slice(0, 48)
}

/** Prefer stored preview; never let canvas export crash opening details. */
function safeDesignImage(stored) {
  const url = typeof stored === 'string' ? stored.trim() : ''
  if (url) return url
  try {
    return getDesignImage?.() || ''
  } catch (err) {
    console.error('[details] export preview failed', err)
    return ''
  }
}

export function closeDesignDetails() {
  closeLightbox()
  const details = document.getElementById('page-details')
  if (details) details.style.display = ''
  if (detailsMode === 'plaza') {
    detailsMode = 'normal'
    plazaViewPub = null
    ownerRepublishPub = null
    applyDetailsModeChrome()
    showTab('plaza')
    return
  }
  showDiyPage()
}

function applyDetailsModeChrome() {
  const isPlaza = detailsMode === 'plaza'
  const isPlazaEdit = detailsMode === 'plaza-edit'
  const showFeeSummary = isPlaza || isPlazaEdit
  const editBtn = document.getElementById('details-name-edit')
  const nameText = document.getElementById('details-name-text')
  const likes = document.getElementById('details-likes')
  const uses = document.getElementById('details-uses')
  const publishCta = document.getElementById('details-publish-cta')
  const plazaMeta = document.getElementById('details-plaza-meta')
  const bom = document.getElementById('details-bom')
  const feeSummary = document.getElementById('details-fee-summary')
  const midBtn = document.getElementById('details-back-design')
  const titleEl = document.getElementById('details-page-title')

  if (editBtn) {
    editBtn.classList.toggle('hidden', isPlaza)
    editBtn.classList.toggle('inline-flex', !isPlaza)
    editBtn.setAttribute('aria-hidden', isPlaza ? 'true' : 'false')
    if (isPlaza) editBtn.tabIndex = -1
    else editBtn.removeAttribute('tabindex')
  }
  nameText?.classList.toggle('pointer-events-none', isPlaza)
  likes?.classList.toggle('hidden', isPlaza)
  uses?.classList.toggle('hidden', !isPlaza)
  publishCta?.classList.toggle('hidden', isPlaza)
  plazaMeta?.classList.toggle('hidden', !isPlaza)
  bom?.classList.toggle('hidden', showFeeSummary)
  feeSummary?.classList.toggle('hidden', !showFeeSummary)

  if (midBtn) midBtn.textContent = isPlaza ? '使用設計' : '返回設計'
  if (titleEl) {
    titleEl.textContent =
      isPlaza || isPlazaEdit ? getDesignName() || '設計詳情' : '設計詳情'
  }
}

/** Auto-save / update My Designs when entering Design Details. */
function persistCurrentDesign() {
  const now = Date.now()
  const existingId = getActiveDesignId()
  const existing = existingId ? getSavedDesign(existingId) : null
  const id = existingId || newDesignId()
  const name = getDesignName() || DEFAULT_DESIGN_NAME

  const originPlazaPublishId =
    getAppliedPlazaPublishId() || existing?.originPlazaPublishId || undefined
  const originDesignFeeTwd =
    originPlazaPublishId != null
      ? getAppliedPlazaPublishId()
        ? getAppliedDesignFeeTwd()
        : Number(existing?.originDesignFeeTwd) || 0
      : undefined

  upsertSavedDesign({
    id,
    name,
    imageDataUrl: designImageUrl,
    beads: getState().beads,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(originPlazaPublishId
      ? { originPlazaPublishId, originDesignFeeTwd }
      : {}),
  })
  setActiveDesignId(id)
}

/** @returns {'normal' | 'plaza-edit'} */
function resolveOwnerDetailsMode() {
  const activeId = getActiveDesignId()
  const saved = activeId ? getSavedDesign(activeId) : null
  if (getAppliedPlazaPublishId() || isPlazaDerivedSavedDesign(saved)) return 'plaza-edit'
  return 'normal'
}

function restorePlazaOriginFromActiveSaved() {
  const activeId = getActiveDesignId()
  const saved = activeId ? getSavedDesign(activeId) : null
  if (!saved?.originPlazaPublishId) return
  if (!getAppliedPlazaPublishId()) {
    setAppliedDesignFee(saved.originDesignFeeTwd || 0, saved.originPlazaPublishId)
  }
}

/**
 * @param {import('../../shared/state/savedDesignsStore.js').SavedDesign} design
 */
function applyPlazaOriginFromSaved(design) {
  if (design.originPlazaPublishId) {
    setAppliedDesignFee(design.originDesignFeeTwd || 0, design.originPlazaPublishId)
  } else {
    clearAppliedDesignFee()
  }
}

/**
 * @param {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign} pub
 * @param {import('../../shared/state/savedDesignsStore.js').SavedDesign | null} saved
 */
function applyPlazaOriginFromPublishOrSaved(pub, saved) {
  const originId = pub.originPlazaPublishId || saved?.originPlazaPublishId
  if (originId) {
    const fee =
      pub.originDesignFeeTwd ?? saved?.originDesignFeeTwd ?? 0
    setAppliedDesignFee(fee, originId)
  } else {
    clearAppliedDesignFee()
  }
}

/**
 * @param {import('../../shared/state/plazaPublishStore.js').PlazaPublishedDesign} pub
 * @param {import('../../shared/state/savedDesignsStore.js').SavedDesign | null} saved
 */
function isPlazaDerivedPublishOrSaved(pub, saved) {
  return Boolean(pub.originPlazaPublishId || saved?.originPlazaPublishId)
}

function bindNav() {
  document.getElementById('details-back')?.addEventListener('click', () => {
    closeDesignDetails()
  })
}

function bindNameEdit() {
  const textEl = document.getElementById('details-name-text')
  const inputEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('details-name-input')
  )
  const editBtn = document.getElementById('details-name-edit')

  function startEdit() {
    if (detailsMode === 'plaza') return
    if (!textEl || !inputEl) return
    inputEl.value = getDesignName()
    textEl.classList.add('hidden')
    inputEl.classList.remove('hidden')
    inputEl.focus()
    inputEl.select()
  }

  function commitEdit() {
    if (!textEl || !inputEl) return
    const next = inputEl.value.trim() || DEFAULT_DESIGN_NAME
    setDesignName(next)
    textEl.textContent = getDesignName()
    inputEl.classList.add('hidden')
    textEl.classList.remove('hidden')
    const id = getActiveDesignId()
    if (id) renameSavedDesign(id, getDesignName())
  }

  editBtn?.addEventListener('click', startEdit)
  textEl?.addEventListener('click', startEdit)
  inputEl?.addEventListener('blur', commitEdit)
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      inputEl.blur()
    }
    if (e.key === 'Escape') {
      inputEl.value = getDesignName()
      inputEl.blur()
    }
  })
}

function bindShares() {
  document.getElementById('details-share-save')?.addEventListener('click', () => {
    saveDesignImage()
  })
  document.getElementById('details-share-friends')?.addEventListener('click', () => {
    showToast('分享 — 即將推出')
  })
  document.getElementById('details-share-feed')?.addEventListener('click', () => {
    showToast('動態分享 — 即將推出')
  })
}

function bindActions() {
  document.getElementById('details-submit')?.addEventListener('click', () => {
    openPlazaPublish()
  })
  document.getElementById('details-cs')?.addEventListener('click', () => {
    showToast('客服中心 — 即將推出')
  })
  document.getElementById('details-back-design')?.addEventListener('click', () => {
    if (detailsMode === 'plaza') {
      usePlazaDesign()
      return
    }
    closeDesignDetails()
  })
  document.getElementById('details-buy')?.addEventListener('click', () => {
    void buyNow()
  })
  document.getElementById('details-check-wrist')?.addEventListener('click', () => {
    openWristGuide()
  })
}

/** Prevent double-open while preparing checkout draft. */
let buyInFlight = false

/**
 * All three details modes → 收貨資訊 → NewebPay MPG.
 * Plaza UI may hide SKU rows, but checkout still expands the bead set.
 */
function buyNow() {
  if (buyInFlight) return
  const beads = getResolvedBeads()
  if (!beads.length) {
    showToast('請先加入珠子再下單')
    return
  }

  const bom = buildBom(beads)
  const mm = totalCircumferenceMm(beads)
  const wristCm = formatCm(mm)
  const wristCmNum = Number((mm / 10).toFixed(1))
  const beadProductCode = beads.map((b) => b.productId).filter(Boolean).join('-')
  const isPlaza = detailsMode === 'plaza'
  const isPlazaEdit = detailsMode === 'plaza-edit'
  const pub = plazaViewPub
  const designFee = isPlaza
    ? pub?.usePriceTwd || 0
    : isPlazaEdit
      ? getAppliedDesignFeeTwd()
      : 0
  const beadsSubtotalTwd = totalPrice(beads)
  const shipping = resolveShipping(beadsSubtotalTwd)
  const amountTwd = beadsSubtotalTwd + designFee + shipping.amount

  buyInFlight = true
  try {
    openCheckout({
      bom,
      designName: getDesignName(),
      wristCm,
      wristCmNum,
      beadProductCode,
      detailsMode,
      designId: getActiveDesignId() || '',
      plazaPublishId: pub?.id || getAppliedPlazaPublishId() || '',
      designerId: isPlaza ? String(pub?.designerId || '').trim() : '',
      designFeeTwd: designFee,
      designImageUrl,
      beadsSubtotalTwd,
      amountTwd,
      onBeforePay: isPlaza
        ? () => {
            recordPlazaPurchaseUse({ silent: true })
          }
        : undefined,
    })
    showCheckoutPage()
  } finally {
    buyInFlight = false
  }
}

/**
 * 「立即下單」確認付款時計 1 次使用，並為設計師建立收益訂單（製作中）.
 * @param {{ silent?: boolean }} [opts]
 */
function recordPlazaPurchaseUse(opts = {}) {
  const pub = plazaViewPub
  if (!pub?.id) {
    if (!opts.silent) showToast('無法記錄使用次數')
    return
  }
  const next = incrementPlazaUseCount(pub.id, pub.useCount || 0)
  const useCount = next?.useCount ?? (pub.useCount || 0) + 1
  plazaViewPub = { ...pub, useCount }
  void syncPlazaUseCount(pub.id, useCount)

  const designerId = String(pub.designerId || '').trim()
  if (designerId) {
    createEarningsOrder({
      publishId: pub.id,
      designTitle: pub.title,
      unitPriceTwd: pub.usePriceTwd || 0,
      designerId,
      buyerMemberId: getMemberId(),
    })
  }

  renderDetails()
  refreshPlazaPage()
  refreshHomePlaza()
  if (!opts.silent) showToast('已記錄使用')
}

/** Load plaza template onto DIY canvas; keep design-use fee. */
function usePlazaDesign() {
  const pub = plazaViewPub
  if (!pub) return
  const saved = getSavedDesign(pub.sourceDesignId)
  const beads = pub.beads?.length ? pub.beads : saved?.beads
  if (!beads?.length) {
    showToast('無法使用：設計資料不完整')
    return
  }

  replaceBeads(beads)
  setDesignName(pub.title)
  setActiveDesignId(null)
  setAppliedDesignFee(pub.usePriceTwd || 0, pub.id)
  designImageUrl = resolvePlazaPreviewUrl({
    ...pub,
    imageDataUrl: saved?.imageDataUrl || pub.imageDataUrl || '',
  })

  detailsMode = 'normal'
  plazaViewPub = null
  ownerRepublishPub = null
  applyDetailsModeChrome()
  closeLightbox()
  refreshPlazaPage()
  refreshHomePlaza()
  showDiyPage()
  showToast(
    pub.usePriceTwd > 0
      ? `已套用設計（使用費 NT$${formatPrice(pub.usePriceTwd)}）`
      : '已套用設計',
  )
}

function bindImagePreview() {
  const thumb = document.getElementById('details-hero-img')
  const lightbox = document.getElementById('details-lightbox')
  const fullImg = /** @type {HTMLImageElement | null} */ (
    document.getElementById('details-lightbox-img')
  )
  const hint = document.getElementById('details-lightbox-hint')

  thumb?.addEventListener('click', () => {
    if (!designImageUrl || !lightbox || !fullImg) return
    fullImg.src = designImageUrl
    lightbox.classList.remove('hidden')
    lightbox.classList.add('flex')
    hint?.classList.remove('opacity-0')
    window.setTimeout(() => hint?.classList.add('opacity-0'), 2200)
  })

  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === fullImg) closeLightbox()
  })

  document.getElementById('details-lightbox-close')?.addEventListener('click', () => {
    closeLightbox()
  })

  const startLongPress = () => {
    window.clearTimeout(longPressTimer)
    longPressTimer = window.setTimeout(() => {
      saveDesignImage()
    }, 650)
  }
  const cancelLongPress = () => window.clearTimeout(longPressTimer)

  fullImg?.addEventListener('touchstart', startLongPress, { passive: true })
  fullImg?.addEventListener('touchend', cancelLongPress)
  fullImg?.addEventListener('touchmove', cancelLongPress)
  fullImg?.addEventListener('mousedown', startLongPress)
  fullImg?.addEventListener('mouseup', cancelLongPress)
  fullImg?.addEventListener('mouseleave', cancelLongPress)
  fullImg?.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    saveDesignImage()
  })
}

function closeLightbox() {
  window.clearTimeout(longPressTimer)
  const lightbox = document.getElementById('details-lightbox')
  lightbox?.classList.add('hidden')
  lightbox?.classList.remove('flex')
}

function bindWristGuide() {
  const modal = document.getElementById('wrist-guide-modal')
  document.getElementById('wrist-guide-close')?.addEventListener('click', () => {
    modal?.classList.add('hidden')
    modal?.classList.remove('flex')
  })
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden')
      modal.classList.remove('flex')
    }
  })
}

function openWristGuide() {
  const modal = document.getElementById('wrist-guide-modal')
  modal?.classList.remove('hidden')
  modal?.classList.add('flex')
}

function bindPlazaPublish() {
  const modal = document.getElementById('plaza-publish-modal')
  const form = /** @type {HTMLFormElement | null} */ (
    document.getElementById('plaza-publish-form')
  )

  document.getElementById('plaza-publish-cancel')?.addEventListener('click', () => {
    closePlazaPublish()
  })

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closePlazaPublish()
  })

  form?.addEventListener('submit', (e) => {
    e.preventDefault()
    submitPlazaPublish()
  })
}

function openPlazaPublish() {
  const modal = document.getElementById('plaza-publish-modal')
  const nameInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-name')
  )
  const nickInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-nickname')
  )
  const blurbInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-blurb')
  )
  const priceInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-price')
  )

  const activeId = getActiveDesignId()
  const existing =
    (activeId ? getPublishedBySourceDesignId(activeId) : null) || ownerRepublishPub

  if (nameInput) {
    const current = getDesignName() || existing?.title || ''
    nameInput.value = [...current].length > 10 ? [...current].slice(0, 10).join('') : current
  }
  if (nickInput) {
    nickInput.value = existing
      ? String(existing.author || '').replace(/^@/, '')
      : ''
  }
  if (blurbInput) {
    const tags = existing?.tags || ''
    blurbInput.value =
      typeof tags === 'string' && tags.startsWith('原創設計') ? '' : tags
  }
  if (priceInput) {
    priceInput.value =
      existing && Number.isFinite(existing.usePriceTwd)
        ? String(existing.usePriceTwd)
        : ''
  }
  setPlazaPublishError('')

  modal?.classList.remove('hidden')
  modal?.classList.add('flex')
  window.setTimeout(() => nameInput?.focus(), 50)
}

function closePlazaPublish() {
  const modal = document.getElementById('plaza-publish-modal')
  modal?.classList.add('hidden')
  modal?.classList.remove('flex')
  setPlazaPublishError('')
}

/** @param {string} message */
function setPlazaPublishError(message) {
  const el = document.getElementById('plaza-publish-error')
  if (!el) return
  if (!message) {
    el.textContent = ''
    el.classList.add('hidden')
    return
  }
  el.textContent = message
  el.classList.remove('hidden')
}

function submitPlazaPublish() {
  const nameInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-name')
  )
  const nickInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-nickname')
  )
  const blurbInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-blurb')
  )
  const priceInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('plaza-publish-price')
  )

  const designName = (nameInput?.value || '').trim()
  const nickname = (nickInput?.value || '').trim()
  const blurb = (blurbInput?.value || '').trim()
  const priceRaw = (priceInput?.value || '').trim()

  if (!designName) {
    setPlazaPublishError('請填寫名稱')
    nameInput?.focus()
    return
  }
  if ([...designName].length > 10) {
    setPlazaPublishError('名稱最多 10 個字')
    nameInput?.focus()
    return
  }
  if (!nickname) {
    setPlazaPublishError('請填寫發佈暱稱')
    nickInput?.focus()
    return
  }
  if ([...nickname].length > 10) {
    setPlazaPublishError('發佈暱稱最多 10 個字')
    nickInput?.focus()
    return
  }
  if ([...blurb].length > 15) {
    setPlazaPublishError('設計說明最多 15 個字')
    blurbInput?.focus()
    return
  }
  if (priceRaw === '') {
    setPlazaPublishError('請填寫使用價格')
    priceInput?.focus()
    return
  }
  const usePrice = Number(priceRaw)
  if (!Number.isFinite(usePrice) || usePrice < 0 || !Number.isInteger(usePrice)) {
    setPlazaPublishError('使用價格請輸入 0 或正整數')
    priceInput?.focus()
    return
  }

  setDesignName(designName)
  const nameText = document.getElementById('details-name-text')
  if (nameText) nameText.textContent = designName
  const id = getActiveDesignId()
  if (id) renameSavedDesign(id, designName)
  persistCurrentDesign()

  const designId = getActiveDesignId()
  if (!designId) {
    setPlazaPublishError('無法發佈：設計尚未儲存')
    return
  }

  const handle = nickname.replace(/^@/, '')
  const tags = blurb
  // Same preview as My Designs — no crop / zoom.
  const saved = getSavedDesign(designId)
  const previewImage = saved?.imageDataUrl || designImageUrl || undefined
  const originPlazaPublishId =
    getAppliedPlazaPublishId() || saved?.originPlazaPublishId || undefined
  const originDesignFeeTwd =
    originPlazaPublishId != null
      ? getAppliedPlazaPublishId()
        ? getAppliedDesignFeeTwd()
        : Number(saved?.originDesignFeeTwd) || 0
      : undefined

  const published = upsertPublishedPlazaDesign({
    sourceDesignId: designId,
    title: designName,
    author: handle,
    designerId: getMemberId(),
    tags,
    usePriceTwd: usePrice,
    beads: getState().beads,
    imageDataUrl: previewImage,
    ...(originPlazaPublishId
      ? { originPlazaPublishId, originDesignFeeTwd }
      : {}),
  })
  ownerRepublishPub = published

  // Always sync with the full preview — localStorage may have dropped the data-URL for quota.
  void syncPlazaPublish({
    ...published,
    imageDataUrl: previewImage || published.imageDataUrl || '',
  }).then((result) => {
    const path = result?.row?.image_path
    if (typeof path === 'string' && path) {
      setPublishedPlazaImage(published.id, path)
      refreshPlazaPage()
      refreshHomePlaza()
      refreshMyDesignsPage()
    } else if (import.meta.env.DEV && !result?.ok) {
      console.warn('[plaza] maintenance table sync failed (is vite dev server running?)')
    }
  })

  refreshPlazaPage()
  refreshHomePlaza()
  refreshMyDesignsPage()
  closePlazaPublish()
  showToast(`已以 @${handle} 發佈「${designName}」`)
}

function saveDesignImage() {
  if (!designImageUrl) {
    showToast('尚無設計圖')
    return
  }
  const a = document.createElement('a')
  a.href = designImageUrl
  a.download = `${slugify(getDesignName())}.png`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  showToast('已儲存至下載')
}

/** @param {string} name */
function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'bracelet-design'
  )
}

function renderDetails() {
  try {
    renderDetailsUnsafe()
  } catch (err) {
    console.error('[details] render failed', err)
    throw err
  }
}

function renderDetailsUnsafe() {
  const beads = getResolvedBeads()
  const mm = totalCircumferenceMm(beads)
  const status = circumferenceStatus(mm)
  const price = totalPrice(beads)
  const shipping = resolveShipping(price)
  const bom = buildBom(beads)
  const isPlaza = detailsMode === 'plaza'
  const isPlazaEdit = detailsMode === 'plaza-edit'
  const showFeeSummary = isPlaza || isPlazaEdit
  const pub = plazaViewPub

  const name = getDesignName()
  const nameText = document.getElementById('details-name-text')
  if (nameText) nameText.textContent = name

  const titleEl = document.getElementById('details-page-title')
  if (titleEl) {
    titleEl.textContent =
      isPlaza || isPlazaEdit ? name : '設計詳情'
  }

  const priceEl = document.getElementById('details-price')
  if (priceEl) priceEl.textContent = `NT$${formatPrice(price)}`

  const shipNoteEl = document.getElementById('details-price-ship-note')
  if (shipNoteEl) shipNoteEl.textContent = shipping.priceBadge

  const wristEl = document.getElementById('details-wrist')
  if (wristEl) {
    const label = statusLabel(status)
    wristEl.textContent = label
      ? `腕圍 ≈ ${formatCm(mm)}cm（${label}）`
      : `腕圍 ≈ ${formatCm(mm)}cm`
  }

  const usesEl = document.getElementById('details-uses')
  if (usesEl && isPlaza) {
    usesEl.textContent = `已使用 ${pub?.useCount || 0} 次`
  }

  if (isPlaza && pub) {
    const author = pub.author || 'designer'
    const handle = author.replace(/^@/, '')
    // designerId = 會員編號; legacy publishes may lack it — use current member id.
    const memberId = String(pub.designerId || getMemberId() || '').trim()
    if (!pub.designerId && memberId) {
      plazaViewPub = { ...pub, designerId: memberId }
    }
    const authorEl = document.getElementById('details-plaza-author')
    const avatarEl = document.getElementById('details-plaza-avatar')
    const idEl = document.getElementById('details-plaza-designer-id')
    const feeEl = document.getElementById('details-plaza-fee')
    if (authorEl) authorEl.textContent = handle
    if (idEl) idEl.textContent = memberId ? `ID ${memberId}` : 'ID —'
    if (avatarEl) {
      avatarEl.textContent = (handle.slice(0, 1) || 'D').toUpperCase()
    }
    if (feeEl) {
      feeEl.textContent =
        pub.usePriceTwd > 0 ? `NT$${formatPrice(pub.usePriceTwd)}` : '免費'
    }
  }

  const img = /** @type {HTMLImageElement | null} */ (
    document.getElementById('details-hero-img')
  )
  if (img && designImageUrl) {
    img.src = designImageUrl
    img.alt = name
  }

  const list = document.getElementById('details-bom')
  if (list && !showFeeSummary) {
    list.innerHTML =
      bom
        .map(
          (row) => `
      <li class="flex items-start justify-between gap-3 py-2.5 text-sm">
        <div class="min-w-0">
          <p class="truncate font-medium text-stone-800">${escapeHtml(row.name)}</p>
          <p class="mt-0.5 text-xs text-stone-400">${row.diameterMm}mm</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-stone-600">×${row.qty}</p>
          <p class="mt-0.5 font-medium text-stone-800">NT$${formatPrice(row.lineTotal)}</p>
        </div>
      </li>`,
        )
        .join('') + shippingBomRowHtml(shipping)
  }

  const feeList = document.getElementById('details-fee-summary')
  if (feeList && showFeeSummary) {
    const designFee = isPlaza ? pub?.usePriceTwd || 0 : getAppliedDesignFeeTwd()
    const wristLabel = `腕圍 ${formatCm(mm)}cm`
    feeList.innerHTML =
      `
      <li class="flex items-start justify-between gap-3 py-2.5 text-sm">
        <div class="min-w-0">
          <p class="truncate font-medium text-stone-800">${escapeHtml(name)}</p>
          <p class="mt-0.5 text-xs text-stone-400">${escapeHtml(wristLabel)}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-stone-600">×1</p>
          <p class="mt-0.5 font-medium text-stone-800">NT$${formatPrice(price)}</p>
        </div>
      </li>
      <li class="flex items-start justify-between gap-3 py-2.5 text-sm">
        <div class="min-w-0 pr-2">
          <p class="font-medium text-stone-800">設計費用</p>
          <p class="mt-0.5 text-xs text-stone-400">由設計師收取，平台不抽成</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-stone-600">×1</p>
          <p class="mt-0.5 font-medium text-stone-800">${
            designFee > 0 ? `NT$${formatPrice(designFee)}` : '免費'
          }</p>
        </div>
      </li>` + shippingBomRowHtml(shipping)
  }

  applyDetailsModeChrome()
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
