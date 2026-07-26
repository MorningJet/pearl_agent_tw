/**
 * In-app page visibility (Home tabs ↔ DIY ↔ Design Details ↔ Me sub-pages).
 * Keeps page modules from depending on each other's DOM helpers.
 */

import { hideTabBar, setTabBarActive, showTabBar } from './ui/tabBar.js'

/** @typedef {'home' | 'plaza' | 'my-designs' | 'me'} TabId */

const TAB_PAGE_IDS = {
  home: 'page-home',
  plaza: 'page-plaza',
  'my-designs': 'page-my-designs',
  me: 'page-me',
}

const ME_SUB_PAGE_IDS = [
  'page-earnings',
  'page-orders',
  'page-order-detail',
  'page-address',
  'page-order-guide',
  'page-designer-rules',
]

/** @type {TabId} */
let activeTab = 'home'

/** @type {null | ((tab: TabId) => void)} */
let afterShowTab = null

/** @param {null | ((tab: TabId) => void)} fn */
export function setAfterShowTab(fn) {
  afterShowTab = fn
}

function hideStudioPages() {
  const diy = document.getElementById('page-diy')
  diy?.classList.add('hidden')
  diy?.classList.remove('flex')
  if (diy) diy.style.display = ''
  const details = document.getElementById('page-details')
  details?.classList.add('hidden')
  details?.classList.remove('flex')
  if (details) details.style.display = ''
  const checkout = document.getElementById('page-checkout')
  checkout?.classList.add('hidden')
  checkout?.classList.remove('flex')
}

function hideMeSubPages() {
  for (const id of ME_SUB_PAGE_IDS) {
    const el = document.getElementById(id)
    el?.classList.add('hidden')
    el?.classList.remove('flex')
  }
}

function hideAllTabs() {
  for (const id of Object.values(TAB_PAGE_IDS)) {
    const el = document.getElementById(id)
    el?.classList.add('hidden')
    el?.classList.remove('flex')
  }
}

/**
 * @param {TabId} tab
 */
export function showTab(tab) {
  activeTab = tab
  hideStudioPages()
  hideMeSubPages()
  hideAllTabs()

  const pageId = TAB_PAGE_IDS[tab]
  const page = document.getElementById(pageId)
  page?.classList.remove('hidden')
  page?.classList.add('flex')

  showTabBar()
  setTabBarActive(tab)

  if (tab === 'home') {
    const scroll = document.getElementById('home-scroll')
    if (scroll) scroll.scrollTop = 0
  }
  if (tab === 'plaza') {
    const scroll = document.getElementById('plaza-scroll')
    if (scroll) scroll.scrollTop = 0
  }
  if (tab === 'my-designs') {
    const scroll = document.getElementById('my-designs-scroll')
    if (scroll) scroll.scrollTop = 0
  }
  if (tab === 'me') {
    const scroll = document.getElementById('me-scroll')
    if (scroll) scroll.scrollTop = 0
  }

  afterShowTab?.(tab)
}

export function showHomePage() {
  showTab('home')
}

/**
 * Secondary pages (earnings / orders / guide / address) — hide tab bar.
 * @param {'page-earnings' | 'page-orders' | 'page-order-detail' | 'page-address' | 'page-order-guide' | 'page-designer-rules'} pageId
 * @param {string} [scrollId]
 */
function showMeSubPage(pageId, scrollId) {
  activeTab = 'me'
  hideAllTabs()
  hideStudioPages()
  hideMeSubPages()
  hideTabBar()
  const page = document.getElementById(pageId)
  page?.classList.remove('hidden')
  page?.classList.add('flex')
  if (scrollId) {
    const scroll = document.getElementById(scrollId)
    if (scroll) scroll.scrollTop = 0
  }
}

export function showEarningsPage() {
  showMeSubPage('page-earnings', 'earnings-scroll')
}

export function showOrdersPage() {
  showMeSubPage('page-orders', 'orders-scroll')
}

export function showOrderDetailPage() {
  showMeSubPage('page-order-detail', 'order-detail-scroll')
}

export function showAddressPage() {
  showMeSubPage('page-address', 'address-scroll')
}

export function showOrderGuidePage() {
  showMeSubPage('page-order-guide', 'order-guide-scroll')
}

export function showDesignerRulesPage() {
  showMeSubPage('page-designer-rules', 'designer-rules-scroll')
}

export function showDiyPage() {
  hideAllTabs()
  hideMeSubPages()
  hideTabBar()
  const details = document.getElementById('page-details')
  details?.classList.add('hidden')
  details?.classList.remove('flex')
  const checkout = document.getElementById('page-checkout')
  checkout?.classList.add('hidden')
  checkout?.classList.remove('flex')
  const diy = document.getElementById('page-diy')
  diy?.classList.remove('hidden')
  diy?.classList.add('flex')
}

/** Leave DIY studio back to Home. */
export function leaveDiyPage() {
  showHomePage()
}

export function showDetailsPage() {
  hideAllTabs()
  hideMeSubPages()
  hideTabBar()
  const diy = document.getElementById('page-diy')
  diy?.classList.add('hidden')
  diy?.classList.remove('flex')
  const checkout = document.getElementById('page-checkout')
  checkout?.classList.add('hidden')
  checkout?.classList.remove('flex')
  const details = document.getElementById('page-details')
  if (details) {
    details.classList.remove('hidden')
    details.classList.add('flex')
    details.style.display = 'flex'
  }
  const scroll = document.getElementById('details-scroll')
  if (scroll) scroll.scrollTop = 0
}

export function showCheckoutPage() {
  hideAllTabs()
  hideMeSubPages()
  hideTabBar()
  const diy = document.getElementById('page-diy')
  diy?.classList.add('hidden')
  diy?.classList.remove('flex')
  const details = document.getElementById('page-details')
  details?.classList.add('hidden')
  details?.classList.remove('flex')
  if (details) details.style.display = ''
  const checkout = document.getElementById('page-checkout')
  if (checkout) {
    checkout.classList.remove('hidden')
    checkout.classList.add('flex')
  }
  const scroll = document.getElementById('checkout-scroll')
  if (scroll) scroll.scrollTop = 0
}

export function getActiveTab() {
  return activeTab
}
