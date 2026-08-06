import { derived, writable, get } from 'svelte/store'
import { getStoredTheme, resolveTheme, setTheme, type ResolvedTheme, type ThemeMode } from '../theme'

const theme = writable<ThemeMode>(getStoredTheme())

export function useTheme() {
  const resolvedTheme = derived(theme, ($theme) => resolveTheme($theme) as ResolvedTheme)

  function updateTheme(mode: ThemeMode) {
    theme.set(mode)
    setTheme(mode)
  }

  function toggleTheme() {
    const current = resolveTheme(get(theme))
    updateTheme(current === 'dark' ? 'light' : 'dark')
  }

  return {
    theme,
    resolvedTheme,
    updateTheme,
    toggleTheme,
  }
}
