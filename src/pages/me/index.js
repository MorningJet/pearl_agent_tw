import meHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import {
  showAddressPage,
  showEarningsPage,
  showHomePage,
  showOrdersPage,
  showTab,
} from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import {
  getAvatarDataUrl,
  getDisplayName,
  getMemberId,
  setAvatarDataUrl,
  setDisplayName,
} from '../../shared/state/userProfileStore.js'
import {
  DESIGNER_FEATURE_LOCKED_TOAST,
  hasCompletedOrder,
} from '../../shared/state/ordersStore.js'
import { refreshEarningsPage } from '../earnings/index.js'
import { refreshOrdersPage } from '../orders/index.js'
import { refreshAddressPage } from '../address/index.js'

const AVATAR_OUT_PX = 256

/**
 * @param {HTMLElement} host
 */
export function initMePage(host) {
  mountFragment(meHtml, host)
  renderProfile()
  bindBack()
  bindLinks()
  bindAvatarEdit()
  bindNameEdit()
}

/** Re-render after profile changes (also usable when showing the tab). */
export function refreshMePage() {
  renderProfile()
}

function renderProfile() {
  const nameEl = document.getElementById('me-display-name')
  const idEl = document.getElementById('me-member-id')
  const imgEl = /** @type {HTMLImageElement | null} */ (
    document.getElementById('me-avatar-img')
  )
  const letterEl = document.getElementById('me-avatar-letter')
  const name = getDisplayName()
  const avatarUrl = getAvatarDataUrl()

  if (nameEl) nameEl.textContent = name
  if (idEl) {
    const mid = getMemberId()
    idEl.textContent = mid ? `會員編號：${mid}` : '會員編號：尚未綁定'
  }

  if (avatarUrl && imgEl && letterEl) {
    imgEl.src = avatarUrl
    imgEl.classList.remove('hidden')
    letterEl.classList.add('hidden')
  } else if (imgEl && letterEl) {
    imgEl.removeAttribute('src')
    imgEl.classList.add('hidden')
    letterEl.classList.remove('hidden')
    letterEl.textContent = (name.slice(0, 1) || 'M').toUpperCase()
  }
}

function bindBack() {
  document.getElementById('me-back')?.addEventListener('click', () => {
    showHomePage()
  })
}

function bindLinks() {
  document.querySelectorAll('.me-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const link = btn instanceof HTMLElement ? btn.dataset.meLink : null
      if (link === 'designs') {
        showTab('my-designs')
        return
      }
      if (link === 'earnings') {
        if (!hasCompletedOrder()) {
          showToast(DESIGNER_FEATURE_LOCKED_TOAST)
          return
        }
        showEarningsPage()
        refreshEarningsPage()
        return
      }
      if (link === 'orders') {
        showOrdersPage()
        refreshOrdersPage()
        return
      }
      if (link === 'address') {
        showAddressPage()
        refreshAddressPage()
        return
      }
      showToast('即將推出')
    })
  })
}

function bindAvatarEdit() {
  const btn = document.getElementById('me-avatar-btn')
  const input = /** @type {HTMLInputElement | null} */ (
    document.getElementById('me-avatar-input')
  )
  if (!btn || !input) return

  btn.addEventListener('click', () => {
    input.value = ''
    input.click()
  })

  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('請選擇圖片檔案')
      return
    }
    try {
      const dataUrl = await cropImageToCircleDataUrl(file)
      const result = setAvatarDataUrl(dataUrl)
      if (!result.ok) {
        showToast(result.error)
        return
      }
      renderProfile()
      showToast('頭像已更新')
    } catch {
      showToast('無法讀取圖片，請再試一次')
    }
  })
}

function bindNameEdit() {
  const openBtn = document.getElementById('me-display-name-btn')
  const modal = document.getElementById('me-name-modal')
  const form = /** @type {HTMLFormElement | null} */ (
    document.getElementById('me-name-form')
  )
  const input = /** @type {HTMLInputElement | null} */ (
    document.getElementById('me-name-input')
  )
  const cancel = document.getElementById('me-name-cancel')
  const errorEl = document.getElementById('me-name-error')

  openBtn?.addEventListener('click', () => openNameModal())
  cancel?.addEventListener('click', () => closeNameModal())
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeNameModal()
  })
  form?.addEventListener('submit', (e) => {
    e.preventDefault()
    const value = input?.value || ''
    const result = setDisplayName(value)
    if (!result.ok) {
      if (errorEl) {
        errorEl.textContent = result.error
        errorEl.classList.remove('hidden')
      }
      input?.focus()
      return
    }
    closeNameModal()
    renderProfile()
    showToast('名稱已更新')
  })
}

function openNameModal() {
  const modal = document.getElementById('me-name-modal')
  const input = /** @type {HTMLInputElement | null} */ (
    document.getElementById('me-name-input')
  )
  const errorEl = document.getElementById('me-name-error')
  if (input) input.value = getDisplayName()
  if (errorEl) {
    errorEl.textContent = ''
    errorEl.classList.add('hidden')
  }
  modal?.classList.remove('hidden')
  modal?.classList.add('flex')
  queueMicrotask(() => {
    input?.focus()
    input?.select()
  })
}

function closeNameModal() {
  const modal = document.getElementById('me-name-modal')
  modal?.classList.add('hidden')
  modal?.classList.remove('flex')
}

/**
 * Center-crop to square, then clip to a perfect circle (transparent corners).
 * @param {Blob} file
 * @returns {Promise<string>}
 */
async function cropImageToCircleDataUrl(file) {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    if (side <= 0) throw new Error('empty image')
    const sx = Math.floor((bitmap.width - side) / 2)
    const sy = Math.floor((bitmap.height - side) / 2)
    const out = AVATAR_OUT_PX
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.clearRect(0, 0, out, out)
    ctx.beginPath()
    ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out)
    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close?.()
  }
}
