/**
 * Shipping addresses (local persistence).
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   lastName?: string,
 *   firstName?: string,
 *   phone: string,
 *   city: string,
 *   district: string,
 *   zip?: string,
 *   detail: string,
 *   isDefault: boolean,
 *   updatedAt: number,
 * }} ShippingAddress
 */

const STORAGE_KEY = 'pearl-tw.addresses.v1'

/** @type {ShippingAddress[] | null} */
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
    cache = Array.isArray(parsed) ? parsed.map(normalizeAddress).filter(Boolean) : []
  } catch {
    cache = []
  }
  return cache
}

/** @param {ShippingAddress[]} list */
function writeAll(list) {
  cache = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/**
 * @param {unknown} raw
 * @returns {ShippingAddress | null}
 */
function normalizeAddress(raw) {
  if (!raw || typeof raw !== 'object') return null
  const a = /** @type {Record<string, unknown>} */ (raw)
  const id = String(a.id || '')
  if (!id) return null
  const lastName = String(a.lastName || '').trim()
  const firstName = String(a.firstName || '').trim()
  const name =
    String(a.name || '').trim() ||
    `${lastName}${firstName}` ||
    ''
  return {
    id,
    name,
    lastName,
    firstName,
    phone: String(a.phone || '').trim(),
    city: String(a.city || '').trim(),
    district: String(a.district || '').trim(),
    zip: String(a.zip || '').trim(),
    detail: String(a.detail || '').trim(),
    isDefault: Boolean(a.isDefault),
    updatedAt: Number(a.updatedAt) || Date.now(),
  }
}

/** @returns {ShippingAddress[]} */
export function listAddresses() {
  return readAll()
    .slice()
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return (b.updatedAt || 0) - (a.updatedAt || 0)
    })
}

/** @param {string} id */
export function getAddress(id) {
  return readAll().find((a) => a.id === id) || null
}

/** @returns {ShippingAddress | null} */
export function getDefaultAddress() {
  const list = readAll()
  return list.find((a) => a.isDefault) || list[0] || null
}

/**
 * @param {Omit<ShippingAddress, 'id' | 'updatedAt'> & { id?: string }} input
 * @returns {{ ok: true, address: ShippingAddress } | { ok: false, error: string }}
 */
export function upsertAddress(input) {
  const lastName = String(input.lastName || '').trim()
  const firstName = String(input.firstName || '').trim()
  const name =
    String(input.name || '').trim() ||
    `${lastName}${firstName}`
  const phone = String(input.phone || '')
    .trim()
    .replace(/[\s-]/g, '')
  const city = String(input.city || '').trim()
  const district = String(input.district || '').trim()
  const zip = String(input.zip || '').trim()
  const detail = String(input.detail || '').trim()

  if (!lastName && !name) return { ok: false, error: '請填寫姓氏' }
  if (!firstName && !name) return { ok: false, error: '請填寫名字' }
  if (!phone) return { ok: false, error: '請填寫手機號碼' }
  if (!/^09\d{8}$/.test(phone)) {
    return { ok: false, error: '請輸入台灣手機門號（09 開頭共 10 碼）' }
  }
  if (!city) return { ok: false, error: '請選擇縣市' }
  if (!district) return { ok: false, error: '請選擇鄉鎮市區' }
  if (!detail) return { ok: false, error: '請填寫地址' }

  const list = readAll().slice()
  const now = Date.now()
  const id = input.id || newAddressId()
  const others = list.filter((a) => a.id !== id)
  const makeDefault = Boolean(input.isDefault) || others.length === 0
  /** @type {ShippingAddress} */
  const next = {
    id,
    name: name || `${lastName}${firstName}`,
    lastName: lastName || (name ? name.slice(0, 1) : ''),
    firstName: firstName || (name.length > 1 ? name.slice(1) : ''),
    phone,
    city,
    district,
    zip,
    detail,
    isDefault: makeDefault,
    updatedAt: now,
  }

  let out = makeDefault ? list.map((a) => ({ ...a, isDefault: false })) : list.slice()
  const idx = out.findIndex((a) => a.id === id)
  if (idx >= 0) out[idx] = next
  else out.unshift(next)
  writeAll(out)
  return { ok: true, address: next }
}

/** @param {string} id */
export function deleteAddress(id) {
  const list = readAll().filter((a) => a.id !== id)
  if (list.length && !list.some((a) => a.isDefault)) {
    list[0] = { ...list[0], isDefault: true }
  }
  writeAll(list)
}

/** @param {string} id */
export function setDefaultAddress(id) {
  const list = readAll().map((a) => ({
    ...a,
    isDefault: a.id === id,
    updatedAt: a.id === id ? Date.now() : a.updatedAt,
  }))
  writeAll(list)
}

function newAddressId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `addr-${crypto.randomUUID()}`
  return `addr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
