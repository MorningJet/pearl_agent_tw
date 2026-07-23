import addressHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showTab } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import {
  deleteAddress,
  getAddress,
  listAddresses,
  setDefaultAddress,
  upsertAddress,
} from '../../shared/state/addressStore.js'

/**
 * @param {HTMLElement} host
 */
export function initAddressPage(host) {
  mountFragment(addressHtml, host)
  document.getElementById('address-back')?.addEventListener('click', () => {
    showTab('me')
  })
  document.getElementById('address-add')?.addEventListener('click', () => {
    openAddressForm()
  })
  document.getElementById('address-form-cancel')?.addEventListener('click', () => {
    closeAddressForm()
  })
  document.getElementById('address-form-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAddressForm()
  })
  document.getElementById('address-form')?.addEventListener('submit', (e) => {
    e.preventDefault()
    submitAddressForm()
  })
  document.getElementById('address-list')?.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    const edit = target.closest('[data-address-edit]')
    if (edit instanceof HTMLElement) {
      openAddressForm(edit.dataset.addressEdit)
      return
    }
    const def = target.closest('[data-address-default]')
    if (def instanceof HTMLElement) {
      const id = def.dataset.addressDefault
      if (!id) return
      setDefaultAddress(id)
      renderAddresses()
      showToast('已設為預設地址')
      return
    }
    const del = target.closest('[data-address-delete]')
    if (del instanceof HTMLElement) {
      const id = del.dataset.addressDelete
      if (!id) return
      deleteAddress(id)
      renderAddresses()
      showToast('已刪除地址')
    }
  })
}

export function refreshAddressPage() {
  renderAddresses()
}

function renderAddresses() {
  const list = document.getElementById('address-list')
  const empty = document.getElementById('address-empty')
  if (!list || !empty) return
  const addresses = listAddresses()
  if (!addresses.length) {
    list.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')
  list.innerHTML = addresses.map(addressCardHtml).join('')
}

/**
 * @param {import('../../shared/state/addressStore.js').ShippingAddress} a
 */
function addressCardHtml(a) {
  const badge = a.isDefault
    ? `<span class="rounded-full bg-stone-900 px-2 py-0.5 text-[0.65rem] font-medium text-white">預設</span>`
    : ''
  return `
  <li class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-100">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-sm font-semibold text-stone-900">${escapeHtml(a.name)}</p>
          <p class="text-sm text-stone-600">${escapeHtml(a.phone)}</p>
          ${badge}
        </div>
        <p class="mt-2 text-sm leading-relaxed text-stone-600">
          ${escapeHtml(a.city)}${escapeHtml(a.district)}${escapeHtml(a.detail)}
        </p>
      </div>
    </div>
    <div class="mt-3 flex items-center gap-3 border-t border-stone-100 pt-3">
      ${
        a.isDefault
          ? ''
          : `<button type="button" class="text-xs font-medium text-stone-600" data-address-default="${escapeAttr(a.id)}">設為預設</button>`
      }
      <button type="button" class="text-xs font-medium text-stone-900" data-address-edit="${escapeAttr(a.id)}">編輯</button>
      <button type="button" class="text-xs font-medium text-rose-500" data-address-delete="${escapeAttr(a.id)}">刪除</button>
    </div>
  </li>`
}

/** @param {string} [id] */
function openAddressForm(id) {
  const modal = document.getElementById('address-form-modal')
  const title = document.getElementById('address-form-title')
  const idInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-id')
  )
  const nameInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-name')
  )
  const phoneInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-phone')
  )
  const cityInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-city')
  )
  const districtInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-district')
  )
  const detailInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-detail')
  )
  const defaultInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-default')
  )
  const errorEl = document.getElementById('address-form-error')

  const existing = id ? getAddress(id) : null
  if (title) title.textContent = existing ? '編輯地址' : '新增地址'
  if (idInput) idInput.value = existing?.id || ''
  if (nameInput) nameInput.value = existing?.name || ''
  if (phoneInput) phoneInput.value = existing?.phone || ''
  if (cityInput) cityInput.value = existing?.city || ''
  if (districtInput) districtInput.value = existing?.district || ''
  if (detailInput) detailInput.value = existing?.detail || ''
  if (defaultInput) defaultInput.checked = existing ? existing.isDefault : listAddresses().length === 0
  if (errorEl) {
    errorEl.textContent = ''
    errorEl.classList.add('hidden')
  }

  modal?.classList.remove('hidden')
  modal?.classList.add('flex')
  queueMicrotask(() => nameInput?.focus())
}

function closeAddressForm() {
  const modal = document.getElementById('address-form-modal')
  modal?.classList.add('hidden')
  modal?.classList.remove('flex')
}

function submitAddressForm() {
  const idInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-id')
  )
  const nameInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-name')
  )
  const phoneInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-phone')
  )
  const cityInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-city')
  )
  const districtInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-district')
  )
  const detailInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-detail')
  )
  const defaultInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('address-form-default')
  )
  const errorEl = document.getElementById('address-form-error')

  const result = upsertAddress({
    id: idInput?.value || undefined,
    name: nameInput?.value || '',
    phone: phoneInput?.value || '',
    city: cityInput?.value || '',
    district: districtInput?.value || '',
    detail: detailInput?.value || '',
    isDefault: Boolean(defaultInput?.checked),
  })
  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error
      errorEl.classList.remove('hidden')
    }
    return
  }
  closeAddressForm()
  renderAddresses()
  showToast('地址已儲存')
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
