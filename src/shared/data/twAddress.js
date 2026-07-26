/**
 * Taiwan city / district / 3-digit zip helpers (Traditional Chinese).
 */

import twZipcodes from './twZipcodes.json'

/**
 * @typedef {{ name: string, zip: string }} TwDistrict
 * @typedef {{ name: string, districts: TwDistrict[] }} TwCity
 */

/** @type {TwCity[]} */
const CITIES = Array.isArray(twZipcodes) ? /** @type {TwCity[]} */ (twZipcodes) : []

/** Normalize 台/臺 for matching. */
export function normalizeTwPlaceName(value) {
  return String(value || '')
    .trim()
    .replaceAll('台', '臺')
}

/** @returns {string[]} */
export function listTwCities() {
  return CITIES.map((c) => c.name)
}

/**
 * @param {string} cityName
 * @returns {TwDistrict[]}
 */
export function listTwDistricts(cityName) {
  const city = findTwCity(cityName)
  return city ? city.districts.slice() : []
}

/**
 * @param {string} cityName
 * @param {string} districtName
 * @returns {string} 3-digit zip or ''
 */
export function lookupTwZip(cityName, districtName) {
  const city = findTwCity(cityName)
  if (!city) return ''
  const want = normalizeTwPlaceName(districtName)
  const row = city.districts.find((d) => normalizeTwPlaceName(d.name) === want)
  return row ? String(row.zip || '').trim() : ''
}

/**
 * @param {string} cityName
 * @returns {TwCity | null}
 */
function findTwCity(cityName) {
  const want = normalizeTwPlaceName(cityName)
  if (!want) return null
  return CITIES.find((c) => normalizeTwPlaceName(c.name) === want) || null
}

/**
 * Split a stored full name into 姓氏 / 名字 (best-effort).
 * @param {string} fullName
 * @returns {{ lastName: string, firstName: string }}
 */
export function splitTwFullName(fullName) {
  const s = String(fullName || '').trim()
  if (!s) return { lastName: '', firstName: '' }
  if (/\s/.test(s)) {
    const parts = s.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return { lastName: parts[0], firstName: parts.slice(1).join(' ') }
    }
  }
  // Chinese: first character as family name
  if (s.length >= 2) {
    return { lastName: s.slice(0, 1), firstName: s.slice(1) }
  }
  return { lastName: s, firstName: '' }
}

/**
 * @param {string} lastName
 * @param {string} firstName
 */
export function joinTwFullName(lastName, firstName) {
  return `${String(lastName || '').trim()}${String(firstName || '').trim()}`
}

/** Taiwan mobile: 09 + 8 digits */
export function isTwMobilePhone(phone) {
  return /^09\d{8}$/.test(String(phone || '').trim())
}
