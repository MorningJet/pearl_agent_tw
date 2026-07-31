/**
 * MRU product IDs for DIY shelf「最近使用」.
 * Keyed globally (filter by bead/accessory type when rendering).
 */

const STORAGE_KEY = 'pearl-tw.recentProducts.v1'
const MAX_RECENT = 40

/** @type {string[] | null} */
let cache = null

function readAll() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      cache = []
      return cache
    }
    const parsed = JSON.parse(raw)
    cache = Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === 'string' && id)
      : []
  } catch {
    cache = []
  }
  return cache
}

/** @param {string[]} list */
function writeAll(list) {
  cache = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Quota / private mode — keep in-memory list so session still works.
  }
}

/** Newest first. */
export function listRecentProductIds() {
  return readAll().slice()
}

/**
 * Move `productId` to front (MRU). No-op for empty id.
 * @param {string} productId
 */
export function recordRecentProduct(productId) {
  const id = String(productId || '').trim()
  if (!id) return
  const next = [id, ...readAll().filter((x) => x !== id)].slice(0, MAX_RECENT)
  writeAll(next)
}
