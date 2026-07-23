/**
 * Shipping addresses (local persistence).
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   phone: string,
 *   city: string,
 *   district: string,
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
    cache = Array.isArray(parsed) ? parsed : []
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
  const name = String(input.name || '').trim()
  const phone = String(input.phone || '').trim()
  const city = String(input.city || '').trim()
  const district = String(input.district || '').trim()
  const detail = String(input.detail || '').trim()
  if (!name) return { ok: false, error: '請填寫收件人' }
  if (!phone) return { ok: false, error: '請填寫手機號碼' }
  if (!/^09\d{8}$/.test(phone) && !/^0\d{8,9}$/.test(phone)) {
    return { ok: false, error: '請輸入有效的台灣手機或市話' }
  }
  if (!city) return { ok: false, error: '請填寫縣市' }
  if (!district) return { ok: false, error: '請填寫鄉鎮市區' }
  if (!detail) return { ok: false, error: '請填寫詳細地址' }

  const list = readAll().slice()
  const now = Date.now()
  const id = input.id || newAddressId()
  const others = list.filter((a) => a.id !== id)
  const makeDefault = Boolean(input.isDefault) || others.length === 0
  /** @type {ShippingAddress} */
  const next = {
    id,
    name,
    phone,
    city,
    district,
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
