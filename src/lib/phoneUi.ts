/**
 * Robust phone / compact-UI detection for WebXDC shells (esp. iOS WKWebView).
 *
 * Relying only on `(max-width: 768px)` is unreliable: some hosts report a
 * desktop-ish CSS width, or media queries lag on first paint. We combine
 * viewport, pointer, and UA signals, and publish `html[data-phone-ui]` for CSS.
 */

const PHONE_MQ = '(max-width: 768px), (max-width: 900px) and (pointer: coarse), (hover: none) and (pointer: coarse)'

export function computePhoneUi(): boolean {
  if (typeof window === 'undefined') return false

  try {
    if (window.matchMedia(PHONE_MQ).matches) return true
  } catch {
    /* ignore */
  }

  const vv = window.visualViewport?.width
  const w = Math.min(
    window.innerWidth || 9999,
    document.documentElement?.clientWidth || 9999,
    typeof vv === 'number' && vv > 0 ? vv : 9999,
  )
  if (w <= 768) return true

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  // Real phones (iPhone / Android mobile) should always get compact UI,
  // even if the WebXDC host fakes a wide layout viewport.
  if (/iPhone|iPod/i.test(ua)) return true
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true

  const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0
  let coarse = false
  let noHover = false
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches
    noHover = window.matchMedia('(hover: none)').matches
  } catch {
    /* ignore */
  }

  // iPad / large phones in landscape: still prefer compact chrome under 1100px.
  if ((coarse || noHover || touchPoints > 1) && w <= 1024) return true

  return false
}

/** Keep `html[data-phone-ui]` in sync for pure CSS (no JS class required). */
export function applyPhoneUiAttr(on = computePhoneUi()): boolean {
  if (typeof document === 'undefined') return on
  if (on) document.documentElement.setAttribute('data-phone-ui', '1')
  else document.documentElement.removeAttribute('data-phone-ui')
  return on
}

/** Subscribe to resize / orientation / media changes. Returns unsubscribe. */
export function watchPhoneUi(onChange: (phone: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  let last = applyPhoneUiAttr()
  onChange(last)

  const emit = () => {
    const next = applyPhoneUiAttr()
    if (next !== last) {
      last = next
      onChange(next)
    } else {
      // Still re-apply attr in case something cleared it.
      applyPhoneUiAttr(next)
    }
  }

  let mq: MediaQueryList | null = null
  try {
    mq = window.matchMedia(PHONE_MQ)
    mq.addEventListener('change', emit)
  } catch {
    mq = null
  }

  window.addEventListener('resize', emit)
  window.addEventListener('orientationchange', emit)
  window.visualViewport?.addEventListener('resize', emit)

  return () => {
    mq?.removeEventListener('change', emit)
    window.removeEventListener('resize', emit)
    window.removeEventListener('orientationchange', emit)
    window.visualViewport?.removeEventListener('resize', emit)
  }
}
