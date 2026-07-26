import checkoutHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showDetailsPage } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import { formatPrice } from '../../shared/domain/pricing.js'
import { withBase } from '../../shared/assetUrl.js'
import {
  isNewebpayConfigured,
  startNewebpayCheckoutBrowser,
} from '../../shared/newebpay/checkout.js'
import {
  getMemberId,
  isEmailMemberId,
  setMemberIdFromEmail,
} from '../../shared/state/userProfileStore.js'
import { fetchLatestShippingAddress } from '../../shared/newebpay/shippingAddress.js'
import { incrementDesignerCount } from '../../shared/state/designerCountStore.js'
import {
  isTwMobilePhone,
  joinTwFullName,
  listTwCities,
  listTwDistricts,
  lookupTwZip,
  normalizeTwPlaceName,
} from '../../shared/data/twAddress.js'
import { refreshMePage } from '../me/index.js'
import { refreshMyDesignsPage } from '../myDesigns/index.js'

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

/** Avoid overlapping address lookups when email changes quickly. */
let shippingPrefillSeq = 0

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
  bindTwAddressSelects()
  bindPhoneInput()
  bindEmailPrefill()
}

/**
 * Fixed「09」prefix + 8-digit local part.
 */
function bindPhoneInput() {
  const phoneEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-phone')
  )
  if (!phoneEl) return
  phoneEl.addEventListener('input', () => {
    phoneEl.value = phoneEl.value.replace(/\D/g, '').slice(0, 8)
  })
}

/**
 * @param {string} fullPhone
 */
function setPhoneLocalPart(fullPhone) {
  const phoneEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-phone')
  )
  if (!phoneEl) return
  const digits = String(fullPhone || '').replace(/\D/g, '')
  if (digits.startsWith('09') && digits.length >= 2) {
    phoneEl.value = digits.slice(2, 10)
  } else if (digits.length === 8) {
    phoneEl.value = digits
  } else if (digits.length === 10 && digits.startsWith('09')) {
    phoneEl.value = digits.slice(2)
  } else {
    phoneEl.value = digits.slice(0, 8)
  }
}

/** @returns {string} full 10-digit 09xxxxxxxx or partial */
function readPhoneFull() {
  const local = String(
    /** @type {HTMLInputElement | null} */ (document.getElementById('checkout-phone'))
      ?.value || '',
  ).replace(/\D/g, '')
  return local ? `09${local}` : ''
}

/**
 * Open shipping form with design payload from details.
 * @param {CheckoutDraft} next
 */
export function openCheckout(next) {
  draft = next
  renderDraft()
  void prefillsFromProfile()
}

export function refreshCheckoutPage() {
  if (draft) renderDraft()
}

function bindEmailPrefill() {
  const emailEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-email')
  )
  if (!emailEl) return
  emailEl.addEventListener('change', () => {
    void prefillsFromEmail(emailEl.value, { overwrite: true })
  })
  emailEl.addEventListener('blur', () => {
    void prefillsFromEmail(emailEl.value, { overwrite: false })
  })
}

function bindTwAddressSelects() {
  const cityEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-city')
  )
  const districtEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-district')
  )
  if (!cityEl || !districtEl) return

  cityEl.innerHTML =
    `<option value="">請選擇</option>` +
    listTwCities()
      .map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
      .join('')

  cityEl.addEventListener('change', () => {
    fillDistrictOptions(cityEl.value, '')
    syncZipFromSelection()
  })
  districtEl.addEventListener('change', () => {
    syncZipFromSelection()
  })

  fillDistrictOptions('', '')
}

/**
 * @param {string} city
 * @param {string} selectedDistrict
 */
function fillDistrictOptions(city, selectedDistrict) {
  const districtEl = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('checkout-district')
  )
  if (!districtEl) return

  const districts = city ? listTwDistricts(city) : []
  if (!city) {
    districtEl.innerHTML = `<option value="">請選擇</option>`
    districtEl.disabled = true
    return
  }

  districtEl.disabled = false
  const want = normalizeTwPlaceName(selectedDistrict)
  districtEl.innerHTML =
    `<option value="">請選擇</option>` +
    districts
      .map((d) => {
        const selected = normalizeTwPlaceName(d.name) === want ? ' selected' : ''
        return `<option value="${escapeAttr(d.name)}"${selected}>${escapeHtml(d.name)}</option>`
      })
      .join('')
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
  const zip = lookupTwZip(cityEl?.value || '', districtEl?.value || '')
  zipEl.value = zip
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

async function prefillsFromProfile() {
  const emailEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-email')
  )
  const countryEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-country')
  )

  if (countryEl) countryEl.value = '台灣'

  const memberId = getMemberId()
  if (emailEl && !emailEl.value.trim() && isEmailMemberId(memberId)) {
    emailEl.value = memberId
  }

  const email = String(emailEl?.value || '').trim()
  await prefillsFromEmail(email, { overwrite: false })
}

/**
 * Prefill from Shopify latest order for this email.
 * First-time buyers stay blank (except email / 台灣).
 * @param {string} email
 * @param {{ overwrite?: boolean }} [opts]
 */
async function prefillsFromEmail(email, opts = {}) {
  const overwrite = Boolean(opts.overwrite)
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized.includes('@')) return

  const seq = ++shippingPrefillSeq
  const result = await fetchLatestShippingAddress(normalized)
  if (seq !== shippingPrefillSeq) return

  if (!result.ok) {
    console.warn('[checkout] shipping prefill failed', result.error)
    return
  }

  if (result.found && result.address) {
    applyShippingPrefill(result.address, { overwrite })
    return
  }

  // No prior Shopify order for this email → leave blank for first-time fill-in.
  if (overwrite) clearShippingFieldsExceptEmail()
}

/**
 * @param {import('../../shared/newebpay/shippingAddress.js').RemoteShippingAddress} addr
 * @param {{ overwrite?: boolean }} [opts]
 */
function applyShippingPrefill(addr, opts = {}) {
  const overwrite = Boolean(opts.overwrite)
  const lastNameEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-last-name')
  )
  const firstNameEl = /** @type {HTMLInputElement | null} */ (
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

  const canFillName =
    overwrite ||
    (!lastNameEl?.value.trim() && !firstNameEl?.value.trim())
  if (canFillName && lastNameEl && firstNameEl) {
    if (addr.lastName || addr.firstName) {
      lastNameEl.value = addr.lastName || ''
      firstNameEl.value = addr.firstName || ''
    }
  }

  if (phoneEl && (overwrite || !phoneEl.value.trim()) && addr.phone) {
    setPhoneLocalPart(addr.phone)
  }
  if (addressEl && (overwrite || !addressEl.value.trim()) && addr.address1) {
    addressEl.value = addr.address1
  }

  if (cityEl && (overwrite || !cityEl.value) && addr.city) {
    const matchedCity =
      listTwCities().find(
        (c) => normalizeTwPlaceName(c) === normalizeTwPlaceName(addr.city || ''),
      ) || ''
    if (matchedCity) {
      cityEl.value = matchedCity
      fillDistrictOptions(matchedCity, addr.district || '')
      syncZipFromSelection()
    }
  }
}

function clearShippingFieldsExceptEmail() {
  const lastNameEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById('checkout-last-name')
  )
  const firstNameEl = /** @type {HTMLInputElement | null} */ (
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
  if (lastNameEl) lastNameEl.value = ''
  if (firstNameEl) firstNameEl.value = ''
  if (addressEl) addressEl.value = ''
  if (phoneEl) phoneEl.value = ''
  if (cityEl) {
    cityEl.value = ''
    fillDistrictOptions('', '')
    syncZipFromSelection()
  }
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
    btn.textContent = '前往付款…'
  }

  try {
    draft.onBeforePay?.()
    void incrementDesignerCount().then(() => {
      refreshMyDesignsPage()
    })

    // Leave Shopify iframe via top-level form POST — fetch() to workers.dev hangs on CF challenges inside iframes.
    const nav = startNewebpayCheckoutBrowser(draft.bom, {
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

    if (!nav.ok) {
      showToast(nav.error)
      return
    }

    setMemberIdFromEmail(parsed.email)
    refreshMePage()
    // Navigation in progress — keep button disabled.
  } catch (err) {
    console.error('[checkout] submit failed', err)
    const msg = err instanceof Error ? err.message : String(err || '未知錯誤')
    showToast(`下單失敗：${msg}`)
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
  const phone = readPhoneFull()
  const country = '台灣'
  const city = String(
    /** @type {HTMLSelectElement | null} */ (document.getElementById('checkout-city'))
      ?.value || '',
  ).trim()
  const district = String(
    /** @type {HTMLSelectElement | null} */ (document.getElementById('checkout-district'))
      ?.value || '',
  ).trim()
  const zip = String(
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
  if (!phone || phone.length !== 10) return { ok: false, error: '請填寫完整手機號碼（09 後 8 碼）' }
  if (!isTwMobilePhone(phone)) {
    return { ok: false, error: '請輸入有效的台灣手機號碼' }
  }
  if (!city) return { ok: false, error: '請選擇縣市' }
  if (!district) return { ok: false, error: '請選擇鄉鎮市區' }
  const expectedZip = lookupTwZip(city, district)
  if (!expectedZip || zip !== expectedZip) {
    return { ok: false, error: '郵遞區號異常，請重新選擇縣市與鄉鎮市區' }
  }
  if (!address1) return { ok: false, error: '請填寫地址' }

  const fullName = joinTwFullName(lastName, firstName)

  return {
    ok: true,
    email,
    shippingAddress: {
      last_name: lastName,
      first_name: firstName,
      name: fullName,
      phone,
      address1,
      city: district,
      province: city,
      district,
      detail: address1,
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
