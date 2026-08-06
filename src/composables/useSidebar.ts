import { writable, get } from 'svelte/store'

const STORAGE_KEY = 'collab-editor-sidebar'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'open'
  } catch {
    return false
  }
}

function writeStored(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed')
  } catch {
    // ignore
  }
}

const sidebarOpen = writable(readStored())

export function useSidebar() {
  function toggleSidebar() {
    sidebarOpen.update((open) => {
      const next = !open
      writeStored(next)
      return next
    })
  }

  function setSidebarOpen(open: boolean) {
    sidebarOpen.set(open)
    writeStored(open)
  }

  return {
    sidebarOpen,
    toggleSidebar,
    setSidebarOpen,
    getSidebarOpen: () => get(sidebarOpen),
  }
}
