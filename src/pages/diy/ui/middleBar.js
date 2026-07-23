import { clearBeads } from '../../../shared/state/designStore.js'
import { showToast } from '../../../shared/ui/toast.js'
import { showTab } from '../../../shared/nav.js'

/**
 * @param {{ onMakeNow: () => void }} options
 */
export function initMiddleBar(options) {
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    clearBeads()
    showToast('已清除設計')
  })

  document.getElementById('btn-recommend')?.addEventListener('click', () => {
    showTab('plaza')
  })

  document.getElementById('btn-make')?.addEventListener('click', () => {
    options.onMakeNow()
  })
}
