import { writable, get } from 'svelte/store'

const STORAGE_KEY = 'collab-editor-join-notifications'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** When true, first chat sync may post an "X joined" info line. Off by default. */
const joinNotificationsEnabled = writable(readStored())

export function isJoinNotificationsEnabled(): boolean {
  return get(joinNotificationsEnabled)
}

export function useJoinNotifications() {
  function setJoinNotificationsEnabled(enabled: boolean) {
    joinNotificationsEnabled.set(enabled)
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // ignore
    }
  }

  function toggleJoinNotifications() {
    setJoinNotificationsEnabled(!get(joinNotificationsEnabled))
  }

  return {
    joinNotificationsEnabled,
    setJoinNotificationsEnabled,
    toggleJoinNotifications,
  }
}
