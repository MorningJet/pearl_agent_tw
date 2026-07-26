import orderDetailHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { showOrdersPage } from '../../shared/nav.js'
import { showToast } from '../../shared/ui/toast.js'
import { formatPrice } from '../../shared/domain/pricing.js'
import { withBase } from '../../shared/assetUrl.js'
import {
  CUSTOM_GOODS_NOTE,
  canRequestRefund,
  getOrder,
  normalizeStatus,
  orderStatusLabel,
  showsCustomGoodsNote,
} from '../../shared/state/ordersStore.js'

/** @type {string} */
let currentOrderId = ''

/**
 * @param {HTMLElement} host
 */
export function initOrderDetailPage(host) {
  mountFragment(orderDetailHtml, host)
  document.getElementById('order-detail-back')?.addEventListener('click', () => {
    showOrdersPage()
  })
  document.getElementById('order-detail-body')?.addEventListener('click', (e) => {
    const refundBtn =
      e.target instanceof Element ? e.target.closest('[data-refund-order]') : null
    if (refundBtn instanceof HTMLElement) {
      showToast('已送出退款申請，客服將儘快處理')
      return
    }
    const btn = e.target instanceof Element ? e.target.closest('[data-copy-tracking]') : null
    if (!(btn instanceof HTMLElement)) return
    const no = btn.dataset.copyTracking || ''
    if (!no) return
    copyText(no)
      .then(() => showToast('已複製物流單號'))
      .catch(() => showToast('複製失敗'))
  })
}

/** @param {string} orderId */
export function openOrderDetail(orderId) {
  currentOrderId = String(orderId || '')
  refreshOrderDetailPage()
}

export function refreshOrderDetailPage() {
  const body = document.getElementById('order-detail-body')
  const empty = document.getElementById('order-detail-empty')
  if (!body || !empty) return

  const order = currentOrderId ? getOrder(currentOrderId) : null
  if (!order) {
    body.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')
  body.innerHTML = detailHtml(order)
}

/**
 * @param {import('../../shared/state/ordersStore.js').Order} o
 */
function detailHtml(o) {
  const status = normalizeStatus(o.status)
  const img = o.imageUrl ? withBase(o.imageUrl) : ''
  const media = img
    ? `<img src="${escapeAttr(img)}" alt="" class="h-full w-full object-cover" />`
    : `<div class="flex h-full w-full items-center justify-center bg-stone-100 text-xs text-stone-400">設計圖</div>`

  const beads = Math.max(0, Math.round(Number(o.beadsSubtotalTwd) || 0))
  const fee = Math.max(0, Math.round(Number(o.designFeeTwd) || 0))
  const ship = Math.max(0, Math.round(Number(o.shippingTwd) || 0))
  const total = Math.max(0, Math.round(Number(o.amountTwd) || 0))
  const wrist =
    typeof o.wristCm === 'number' && Number.isFinite(o.wristCm)
      ? `腕圍 ≈ ${o.wristCm.toFixed(1)}cm`
      : ''

  const tracking =
    o.trackingNo && (status === 'shipping' || status === 'pickup' || status === 'done')
      ? `<div class="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 pt-3">
          <div class="min-w-0">
            <p class="text-xs text-stone-400">物流單號</p>
            <p class="mt-0.5 truncate text-sm font-medium tabular-nums text-stone-800">${escapeHtml(
              o.trackingNo,
            )}</p>
          </div>
          <button
            type="button"
            data-copy-tracking="${escapeAttr(o.trackingNo)}"
            class="shrink-0 rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-800"
          >
            複製
          </button>
        </div>`
      : ''

  const closedNote =
    status === 'closed'
      ? `<p class="mt-2 text-xs text-stone-400">關閉原因：${escapeHtml(
          o.cancelReason || '訂單已關閉',
        )}</p>`
      : ''

  const showNote = showsCustomGoodsNote(status)
  const showRefund = canRequestRefund(status)
  const noteRefundRow =
    showNote || showRefund
      ? `<div class="mt-3 flex items-center gap-2 ${
          showNote ? 'justify-between' : 'justify-end'
        }">
      ${
        showNote
          ? `<p class="min-w-0 flex-1 text-[0.65rem] leading-snug text-stone-400">${escapeHtml(
              CUSTOM_GOODS_NOTE,
            )}</p>`
          : ''
      }
      ${
        showRefund
          ? `<button
          type="button"
          data-refund-order="${escapeAttr(o.id)}"
          class="shrink-0 rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-800 active:bg-stone-50"
        >申請退款</button>`
          : ''
      }
    </div>`
      : ''

  const hasAddress = o.recipientName || o.recipientPhone || o.recipientAddress
  const paidLabel = status === 'unpaid' ? '建立時間' : '付款時間'
  const paidValue =
    status === 'unpaid'
      ? formatTime(o.createdAt)
      : formatTime(o.paidAt || o.createdAt)

  return `
    <section class="rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-stone-100">
      <div class="flex items-center justify-between gap-2">
        <p class="text-base font-semibold text-stone-900">${escapeHtml(orderStatusLabel(status))}</p>
        <p class="text-xs tabular-nums text-stone-400">${escapeHtml(
          formatTime(o.paidAt || o.createdAt),
        )}</p>
      </div>
      ${statusProgressHtml(status)}
      ${closedNote}
      ${tracking}
      ${noteRefundRow}
    </section>

    ${
      hasAddress
        ? `<section class="rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-stone-100">
      <p class="text-xs font-medium text-stone-400">收件資訊</p>
      <p class="mt-2 text-sm font-medium text-stone-900">
        ${escapeHtml(o.recipientName || '—')}
        <span class="ml-2 font-normal tabular-nums text-stone-600">${escapeHtml(
          o.recipientPhone || '',
        )}</span>
      </p>
      <p class="mt-1 text-sm leading-relaxed text-stone-600">${escapeHtml(
        o.recipientAddress || '',
      )}</p>
    </section>`
        : ''
    }

    <section class="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-100">
      <div class="flex gap-3">
        <div class="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-stone-50">${media}</div>
        <div class="min-w-0 flex-1 py-0.5">
          <p class="truncate text-sm font-medium text-stone-900">${escapeHtml(o.title)}</p>
          ${
            wrist
              ? `<p class="mt-1 text-xs text-stone-400">${escapeHtml(wrist)}</p>`
              : ''
          }
          <p class="mt-2 text-sm font-semibold tabular-nums text-stone-900">NT$${formatPrice(
            total,
          )}</p>
        </div>
      </div>
    </section>

    <section class="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-100">
      <p class="text-xs font-medium text-stone-400">費用明細</p>
      <ul class="mt-1 divide-y divide-stone-100 text-sm">
        <li class="flex items-center justify-between gap-3 py-2.5">
          <span class="text-stone-600">手鍊材料</span>
          <span class="tabular-nums text-stone-900">NT$${formatPrice(beads)}</span>
        </li>
        <li class="flex items-center justify-between gap-3 py-2.5">
          <span class="text-stone-600">設計費用</span>
          <span class="tabular-nums text-stone-900">${
            fee > 0 ? `NT$${formatPrice(fee)}` : '免費'
          }</span>
        </li>
        <li class="flex items-center justify-between gap-3 py-2.5">
          <span class="text-stone-600">運費${ship === 0 ? '（包郵）' : ''}</span>
          <span class="tabular-nums text-stone-900">NT$${formatPrice(ship)}</span>
        </li>
        <li class="flex items-center justify-between gap-3 py-2.5">
          <span class="font-medium text-stone-900">${
            status === 'unpaid' ? '應付金額' : '實付金額'
          }</span>
          <span class="font-semibold tabular-nums text-stone-900">NT$${formatPrice(total)}</span>
        </li>
      </ul>
    </section>

    <section class="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-100">
      <p class="text-xs font-medium text-stone-400">訂單資訊</p>
      <ul class="mt-1 space-y-2.5 pt-1 text-sm">
        <li class="flex items-start justify-between gap-3">
          <span class="shrink-0 text-stone-500">訂單編號</span>
          <span class="break-all text-right tabular-nums text-stone-800">${escapeHtml(o.id)}</span>
        </li>
        <li class="flex items-start justify-between gap-3">
          <span class="shrink-0 text-stone-500">${escapeHtml(paidLabel)}</span>
          <span class="text-right tabular-nums text-stone-800">${escapeHtml(paidValue)}</span>
        </li>
        <li class="flex items-start justify-between gap-3">
          <span class="shrink-0 text-stone-500">付款方式</span>
          <span class="text-right text-stone-800">${
            status === 'unpaid' ? '待付款' : '線上付款'
          }</span>
        </li>
      </ul>
    </section>
  `
}

/**
 * @param {import('../../shared/state/ordersStore.js').OrderStatus} status
 */
function statusProgressHtml(status) {
  if (status === 'closed') {
    return `<p class="mt-3 text-sm text-stone-500">此訂單已關閉。</p>`
  }
  if (status === 'unpaid') {
    return `<p class="mt-3 text-sm text-stone-500">請完成付款後開始排單製作。</p>`
  }

  const steps = [
    { key: 'scheduling', label: '排單中' },
    { key: 'designing', label: '設計中' },
    { key: 'shipping', label: '運送中' },
    { key: 'pickup', label: '待提貨' },
    { key: 'done', label: '已完成' },
  ]
  const indexByStatus = {
    scheduling: 0,
    designing: 1,
    shipping: 2,
    pickup: 3,
    done: 4,
  }
  const activeIndex = indexByStatus[status] ?? 0

  return `
    <ol class="mt-4 flex items-start justify-between gap-0.5">
      ${steps
        .map((step, i) => {
          const done = i <= activeIndex
          const current = i === activeIndex
          return `
        <li class="flex min-w-0 flex-1 flex-col items-center text-center">
          <span class="flex h-2.5 w-2.5 rounded-full ${
            done ? 'bg-stone-900' : 'bg-stone-200'
          } ${current ? 'ring-4 ring-stone-900/15' : ''}"></span>
          <span class="mt-2 text-[0.6rem] leading-tight ${
            current ? 'font-semibold text-stone-900' : done ? 'text-stone-600' : 'text-stone-300'
          }">${escapeHtml(step.label)}</span>
        </li>`
        })
        .join('')}
    </ol>`
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

/** @param {string} text */
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
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
