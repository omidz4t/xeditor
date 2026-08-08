<script lang="ts">
import ChevronRight from '@lucide/svelte/icons/chevron-right'
import FileText from '@lucide/svelte/icons/file-text'
import FileUp from '@lucide/svelte/icons/file-up'
import Plus from '@lucide/svelte/icons/plus'
import Search from '@lucide/svelte/icons/search'
import X from '@lucide/svelte/icons/x'
import { tick, untrack } from 'svelte'
import type { PeerPresence } from '../collab/presence'
import type { PageMeta } from '../collab/document'
import { pathForPage } from '../collab/folder-binding'
import { isBrowserWebxdcMock } from '../collab/sync-mode'
import { portal } from '../lib/portal'


let {
  open = $bindable(false),
  pages = [] as PageMeta[],
  peers = [] as PeerPresence[],
  currentPageId = '',
  rootPageId = '',
  onnavigate,
  onrename,
  onnewPage,
  onimportMarkdown,
  onimportMarkdownFiles,
  onmove,
  onrequestDelete,
}: {
  open?: boolean
  pages?: PageMeta[]
  peers?: PeerPresence[]
  currentPageId?: string
  rootPageId?: string
  onnavigate?: (pageId: string) => void
  onrename?: (pageId: string, title: string) => void
  onnewPage?: (payload?: { parentId: string; insertAfterPageId?: string }) => void
  onimportMarkdown?: () => void
  onimportMarkdownFiles?: (files: File[]) => void
  onmove?: (payload: { pageId: string; parentId: string; insertBeforePageId?: string }) => void
  onrequestDelete?: (pageIds: string[]) => void
} = $props()


function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdown')) return true
  const type = (file.type || '').toLowerCase()
  return type === 'text/markdown' || type === 'text/x-markdown'
}

function onSidebarFileDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? []).filter(isMarkdownFile)
  if (files.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  onimportMarkdownFiles?.(files)
}

type DropIntent =
  | { kind: 'child'; parentId: string; targetId: string }
  | {
      kind: 'sibling'
      parentId: string
      /** Insert before this sibling; omit to append as last under parent. */
      insertBeforePageId?: string
      /** Where to draw the drop indicator in the list. */
      indicatorPageId: string
      indicator: 'before' | 'after'
    }
  | { kind: 'root'; parentId: string; insertBeforePageId?: string }
  | { kind: 'outdent'; parentId: string; insertBeforePageId: string; indicatorPageId: string }

let query = $state('')
let editingPageId = $state<string | null>(null)
let editingTitle = $state('')
let editInputRef = $state<HTMLInputElement | null>(null)
let draggingPageId = $state<string | null>(null)
let dropIntent = $state<DropIntent | null>(null)
/**
 * Collapsed page ids. Stored as a sorted key string + helper Set so Svelte 5
 * always re-renders when the set of collapsed nodes changes.
 */
let collapsedKey = $state('')
const collapsedSet = new Set<string>()
/** Last page id we auto-expanded ancestors for (navigation only). */
let expandedPathForId: string | null = null
/** Multi-select in the page tree (Ctrl/Cmd+click, Shift+click). */
let selectedPageIds = $state(new Set<string>())
/** Anchor for Shift+click range selection. */
let selectionAnchorId = $state<string | null>(null)

/** Right-click menu for a single sidebar page (rename / delete only). */
let pageMenuOpen = $state(false)
let pageMenuPageId = $state<string | null>(null)
let pageMenuX = $state(0)
let pageMenuY = $state(0)
let pageMenuRef = $state<HTMLElement | null>(null)

const pageMenuPage = $derived.by(() =>
  pageMenuPageId
    ? pages.find((page) => page.id === pageMenuPageId) ?? null
    : null,
)

const pageMenuSelectionIds = $derived.by(() => {
  const ids = [...selectedPageIds]
  if (ids.length > 0) return ids
  return pageMenuPageId ? [pageMenuPageId] : []
})

const pageMenuCanDelete = $derived.by(() =>
  pageMenuSelectionIds.some((id) => id && !isRootPage(id))
)

const pageMenuDeleteLabel = $derived.by(() => {
  const n = pageMenuSelectionIds.filter((id) => id && !isRootPage(id)).length
  return n > 1 ? `Delete ${n} pages` : 'Delete'
})

const pageMenuShowRename = $derived.by(() => pageMenuSelectionIds.length <= 1)

const INDENT_BASE = 4
const INDENT_STEP = 14

const filteredPages = $derived.by(() => {
  const q = query.trim().toLowerCase()
  if (!q) return pages
  return pages.filter((page) => page.title.toLowerCase().includes(q))
})

/** Split title into plain + match segments for search highlighting. */
function titleHighlightParts(title: string): Array<{ text: string; match: boolean }> {
  const q = query.trim()
  if (!q || !isSearching) {
    return [{ text: title, match: false }]
  }

  const lower = title.toLowerCase()
  const needle = q.toLowerCase()
  const parts: Array<{ text: string; match: boolean }> = []
  let start = 0

  while (start < title.length) {
    const idx = lower.indexOf(needle, start)
    if (idx < 0) {
      parts.push({ text: title.slice(start), match: false })
      break
    }
    if (idx > start) {
      parts.push({ text: title.slice(start, idx), match: false })
    }
    parts.push({ text: title.slice(idx, idx + needle.length), match: true })
    start = idx + needle.length
  }

  return parts.length ? parts : [{ text: title, match: false }]
}

const childCountByParent = $derived.by(() => {
  const counts = new Map<string, number>()

  for (const page of pages) {
    if (!page?.id || page.id === rootPageId) continue
    // Match treeParentId so empty/missing parentId still counts under root.
    const parentId = treeParentId(page) ?? rootPageId
    if (!parentId) continue
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1)
  }

  return counts
})

const isSearching = $derived.by(() => Boolean(query.trim()))

const visiblePages = $derived.by(() => {
  // collapsedKey is the reactive source of truth for expand/collapse.
  void collapsedKey
  if (isSearching) return filteredPages
  return filteredPages.filter((page) => !isHiddenByCollapse(page))
})

const dragEnabled = $derived.by(() => !isSearching)

const draggedPage = $derived.by(() =>
  draggingPageId
    ? pages.find((page) => page.id === draggingPageId) ?? null
    : null,
)

const showRootDrop = $derived.by(() => {
  if (!draggedPage || !rootPageId) return false
  const parentId = draggedPage.parentId ?? rootPageId
  return parentId !== rootPageId
})

function isPageSelected(pageId: string) {
  return selectedPageIds.has(pageId)
}

function setSelection(ids: Iterable<string>, anchorId?: string | null) {
  selectedPageIds = new Set(ids)
  if (anchorId !== undefined) {
    selectionAnchorId = anchorId
  }
}

function clearSelection() {
  selectedPageIds = new Set()
  selectionAnchorId = null
}

function rangeIdsBetween(fromId: string, toId: string): string[] {
  const list = visiblePages.map((page) => page.id)
  const a = list.indexOf(fromId)
  const b = list.indexOf(toId)
  if (a < 0 || b < 0) return [toId]
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  return list.slice(start, end + 1)
}

function selectPage(pageId: string, event?: MouseEvent) {
  if (editingPageId || draggingPageId) {
    return
  }

  const multi = Boolean(event && (event.ctrlKey || event.metaKey))
  const range = Boolean(event && event.shiftKey && !multi)

  if (multi) {
    event?.preventDefault()
    const next = new Set(selectedPageIds)
    // Seed selection with the current page when starting multi-select.
    if (next.size === 0 && currentPageId) {
      next.add(currentPageId)
    }
    if (next.has(pageId)) {
      next.delete(pageId)
    } else {
      next.add(pageId)
    }
    setSelection(next, pageId)
    return
  }

  if (range) {
    event?.preventDefault()
    const anchor = selectionAnchorId ?? currentPageId ?? pageId
    setSelection(rangeIdsBetween(anchor, pageId), anchor)
    return
  }

  // Plain click: navigate and reset multi-select to this page.
  setSelection([pageId], pageId)
  onnavigate?.(pageId)
  if (window.innerWidth <= 768) {
    open = false
  }
}

function deletableSelectedIds(): string[] {
  const ids = [...selectedPageIds].filter((id) => id && !isRootPage(id))
  if (ids.length > 0) return ids
  if (currentPageId && !isRootPage(currentPageId)) {
    return [currentPageId]
  }
  return []
}

function requestDeleteIds(ids: string[]) {
  const unique = [...new Set(ids.filter((id) => id && !isRootPage(id)))]
  if (unique.length === 0) return
  onrequestDelete?.(unique)
}

function startRename(page: PageMeta, event?: MouseEvent) {
  event?.preventDefault()
  event?.stopPropagation()
  closePageMenu()
  editingPageId = page.id
  editingTitle = page.title === 'Untitled' ? '' : page.title
  void tick().then(() => {
    editInputRef?.focus()
    editInputRef?.select()
  })
}

function closePageMenu() {
  pageMenuOpen = false
  pageMenuPageId = null
}

function openPageMenu(page: PageMeta, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (editingPageId || draggingPageId) return

  // Right-click outside the multi-selection focuses that page only.
  if (!selectedPageIds.has(page.id)) {
    setSelection([page.id], page.id)
  }

  pageMenuPageId = page.id
  pageMenuX = event.clientX
  pageMenuY = event.clientY
  pageMenuOpen = true

  void tick().then(() => {
    const menu = pageMenuRef
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const padding = 8
    let left = pageMenuX
    let top = pageMenuY
    if (left + rect.width > window.innerWidth - padding) {
      left = window.innerWidth - rect.width - padding
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = window.innerHeight - rect.height - padding
    }
    menu.style.left = `${Math.max(padding, left)}px`
    menu.style.top = `${Math.max(padding, top)}px`
  })
}

function onPageMenuRename() {
  const page = pageMenuPage
  if (!page) {
    closePageMenu()
    return
  }
  startRename(page)
}

function pageDisplayName(page: PageMeta): string {
  return page.title?.trim() || 'Untitled'
}

/** Disk path when a folder is bound; otherwise a title breadcrumb path. */
function pagePathLabel(page: PageMeta): string {
  const bound = pathForPage(page.id)
  if (bound) return bound

  const parts: string[] = []
  let current: PageMeta | undefined = page
  const guard = new Set<string>()
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    parts.unshift(pageDisplayName(current))
    if (current.id === rootPageId) break
    const parentId = treeParentId(current)
    current = parentId ? pages.find((entry) => entry.id === parentId) : undefined
  }
  return parts.join(' / ')
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text ?? ''
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

async function onPageMenuCopyName() {
  const page = pageMenuPage
  closePageMenu()
  if (!page) return
  await copyTextToClipboard(pageDisplayName(page))
}

async function onPageMenuCopyPath() {
  const page = pageMenuPage
  closePageMenu()
  if (!page) return
  await copyTextToClipboard(pagePathLabel(page))
}

/** Sibling page after the right-clicked one (or top-level under root). */
function onPageMenuNewPage() {
  const page = pageMenuPage
  closePageMenu()
  if (!page) return

  if (isRootPage(page.id)) {
    onnewPage?.({ parentId: page.id })
    return
  }

  const parentId = page.parentId ?? rootPageId
  if (!parentId) return
  onnewPage?.({ parentId, insertAfterPageId: page.id })
}

/** Nested page under the right-clicked page. */
function onPageMenuAddSubPage() {
  const page = pageMenuPage
  closePageMenu()
  if (!page) return
  // Keep the parent expanded so the new child is visible in the tree.
  setCollapsed(page.id, false)
  onnewPage?.({ parentId: page.id })
}

function onPageMenuDelete() {
  const ids = pageMenuSelectionIds
  closePageMenu()
  requestDeleteIds(ids)
}

function onPageMenuDocumentPointerDown(event: MouseEvent) {
  if (!pageMenuOpen || !pageMenuRef) return
  if (!pageMenuRef.contains(event.target as Node)) closePageMenu()
}

function onPageMenuDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && pageMenuOpen) {
    event.preventDefault()
    closePageMenu()
  }
}

function commitRename(pageId: string) {
  if (editingPageId !== pageId) {
    return
  }

  const title = editingTitle.trim()
  editingPageId = null
  onrename?.(pageId, title)
}

function cancelRename() {
  editingPageId = null
}

function onRenameKeydown(pageId: string, event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename(pageId)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

const hidePeople = $derived(isBrowserWebxdcMock())

function peersOnPage(pageId: string) {
  if (hidePeople) return [] as PeerPresence[]
  return (peers ?? []).filter((peer) => peer.pageId === pageId)
}

function pageHasChildren(pageId: string) {
  return (childCountByParent.get(pageId) ?? 0) > 0
}

function syncCollapsedKey() {
  collapsedKey = [...collapsedSet].sort().join('\0')
}

function isCollapsed(pageId: string) {
  void collapsedKey
  return collapsedSet.has(pageId)
}

function setCollapsed(pageId: string, collapsed: boolean) {
  if (!pageId) return
  if (collapsed) {
    if (collapsedSet.has(pageId)) return
    collapsedSet.add(pageId)
  } else {
    if (!collapsedSet.has(pageId)) return
    collapsedSet.delete(pageId)
  }
  syncCollapsedKey()
}

/** Parent id used for the tree (root children often omit parentId on the record). */
function treeParentId(page: PageMeta): string | undefined {
  if (!page?.id || page.id === rootPageId) return undefined
  return page.parentId || rootPageId || undefined
}

function isHiddenByCollapse(page: PageMeta) {
  void collapsedKey
  if (!page || page.id === rootPageId) return false

  let parentId = treeParentId(page)
  const guard = new Set<string>()
  while (parentId && !guard.has(parentId)) {
    guard.add(parentId)
    if (collapsedSet.has(parentId)) return true
    if (parentId === rootPageId) break
    const parent = pages.find((entry) => entry.id === parentId)
    if (!parent) break
    parentId = treeParentId(parent)
  }

  return false
}

function toggleCollapse(pageId: string, event?: Event) {
  event?.preventDefault()
  event?.stopPropagation()
  if (event && typeof (event as Event).stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation()
  }
  if (!pageId) return
  setCollapsed(pageId, !collapsedSet.has(pageId))
}

/**
 * Ensure the path to `pageId` is visible after navigation.
 * Does NOT expand the page itself, and never treats root as its own parent.
 */
function expandAncestors(pageId: string) {
  if (!pageId || pageId === rootPageId) return
  const page = pages.find((entry) => entry.id === pageId)
  if (!page) return

  let parentId = treeParentId(page)
  if (!parentId) return

  let changed = false
  const guard = new Set<string>()

  while (parentId && !guard.has(parentId)) {
    guard.add(parentId)
    if (collapsedSet.has(parentId)) {
      collapsedSet.delete(parentId)
      changed = true
    }
    if (parentId === rootPageId) break
    const parent = pages.find((entry) => entry.id === parentId)
    parentId = parent ? treeParentId(parent) : undefined
  }

  if (changed) syncCollapsedKey()
}

function pageIndent(page: PageMeta) {
  // Root sits flush; children indent for hierarchy (no drag-handle column).
  if (isRootPage(page.id)) return INDENT_BASE
  return INDENT_BASE + Math.max(1, page.depth ?? 1) * INDENT_STEP
}

function showCollapseControl(page: PageMeta) {
  return pageHasChildren(page.id)
}

function onCollapsePointerDown(event: PointerEvent | MouseEvent) {
  // Isolate from the row's HTML5 drag — do NOT preventDefault here or
  // some browsers drop the following click.
  event.stopPropagation()
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation()
  }
}

function onCollapseClick(pageId: string, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation()
  }
  toggleCollapse(pageId)
}


function isRootPage(pageId: string) {
  return pageId === rootPageId
}

function canDragPage(page: PageMeta) {
  return dragEnabled && !isRootPage(page.id)
}

function isInvalidDrop(draggedId: string, targetId: string) {
  if (draggedId === targetId) return true

  const descendants = new Set<string>()
  const stack = [draggedId]

  while (stack.length) {
    const current = stack.pop()
    if (!current || descendants.has(current)) continue
    descendants.add(current)
    for (const page of pages) {
      const parentId = page.parentId ?? rootPageId
      if (parentId === current) {
        stack.push(page.id)
      }
    }
  }

  return descendants.has(targetId)
}

function pageParentId(pageId: string) {
  const page = pages.find((entry) => entry.id === pageId)
  return page?.parentId ?? rootPageId
}

/** Siblings under the same parent in current sidebar list order (visible pages). */
function siblingIds(parentId: string): string[] {
  return pages
    .filter((page) => !isRootPage(page.id) && pageParentId(page.id) === parentId)
    .map((page) => page.id)
}

function nextSiblingId(pageId: string): string | undefined {
  if (isRootPage(pageId)) return undefined
  const parent = pageParentId(pageId)
  const siblings = siblingIds(parent)
  const index = siblings.indexOf(pageId)
  if (index < 0 || index >= siblings.length - 1) return undefined
  return siblings[index + 1]
}

function resolveDropTarget(page: PageMeta, event: DragEvent): DropIntent | null {
  const draggedId = draggingPageId
  if (!draggedId || !rootPageId) return null
  if (isInvalidDrop(draggedId, page.id)) return null

  const row = event.currentTarget as HTMLElement
  const rect = row.getBoundingClientRect()
  const y = event.clientY - rect.top
  const ratio = rect.height > 0 ? y / rect.height : 0.5
  const x = event.clientX - rect.left

  if (x < 22) {
    const draggedParent = pageParentId(draggedId)
    if (draggedParent === rootPageId) {
      return {
        kind: 'sibling',
        parentId: rootPageId,
        insertBeforePageId: isRootPage(page.id) ? siblingIds(rootPageId)[0] : page.id,
        indicatorPageId: page.id,
        indicator: 'before',
      }
    }

    const newParent = pageParentId(draggedParent)
    if (isInvalidDrop(draggedId, newParent)) return null

    return {
      kind: 'outdent',
      parentId: newParent,
      insertBeforePageId: draggedParent,
      indicatorPageId: page.id,
    }
  }

  // Top of row → insert before this page (same parent).
  if (ratio < 0.33) {
    if (isRootPage(page.id)) {
      const firstTop = siblingIds(rootPageId)[0]
      return {
        kind: 'sibling',
        parentId: rootPageId,
        insertBeforePageId: firstTop,
        indicatorPageId: page.id,
        indicator: 'before',
      }
    }
    const parentId = pageParentId(page.id)
    return {
      kind: 'sibling',
      parentId,
      insertBeforePageId: page.id,
      indicatorPageId: page.id,
      indicator: 'before',
    }
  }

  // Bottom of row → insert after this page (same parent), including “last”.
  if (ratio > 0.67 || isRootPage(page.id)) {
    if (isRootPage(page.id)) {
      // Drop on lower half of root → append as last top-level page.
      return {
        kind: 'sibling',
        parentId: rootPageId,
        insertBeforePageId: undefined,
        indicatorPageId: page.id,
        indicator: 'after',
      }
    }
    const parentId = pageParentId(page.id)
    const next = nextSiblingId(page.id)
    return {
      kind: 'sibling',
      parentId,
      insertBeforePageId: next,
      indicatorPageId: page.id,
      indicator: 'after',
    }
  }

  // Middle band → nest as child.
  if (isRootPage(page.id)) {
    return {
      kind: 'sibling',
      parentId: rootPageId,
      insertBeforePageId: siblingIds(rootPageId)[0],
      indicatorPageId: page.id,
      indicator: 'before',
    }
  }

  return { kind: 'child', parentId: page.id, targetId: page.id }
}

function onDragStart(page: PageMeta, event: DragEvent) {
  // Only the dedicated handle may start a drag — never the title click target.
  const target = event.target as HTMLElement | null
  const fromHandle = !!target?.closest?.('[data-page-drag-handle]')
  if (
    !fromHandle
    || !canDragPage(page)
    || editingPageId === page.id
    || isEditableTarget(event.target)
  ) {
    event.preventDefault()
    draggingPageId = null
    dropIntent = null
    return
  }

  draggingPageId = page.id
  dropIntent = null

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', page.id)
    // Empty drag image offset keeps the ghost near the cursor without blocking clicks.
    try {
      const ghost = target?.closest?.('[data-page-drag-handle]') as HTMLElement | null
      if (ghost) event.dataTransfer.setDragImage(ghost, 10, 10)
    } catch {
      // ignore
    }
  }
}

function onDragEnd() {
  draggingPageId = null
  dropIntent = null
}

function onDragOver(page: PageMeta, event: DragEvent) {
  if (!draggingPageId) return

  event.preventDefault()
  const intent = resolveDropTarget(page, event)
  dropIntent = intent

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = intent ? 'move' : 'none'
  }
}

function onRootDragOver(event: DragEvent) {
  if (!draggingPageId || !rootPageId) return

  event.preventDefault()
  // Explicit “move to top level” strip — append as last root child.
  dropIntent = {
    kind: 'sibling',
    parentId: rootPageId,
    insertBeforePageId: undefined,
    indicatorPageId: rootPageId,
    indicator: 'after',
  }

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function applyDrop(intent: DropIntent) {
  const draggedId = draggingPageId
  if (!draggedId || !intent.parentId || draggedId === intent.parentId) return

  let insertBeforePageId: string | undefined

  if (intent.kind === 'sibling' || intent.kind === 'outdent' || intent.kind === 'root') {
    insertBeforePageId = intent.insertBeforePageId
  }

  onmove?.({
    pageId: draggedId,
    parentId: intent.parentId,
    insertBeforePageId,
  })
  draggingPageId = null
  dropIntent = null
}

function onDrop(page: PageMeta, event: DragEvent) {
  event.preventDefault()
  const intent = resolveDropTarget(page, event) ?? dropIntent
  if (!intent) return
  applyDrop(intent)
}

function onRootDrop(event: DragEvent) {
  event.preventDefault()
  if (!rootPageId) return
  applyDrop({
    kind: 'sibling',
    parentId: rootPageId,
    insertBeforePageId: undefined,
    indicatorPageId: rootPageId,
    indicator: 'after',
  })
}

function rowDropClass(page: PageMeta) {
  const intent = dropIntent
  if (!intent || intent.kind === 'root') return null

  if (intent.kind === 'child') {
    return intent.targetId === page.id ? 'page-sidebar__item--drop-child' : null
  }

  if (intent.kind === 'outdent') {
    return intent.indicatorPageId === page.id ? 'page-sidebar__item--drop-outdent' : null
  }

  if (intent.kind === 'sibling' && intent.indicatorPageId === page.id) {
    return intent.indicator === 'after'
      ? 'page-sidebar__item--drop-sibling-after'
      : 'page-sidebar__item--drop-sibling'
  }

  return null
}

function showDropLineBefore(page: PageMeta) {
  const intent = dropIntent
  if (!intent || intent.kind !== 'sibling') return false
  return intent.indicatorPageId === page.id && intent.indicator === 'before'
}

function showDropLineAfter(page: PageMeta) {
  const intent = dropIntent
  if (!intent || intent.kind !== 'sibling') return false
  return intent.indicatorPageId === page.id && intent.indicator === 'after'
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function canDeleteSelectedPages() {
  if (!open) return false
  if (editingPageId) return false
  return deletableSelectedIds().length > 0
}

function onSidebarKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selectedPageIds.size > 0) {
    if (isEditableTarget(event.target)) return
    event.preventDefault()
    clearSelection()
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (!canDeleteSelectedPages()) return
  if (isEditableTarget(event.target)) return

  event.preventDefault()
  event.stopPropagation()
  requestDeleteIds(deletableSelectedIds())
}


// Expand ancestors only when navigating to a different page (or when that page
// first appears in the list). Never re-run on collab `pages` refreshes for the
// same id — that was undoing chevron collapse on every sync.
$effect(() => {
  const id = currentPageId
  if (!id) {
    expandedPathForId = null
    return
  }
  const found = pages.some((page) => page.id === id)
  if (!found) return
  if (expandedPathForId === id) return
  expandedPathForId = id
  untrack(() => expandAncestors(id))
})

$effect(() => {
  void pages
  if (selectedPageIds.size === 0) return
  const valid = new Set(pages.map((page) => page.id))
  const next = new Set([...selectedPageIds].filter((id) => valid.has(id)))
  if (next.size !== selectedPageIds.size) {
    selectedPageIds = next
  }
  if (selectionAnchorId && !valid.has(selectionAnchorId)) {
    selectionAnchorId = null
  }
})

$effect(() => {
  if (!open) {
    closePageMenu()
    clearSelection()
    return
  }
  window.addEventListener('keydown', onSidebarKeydown, { capture: true })
  return () => {
    window.removeEventListener('keydown', onSidebarKeydown, { capture: true })
  }
})

$effect(() => {
  if (pageMenuOpen) {
    document.addEventListener('mousedown', onPageMenuDocumentPointerDown)
    document.addEventListener('keydown', onPageMenuDocumentKeydown)
    return () => {
      document.removeEventListener('mousedown', onPageMenuDocumentPointerDown)
      document.removeEventListener('keydown', onPageMenuDocumentKeydown)
    }
  }
})
</script>


{#if open}
  <button
    use:portal
    class="sidebar-backdrop"
    type="button"
    aria-label="Close sidebar"
    onclick={() => (open = false)}
  ></button>
{/if}

{#if pageMenuOpen && pageMenuPage}
  <div
    use:portal
    bind:this={pageMenuRef}
    class="page-sidebar-menu"
    role="menu"
    tabindex="-1"
    style="left: {pageMenuX}px; top: {pageMenuY}px"
    onmousedown={(e) => e.preventDefault()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <button type="button" class="page-sidebar-menu__item" role="menuitem" onclick={onPageMenuNewPage}>
      New page
    </button>
    <button type="button" class="page-sidebar-menu__item" role="menuitem" onclick={onPageMenuAddSubPage}>
      Add sub-page
    </button>
    <div class="page-sidebar-menu__sep" role="separator"></div>
    {#if pageMenuShowRename}
      <button type="button" class="page-sidebar-menu__item" role="menuitem" onclick={onPageMenuRename}>
        Rename
      </button>
    {/if}
    <button type="button" class="page-sidebar-menu__item" role="menuitem" onclick={() => void onPageMenuCopyName()}>
      Copy name
    </button>
    <button type="button" class="page-sidebar-menu__item" role="menuitem" onclick={() => void onPageMenuCopyPath()}>
      Copy path
    </button>
    {#if pageMenuCanDelete}
      <button
        type="button"
        class="page-sidebar-menu__item page-sidebar-menu__item--danger"
        role="menuitem"
        onclick={onPageMenuDelete}
      >
        {pageMenuDeleteLabel}
      </button>
    {/if}
  </div>
{/if}

<aside
  class="page-sidebar"
  class:page-sidebar--open={open}
  aria-label="Pages"
  ondragover={(e) => e.preventDefault()}
  ondrop={onSidebarFileDrop}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="page-sidebar__header">
    <div class="page-sidebar__brand" aria-label="XEditor">
      <img class="page-sidebar__logo" src="./icon.png" alt="" width="22" height="22" />
      <span class="page-sidebar__brand-name">XEditor</span>
    </div>
    <button
      class="page-sidebar__close"
      type="button"
      aria-label="Close sidebar"
      onclick={() => (open = false)}
    >
      <X size={16} strokeWidth={2} />
    </button>
  </div>

  <div class="page-sidebar__search">
    <Search size={14} strokeWidth={2} />
    <input
      bind:value={query}
      type="search"
      class="page-sidebar__search-input"
      placeholder="Search pages…"
    />
  </div>

  <button class="page-sidebar__new" type="button" onclick={() => onnewPage?.()}>
    <Plus size={16} strokeWidth={2} />
    <span>New page</span>
  </button>

  <button class="page-sidebar__import" type="button" onclick={() => onimportMarkdown?.()}>
    <FileUp size={16} strokeWidth={2} />
    <span>Import</span>
  </button>

  <nav class="page-sidebar__nav" class:page-sidebar__nav--dragging={!!draggingPageId}>
    <p class="page-sidebar__section">Pages</p>

    {#if draggingPageId && showRootDrop}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="page-sidebar__root-drop"
        class:page-sidebar__root-drop--active={
          dropIntent?.kind === 'sibling'
            && dropIntent.parentId === rootPageId
            && !dropIntent.insertBeforePageId
            && dropIntent.indicatorPageId === rootPageId
        }
        ondragover={onRootDragOver}
        ondrop={onRootDrop}
      >
        Move out to top level
      </div>
    {/if}

    {#each visiblePages as page (page.id)}
      {@const collapsed = isCollapsed(page.id)}
      {@const hasKids = showCollapseControl(page)}
      <div
        class="page-sidebar__row"
        class:page-sidebar__row--line-before={showDropLineBefore(page)}
        class:page-sidebar__row--line-after={showDropLineAfter(page)}
        style="padding-inline-start: {pageIndent(page)}px"
      >
        {#if hasKids}
          <button
            type="button"
            class="page-sidebar__collapse"
            class:page-sidebar__collapse--collapsed={collapsed}
            class:page-sidebar__collapse--expanded={!collapsed}
            aria-label={collapsed ? 'Expand sub-pages' : 'Collapse sub-pages'}
            aria-expanded={!collapsed}
            tabindex="0"
            draggable="false"
            style:transform={collapsed ? 'rotate(0deg)' : 'rotate(90deg)'}
            onpointerdown={onCollapsePointerDown}
            onmousedown={onCollapsePointerDown}
            onclick={(e) => onCollapseClick(page.id, e)}
            ondragstart={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
          >
            <ChevronRight class="page-sidebar__collapse-icon" size={14} strokeWidth={2} />
          </button>
        {:else if !isRootPage(page.id)}
          <!-- Nested leaves keep a chevron-width spacer so icons align with siblings.
               Root with no sub-pages should sit flush (no fake indent). -->
          <span class="page-sidebar__collapse-spacer" aria-hidden="true"></span>
        {/if}

        <div
          class={"page-sidebar__item " + (rowDropClass(page) || "")}
          class:page-sidebar__item--root={isRootPage(page.id)}
          class:page-sidebar__item--active={page.id === currentPageId && selectedPageIds.size <= 1}
          class:page-sidebar__item--selected={isPageSelected(page.id)}
          class:page-sidebar__item--dragging={draggingPageId === page.id}
          class:page-sidebar__item--draggable={canDragPage(page)}
          draggable="false"
          ondragover={(e) => onDragOver(page, e)}
          ondrop={(e) => onDrop(page, e)}
          role="presentation"
        >
          {#if canDragPage(page)}
            <!-- Drag only from the icon handle so a normal title click selects/navigates. -->
            <button
              type="button"
              class="page-sidebar__drag-handle"
              data-page-drag-handle
              draggable="true"
              title="Drag to reorder"
              aria-label="Drag to reorder"
              tabindex="-1"
              ondragstart={(e) => onDragStart(page, e)}
              ondragend={onDragEnd}
              onclick={(e) => {
                // Click on handle still opens the page (no accidental “drag only”).
                e.stopPropagation()
                selectPage(page.id, e)
              }}
            >
              <span class="page-sidebar__item-icon" aria-hidden="true">
                <FileText size={16} strokeWidth={1.75} />
              </span>
            </button>
          {/if}

          <button
            class="page-sidebar__item-button"
            class:page-sidebar__item-button--with-handle={canDragPage(page)}
            type="button"
            draggable="false"
            aria-current={isPageSelected(page.id) || page.id === currentPageId ? 'page' : undefined}
            onclick={(e) => selectPage(page.id, e)}
            ondblclick={(e) => startRename(page, e)}
            oncontextmenu={(e) => openPageMenu(page, e)}
            ondragstart={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {#if !canDragPage(page)}
              <span class="page-sidebar__item-icon" aria-hidden="true">
                <FileText size={16} strokeWidth={1.75} />
              </span>
            {/if}
            {#if editingPageId === page.id}
              <input
                bind:this={editInputRef}
                bind:value={editingTitle}
                class="page-sidebar__item-input"
                type="text"
                spellcheck="false"
                placeholder="Untitled"
                draggable="false"
                onclick={(e) => e.stopPropagation()}
                ondblclick={(e) => e.stopPropagation()}
                onkeydown={(e) => onRenameKeydown(page.id, e)}
                onblur={() => commitRename(page.id)}
                ondragstart={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
              />
            {:else}
              <span class="page-sidebar__item-title">
                {#each titleHighlightParts(page.title) as part, partIdx (partIdx)}
                  {#if part.match}
                    <mark class="page-sidebar__item-title-match">{part.text}</mark>
                  {:else}
                    {part.text}
                  {/if}
                {/each}
              </span>
            {/if}
            {#if peersOnPage(page.id).length}
              <span class="page-sidebar__item-peers">
                {#each peersOnPage(page.id) as peer (peer.addr)}
                  <span
                    class="page-sidebar__peer-dot"
                    style:background={peer.color}
                    title="{peer.name} is here"
                  ></span>
                {/each}
              </span>
            {/if}
          </button>
        </div>
      </div>
    {/each}

    {#if !visiblePages.length}
      <p class="page-sidebar__empty">No pages found</p>
    {/if}
  </nav>
</aside>


<style>

.page-sidebar-menu {
  position: fixed;
  z-index: 10002;
  min-width: 160px;
  padding: 6px;
  border-radius: 10px;
  background: var(--settings-panel-bg, #fff);
  border: 1px solid var(--settings-panel-border, rgb(15 15 15 / 0.06));
  box-shadow: var(--settings-panel-shadow, 0 24px 48px rgb(15 15 15 / 0.12));
}

.page-sidebar-menu__item {
  display: flex;
  align-items: center;
  width: 100%;
  border: none;
  border-radius: 7px;
  background: transparent;
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
  color: var(--settings-text, #37352f);
  cursor: pointer;
}

.page-sidebar-menu__sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--settings-divider, #ebebea);
}

.page-sidebar-menu__item:hover {
  background: var(--settings-hover, #f1f1ef);
}

.page-sidebar-menu__item--danger {
  color: #eb5757;
}

.page-sidebar-menu__item--danger:hover {
  background: rgb(235 87 87 / 0.1);
}

.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 45;
  border: none;
  background: var(--sidebar-backdrop);
  cursor: default;
}

.page-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 46;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100vh;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
  overflow: hidden;
}

.page-sidebar--open {
  transform: translateX(0);
}

.page-sidebar__header {
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 45px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--sidebar-border);
}

.page-sidebar__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--sidebar-text);
}

.page-sidebar__logo {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: cover;
}

.page-sidebar__brand-name {
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-sidebar__close {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sidebar-muted);
  cursor: pointer;
}

.page-sidebar__close:hover {
  background: var(--sidebar-hover);
  color: var(--sidebar-text);
}

.page-sidebar__search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 12px 0;
  padding: 0 10px;
  height: 32px;
  border-radius: 6px;
  background: var(--sidebar-search-bg);
  color: var(--sidebar-muted);
}

.page-sidebar__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: var(--sidebar-text);
}

.page-sidebar__search-input::placeholder {
  color: var(--sidebar-muted);
}

.page-sidebar__new,
.page-sidebar__import {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 12px 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--sidebar-muted);
  cursor: pointer;
  text-align: left;
}

.page-sidebar__import {
  margin-top: 0;
}

.page-sidebar__new:hover,
.page-sidebar__import:hover {
  background: var(--sidebar-hover);
  color: var(--sidebar-text);
}

.page-sidebar__nav {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 16px;
}

.page-sidebar__nav--dragging {
  user-select: none;
}

.page-sidebar__section {
  margin: 8px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--sidebar-muted);
}

.page-sidebar__root-drop {
  margin: 4px 8px 8px;
  padding: 8px 10px;
  border: 1px dashed var(--sidebar-border);
  border-radius: 8px;
  background: transparent;
  font-size: 12px;
  color: var(--sidebar-muted);
  text-align: center;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.page-sidebar__root-drop--active {
  border-color: var(--xpe-primary, #2383e2);
  background: rgb(35 131 226 / 0.08);
  color: var(--sidebar-text);
}

.page-sidebar__row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  box-sizing: border-box;
}

.page-sidebar__row--line-before::before,
.page-sidebar__row--line-after::after {
  content: '';
  position: absolute;
  right: 10px;
  left: 10px;
  height: 2px;
  border-radius: 999px;
  background: var(--xpe-primary, #2383e2);
  pointer-events: none;
  z-index: 1;
}

.page-sidebar__row--line-before::before {
  top: 0;
}

.page-sidebar__row--line-after::after {
  bottom: 0;
}

.page-sidebar__item {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1;
  min-width: 0;
  border-radius: 6px;
  transition: background 0.12s, box-shadow 0.12s;
}

.page-sidebar__item:hover {
  background: var(--sidebar-hover);
}

.page-sidebar__item--root {
  padding-inline-end: 4px;
}

.page-sidebar__item--active {
  background: var(--sidebar-active);
}

.page-sidebar__item--active .page-sidebar__item-button {
  font-weight: 500;
}

.page-sidebar__item--selected {
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--xpe-primary, #2383e2) 35%, transparent);
}

.page-sidebar__item--selected.page-sidebar__item--active {
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 18%, var(--sidebar-active, transparent));
}

.page-sidebar__item--selected .page-sidebar__item-button {
  font-weight: 500;
}

.page-sidebar__item--draggable {
  cursor: default;
}

.page-sidebar__drag-handle {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 22px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-drag: element;
}

.page-sidebar__drag-handle:active {
  cursor: grabbing;
}

.page-sidebar__drag-handle:hover .page-sidebar__item-icon {
  opacity: 1;
  color: var(--sidebar-text);
}

.page-sidebar__item--dragging {
  opacity: 0.45;
}

.page-sidebar__item--dragging .page-sidebar__drag-handle {
  cursor: grabbing;
}

.page-sidebar__item--drop-child {
  background: rgb(35 131 226 / 0.12);
  box-shadow: inset 0 0 0 1px rgb(35 131 226 / 0.35);
}

.page-sidebar__item--drop-sibling,
.page-sidebar__item--drop-sibling-after {
  background: transparent;
}

.page-sidebar__item--drop-outdent {
  background: rgb(35 131 226 / 0.08);
  box-shadow: inset 2px 0 0 var(--xpe-primary, #2383e2);
}

.page-sidebar__collapse {
  display: grid;
  place-items: center;
  width: 18px;
  height: 22px;
  margin: 0;
  margin-inline-end: -2px;
  padding: 0;
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sidebar-muted);
  cursor: pointer;
  position: relative;
  z-index: 3;
  /* Outside the draggable item — still guard against accidental drag. */
  pointer-events: auto;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-drag: none;
  transform-origin: center center;
  transition: transform 0.15s ease, background 0.12s ease, color 0.12s ease;
  will-change: transform;
}

.page-sidebar__collapse-spacer {
  display: block;
  width: 16px;
  height: 22px;
  flex-shrink: 0;
}

.page-sidebar__collapse:hover,
.page-sidebar__collapse:focus,
.page-sidebar__collapse:active {
  background: transparent;
  color: var(--sidebar-text);
  outline: none;
  box-shadow: none;
}

/* Icon stays unrotated; the button rotates via style:transform. */
.page-sidebar__collapse :global(.page-sidebar__collapse-icon),
.page-sidebar__collapse :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
  stroke: currentColor;
  color: inherit;
  opacity: 0.55;
  transition: opacity 0.12s ease, color 0.12s ease;
}

.page-sidebar__collapse:hover :global(.page-sidebar__collapse-icon),
.page-sidebar__collapse:hover :global(svg),
.page-sidebar__collapse:focus :global(.page-sidebar__collapse-icon),
.page-sidebar__collapse:focus :global(svg) {
  opacity: 1;
  color: var(--sidebar-text);
  stroke: currentColor;
}

.page-sidebar__item-button {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 6px 8px 6px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--sidebar-text);
  cursor: pointer;
  text-align: left;
  -webkit-user-drag: none;
  user-select: none;
}

.page-sidebar__item-button--with-handle {
  padding-inline-start: 2px;
}

.page-sidebar__item--root .page-sidebar__item-button {
  /* Keep flush with the collapse chevron (extra start pad made a large gap). */
  padding-inline-start: 0;
  cursor: pointer;
}

.page-sidebar__item-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 0;
  color: var(--sidebar-muted, var(--sidebar-text));
  opacity: 0.85;
}

.page-sidebar__item-icon :deep(svg) {
  display: block;
}

.page-sidebar__item-title-match {
  padding: 0 1px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 28%, transparent);
  color: inherit;
  font: inherit;
  font-weight: 650;
}

.page-sidebar__item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-sidebar__item-peers {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
}

.page-sidebar__peer-dot {
  width: 8px;
  height: 8px;
  margin-left: -3px;
  border: 1.5px solid var(--sidebar-bg);
  border-radius: 50%;
}

.page-sidebar__peer-dot:first-child {
  margin-left: 0;
}

.page-sidebar__item-input {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: inherit;
  font-weight: inherit;
  color: inherit;
  caret-color: var(--xpe-primary, #2383e2);
}

.page-sidebar__empty {
  margin: 8px 10px;
  font-size: 13px;
  color: var(--sidebar-muted);
}

/* Mobile overlay: keep a thin header so the close control has a home. */
@media (max-width: 768px) {
  .page-sidebar__header {
    display: flex;
  }
}

@media (min-width: 769px) {
  .sidebar-backdrop {
    display: none;
  }

  /* Desktop: no brand row / close control. */
  .page-sidebar__header,
  .page-sidebar__close {
    display: none;
  }

  /*
   * Desktop rail: keep the element mounted and collapse via width so open/close
   * is reliable (display:none made toggles feel broken / non-interactive).
   */
  .page-sidebar {
    position: sticky;
    top: 0;
    flex-shrink: 0;
    height: 100vh;
    height: 100dvh;
    display: flex;
    transform: none;
    width: 0;
    min-width: 0;
    border-right-width: 0;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
    transition:
      width 0.2s ease,
      min-width 0.2s ease,
      opacity 0.16s ease,
      border-color 0.2s ease;
  }

  .page-sidebar--open {
    width: var(--sidebar-width);
    min-width: var(--sidebar-width);
    border-right-width: 1px;
    opacity: 1;
    pointer-events: auto;
    transform: none;
    overflow: hidden;
  }
}

</style>
