import checkoutHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showDetailsPage } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import { formatPrice } from '../../shared/domain/pricing.js'
import {
  listTwCities,
  listTwDistricts,
  lookupTwZip,
  normalizeTwCityName,
} from '../../shared/domain/twAddress.js'
import { withBase } from '../../shared/assetUrl.js'
import {
  createNewebpayCheckout,
  isNewebpayConfigured,
  submitNewebpayForm,
} from '../../shared/newebpay/checkout.js'
import { persistCheckoutOrder } from '../../shared/newebpay/orderStatus.js'
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

/** @type {boolean} */
let regionBound = false

/**
 * @param {HTMLElement} host
 */
export function initCheckoutPage(host) {
  // Replace any prior mount (HMR / double-init) so getElementById hits fresh markup.
  document.getElementById('page-checkout')?.remove()
  regionBound = false
  mountFragment(checkoutHtml, host)
  document.getElementById('checkout-back')?.addEventListener('click', () => {
    showDetailsPage()
  })
  document.getElementById('checkout-submit')?.addEventListener('click', () => {
    void submitCheckout()
  })
  bindRegionSelects()
  fillCityOptions()
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

function bindRegionSelects() {
  if (regionBound) return
  regionBound = true
  document.getElementById('checkout-city')?.addEventListener('change', () => {
    onCityChange()
  })
  document.getElementById('checkout-district')?.addEventListener('change', () => {
    syncZipFromSelection()
  })
}

function fillCityOptions() {
  const cityEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-city')
  )
  if (!cityEl) return
  const current = cityEl.value
  cityEl.innerHTML =
    `<option value="">請選擇縣市</option>` +
    listTwCities()
      .map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
      .join('')
  if (current && listTwCities().includes(normalizeTwCityName(current))) {
    cityEl.value = normalizeTwCityName(current)
  }
}

/** @param {string} [preferredDistrict] */
function onCityChange(preferredDistrict = '') {
  const cityEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-city')
  )
  const districtEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-district')
  )
  if (!cityEl || !districtEl) return

  const city = cityEl.value
  const districts = listTwDistricts(city)
  districtEl.disabled = !districts.length
  districtEl.innerHTML = districts.length
    ? `<option value="">請選擇鄉鎮市區</option>` +
      districts
        .map(
          (d) =>
            `<option value="${escapeAttr(d.name)}">${escapeHtml(d.name)}</option>`,
        )
        .join('')
    : `<option value="">請先選擇縣市</option>`

  if (preferredDistrict) {
    const match = districts.find((d) => d.name === preferredDistrict)
    if (match) districtEl.value = match.name
  }
  syncZipFromSelection()
}

function syncZipFromSelection() {
  const cityEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-city')
  )
  const districtEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-district')
  )
  const zipEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-zip')
  )
  if (!zipEl) return
  zipEl.value = lookupTwZip(cityEl?.value || '', districtEl?.value || '')
}

function renderDraft() {
  if (!draft) return
  const title = document.getElementById('checkout-product-title')
  const price = document.getElementById('checkout-product-price')
  const media = document.getElementById('checkout-product-media')
  const submitBtn = document.getElementById('checkout-submit')
  const countryEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-country')
  )

  // Always force current CTA copy (survives stale cached markup).
  if (submitBtn) submitBtn.textContent = '立即付款'
  if (countryEl) {
    countryEl.value = '台灣'
    countryEl.readOnly = true
  }

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
  const lastEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-last-name')
  )
  const firstEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-first-name')
  )
  const addressEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-address')
  )
  const phoneEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-phone')
  )
  const cityEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-city')
  )

  if (countryEl) countryEl.value = '台灣'

  const memberId = getMemberId()
  if (emailEl && !emailEl.value.trim() && isEmailMemberId(memberId)) {
    emailEl.value = memberId
  }

  const addr = getDefaultAddress()
  if (!addr) {
    fillCityOptions()
    onCityChange()
    return
  }

  const split = splitRecipientName(addr.lastName, addr.firstName, addr.name)
  if (lastEl && !lastEl.value.trim()) lastEl.value = split.lastName
  if (firstEl && !firstEl.value.trim()) firstEl.value = split.firstName
  if (phoneEl && !phoneEl.value.trim()) phoneEl.value = addr.phone || ''
  if (addressEl && !addressEl.value.trim()) addressEl.value = addr.detail || ''

  fillCityOptions()
  const city = normalizeTwCityName(addr.city || '')
  if (cityEl && city && listTwCities().includes(city)) {
    cityEl.value = city
    onCityChange(addr.district || '')
  } else {
    onCityChange()
  }
}

/**
 * @param {string} [lastName]
 * @param {string} [firstName]
 * @param {string} [fullName]
 */
function splitRecipientName(lastName, firstName, fullName) {
  const last = String(lastName || '').trim()
  const first = String(firstName || '').trim()
  if (last || first) return { lastName: last, firstName: first }
  const full = String(fullName || '').trim()
  if (!full) return { lastName: '', firstName: '' }
  if (full.length === 1) return { lastName: full, firstName: '' }
  return { lastName: full.slice(0, 1), firstName: full.slice(1) }
}

async function submitCheckout() {
  if (submitInFlight) return
  if (!draft?.bom?.length) {
    showToast('沒有可下單的設計')
    return
  }
  if (!isNewebpayConfigured()) {
    showToast('尚未設定結帳服務（VITE_NEWEBPAY_API_BASE）')
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
    btn.textContent = '建立訂單…'
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

    persistCheckoutOrder(
      result,
      {
        designName: draft.designName,
        designImageUrl: draft.designImageUrl || '',
        wristCmNum: draft.wristCmNum,
        wristCm: draft.wristCm,
        beadsSubtotalTwd: draft.beadsSubtotalTwd,
        designFeeTwd: draft.designFeeTwd,
        email: parsed.email,
        shippingAddress: parsed.shippingAddress,
        bomDisplay: draft.bomDisplay || 'sku',
        bom: draft.bom,
      },
      {
        beadsSubtotal: draft.beadsSubtotalTwd,
        designFee: draft.designFeeTwd,
        shipping: draft.shippingTwd,
      },
    )

    if (result.paymentReady) {
      if (btn) btn.textContent = '前往付款…'
      submitNewebpayForm(result)
      return
    }

    const orderLabel = result.shopifyOrderName
      ? `訂單 ${result.shopifyOrderName} 已建立（未付款）`
      : '未付款訂單已建立'
    showToast(
      `${orderLabel}；付款頁暫不可用${
        result.paymentError ? `：${result.paymentError}` : ''
      }`,
    )
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
  const lastName = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-last-name'))
      ?.value || '',
  ).trim()
  const firstName = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-first-name'))
      ?.value || '',
  ).trim()
  const phone = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-phone'))
      ?.value || '',
  )
    .trim()
    .replace(/[\s-]/g, '')
  const country = '台灣'
  const city = normalizeTwCityName(
    String(
      /** @type {HTMLSelectElement | null} */ (document.getElementById('checkout-city'))
        ?.value || '',
    ).trim(),
  )
  const district = String(
    /** @type {HTMLSelectElement | null} */ (document.getElementById('checkout-district'))
      ?.value || '',
  ).trim()
  const zip = lookupTwZip(city, district) ||
    String(
      /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-zip'))
        ?.value || '',
    ).trim()
  const address1 = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-address'))
      ?.value || '',
  ).trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: '請輸入有效的電子信箱' }
  }
  if (!lastName) return { ok: false, error: '請填寫姓氏' }
  if (!firstName) return { ok: false, error: '請填寫名字' }
  if (!phone) return { ok: false, error: '請填寫手機號碼' }
  if (!/^09\d{8}$/.test(phone)) {
    return { ok: false, error: '請輸入台灣手機門號（09 開頭共 10 碼）' }
  }
  if (!city) return { ok: false, error: '請選擇縣市' }
  if (!district) return { ok: false, error: '請選擇鄉鎮市區' }
  if (!/^\d{3}$/.test(zip)) return { ok: false, error: '郵遞區號異常，請重新選擇縣市與鄉鎮市區' }
  if (!address1) return { ok: false, error: '請填寫地址' }

  const fullName = `${lastName}${firstName}`

  return {
    ok: true,
    email,
    shippingAddress: {
      last_name: lastName,
      first_name: firstName,
      name: fullName,
      phone,
      province: city,
      city: district,
      district,
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
