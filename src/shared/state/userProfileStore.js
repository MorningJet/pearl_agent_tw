/**
 * Current member profile (MVP: localStorage).
 * `memberId` = buyer email after first order (會員編號). Empty until first checkout.
 */

const STORAGE_KEY = 'pearl-tw.userProfile.v1'

/** Legacy demo id — treated as unbound. */
const LEGACY_DEMO_MEMBER_ID = '912525'

export const DEFAULT_DISPLAY_NAME = 'Mia'

/**
 * @typedef {{
 *   memberId: string,
 *   displayName: string,
 *   avatarDataUrl: string,
 * }} UserProfile
 */

/** @type {UserProfile | null} */
let cache = null

/** @returns {UserProfile} */
function read() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const rawId = String(parsed.memberId || '').trim()
        cache = {
          memberId: normalizeStoredMemberId(rawId),
          displayName:
            String(parsed.displayName || DEFAULT_DISPLAY_NAME).trim() ||
            DEFAULT_DISPLAY_NAME,
          avatarDataUrl:
            typeof parsed.avatarDataUrl === 'string' ? parsed.avatarDataUrl : '',
        }
        return cache
      }
    }
  } catch {
    /* ignore */
  }
  cache = {
    memberId: '',
    displayName: DEFAULT_DISPLAY_NAME,
    avatarDataUrl: '',
  }
  return cache
}

/** @param {UserProfile} next */
function write(next) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

/** @param {string} id */
function normalizeStoredMemberId(id) {
  const s = String(id || '').trim()
  if (!s || s === LEGACY_DEMO_MEMBER_ID) return ''
  return s
}

/** @returns {string} 會員編號 — email after first order; empty before */
export function getMemberId() {
  return read().memberId
}

/** @param {string} value */
export function isEmailMemberId(value) {
  const s = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

/**
 * Bind member id to checkout email (unique buyer key).
 * @param {string} email
 * @returns {{ ok: true, memberId: string } | { ok: false, error: string }}
 */
export function setMemberIdFromEmail(email) {
  const next = String(email || '').trim().toLowerCase()
  if (!isEmailMemberId(next)) {
    return { ok: false, error: '電子信箱格式不正確' }
  }
  const prev = read()
  const ok = write({ ...prev, memberId: next })
  if (!ok) return { ok: false, error: '儲存失敗，請稍後再試' }
  return { ok: true, memberId: next }
}

/** @returns {string} Account display name on「我的」(may differ from plaza nickname) */
export function getDisplayName() {
  return read().displayName
}

/** @returns {string} Avatar data URL, or empty for letter fallback */
export function getAvatarDataUrl() {
  return read().avatarDataUrl || ''
}

/**
 * @param {string} name
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function setDisplayName(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return { ok: false, error: '請輸入名稱' }
  if ([...trimmed].length > 24) return { ok: false, error: '名稱最多 24 個字' }
  const prev = read()
  const ok = write({ ...prev, displayName: trimmed })
  if (!ok) return { ok: false, error: '儲存失敗，請稍後再試' }
  return { ok: true, name: trimmed }
}

/**
 * @param {string} dataUrl
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function setAvatarDataUrl(dataUrl) {
  const url = String(dataUrl || '').trim()
  if (!url.startsWith('data:image/')) {
    return { ok: false, error: '頭像格式不正確' }
  }
  const prev = read()
  const next = { ...prev, avatarDataUrl: url }
  if (write(next)) return { ok: true }
  return { ok: false, error: '頭像過大，請換一張較小的圖片' }
}

/** Clear custom avatar (letter fallback). */
export function clearAvatar() {
  const prev = read()
  write({ ...prev, avatarDataUrl: '' })
}
