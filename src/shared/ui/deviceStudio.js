import {
  applyEmbedClass,
  applyUiScale,
  isLivePhoneViewport,
  syncUiScaleFromScreen,
} from './uiScale.js'

/** iPhone 12–17 logical CSS viewport sizes (points) — desktop preview only. */

/**
 * @typedef {'notch' | 'island'} DeviceTop
 * @typedef {{ id: string, name: string, w: number, h: number, top: DeviceTop }} PhoneModel
 */

/** @type {PhoneModel[]} */
export const IPHONE_MODELS = [
  { id: 'iphone-12-mini', name: 'iPhone 12 mini', w: 360, h: 780, top: 'notch' },
  { id: 'iphone-12', name: 'iPhone 12', w: 390, h: 844, top: 'notch' },
  { id: 'iphone-12-pro', name: 'iPhone 12 Pro', w: 390, h: 844, top: 'notch' },
  { id: 'iphone-12-pro-max', name: 'iPhone 12 Pro Max', w: 428, h: 926, top: 'notch' },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', w: 360, h: 780, top: 'notch' },
  { id: 'iphone-13', name: 'iPhone 13', w: 390, h: 844, top: 'notch' },
  { id: 'iphone-13-pro', name: 'iPhone 13 Pro', w: 390, h: 844, top: 'notch' },
  { id: 'iphone-13-pro-max', name: 'iPhone 13 Pro Max', w: 428, h: 926, top: 'notch' },
  { id: 'iphone-14', name: 'iPhone 14', w: 390, h: 844, top: 'notch' },
  { id: 'iphone-14-plus', name: 'iPhone 14 Plus', w: 428, h: 926, top: 'notch' },
  { id: 'iphone-14-pro', name: 'iPhone 14 Pro', w: 393, h: 852, top: 'island' },
  { id: 'iphone-14-pro-max', name: 'iPhone 14 Pro Max', w: 430, h: 932, top: 'island' },
  { id: 'iphone-15', name: 'iPhone 15', w: 393, h: 852, top: 'island' },
  { id: 'iphone-15-plus', name: 'iPhone 15 Plus', w: 430, h: 932, top: 'island' },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', w: 393, h: 852, top: 'island' },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', w: 430, h: 932, top: 'island' },
  { id: 'iphone-16', name: 'iPhone 16', w: 393, h: 852, top: 'island' },
  { id: 'iphone-16-plus', name: 'iPhone 16 Plus', w: 430, h: 932, top: 'island' },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', w: 402, h: 874, top: 'island' },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', w: 440, h: 956, top: 'island' },
  { id: 'iphone-17', name: 'iPhone 17', w: 402, h: 874, top: 'island' },
  { id: 'iphone-17-air', name: 'iPhone 17 Air', w: 420, h: 912, top: 'island' },
  { id: 'iphone-17-pro', name: 'iPhone 17 Pro', w: 402, h: 874, top: 'island' },
  { id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max', w: 440, h: 956, top: 'island' },
]

const STORAGE_KEY = 'pearl-tw-preview-device'
const DEFAULT_ID = 'iphone-15'

/**
 * Desktop studio shell: dark canvas, phone frame, model picker.
 * On a real phone, frame sizes are ignored — live viewport drives UI scale.
 */
export function initDeviceStudio() {
  applyEmbedClass()

  const screen = document.getElementById('device-screen')
  const select = document.getElementById('device-select')
  const cutout = document.getElementById('device-cutout')
  if (!screen || !select) return

  select.innerHTML = IPHONE_MODELS.map(
    (m) => `<option value="${m.id}">${m.name} · ${m.w}×${m.h}</option>`,
  ).join('')

  const saved = localStorage.getItem(STORAGE_KEY) || DEFAULT_ID
  const initial =
    IPHONE_MODELS.find((m) => m.id === saved) ||
    IPHONE_MODELS.find((m) => m.id === DEFAULT_ID)
  if (initial) select.value = initial.id

  function apply(id) {
    const model = IPHONE_MODELS.find((m) => m.id === id) || IPHONE_MODELS[0]

    if (isLivePhoneViewport()) {
      // Real device: fill the phone; scale from measured CSS width (any brand/model)
      screen.style.width = ''
      screen.style.height = ''
      screen.dataset.device = 'live'
      screen.style.removeProperty('--safe-top')
      syncUiScaleFromScreen()
    } else {
      screen.style.width = `${model.w}px`
      screen.style.height = `${model.h}px`
      screen.dataset.device = model.id
      screen.style.setProperty('--safe-top', model.top === 'island' ? '26px' : '22px')
      applyUiScale(model.w)
    }

    if (cutout) {
      cutout.dataset.top = model.top
      cutout.setAttribute('aria-hidden', 'true')
    }
    localStorage.setItem(STORAGE_KEY, model.id)
    window.dispatchEvent(new Event('resize'))
  }

  select.addEventListener('change', () => apply(select.value))
  apply(select.value)

  const stage = document.getElementById('studio-stage')
  const shell = document.getElementById('device-shell')
  if (!stage || !shell) return

  const scaleFit = () => {
    if (isLivePhoneViewport()) {
      shell.style.transform = ''
      syncUiScaleFromScreen()
      return
    }
    const pad = 48
    const availW = stage.clientWidth - pad
    const availH = stage.clientHeight - pad
    const bezel = 14
    const fw = screen.offsetWidth + bezel * 2
    const fh = screen.offsetHeight + bezel * 2
    const scale = Math.min(1, availW / fw, availH / fh)
    shell.style.transform = `scale(${scale})`
  }

  const ro = new ResizeObserver(scaleFit)
  ro.observe(stage)
  select.addEventListener('change', () => requestAnimationFrame(scaleFit))
  scaleFit()
}
