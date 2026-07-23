import earningsHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showTab } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import { formatPrice } from '../../shared/domain/pricing.js'
import {
  EARNINGS_TAX_RATE,
  earningsStatusLabel,
  getEarningsSummary,
  netAfterTax,
} from '../../shared/state/earningsStore.js'

const TAX_PCT = Math.round(EARNINGS_TAX_RATE * 100)

/**
 * @param {HTMLElement} host
 */
export function initEarningsPage(host) {
  mountFragment(earningsHtml, host)
  document.getElementById('earnings-back')?.addEventListener('click', () => {
    showTab('me')
  })
  document.getElementById('earnings-withdraw')?.addEventListener('click', () => {
    const { availableTwd } = getEarningsSummary()
    if (availableTwd <= 0) {
      showToast('目前沒有可提領金額')
      return
    }
    showToast('提領功能即將推出')
  })
}

export function refreshEarningsPage() {
  const summary = getEarningsSummary()
  const available = document.getElementById('earnings-available')
  const total = document.getElementById('earnings-total')
  const pending = document.getElementById('earnings-pending')
  const list = document.getElementById('earnings-list')
  const empty = document.getElementById('earnings-empty')

  if (available) available.textContent = `NT$${formatPrice(summary.availableTwd)}`
  if (total) total.textContent = `NT$${formatPrice(summary.totalTwd)}`
  if (pending) pending.textContent = `NT$${formatPrice(summary.pendingTwd)}`

  if (!list || !empty) return
  if (!summary.orders.length) {
    list.innerHTML = ''
    list.classList.add('hidden')
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')
  list.classList.remove('hidden')
  list.innerHTML = summary.orders.map((o, i) => orderRowHtml(o, i > 0)).join('')
}

/**
 * @param {import('../../shared/state/earningsStore.js').EarningsOrder} o
 * @param {boolean} bordered
 */
function orderRowHtml(o, bordered) {
  const status = o.status
  const estimated = netAfterTax(o.unitPriceTwd)
  const priceBlock =
    status === 'settled'
      ? `<div class="shrink-0 text-right">
          <p class="text-sm font-semibold tabular-nums text-emerald-600">+NT$${formatPrice(
            o.settledNetTwd || 0,
          )}</p>
          <p class="mt-0.5 text-[0.65rem] text-stone-400">已刨除營業稅 ${TAX_PCT}%</p>
        </div>`
      : `<div class="shrink-0 text-right">
          <p class="text-sm font-medium text-stone-500">${escapeHtml(earningsStatusLabel(status))}</p>
          <p class="mt-0.5 text-[0.65rem] tabular-nums text-stone-400">預計收益 NT$${formatPrice(
            estimated,
          )}</p>
        </div>`

  return `
    <li class="${bordered ? 'border-t border-stone-100' : ''} px-4 py-3.5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-stone-900">${escapeHtml(o.designTitle)}</p>
          <p class="mt-1 text-xs text-stone-400">
            單價 NT$${formatPrice(o.unitPriceTwd)} · 客人 ID ${escapeHtml(o.buyerMemberId || '—')}
          </p>
        </div>
        ${priceBlock}
      </div>
    </li>`
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
