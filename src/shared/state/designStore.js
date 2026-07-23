import { getProduct } from '../data/products.js'

/**
 * @typedef {object} BeadInstance
 * @property {string} instanceId
 * @property {string} productId
 */

/**
 * @typedef {object} DesignState
 * @property {BeadInstance[]} beads
 * @property {'bead'|'accessory'} shelfType
 * @property {string} shelfCategory
 * @property {string} name
 */

const DEFAULT_NAME = '我的手鍊設計'

/** @type {DesignState} */
const state = {
  beads: [],
  shelfType: 'bead',
  shelfCategory: '全部',
  name: DEFAULT_NAME,
}

/** Active saved-design id while editing (null = unsaved / new). */
/** @type {string | null} */
let activeDesignId = null

/** Design fee when working from a plaza “使用設計” template. */
/** @type {number} */
let appliedDesignFeeTwd = 0

/** @type {string | null} */
let appliedPlazaPublishId = null

/** @type {Set<(s: DesignState) => void>} */
const listeners = new Set()

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn(getState())
    } catch (err) {
      console.error('[designStore] subscriber failed', err)
    }
  }
}

export function getState() {
  return {
    beads: state.beads.slice(),
    shelfType: state.shelfType,
    shelfCategory: state.shelfCategory,
    name: state.name,
  }
}

export function getDesignName() {
  return state.name
}

/** @param {string} [name] */
export function setDesignName(name = DEFAULT_NAME) {
  state.name = (name && String(name).trim()) || DEFAULT_NAME
  notify()
}

export function getActiveDesignId() {
  return activeDesignId
}

/** @param {string | null} id */
export function setActiveDesignId(id) {
  activeDesignId = id
}

export function getAppliedDesignFeeTwd() {
  return appliedDesignFeeTwd
}

export function getAppliedPlazaPublishId() {
  return appliedPlazaPublishId
}

/**
 * @param {number} feeTwd
 * @param {string | null} [publishId]
 */
export function setAppliedDesignFee(feeTwd, publishId = null) {
  appliedDesignFeeTwd = Math.max(0, Math.round(Number(feeTwd) || 0))
  appliedPlazaPublishId = publishId
}

export function clearAppliedDesignFee() {
  appliedDesignFeeTwd = 0
  appliedPlazaPublishId = null
}

/**
 * Replace the full bead string (e.g. continue a saved design).
 * @param {{ instanceId: string, productId: string }[]} beads
 * @param {{ silent?: boolean }} [options] silent=true skips DIY canvas subscribers (safer when opening details)
 */
export function replaceBeads(beads, options = {}) {
  const list = Array.isArray(beads) ? beads : []
  state.beads = list
    .filter((b) => b && b.productId)
    .map((b) => ({
      instanceId: String(b.instanceId || `${b.productId}-${Math.random().toString(36).slice(2, 7)}`),
      productId: String(b.productId),
    }))
  if (!options.silent) notify()
}

/** Clear canvas and detach from any saved design. */
export function startNewDesign() {
  activeDesignId = null
  appliedDesignFeeTwd = 0
  appliedPlazaPublishId = null
  state.beads = []
  state.name = DEFAULT_NAME
  notify()
}

export { DEFAULT_NAME as DEFAULT_DESIGN_NAME }

/** @param {(s: DesignState) => void} fn */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function addBead(productId) {
  const product = getProduct(productId)
  if (!product) return null
  const instance = {
    instanceId: `${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId,
  }
  state.beads.push(instance)
  notify()
  return instance
}

/** @param {string} instanceId */
export function removeBead(instanceId) {
  const i = state.beads.findIndex((b) => b.instanceId === instanceId)
  if (i < 0) return
  state.beads.splice(i, 1)
  notify()
}

export function clearBeads() {
  state.beads = []
  notify()
}

/**
 * Move bead from fromIndex to toIndex (array order = string order).
 * @param {number} fromIndex
 * @param {number} toIndex
 */
export function reorderBead(fromIndex, toIndex) {
  if (fromIndex === toIndex) return
  if (fromIndex < 0 || toIndex < 0) return
  if (fromIndex >= state.beads.length || toIndex >= state.beads.length) return
  const [item] = state.beads.splice(fromIndex, 1)
  state.beads.splice(toIndex, 0, item)
  notify()
}

/** @param {'bead'|'accessory'} type */
export function setShelfType(type) {
  state.shelfType = type
  state.shelfCategory = '全部'
  notify()
}

/** @param {string} category */
export function setShelfCategory(category) {
  state.shelfCategory = category
  notify()
}

/** Resolved beads with product data for rendering / totals. */
export function getResolvedBeads() {
  return state.beads
    .map((b) => {
      const product = getProduct(b.productId)
      if (!product) return null
      return { ...b, product }
    })
    .filter(Boolean)
}
