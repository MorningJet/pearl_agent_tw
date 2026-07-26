import checkoutHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showDetailsPage } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import { formatPrice } from '../../shared/domain/pricing.js'
import { withBase } from '../../shared/assetUrl.js'
import {
  createNewebpayCheckout,
  isNewebpayConfigured,
  submitNewebpayForm,
} from '../../shared/newebpay/checkout.js'
import {
  getMemberId,
  isEmailMemberId,
  setMemberIdFromEmail,
} from '../../shared/state/userProfileStore.js'
import { getDefaultAddress } from '../../shared/state/addressStore.js'
import { refreshMePage } from '../me/index.js'

/**
 * @typedef {{
 *   bom: Array<{
 *     productId: string,
 *     name: string,
 *     diameterMm: number,
 *     qty: number,
 *     unitPrice?: number,
 *     lineTotal?: number,
 *   }>,
 *   designName: string,
 *   wristCm: string,
 *   wristCmNum: number,
 *   beadProductCode: string,
 *   detailsMode: string,
 *   designId?: string,
 *   plazaPublishId?: string,
 *   designerId?: string,
 *   designFeeTwd?: number,
 *   shippingTwd?: number,
 *   bomDisplay?: 'fee' | 'sku',
 *   designImageUrl?: string,
 *   beadsSubtotalTwd?: number,
 *   amountTwd: number,
 *   onBeforePay?: () => void,
 * }} CheckoutDraft
 */

/** @type {CheckoutDraft | null} */
let draft = null

/** @type {boolean} */
let submitInFlight = false

/**
 * @param {HTMLElement} host
 */
export function initCheckoutPage(host) {
  // Replace any prior mount (HMR / double-init) so getElementById hits fresh markup.
  document.getElementById('page-checkout')?.remove()
  mountFragment(checkoutHtml, host)
  document.getElementById('checkout-back')?.addEventListener('click', () => {
    showDetailsPage()
  })
  document.getElementById('checkout-submit')?.addEventListener('click', () => {
    void submitCheckout()
  })
}

/**
 * Open shipping form with design payload from details.
 * @param {CheckoutDraft} next
 */
export function openCheckout(next) {
  draft = next
  renderDraft()
  prefillsFromProfile()
}

export function refreshCheckoutPage() {
  if (draft) renderDraft()
}

function renderDraft() {
  if (!draft) return
  const title = document.getElementById('checkout-product-title')
  const price = document.getElementById('checkout-product-price')
  const media = document.getElementById('checkout-product-media')
  const submitBtn = document.getElementById('checkout-submit')

  // Always force current CTA copy (survives stale cached markup).
  if (submitBtn) submitBtn.textContent = '立即付款'

  const beadsSubtotal = Math.max(0, Math.round(Number(draft.beadsSubtotalTwd) || 0))
  const designFee = Math.max(0, Math.round(Number(draft.designFeeTwd) || 0))
  const shippingTwd = Math.max(
    0,
    Math.round(
      Number.isFinite(Number(draft.shippingTwd))
        ? Number(draft.shippingTwd)
        : Math.max(0, Math.round(Number(draft.amountTwd) || 0) - beadsSubtotal - designFee),
    ),
  )

  if (title) title.textContent = draft.designName || '手鍊設計'
  if (price) {
    const total =
      Math.max(0, Math.round(Number(draft.amountTwd) || 0)) ||
      beadsSubtotal + designFee + shippingTwd
    price.textContent = `NT$${formatPrice(total)}`
  }
  // Drop leftovers from older cached markup.
  document.getElementById('checkout-product-wrist')?.remove()
  document.getElementById('checkout-bom')?.closest('section')?.remove()
  if (media) {
    const imgUrl = draft.designImageUrl ? withBase(draft.designImageUrl) : ''
    media.innerHTML = imgUrl
      ? `<img src="${escapeAttr(imgUrl)}" alt="" class="h-full w-full object-cover" />`
      : `<div class="flex h-full w-full items-center justify-center bg-stone-100 text-[0.65rem] text-stone-400">設計圖</div>`
  }
}

function prefillsFromProfile() {
  const emailEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-email')
  )
  const countryEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-country')
  )
  const nameEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-name')
  )
  const addressEl = /** @type {HTMLTextAreaElement | null} */ (
    document.getElementById('checkout-address')
  )
  const zipEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-zip')
  )
  const phoneEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-phone')
  )

  if (countryEl && !countryEl.value.trim()) countryEl.value = '台灣'

  const memberId = getMemberId()
  if (emailEl && !emailEl.value.trim() && isEmailMemberId(memberId)) {
    emailEl.value = memberId
  }

  const addr = getDefaultAddress()
  if (!addr) return
  if (nameEl && !nameEl.value.trim()) nameEl.value = addr.name || ''
  if (phoneEl && !phoneEl.value.trim()) phoneEl.value = addr.phone || ''
  if (addressEl && !addressEl.value.trim()) {
    addressEl.value = [addr.city, addr.district, addr.detail].filter(Boolean).join('')
  }
}

async function submitCheckout() {
  if (submitInFlight) return
  if (!draft?.bom?.length) {
    showToast('沒有可下單的設計')
    return
  }
  if (!isNewebpayConfigured()) {
    showToast('尚未設定藍新付款服務（VITE_NEWEBPAY_API_BASE）')
    return
  }

  const parsed = readForm()
  if (!parsed.ok) {
    showToast(parsed.error)
    return
  }

  submitInFlight = true
  const btn = document.getElementById('checkout-submit')
  const prevLabel = btn?.textContent
  if (btn) {
    btn.setAttribute('disabled', 'true')
    btn.textContent = '前往付款…'
  }

  try {
    draft.onBeforePay?.()

    const result = await createNewebpayCheckout(draft.bom, {
      designName: draft.designName,
      wristCm: draft.wristCm,
      wristCmNum: draft.wristCmNum,
      beadProductCode: draft.beadProductCode,
      detailsMode: draft.detailsMode,
      designId: draft.designId || '',
      plazaPublishId: draft.plazaPublishId || '',
      designerId: draft.designerId || '',
      designFeeTwd: draft.designFeeTwd || 0,
      designImageUrl: draft.designImageUrl || '',
      beadsSubtotalTwd: draft.beadsSubtotalTwd,
      email: parsed.email,
      shippingAddress: parsed.shippingAddress,
    })

    if (!result.ok) {
      showToast(result.error)
      return
    }

    setMemberIdFromEmail(parsed.email)
    refreshMePage()
    submitNewebpayForm(result)
  } catch (err) {
    console.error('[checkout] submit failed', err)
    const msg = err instanceof Error ? err.message : String(err || '未知錯誤')
    showToast(`下單失敗：${msg}`)
  } finally {
    submitInFlight = false
    if (btn) {
      btn.removeAttribute('disabled')
      if (prevLabel) btn.textContent = prevLabel
    }
  }
}

/**
 * @returns {
 *   | { ok: true, email: string, shippingAddress: object }
 *   | { ok: false, error: string }
 * }
 */
function readForm() {
  const email = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-email'))
      ?.value || '',
  )
    .trim()
    .toLowerCase()
  const country = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-country'))
      ?.value || '',
  ).trim() || '台灣'
  const name = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-name'))
      ?.value || '',
  ).trim()
  const address1 = String(
    /** @type {HTMLTextAreaElement | null} */ (document.getElementById('checkout-address'))
      ?.value || '',
  ).trim()
  const zip = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-zip'))
      ?.value || '',
  ).trim()
  const phone = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-phone'))
      ?.value || '',
  ).trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: '請輸入有效的電子信箱' }
  }
  if (!name) return { ok: false, error: '請填寫收貨姓名' }
  if (!address1) return { ok: false, error: '請填寫收貨地址' }
  if (!zip) return { ok: false, error: '請填寫郵政編碼' }
  if (!phone) return { ok: false, error: '請填寫手機號碼' }
  if (!/^09\d{8}$/.test(phone) && !/^0\d{8,9}$/.test(phone)) {
    return { ok: false, error: '請輸入有效的台灣手機或市話' }
  }

  return {
    ok: true,
    email,
    shippingAddress: {
      name,
      phone,
      address1,
      zip,
      country,
      country_code: 'TW',
    },
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
