import tabBarHtml from './tabBar.html?raw'
import { mountFragment } from '../mount.js'

/**
 * @param {HTMLElement} host
 * @param {{ onTabChange: (tab: import('../nav.js').TabId) => void }} options
 */
export function initTabBar(host, options) {
  mountFragment(tabBarHtml, host)

  document.getElementById('app-tabbar')?.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.tab-btn') : null
    if (!(btn instanceof HTMLElement)) return
    const tab = btn.dataset.tab
    if (!tab) return
    options.onTabChange(/** @type {import('../nav.js').TabId} */ (tab))
  })
}

/** @param {import('../nav.js').TabId} tab */
export function setTabBarActive(tab) {
  document.querySelectorAll('.tab-btn').forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    const active = el.dataset.tab === tab
    el.classList.toggle('tab-btn-active', active)
    el.classList.toggle('text-stone-400', !active)
    const img = el.querySelector('img')
    if (img) img.classList.toggle('opacity-45', !active)
  })
}

export function showTabBar() {
  document.getElementById('app-tabbar')?.classList.remove('hidden')
}

export function hideTabBar() {
  document.getElementById('app-tabbar')?.classList.add('hidden')
}
