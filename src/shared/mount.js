import { rewriteRootUrls } from './assetUrl.js'

/**
 * Mount HTML fragments into a host.
 * Nodes with [data-mount="body"] go to document.body (modals);
 * everything else appends to host.
 * @param {string} html
 * @param {HTMLElement} host
 */
export function mountFragment(html, host) {
  const tpl = document.createElement('template')
  tpl.innerHTML = rewriteRootUrls(html).trim()
  for (const node of [...tpl.content.childNodes]) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = /** @type {HTMLElement} */ (node)
    if (el.dataset.mount === 'body' || el.id?.endsWith('-modal')) {
      document.body.appendChild(el)
    } else {
      host.appendChild(el)
    }
  }
}
