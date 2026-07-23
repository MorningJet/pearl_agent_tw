/**
 * Vite `base`–aware public asset URLs (needed for GitHub Pages project sites).
 */

/** @returns {string} always ends with `/` */
export function assetBase() {
  const b = import.meta.env.BASE_URL || '/'
  return b.endsWith('/') ? b : `${b}/`
}

/**
 * Prefix root-relative paths (`/icons/...`) with the deploy base.
 * Leaves http(s) / data / blob URLs unchanged.
 * @param {string} [path]
 */
export function withBase(path = '') {
  const p = String(path || '')
  if (!p) return ''
  if (/^(https?:|data:|blob:)/i.test(p)) return p
  const base = assetBase()
  if (p.startsWith(base)) return p
  if (p.startsWith('/')) return `${base}${p.slice(1)}`
  return `${base}${p}`
}

/**
 * Rewrite root-relative src/href in HTML fragments before mount.
 * @param {string} html
 */
export function rewriteRootUrls(html) {
  const base = assetBase()
  return String(html).replace(/\b(src|href)=(["'])\/(?!\/)/g, `$1=$2${base}`)
}
