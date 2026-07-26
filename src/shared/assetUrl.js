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
 * Collapse accidental double deploy-base prefixes and return a usable URL.
 * e.g. `/pearl_agent_tw/pearl_agent_tw/plaza/x.png` → `/pearl_agent_tw/plaza/x.png`
 * @param {string} [url]
 */
export function normalizeAssetUrl(url = '') {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^(data:|blob:)/i.test(raw)) return raw

  const rel = toSiteRelativeAssetPath(raw)
  if (!rel) return raw
  if (/^https?:\/\//i.test(rel)) return rel
  return withBase(rel)
}

/**
 * Strip origin + one or more deploy-base prefixes → `/plaza/...` style path.
 * @param {string} [url]
 */
export function toSiteRelativeAssetPath(url = '') {
  let s = String(url || '').trim()
  if (!s) return ''
  if (/^(data:|blob:)/i.test(s)) return s

  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s)
      s = u.pathname + u.search
    }
  } catch {
    /* keep s */
  }

  s = s.replace(/\\/g, '/')
  // Collapse .../pearl_agent_tw/pearl_agent_tw/...
  s = s.replace(/(\/pearl_agent_tw)+(?=\/)/gi, '/pearl_agent_tw')

  const base = assetBase().replace(/\/$/, '')
  const baseName = base.replace(/^\//, '')
  if (baseName && s.startsWith(`${base}/`)) {
    s = s.slice(base.length)
  } else if (baseName && s === base) {
    s = '/'
  }

  // Again in case leftover double segment after strip
  s = s.replace(/(\/pearl_agent_tw)+(?=\/)/gi, '/pearl_agent_tw')
  if (baseName) {
    const re = new RegExp(`^(?:/${baseName})+/`, 'i')
    s = s.replace(re, '/')
  }

  if (!s.startsWith('/')) s = `/${s}`
  return s
}

/**
 * Rewrite root-relative src/href in HTML fragments before mount.
 * @param {string} html
 */
export function rewriteRootUrls(html) {
  const base = assetBase()
  return String(html).replace(/\b(src|href)=(["'])\/(?!\/)/g, `$1=$2${base}`)
}
