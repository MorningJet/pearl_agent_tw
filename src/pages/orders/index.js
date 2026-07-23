import ordersHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showOrderDetailPage, showTab } from '../../shared/nav.js'
import { formatPrice } from '../../shared/domain/pricing.js'
import { listOrders, orderStatusLabel } from '../../shared/state/ordersStore.js'
import { openOrderDetail } from '../orderDetail/index.js'

/** @type {'all' | 'making' | 'shipping' | 'done' | 'cancelled'} */
let filter = 'all'

/**
 * @param {HTMLElement} host
 */
export function initOrdersPage(host) {
  mountFragment(ordersHtml, host)
  document.getElementById('orders-back')?.addEventListener('click', () => {
    showTab('me')
  })
  document.getElementById('orders-tabs')?.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-orders-filter]') : null
    if (!(btn instanceof HTMLElement)) return
    const next = btn.dataset.ordersFilter
    if (!next) return
    filter = /** @type {typeof filter} */ (next)
    syncFilterTabs()
    renderOrders()
  })
  document.getElementById('orders-list')?.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-order-id]') : null
    if (!(btn instanceof HTMLElement)) return
    const id = btn.dataset.orderId
    if (!id) return
    openOrderDetail(id)
    showOrderDetailPage()
  })
}

export function refreshOrdersPage() {
  syncFilterTabs()
  renderOrders()
}

function syncFilterTabs() {
  document.querySelectorAll('.orders-tab').forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    const active = el.dataset.ordersFilter === filter
    el.classList.toggle('bg-stone-100', active)
    el.classList.toggle('text-stone-900', active)
    el.classList.toggle('font-medium', true)
    el.classList.toggle('text-stone-500', !active)
  })
}

function renderOrders() {
  const list = document.getElementById('orders-list')
  const empty = document.getElementById('orders-empty')
  if (!list || !empty) return

  let orders = listOrders()
  if (filter === 'making') {
    orders = orders.filter((o) => o.status === 'making' || o.status === 'pending' || o.status === 'paid')
  } else if (filter === 'shipping') {
    orders = orders.filter((o) => o.status === 'shipping')
  } else if (filter === 'done') {
    orders = orders.filter((o) => o.status === 'done')
  } else if (filter === 'cancelled') {
    orders = orders.filter((o) => o.status === 'cancelled')
  }

  if (!orders.length) {
    list.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')
  list.innerHTML = orders.map(orderCardHtml).join('')
}

/**
 * @param {import('../../shared/state/ordersStore.js').Order} o
 */
function orderCardHtml(o) {
  const media = o.imageUrl
    ? `<img src="${escapeAttr(o.imageUrl)}" alt="" class="h-full w-full object-cover" />`
    : `<div class="flex h-full w-full items-center justify-center bg-stone-100 text-[0.65rem] text-stone-400">設計圖</div>`

  return `
  <li>
    <button
      type="button"
      class="flex w-full gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-stone-100 active:bg-stone-50"
      data-order-id="${escapeAttr(o.id)}"
    >
      <div class="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-stone-50">${media}</div>
      <div class="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div class="flex items-start justify-between gap-2">
          <p class="truncate text-sm font-medium text-stone-900">${escapeHtml(o.title)}</p>
          <span class="shrink-0 text-[0.65rem] font-medium text-stone-500">${escapeHtml(orderStatusLabel(o.status))}</span>
        </div>
        <div class="flex items-end justify-between gap-2">
          <p class="text-sm font-semibold tabular-nums text-stone-900">NT$${formatPrice(o.amountTwd)}</p>
          <p class="shrink-0 text-xs tabular-nums text-stone-400">${escapeHtml(formatTime(o.createdAt))}</p>
        </div>
      </div>
    </button>
  </li>`
}

/** @param {number} ts */
function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", '&#39;')
}
