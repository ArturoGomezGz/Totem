// navigator.clipboard solo existe en contextos seguros (HTTPS o localhost).
// Los despliegues por HTTP plano en una IP de LAN (ej. un server local sin TLS)
// no lo tienen disponible, así que hace falta un respaldo vía execCommand.
function fallbackCopy(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}

// Devuelve una Promise<boolean> — true si se copió, false si ningún mecanismo funcionó.
export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
      .then(() => true)
      .catch(() => fallbackCopy(text))
  }
  return Promise.resolve(fallbackCopy(text))
}
