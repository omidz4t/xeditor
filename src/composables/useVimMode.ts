import { writable, get } from 'svelte/store'

const STORAGE_KEY = 'collab-editor-vim-mode'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const vimEnabled = writable(readStored())

export function useVimMode() {
  function setVimEnabled(enabled: boolean) {
    vimEnabled.set(enabled)
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // ignore
    }
  }

  function toggleVimEnabled() {
    setVimEnabled(!get(vimEnabled))
  }

  return {
    vimEnabled,
    setVimEnabled,
    toggleVimEnabled,
  }
}
