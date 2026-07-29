/**
 * User-published Design Plaza entries (local persistence).
 * Each entry keeps a full snapshot so deleting from My Designs does not affect it.
 */

/**
 * @typedef {object} PlazaPublishedBead
 * @property {string} instanceId
 * @property {string} productId
 */

/**
 * @typedef {object} PlazaPublishedDesign
 * @property {string} id
 * @property {string} sourceDesignId
 * @property {string} title
 * @property {string} author Publish nickname (display only; may differ from account name)
 * @property {string} designerId Member number（會員編號）— canonical designer ID
 * @property {string} tags
 * @property {number} usePriceTwd
 * @property {number} publishedAt
 * @property {number} [useCount]
 * @property {PlazaPublishedBead[]} beads
 * @property {string} [imageDataUrl]
 * @property {string} [originPlazaPublishId] Source plaza template (if this publish was derived via「使用設計」)
 * @property {number} [originDesignFeeTwd]
 */

const STORAGE_KEY = 'pearl-tw.plazaPublished.v2'

/** @type {PlazaPublishedDesign[] | null} */
let cache = null

/**
 * Ensure designerId is the member number (not the nickname).
 * Legacy rows stored only `author`; backfill from current profile on read.
 * @param {PlazaPublishedDesign} d
 * @returns {PlazaPublishedDesign}
 */
function normalizePublished(d) {
  const author = d.author || '@designer'
  const designerId = String(d.designerId || '').trim()
  return {
    ...d,
    author: author.startsWith('@') ? author : `@${author}`,
    designerId,
  }
}

function readAll() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      cache = []
      return cache
    }
    const parsed = JSON.parse(raw)
    cache = (Array.isArray(parsed) ? parsed : []).map(normalizePublished)
  } catch {
    cache = []
  }
  return cache
}

/** @param {PlazaPublishedDesign[]} list */
function writeAll(list) {
  cache = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    return true
  } catch {
    // Quota / private mode — keep in-memory so this session still shows the card.
    return false
  }
}

/** Newest first (by last publish time). */
export function listPublishedPlazaDesigns() {
  return readAll()
    .slice()
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

/** @param {string} id plaza publish id */
export function getPublishedPlazaDesign(id) {
  return readAll().find((d) => d.id === id) || null
}

/**
 * Update preview URL only (e.g. after sync wrote /plaza/*.png, or before deleting saved design).
 * @param {string} id
 * @param {string} imageDataUrl
 */
export function setPublishedPlazaImage(id, imageDataUrl) {
  const url = String(imageDataUrl || '').trim()
  if (!url) return null
  const list = readAll().slice()
  const i = list.findIndex((d) => d.id === id)
  if (i < 0) return null
  const next = { ...list[i], imageDataUrl: url }
  list[i] = next
  writeAll(list)
  return next
}

/** @param {string} sourceDesignId */
export function getPublishedBySourceDesignId(sourceDesignId) {
  return readAll().find((d) => d.sourceDesignId === sourceDesignId) || null
}

/** @param {string} id plaza publish id */
export function deletePublishedPlazaDesign(id) {
  const list = readAll().filter((d) => d.id !== id)
  writeAll(list)
}

const USE_COUNT_KEY = 'pearl-tw.plazaUseCounts.v2'

/** @returns {Record<string, number>} */
function readUseOverrides() {
  try {
    const raw = localStorage.getItem(USE_COUNT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** @param {Record<string, number>} map */
function writeUseOverrides(map) {
  try {
    localStorage.setItem(USE_COUNT_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/**
 * Resolved use count for a plaza design (local publish or override / fallback).
 * @param {string} id
 * @param {number} [fallback]
 */
export function getPlazaUseCount(id, fallback = 0) {
  const pub = getPublishedPlazaDesign(id)
  if (pub) return pub.useCount || 0
  const overrides = readUseOverrides()
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    return Number(overrides[id]) || 0
  }
  return Number(fallback) || 0
}

/**
 * +1 use when visitor taps「立即下單」on plaza / plaza-edit details.
 * @param {string} id
 * @param {number} [fallback] seed/master count when not in publish store
 * @returns {{ id: string, useCount: number } | null}
 */
export function incrementPlazaUseCount(id, fallback = 0) {
  const updated = incrementPublishedUseCount(id)
  if (updated) return { id: updated.id, useCount: updated.useCount || 0 }

  const overrides = readUseOverrides()
  const base = Object.prototype.hasOwnProperty.call(overrides, id)
    ? Number(overrides[id]) || 0
    : Number(fallback) || 0
  const useCount = base + 1
  overrides[id] = useCount
  writeUseOverrides(overrides)
  return { id, useCount }
}

/** @param {string} id plaza publish id */
export function incrementPublishedUseCount(id) {
  const list = readAll().slice()
  const i = list.findIndex((d) => d.id === id)
  if (i < 0) return null
  const prev = list[i]
  const next = { ...prev, useCount: (prev.useCount || 0) + 1 }
  list[i] = next
  writeAll(list)
  return next
}

/**
 * Insert or replace by sourceDesignId (re-publish refreshes `publishedAt` unless preserved).
 * @param {Omit<PlazaPublishedDesign, 'id' | 'publishedAt'> & { id?: string, publishedAt?: number, preservePublishedAt?: boolean }} input
 */
export function upsertPublishedPlazaDesign(input) {
  const list = readAll().slice()
  const existingIdx = list.findIndex((d) => d.sourceDesignId === input.sourceDesignId)
  const prev = existingIdx >= 0 ? list[existingIdx] : null
  const beads = (input.beads || prev?.beads || []).map((b) => ({
    instanceId: b.instanceId,
    productId: b.productId,
  }))
  const publishedAt =
    input.preservePublishedAt && prev?.publishedAt
      ? prev.publishedAt
      : input.publishedAt || Date.now()
  const designerId = String(input.designerId || prev?.designerId || '').trim()
  const originPlazaPublishId =
    input.originPlazaPublishId || prev?.originPlazaPublishId || undefined
  const originDesignFeeTwd =
    originPlazaPublishId != null
      ? Number(
          input.originDesignFeeTwd ?? prev?.originDesignFeeTwd ?? 0,
        ) || 0
      : undefined
  /** @type {PlazaPublishedDesign} */
  const next = {
    id: prev?.id || input.id || newPlazaPublishId(),
    sourceDesignId: input.sourceDesignId,
    title: input.title,
    author: input.author.startsWith('@') ? input.author : `@${input.author}`,
    designerId,
    tags: input.tags,
    usePriceTwd: input.usePriceTwd,
    publishedAt,
    useCount: input.useCount ?? prev?.useCount ?? 0,
    beads,
    imageDataUrl: input.imageDataUrl || prev?.imageDataUrl || '',
    ...(originPlazaPublishId
      ? { originPlazaPublishId, originDesignFeeTwd }
      : {}),
  }

  const withImage = next.imageDataUrl ? next : { ...next, imageDataUrl: undefined }

  if (existingIdx >= 0) list[existingIdx] = withImage
  else list.unshift(withImage)

  if (!writeAll(list) && withImage.imageDataUrl) {
    const slim = { ...withImage, imageDataUrl: undefined }
    if (existingIdx >= 0) list[existingIdx] = slim
    else list[0] = slim
    writeAll(list)
    return slim
  }
  return withImage
}

function newPlazaPublishId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `pub-${crypto.randomUUID()}`
  }
  return `pub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
