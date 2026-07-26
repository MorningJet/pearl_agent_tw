/**
 * Social-proof designer count under「我的設計 → 新增設計」.
 * Base 2000; +1 on each checkout「立即付款」click (Worker KV + local cache).
 */

const STORAGE_KEY = 'pearl-tw.designer-count.v1'
export const DESIGNER_COUNT_BASE = 2000

function apiBase() {
  return String(import.meta.env.VITE_NEWEBPAY_API_BASE || '').trim().replace(/\/$/, '')
}

/** @returns {number} */
export function getDesignerCountLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null || raw === '') return DESIGNER_COUNT_BASE
    const n = Number(raw)
    return Number.isFinite(n) && n >= DESIGNER_COUNT_BASE ? Math.floor(n) : DESIGNER_COUNT_BASE
  } catch {
    return DESIGNER_COUNT_BASE
  }
}

/** @param {number} count */
function writeLocal(count) {
  const n = Math.max(DESIGNER_COUNT_BASE, Math.floor(Number(count) || DESIGNER_COUNT_BASE))
  try {
    localStorage.setItem(STORAGE_KEY, String(n))
  } catch {
    /* ignore */
  }
  return n
}

/**
 * @returns {Promise<number>}
 */
export async function fetchDesignerCount() {
  const base = apiBase()
  if (!base) return getDesignerCountLocal()
  try {
    const res = await fetch(`${base}/api/h5/designer-count`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    /** @type {any} */
    const data = await res.json().catch(() => null)
    if (res.ok && data?.ok && Number.isFinite(Number(data.count))) {
      return writeLocal(Number(data.count))
    }
  } catch {
    /* fall through */
  }
  return getDesignerCountLocal()
}

/**
 * +1 when user taps「立即付款」(each click counts).
 * @returns {Promise<number>}
 */
export async function incrementDesignerCount() {
  const base = apiBase()
  if (base) {
    try {
      const res = await fetch(`${base}/api/h5/designer-count`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
      })
      /** @type {any} */
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok && Number.isFinite(Number(data.count))) {
        return writeLocal(Number(data.count))
      }
    } catch {
      /* fall through to local */
    }
  }
  return writeLocal(getDesignerCountLocal() + 1)
}

/** @param {number} n */
export function formatDesignerCount(n) {
  return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US')
}
