/**
 * Compress DIY canvas data-URLs into a small JPEG for checkout / order thumbs.
 * Full PNG data-URLs are too large for App Proxy form POST and Shopify notes.
 */

const MAX_SIDE = 512
const MAX_CHARS = 90_000

/**
 * @param {string} [src]
 * @returns {Promise<string>} JPEG data URL or '' 
 */
export async function compressDesignThumb(src) {
  const raw = String(src || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return ''
  if (!/^data:image\//i.test(raw)) return ''

  try {
    const bitmap = await loadImage(raw)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height, 1))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    if (typeof bitmap.close === 'function') bitmap.close()

    for (const quality of [0.72, 0.58, 0.45, 0.35]) {
      const out = canvas.toDataURL('image/jpeg', quality)
      if (out.length <= MAX_CHARS) return out
    }
    const last = canvas.toDataURL('image/jpeg', 0.28)
    return last.length <= MAX_CHARS ? last : ''
  } catch (e) {
    console.warn('[design-thumb] compress failed', e)
    return ''
  }
}

/**
 * @param {string} src
 * @returns {Promise<CanvasImageSource & { width: number, height: number, close?: () => void }>}
 */
function loadImage(src) {
  if (typeof createImageBitmap === 'function') {
    return fetch(src)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}
