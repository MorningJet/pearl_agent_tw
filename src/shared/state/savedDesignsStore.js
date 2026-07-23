/**
 * Local persistence for "My Designs" (auto-saved when entering Design Details).
 */

/**
 * @typedef {object} SavedBead
 * @property {string} instanceId
 * @property {string} productId
 */

/**
 * @typedef {object} SavedDesign
 * @property {string} id
 * @property {string} name
 * @property {string} imageDataUrl
 * @property {SavedBead[]} beads
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} [originPlazaPublishId] If set, this design started from「使用設計」(never normal details)
 * @property {number} [originDesignFeeTwd] Design fee locked when the plaza template was applied
 */

const STORAGE_KEY = 'pearl-tw.savedDesigns.v1'

/** @type {SavedDesign[] | null} */
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

function writeAll(list) {
  cache = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Quota / private mode — keep in-memory list so session still works.
  }
}

/** Newest first. */
export function listSavedDesigns() {
  return readAll()
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** @param {string} id */
export function getSavedDesign(id) {
  return readAll().find((d) => d.id === id) || null
}

/**
 * Insert or replace a design by id.
 * @param {SavedDesign} design
 */
export function upsertSavedDesign(design) {
  const list = readAll().slice()
  const i = list.findIndex((d) => d.id === design.id)
  const prev = i >= 0 ? list[i] : null
  // Once plaza-derived, origin sticks for the life of this saved design.
  const originPlazaPublishId =
    design.originPlazaPublishId || prev?.originPlazaPublishId || undefined
  const originDesignFeeTwd =
    originPlazaPublishId != null
      ? Number(
          design.originDesignFeeTwd ??
            prev?.originDesignFeeTwd ??
            0,
        ) || 0
      : undefined
  /** @type {SavedDesign} */
  const next = {
    ...design,
    ...(originPlazaPublishId
      ? { originPlazaPublishId, originDesignFeeTwd }
      : {}),
  }
  if (i >= 0) list[i] = next
  else list.push(next)
  writeAll(list)
  return next
}

/** @param {SavedDesign | null | undefined} design */
export function isPlazaDerivedSavedDesign(design) {
  return Boolean(design?.originPlazaPublishId)
}

/** @param {string} id */
export function deleteSavedDesign(id) {
  const list = readAll().filter((d) => d.id !== id)
  writeAll(list)
}

/** @param {string} id @param {string} name */
export function renameSavedDesign(id, name) {
  const existing = getSavedDesign(id)
  if (!existing) return null
  const next = { ...existing, name, updatedAt: Date.now() }
  return upsertSavedDesign(next)
}

export function newDesignId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `design-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
