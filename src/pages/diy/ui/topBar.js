import {
  circumferenceStatus,
  formatCm,
  statusLabel,
  totalCircumferenceMm,
} from '../../../shared/domain/sizing.js'
import { formatPrice, totalPrice } from '../../../shared/domain/pricing.js'
import { getResolvedBeads, subscribe } from '../../../shared/state/designStore.js'

export function initTopBar() {
  const wristEl = document.getElementById('wrist-value')
  const statusEl = document.getElementById('wrist-status')
  const priceEl = document.getElementById('price-value')
  const helpBtn = document.getElementById('btn-help')
  const helpModal = document.getElementById('help-modal')
  const helpClose = document.getElementById('help-close')

  function render() {
    const beads = getResolvedBeads()
    const mm = totalCircumferenceMm(beads)
    const status = circumferenceStatus(mm)
    if (wristEl) wristEl.textContent = formatCm(mm)
    if (statusEl) {
      statusEl.textContent = statusLabel(status)
      statusEl.className =
        status === 'too_short'
          ? 'ml-1 text-rose-500'
          : status === 'too_long'
            ? 'ml-1 text-amber-500'
            : 'ml-1'
    }
    if (priceEl) priceEl.textContent = formatPrice(totalPrice(beads))
  }

  helpBtn?.addEventListener('click', () => {
    helpModal?.classList.remove('hidden')
    helpModal?.classList.add('flex')
  })
  helpClose?.addEventListener('click', () => {
    helpModal?.classList.add('hidden')
    helpModal?.classList.remove('flex')
  })
  helpModal?.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.classList.add('hidden')
      helpModal.classList.remove('flex')
    }
  })

  subscribe(render)
  render()
}
