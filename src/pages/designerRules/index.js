import designerRulesHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showTab } from '../../shared/nav.js'

/**
 * @param {HTMLElement} host
 */
export function initDesignerRulesPage(host) {
  mountFragment(designerRulesHtml, host)
  document.getElementById('designer-rules-back')?.addEventListener('click', () => {
    showTab('home')
  })
}
