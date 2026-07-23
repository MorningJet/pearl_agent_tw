let timer = 0

/** @param {string} message */
export function showToast(message) {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = message
  el.classList.remove('hidden')
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    el.classList.add('hidden')
  }, 1800)
}
