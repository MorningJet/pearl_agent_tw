import { createCanvasApp } from './canvas/engine.js'
import { initTopBar } from './ui/topBar.js'
import { initMiddleBar } from './ui/middleBar.js'
import { initShelf } from './ui/shelf.js'
import diyHtml from './page.html?raw'
import { mountFragment } from '../../shared/mount.js'
import { leaveDiyPage } from '../../shared/nav.js'

/**
 * @param {HTMLElement} host
 * @param {{ onMakeNow: () => void }} options
 * @returns {{ exportImage: () => string }}
 */
export function initDiyPage(host, options) {
  mountFragment(diyHtml, host)

  const canvas = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById('bracelet-canvas')
  )
  if (!canvas) throw new Error('#bracelet-canvas missing')

  const canvasApp = createCanvasApp(canvas)
  initTopBar()
  initMiddleBar({ onMakeNow: options.onMakeNow })
  initShelf()

  document.getElementById('diy-back')?.addEventListener('click', () => {
    leaveDiyPage()
  })

  return {
    exportImage: () => canvasApp.exportImage(),
  }
}
