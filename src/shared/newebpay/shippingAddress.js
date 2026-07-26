/**
 * Fetch latest Shopify shipping address for a buyer email (Worker).
 */

/**
 * @typedef {{
 *   lastName: string,
 *   firstName: string,
 *   phone: string,
 *   city: string,
 *   district: string,
 *   zip: string,
 *   address1: string,
 * }} RemoteShippingAddress
 */

function apiBase() {
  return String(import.meta.env.VITE_NEWEBPAY_API_BASE || '').trim().replace(/\/$/, '')
}

/**
 * @param {string} email
 * @returns {Promise<{ ok: boolean, found: boolean, address: RemoteShippingAddress | null, error?: string }>}
 */
export async function fetchLatestShippingAddress(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized.includes('@')) {
    return { ok: false, found: false, address: null, error: 'email 無效' }
  }
  const base = apiBase()
  if (!base) {
    return { ok: false, found: false, address: null, error: '未設定結帳服務' }
  }
  try {
    const res = await fetch(
      `${base}/api/h5/shipping-address?email=${encodeURIComponent(normalized)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    )
    /** @type {any} */
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        found: false,
        address: null,
        error: String(data?.error || `HTTP ${res.status}`),
      }
    }
    if (!data.found || !data.address) {
      return { ok: true, found: false, address: null }
    }
    const a = data.address
    return {
      ok: true,
      found: true,
      address: {
        lastName: String(a.lastName || ''),
        firstName: String(a.firstName || ''),
        phone: String(a.phone || ''),
        city: String(a.city || ''),
        district: String(a.district || ''),
        zip: String(a.zip || ''),
        address1: String(a.address1 || ''),
      },
    }
  } catch (e) {
    return {
      ok: false,
      found: false,
      address: null,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
