/**
 * Taiwan city / district / 3-digit postal code helpers.
 */

import twCities from '../data/twZipcodes.json'

/**
 * @typedef {{ zip: string, name: string }} TwDistrict
 * @typedef {{ name: string, districts: TwDistrict[] }} TwCity
 */

/** @type {TwCity[]} */
const CITIES = /** @type {TwCity[]} */ (twCities)

/** Common informal → official 臺 spellings. */
const CITY_ALIASES = {
  台北市: '臺北市',
  台中市: '臺中市',
  台南市: '臺南市',
  台東縣: '臺東縣',
  台東市: '臺東市',
}

/**
 * @param {string} name
 * @returns {string}
 */
export function normalizeTwCityName(name) {
  const s = String(name || '').trim()
  return CITY_ALIASES[s] || s
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
  const city = findCity(cityName)
  return city ? city.districts.slice() : []
}

/**
 * @param {string} cityName
 * @param {string} districtName
 * @returns {string}
 */
export function lookupTwZip(cityName, districtName) {
  const city = findCity(cityName)
  if (!city) return ''
  const dist = String(districtName || '').trim()
  const row = city.districts.find((d) => d.name === dist)
  return row ? String(row.zip || '') : ''
}

/**
 * @param {string} cityName
 * @returns {TwCity | null}
 */
function findCity(cityName) {
  const name = normalizeTwCityName(cityName)
  return CITIES.find((c) => c.name === name) || null
}
