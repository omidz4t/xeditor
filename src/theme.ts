export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'collab-editor-theme'

let systemListenerBound = false

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return getSystemTheme()
  }

  return mode
}

export function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // ignore
  }

  return 'system'
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode)
}

function bindSystemThemeListener(): void {
  if (systemListenerBound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (getStoredTheme() === 'system') {
      applyTheme('system')
    }
  }

  media.addEventListener('change', onChange)
  systemListenerBound = true
}

export function setTheme(mode: ThemeMode): void {
  applyTheme(mode)

  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

export function initTheme(): ThemeMode {
  const mode = getStoredTheme()
  applyTheme(mode)
  bindSystemThemeListener()
  return mode
}