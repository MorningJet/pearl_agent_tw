import orderGuideHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showTab } from '../../shared/nav.js'

/**
 * @param {HTMLElement} host
 */
export function initOrderGuidePage(host) {
  mountFragment(orderGuideHtml, host)
  document.getElementById('order-guide-back')?.addEventListener('click', () => {
    showTab('home')
  })
}
