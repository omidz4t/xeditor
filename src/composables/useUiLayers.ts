/**
 * Stack of open UI layers so Escape closes the topmost surface first
 * (dialogs → menus → comments → left sidebar).
 */
import { derived, get, writable } from 'svelte/store'

export type UiLayerId =
  | 'delete-dialog'
  | 'sync-mode'
  | 'import-dialog'
  | 'share-dialog'
  | 'settings'
  | 'command-palette'
  | 'context-menu'
  | 'shortcuts'
  | 'comments'
  | 'link-context-menu'
  | 'external-link-modal'
  | 'slash-menu'
  | 'emoji-menu'
  | 'bubble-toolbar'
  | 'people-popover'
  | 'more-menu'
  | 'cover-picker'
  | 'icon-picker'
  | 'sidebar'

/** Higher z = closer to top (closed first on Escape). */
const LAYER_Z: Record<UiLayerId, number> = {
  'delete-dialog': 120,
  'sync-mode': 115,
  'import-dialog': 110,
  'share-dialog': 105,
  settings: 100,
  'command-palette': 95,
  'context-menu': 90,
  shortcuts: 85,
  'link-context-menu': 80,
  'external-link-modal': 75,
  'people-popover': 70,
  'more-menu': 65,
  'cover-picker': 60,
  'icon-picker': 55,
  'slash-menu': 50,
  'emoji-menu': 45,
  'bubble-toolbar': 40,
  comments: 20,
  sidebar: 10,
}

const openLayers = writable<Set<UiLayerId>>(new Set())
/** Close handlers for currently open layers (registered by the owner). */
const layerClosers = writable<Partial<Record<UiLayerId, () => void>>>({})

export function setUiLayerOpen(id: UiLayerId, open: boolean): void {
  openLayers.update((prev) => {
    const has = prev.has(id)
    if (open === has) return prev
    const next = new Set(prev)
    if (open) next.add(id)
    else next.delete(id)
    return next
  })
  if (!open) {
    layerClosers.update((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }
}

/**
 * Keep a layer registered while open and attach how to dismiss it on Escape.
 * Call from an `$effect` that tracks the open flag.
 */
export function bindUiLayer(id: UiLayerId, open: boolean, close: () => void): void {
  setUiLayerOpen(id, open)
  layerClosers.update((prev) => {
    if (!open) {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    }
    if (prev[id] === close) return prev
    return { ...prev, [id]: close }
  })
}

export function isUiLayerOpen(id: UiLayerId): boolean {
  return get(openLayers).has(id)
}

/** Topmost open layer, or null if none. */
export function getTopUiLayer(): UiLayerId | null {
  const set = get(openLayers)
  let top: UiLayerId | null = null
  let z = -1
  for (const id of set) {
    const layerZ = LAYER_Z[id] ?? 0
    if (layerZ > z) {
      z = layerZ
      top = id
    }
  }
  return top
}

/** Close a specific layer if it is open. Returns true if it was open. */
export function closeUiLayer(id: UiLayerId): boolean {
  if (!get(openLayers).has(id)) return false
  const close = get(layerClosers)[id]
  if (close) {
    close()
  } else {
    setUiLayerOpen(id, false)
  }
  return true
}

/** Close the highest open layer. Returns true if something was dismissed. */
export function dismissTopUiLayer(): boolean {
  const top = getTopUiLayer()
  if (!top) return false
  return closeUiLayer(top)
}

export const topUiLayer = derived(openLayers, ($set) => {
  let top: UiLayerId | null = null
  let z = -1
  for (const id of $set) {
    const layerZ = LAYER_Z[id] ?? 0
    if (layerZ > z) {
      z = layerZ
      top = id
    }
  }
  return top
})

export const uiLayersOpen = {
  subscribe: openLayers.subscribe,
}

/**
 * Editor-owned overlays live outside this app store (package boundary).
 * If any of these are in the DOM, Escape should be left to the editor first.
 */
export function editorOwnsEscape(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.querySelector(
      [
        '.slash-menu',
        '.emoji-menu',
        '.editor-bubble-toolbar',
        '.be-link-context-menu',
        '.be-external-link-modal',
        '.page-ref__picker',
        '.xpe-icon-popover',
        '.cover-picker',
      ].join(','),
    ),
  )
}
