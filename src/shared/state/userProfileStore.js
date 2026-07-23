/**
 * Current signed-in member profile (MVP: localStorage).
 * `memberId` is the canonical designer ID on Design Plaza (= 會員編號 on「我的」).
 */

const STORAGE_KEY = 'pearl-tw.userProfile.v1'

/** Demo account shown on「我的」. */
export const DEFAULT_MEMBER_ID = '912525'
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
        cache = {
          memberId: String(parsed.memberId || DEFAULT_MEMBER_ID),
          displayName: String(parsed.displayName || DEFAULT_DISPLAY_NAME).trim() || DEFAULT_DISPLAY_NAME,
          avatarDataUrl: typeof parsed.avatarDataUrl === 'string' ? parsed.avatarDataUrl : '',
        }
        return cache
      }
    }
  } catch {
    /* ignore */
  }
  cache = {
    memberId: DEFAULT_MEMBER_ID,
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

/** @returns {string} 會員編號 — used as plaza designer ID */
export function getMemberId() {
  return read().memberId
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
  // Retry with a smaller payload if quota exceeded.
  return { ok: false, error: '頭像過大，請換一張較小的圖片' }
}

/** Clear custom avatar (letter fallback). */
export function clearAvatar() {
  const prev = read()
  write({ ...prev, avatarDataUrl: '' })
}
