<script lang="ts">

import { onMount, onDestroy, tick, setContext, untrack } from 'svelte'
import {
  parseBlocksFromClipboardData,
  writeBlocksToClipboardData,
  fileToDataUrl,
  getClipboardImageFiles,
  isEmbeddableImageUrl,
  caretPointFromClient,
  getCaretClientRect,
  getSelectionClientRect,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  htmlToBlocks,
  looksLikeMarkdown,
  markdownToBlocks,
  createBlock, cloneBlock, spansToText, splitSpansAt, normalizeSpans,
  deleteRangeInSpans, insertTextInSpans, applyMarkToRange, rangeHasMark, rangeMarkValue, sliceSpans, detectDir,
  applyMarkToTextRange,
  cssColorToHex,
  deleteTextRange,
  extractTextRangeAsBlocks,
  fullBlockTextRange,
  getTextRangeSegments,
  isBlockFullySelected,
  isCrossBlockTextRange,
  isNonTextBlockCoveredByRange,
  isTextRangeCollapsed,
  rangeHasMarkAcrossSegments,
  rangeMarkValueAcrossSegments,
  computeListNumbering,
  normalizeTableData,
  nextVisibleCellCoord,
  patchTableCell,
  patchTableCellsBackground,
  patchTableStyle,
  isTextBlock,
  buildBlockDirectionMap,
  buildBlockRenderTree,
  ensureTogglePlaceholder,
  ensureTogglePlaceholders,
  findContainingToggleIndex,
  isDirectToggleBodyBlock,
  isLastToggleDescendant,
  toggleDescendantCount,
  COLUMN_DROP_EDGE_PX,
  createColumnLayoutFromDrop,
  canColumnizeBlock,
  blockUnitSpan,
  parsePageLink,
} from '@xproeditor/core'
import type { TextPoint, TextRangeSelection, Block, BlockType, InlineSpan, MarkName, TableCellCoord, TableCellAlign, TableStyle } from '@xproeditor/core'
import EditorBlockTree from './EditorBlockTree.svelte'
import { BLOCK_EDITOR_CTX } from './block-editor-context'
import EditorBubbleToolbar from './EditorBubbleToolbar.svelte'
import type { FormatToolbarAlign, FormatToolbarState } from './EditorFormatToolbar.svelte'
import EditorSlashMenu from './EditorSlashMenu.svelte'
import type {SlashItem} from './EditorSlashMenu.svelte'
import EditorEmojiMenu from './EditorEmojiMenu.svelte'
import { searchEmojis, type EmojiEntry } from '../ui/emojiCatalog'
import type { VimEngine, VimModeName } from '../vim/vimEngine'
import { hasMod, isModLetter } from '../utils/keyboard'

function portalToBody(node: HTMLElement) {
  document.body.appendChild(node)
  return { destroy() { node.remove() } }
}


let {
  modelValue,
  upload,
  pickMedia,
  editorDir,
  readonly = false,
  showBubbleToolbar = true,
  pages,
  currentPageId,
  createPage,
  setPageParent,
  lockedBlocks,
  voterId,
  vimMode = false,
  onchange,
  onformatstate,
  onnavigatepage,
  oncomment,
  onfocusblock,
  resolveInternalHref,
}: {
  modelValue: Block[]
  upload?: (file: File) => Promise<string>
  pickMedia?: (options: {
    accept: string[]
    title?: string
  }) => Promise<{ url: string; alt?: string; caption?: string } | null>
  editorDir?: 'ltr' | 'rtl'
  readonly?: boolean
  showBubbleToolbar?: boolean
  pages?: Array<{ id: string; title: string; icon?: string }>
  currentPageId?: string
  createPage?: (title?: string, parentId?: string) => { id: string; title: string; icon?: string }
  setPageParent?: (pageId: string, parentId: string) => void
  lockedBlocks?: Record<string, { name: string; color: string }>
  voterId?: string
  vimMode?: boolean
  onchange?: () => void
  onformatstate?: (state: FormatToolbarState | null) => void
  onnavigatepage?: (pageId: string) => void
  oncomment?: (payload: { blockId: string; start: number; end: number; quote: string; text: string }) => void
  onfocusblock?: (blockId: string | null) => void
  /** Resolve relative/internal hrefs (e.g. `./foo.md`) to a page id. */
  resolveInternalHref?: (href: string) => string | null
} = $props()

// Live prop accessors (avoid naming this `props` — conflicts with $props rune)
const editorProps = {
  get modelValue() { return modelValue },
  get upload() { return upload },
  get pickMedia() { return pickMedia },
  get editorDir() { return editorDir },
  get readonly() { return readonly },
  get showBubbleToolbar() { return showBubbleToolbar },
  get pages() { return pages },
  get currentPageId() { return currentPageId },
  get createPage() { return createPage },
  get setPageParent() { return setPageParent },
  get lockedBlocks() { return lockedBlocks },
  get voterId() { return voterId },
  get vimMode() { return vimMode },
}

function emit(event: string, ...args: unknown[]) {
  if (event === 'change') onchange?.()
  else if (event === 'format-state') onformatstate?.(args[0] as FormatToolbarState | null)
  else if (event === 'navigate-page') onnavigatepage?.(args[0] as string)
  else if (event === 'comment') oncomment?.(args[0] as any)
  else if (event === 'focus-block') onfocusblock?.(args[0] as string | null)
}

let blocks = $derived(editorProps.modelValue)
/** Bumped when the block list is mutated in place so dependents re-render. */
let blocksRevision = $state(0)

function touchBlocks() {
  blocksRevision++
}

function blockDirOptions(): { defaultDir?: 'ltr' | 'rtl' } | undefined {
  return editorProps.editorDir === 'rtl' ? { defaultDir: 'rtl' } : undefined
}

function makeBlock(type: BlockType, partial: Partial<Block> = {}): Block {
  return createBlock(type, partial, blockDirOptions())
}

let rootEl = $state<HTMLElement | null>(null)
let focusedBlockId = $state<string | null>(null)
let selectedBlockId = $state<string | null>(null)
/** Vim mode indicator (NORMAL / INSERT / …). */
let vimStatus = $state('')
let vimModeName = $state<VimModeName>('insert')
let vimPendingKeys = $state('')
/** Line:col for statusline (1-based). */
let vimPos = $state({ line: 1, col: 1, total: 1, percent: 0 })
/** Bumped on mode change so contenteditable toggles reactively. */
let vimEditRevision = $state(0)
/** Vim : / command-line buffer (bound to the statusline input). */
let vimCmdline = $state('')
let vimCmdlinePrompt = $state<':' | '/'>(':')
let vimMessage = $state('')
let vimCmdlineInputRef = $state<HTMLInputElement | null>(null)
let vimEngine: VimEngine | null = null
/** Preferred column for j/k navigation in vim. */
let vimPreferredCol = 0
let vimDocListenersBound = false

function refreshVimStatusline() {
  if (!editorProps.vimMode || !vimEngine) return
  // Never let statusline reads (focusedBlockId / visibleBlocks) become
  // dependencies of an outer $effect that also enables vim — that looped.
  untrack(() => {
    if (!vimEngine) return
    const st = vimEngine.getState()
    vimModeName = st.mode
    vimStatus = st.status
    vimPendingKeys = vimEngine.getPendingKeys()
    vimCmdline = st.cmdline
    vimCmdlinePrompt = st.cmdlinePrompt
    vimMessage = st.message

    let caret: { blockId: string; offset: number } | null = null
    if (focusedBlockId) {
      const block = byId(focusedBlockId)
      if (block && isTextBlock(block.type)) {
        const sel = itemRefs.get(focusedBlockId)?.getSelection()
        caret = { blockId: focusedBlockId, offset: sel?.start ?? 0 }
      }
    }
    if (!caret) {
      const active = document.activeElement
      if (active instanceof HTMLElement) {
        const host = active.closest('[data-block-id]') as HTMLElement | null
        const id = host?.dataset.blockId
        if (id) {
          const block = byId(id)
          if (block && isTextBlock(block.type)) {
            const sel = itemRefs.get(id)?.getSelection()
            caret = { blockId: id, offset: sel?.start ?? 0 }
          }
        }
      }
    }
    if (!caret) {
      const first = visibleBlocks.find((b) => isTextBlock(b.type))
      caret = first ? { blockId: first.id, offset: 0 } : null
    }

    const blocksList = visibleBlocks
    const total = Math.max(1, blocksList.length)
    let line = 1
    let col = 1
    if (caret) {
      const idx = blocksList.findIndex((b) => b.id === caret!.blockId)
      line = idx >= 0 ? idx + 1 : 1
      col = Math.max(1, caret.offset + 1)
    }
    const percent = Math.min(100, Math.round(((line - 1) / Math.max(1, total - 1)) * 100))
    const next = { line, col, total, percent }
    const prev = vimPos
    if (
      prev.line !== next.line
      || prev.col !== next.col
      || prev.total !== next.total
      || prev.percent !== next.percent
    ) {
      vimPos = next
    }
  })
}

function vimAllowsTextInput(): boolean {
  if (!editorProps.vimMode || !vimEngine) return true
  return vimEngine.allowsTextInput()
}
/** Multi-block selection (marquee / shift range). Document order. */
let selectedBlockIds = $state<string[]>([])
let focusedTableCell = $state<{ blockId: string; row: number; col: number } | null>(null)
let tableSelectedCells = $state<TableCellCoord[]>([])

let textRangeSelection = $state<TextRangeSelection | null>(null)
let managedTextSelection = $state(false)
/** Bumped after span mutations so format toolbar active-state stays in sync. */
let contentRevision = $state(0)
let dragSelectAnchor: TextPoint | null = null
let isDragSelecting = false
/** Touch/pen: wait for movement before treating a press as text-range drag. */
let dragSelectPending = false
let dragSelectOriginClient: { x: number; y: number } | null = null
let dragSelectPointerType: string | null = null

/** Marquee (click-drag) block selection rectangle in client coordinates. */
let marqueeRect = $state<{ left: number; top: number; width: number; height: number } | null>(null)
/** True while a marquee gesture is live (for CSS / cursor). */
let marqueeLive = $state(false)
let marqueePointerId: number | null = null
/**
 * Marquee origin in scroll-stable document coords:
 * x = clientX, y = clientY + scrollTop (of the marquee scroll parent).
 * Converting back to client avoids origin drift when edge-scrolling.
 */
let marqueeOriginDoc: { x: number; y: number } | null = null
let marqueeActive = false
let marqueeMoved = false
let marqueeLastClient = { x: 0, y: 0 }
let marqueeAutoScrollRaf = 0
let marqueeCaptureEl: HTMLElement | null = null
/** Desktop mouse can use a tight threshold; touch needs more slack. */
const MARQUEE_THRESHOLD_MOUSE_PX = 3
const MARQUEE_THRESHOLD_TOUCH_PX = 12
/** Text-range drag: ignore finger jitter so a single tap keeps the caret. */
const TEXT_DRAG_THRESHOLD_MOUSE_PX = 2
const TEXT_DRAG_THRESHOLD_TOUCH_PX = 10
const MARQUEE_EDGE_PX = 48
const MARQUEE_SCROLL_SPEED = 18
/** Ignore sub-pixel / layout jitter when deciding if anything can scroll. */
const MARQUEE_SCROLL_EPS = 2
/** Minimum side strip width for marquee hit-testing (px). */
const MARQUEE_SIDE_STRIP_MIN_PX = 44

function isTouchLikePointer(e: Pick<PointerEvent, 'pointerType'> | null | undefined): boolean {
  const type = e?.pointerType
  return type === 'touch' || type === 'pen'
}

function marqueeThresholdPx(pointerType?: string | null): number {
  return pointerType === 'touch' || pointerType === 'pen'
    ? MARQUEE_THRESHOLD_TOUCH_PX
    : MARQUEE_THRESHOLD_MOUSE_PX
}

function textDragThresholdPx(pointerType?: string | null): number {
  return pointerType === 'touch' || pointerType === 'pen'
    ? TEXT_DRAG_THRESHOLD_TOUCH_PX
    : TEXT_DRAG_THRESHOLD_MOUSE_PX
}

function clearDragSelectState() {
  isDragSelecting = false
  dragSelectPending = false
  dragSelectAnchor = null
  dragSelectOriginClient = null
  dragSelectPointerType = null
}

function marqueeStripWidths(): { start: number; end: number } {
  const root = rootEl
  if (!root) return { start: MARQUEE_SIDE_STRIP_MIN_PX, end: MARQUEE_SIDE_STRIP_MIN_PX }
  const styles = getComputedStyle(root)
  const start = Number.parseFloat(styles.getPropertyValue('--be-marquee-gutter-start')) || MARQUEE_SIDE_STRIP_MIN_PX
  const end = Number.parseFloat(styles.getPropertyValue('--be-marquee-gutter-end')) || MARQUEE_SIDE_STRIP_MIN_PX
  return {
    start: Math.max(MARQUEE_SIDE_STRIP_MIN_PX, start),
    end: Math.max(MARQUEE_SIDE_STRIP_MIN_PX, end),
  }
}

function isPointerInMarqueeStrip(clientX: number): boolean {
  const root = rootEl
  if (!root) return false
  const box = root.getBoundingClientRect()
  if (box.width <= 0) return false
  const { start, end } = marqueeStripWidths()
  // Strips hang *outside* the content box into the page insets.
  return (
    (clientX >= box.left - start && clientX < box.left)
    || (clientX > box.right && clientX <= box.right + end)
  )
}

// ─── Item refs ────────────────────────────────────────────────────────────────

interface ItemApi {
  focusAt: (pos: number | 'start' | 'end') => void
  getSelection: () => { start: number; end: number } | null
  setSelection: (start: number, end?: number) => void
  getEl?: () => HTMLElement | null
  /** Force contenteditable HTML to match model spans (marks like highlight). */
  syncFromModel?: (restore?: { start: number; end: number } | null) => void
  textual: { value: boolean } | boolean
  getTableSelectedCells?: () => TableCellCoord[]
  setTableSelectedCells?: (cells: TableCellCoord[]) => void
  focusTableCell?: (row: number, col: number, pos?: number | 'start' | 'end') => void
  getTableCellSelection?: (row: number, col: number) => { start: number; end: number } | null
  setTableCellSelection?: (row: number, col: number, start: number, end?: number) => void
}

/** Apply mark result to DOM immediately (shallow block state skips deep watchers). */
function syncBlockDom(blockId: string, range?: { start: number; end: number } | null) {
  const api = itemRefs.get(blockId)
  if (!api) return
  if (api.syncFromModel) {
    api.syncFromModel(range ?? null)
    return
  }
  if (range) {
    api.setSelection(range.start, range.end)
  }
}

const itemRefs = new Map<string, ItemApi>()

function setItemRef(id: string, el: unknown) {
  if (el) {
itemRefs.set(id, el as ItemApi)
} else {
itemRefs.delete(id)
}
}

function byId(id: string): Block | undefined {
  return blocks.find(b => b.id === id)
}

function focusBlock(id: string, pos: number | 'start' | 'end') {
  const block = byId(id)

  if (!block) {
return
}

  if (!isTextBlock(block.type) && block.type !== 'code') {
    selectBlock(id)

    return
  }

  clearBlockSelection()
  void tick().then(() => itemRefs.get(id)?.focusAt(pos))
}

function blockLength(block: Block): number {
  return isTextBlock(block.type) ? spansToText(block.content).length : 0
}

function hasActiveManagedSelection(): boolean {
  return managedTextSelection
    && textRangeSelection !== null
    && !isTextRangeCollapsed(textRangeSelection, visibleBlocks)
}

function textHighlightForBlock(id: string): { start: number; end: number } | null {
  if (!hasActiveManagedSelection() || !textRangeSelection) {
    return null
  }

  const segments = getTextRangeSegments(
    textRangeSelection,
    blocks,
    visibleBlocks,
  )
  const segment = segments.find(s => s.blockId === id)

  if (!segment) {
    return null
  }

  return { start: segment.start, end: segment.end }
}

function clearTextRangeSelection(): void {
  textRangeSelection = null
  managedTextSelection = false
}

function setManagedTextRange(anchor: TextPoint, focus: TextPoint) {
  textRangeSelection = { anchor, focus }
  managedTextSelection = true
  clearBlockSelection()
  focusedBlockId = null
  closeSlash()
  bubble = null
  window.getSelection()?.removeAllRanges()
}

/**
 * Select the entire page: every visible block (text + images/tables/…).
 * Text blocks also get a managed text range for blue selection highlight.
 * Non-text must be multi-selected so Delete/Cut removes them too (text-range
 * alone only spans first→last *text* block and skips trailing/leading media).
 */
function selectAllBlocks() {
  if (visibleBlocks.length === 0) {
    return
  }

  focusedBlockId = null
  closeSlash()
  bubble = null
  window.getSelection()?.removeAllRanges()

  // Multi-select all visible blocks first (images, tables, code, …).
  setSelectedBlocks(visibleBlocks.map((b) => b.id))

  const range = fullBlockTextRange(visibleBlocks)
  if (range) {
    // Do not call setManagedTextRange — it clears block multi-select.
    textRangeSelection = range
    managedTextSelection = true
  } else {
    textRangeSelection = null
    managedTextSelection = false
  }

  void tick().then(() => rootEl?.focus())
}

function allVisibleBlocksSelected(): boolean {
  return (
    visibleBlocks.length > 0
    && visibleBlocks.every(
      (b) => selectedBlockIds.includes(b.id) || selectedBlockId === b.id,
    )
  )
}

function deleteManagedTextRange() {
  // Ctrl+A (or equivalent): every visible block is selected — remove them all,
  // including images/tables that sit outside the text-only range endpoints.
  if (allVisibleBlocksSelected()) {
    removeSelectedBlocksBulk()
    clearTextRangeSelection()
    return
  }

  if (!textRangeSelection) {
    if (selectedBlockIds.length > 0 || selectedBlockId) {
      removeSelectedBlocksBulk()
    }
    return
  }

  // Non-text multi-selected alongside a text range (or covered between endpoints).
  const extraNonTextIds = new Set<string>()
  for (const id of selectedBlockIds) {
    const b = byId(id)
    if (b && !isTextBlock(b.type)) extraNonTextIds.add(id)
  }
  for (const b of visibleBlocks) {
    if (
      !isTextBlock(b.type)
      && isNonTextBlockCoveredByRange(b.id, textRangeSelection, visibleBlocks)
    ) {
      extraNonTextIds.add(b.id)
    }
  }

  const result = deleteTextRange(blocks, textRangeSelection, visibleBlocks)

  // Intermediate non-text between text anchors is already removed by deleteTextRange.
  // Drop any remaining multi-selected non-text (e.g. still present if layout differed).
  for (const id of extraNonTextIds) {
    const i = blocks.findIndex((b) => b.id === id)
    if (i === -1) continue
    const parentToggleIdx = findContainingToggleIndex(blocks, i)
    blocks.splice(i, 1)
    if (parentToggleIdx !== null) {
      const parent = blocks[parentToggleIdx]
      if (parent?.type === 'toggle') {
        syncTogglePlaceholder(parent, { history: false })
      }
    }
  }

  clearTextRangeSelection()
  clearBlockSelection()
  ensureNotEmpty()
  pushHistory(true)

  if (result && byId(result.focusBlockId)) {
    focusBlock(result.focusBlockId, result.focusOffset)
  } else {
    const first = blocks[0]
    if (first) {
      if (isTextBlock(first.type) || first.type === 'code') {
        focusBlock(first.id, 'start')
      } else {
        selectBlock(first.id)
      }
    }
  }
}

function resolveSelectionAnchor(): TextPoint | null {
  if (textRangeSelection) {
    return textRangeSelection.anchor
  }

  if (focusedBlockId) {
    const sel = itemRefs.get(focusedBlockId)?.getSelection()

    return { blockId: focusedBlockId, offset: sel?.start ?? 0 }
  }

  if (selectedBlockId) {
    return { blockId: selectedBlockId, offset: 0 }
  }

  return null
}

function finalizeTextRangeSelection() {
  if (!textRangeSelection) {
    return
  }

  if (isCrossBlockTextRange(textRangeSelection, visibleBlocks)) {
    managedTextSelection = true
    window.getSelection()?.removeAllRanges()
    focusedBlockId = null

    return
  }

  const { anchor, focus } = textRangeSelection
  const start = Math.min(anchor.offset, focus.offset)
  const end = Math.max(anchor.offset, focus.offset)
  const blockId = anchor.blockId

  textRangeSelection = null
  managedTextSelection = false

  if (start !== end) {
    itemRefs.get(blockId)?.setSelection(start, end)
    focusedBlockId = blockId
    return
  }

  // Collapsed range (simple tap / no real drag): ensure the line is focused so
  // the soft keyboard opens on the first press, not the second.
  const editable = itemRefs.get(blockId)
  const active = document.activeElement
  const host = rootEl?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
  const alreadyInBlock = !!(
    active instanceof HTMLElement
    && host
    && host.contains(active)
  )
  if (!alreadyInBlock) {
    editable?.setSelection?.(start, start)
    focusedBlockId = blockId
  }
}

function onSelectionPointerDown(
  block: Block,
  payload: {
    shiftKey: boolean
    clientX: number
    clientY: number
    pointerType?: string
  },
) {
  if (editorProps.readonly || !isTextBlock(block.type) || !rootEl) {
    return
  }

  const point = caretPointFromClient(rootEl, payload.clientX, payload.clientY)

  if (!point) {
    return
  }

  if (payload.shiftKey) {
    // Extend from the existing caret / selection anchor, then keep tracking while dragged.
    const anchor = resolveSelectionAnchor() ?? point
    dragSelectAnchor = anchor
    dragSelectOriginClient = { x: payload.clientX, y: payload.clientY }
    dragSelectPointerType = payload.pointerType ?? null
    textRangeSelection = { anchor, focus: point }
    isDragSelecting = true
    dragSelectPending = false

    if (point.blockId === anchor.blockId) {
      managedTextSelection = false
      const start = Math.min(anchor.offset, point.offset)
      const end = Math.max(anchor.offset, point.offset)
      itemRefs.get(point.blockId)?.setSelection(start, end)
      focusedBlockId = point.blockId
    } else {
      managedTextSelection = true
      clearBlockSelection()
      focusedBlockId = null
      closeSlash()
      bubble = null
      window.getSelection()?.removeAllRanges()
    }

    return
  }

  if (hasActiveManagedSelection()) {
    clearTextRangeSelection()
  }

  // Arm text-range drag. On touch/pen keep it pending until the finger actually
  // moves — otherwise a normal tap is treated as a micro-drag, steals the native
  // caret, and feels like “tap twice to edit”.
  dragSelectAnchor = point
  dragSelectOriginClient = { x: payload.clientX, y: payload.clientY }
  dragSelectPointerType = payload.pointerType ?? null
  textRangeSelection = { anchor: point, focus: point }
  managedTextSelection = false

  if (isTouchLikePointer({ pointerType: payload.pointerType ?? '' })) {
    dragSelectPending = true
    isDragSelecting = false
  } else {
    dragSelectPending = false
    isDragSelecting = true
  }
}

function isEditorOverlayTarget(target: HTMLElement): boolean {
  return !!target.closest(
    '[data-slot="popover-content"], [data-slot="popover-anchor"], [data-slot="dropdown-menu-content"], [data-slot="dialog-content"], .slash-menu',
  )
}

function isFormatToolbarTarget(target: HTMLElement): boolean {
  return !!target.closest('[data-pro-editor-toolbar]')
}

function isNativeInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return !!target.closest('input, textarea, select, [contenteditable="true"]')
}

function shouldKeepNativeFocus(): boolean {
  const active = document.activeElement

  if (!(active instanceof HTMLElement)) {
    return false
  }

  if (isEditorOverlayTarget(active)) {
    return true
  }

  return !!active.closest('input, textarea, select, [role="combobox"], [role="listbox"]')
}

function clearBlockSelection() {
  selectedBlockId = null
  selectedBlockIds = []
}

function isBlockSelected(id: string): boolean {
  if (selectedBlockIds.includes(id) || selectedBlockId === id) {
    return true
  }
  // Highlight non-text (image/table/…) between multi-block text selection endpoints.
  if (
    hasActiveManagedSelection()
    && textRangeSelection
    && isNonTextBlockCoveredByRange(id, textRangeSelection, visibleBlocks)
  ) {
    return true
  }
  return false
}

function hasBlockSelection(): boolean {
  return selectedBlockIds.length > 0 || !!selectedBlockId
}

/** Selected blocks in document order (multi or single). */
function selectedBlocksInOrder(): Block[] {
  if (selectedBlockIds.length > 0) {
    const want = new Set(selectedBlockIds)
    return blocks.filter((b) => want.has(b.id))
  }
  if (selectedBlockId) {
    const block = byId(selectedBlockId)
    return block ? [block] : []
  }
  return []
}

function setSelectedBlocks(ids: string[]) {
  const want = new Set(ids)
  const ordered = blocks.map((b) => b.id).filter((id) => want.has(id))
  selectedBlockIds = ordered
  // Keep single-select id for legacy paths when exactly one block is selected.
  selectedBlockId = ordered.length === 1 ? ordered[0] : null
}

function selectBlock(id: string) {
  clearTextRangeSelection()
  setSelectedBlocks([id])
  focusedBlockId = null
  closeSlash()
  closeEmoji()
  bubble = null
  window.getSelection()?.removeAllRanges()
  void tick().then(() => {
    if (shouldKeepNativeFocus()) {
      return
    }

    rootEl?.focus()
  })
}

function marqueeBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  return {
    left,
    top,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function rectsIntersect(
  a: { left: number; top: number; width: number; height: number },
  b: DOMRect,
): boolean {
  return !(
    a.left + a.width < b.left
    || b.right < a.left
    || a.top + a.height < b.top
    || b.bottom < a.top
  )
}

function hitTestMarqueeBlocks(rect: { left: number; top: number; width: number; height: number }): string[] {
  const root = rootEl
  if (!root || rect.width < 1 || rect.height < 1) return []

  // Prefer block item roots; fall back to any data-block-id host.
  const nodes = root.querySelectorAll<HTMLElement>('.ebi[data-block-id], [data-block-id]')
  const hits = new Set<string>()

  for (const node of nodes) {
    const id = node.dataset.blockId
    if (!id || hits.has(id)) continue

    const box = node.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) continue
    // Slightly inflate tiny blocks so they are easier to catch.
    const inflated = {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: Math.max(box.height, 8),
    }
    if (rectsIntersect(rect, inflated as DOMRect)) {
      hits.add(id)
    }
  }

  // Preserve document order.
  return blocks.map((b) => b.id).filter((id) => hits.has(id))
}

function isHardMarqueeBlocker(target: HTMLElement): boolean {
  return !!target.closest(
    'input, textarea, select, button, a, .ebi-gutter, .ebi-reorder-handle, .ebi-gutter-btn, .slash-menu, [data-pro-editor-toolbar], .eib-lightbox, .eib-toolbar, .eib-caption-input, .epb-option__text, .epb-question, .epb-footer, .be-marquee',
  )
}

/** True when the pointer is over a block drag handle (even under a marquee strip layer). */
function isOverBlockDragHandle(clientX: number, clientY: number): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!(el instanceof Element)) continue
    if (el.closest('.ebi-reorder-handle, .ebi-gutter')) return true
  }
  return false
}

/**
 * Marquee may start when:
 * - Drag begins on empty chrome / tail / non-text block chrome
 * - Drag begins in the left OR right strip of the editor (even over text)
 * - Alt is held (force marquee over text)
 *
 * Never when starting on the block drag handle — that must remain HTML5 reorder drag.
 * Never when starting on a text block host (padding / list row) — on phones that
 * steals the first tap (3px jitter activates marquee and blurs the caret).
 */
function canStartMarquee(e: PointerEvent): boolean {
  if (editorProps.readonly || !(e.target instanceof HTMLElement)) return false
  const root = rootEl
  if (!root) return false

  // Block reorder handle always wins over marquee (incl. side-strip hit targets).
  if (isHardMarqueeBlocker(e.target) || isOverBlockDragHandle(e.clientX, e.clientY)) {
    return false
  }

  if (isEditorOverlayTarget(e.target) || isFormatToolbarTarget(e.target)) return false

  const inRoot = root.contains(e.target)
  const inStrip = isPointerInMarqueeStrip(e.clientX)

  // Strip coords may land on page padding outside root when surfaces are skipped.
  if (!inRoot && !inStrip) return false

  // Force marquee over text with Alt.
  if (e.altKey && inRoot) return true

  // Side strips: always marquee (block block select gutters on both sides).
  if (inStrip) return true

  if (!inRoot) return false

  // Empty tail / root surface / dedicated strips.
  if (
    e.target === root
    || e.target.classList.contains('editor-tail')
    || e.target.classList.contains('be-marquee-surface')
  ) {
    return true
  }

  // Editable field — never marquee (native caret / keyboard need the gesture).
  if (e.target.closest('[contenteditable="true"], input, textarea')) return false

  // Text / code / table blocks use text-range drag (armed separately), not marquee.
  // Empty chrome outside blocks, images, etc. can still marquee-select.
  const host = e.target.closest('[data-block-id]') as HTMLElement | null
  if (host) {
    const hostId = host.dataset.blockId
    const hostBlock = hostId ? byId(hostId) : undefined
    if (
      hostBlock
      && (isTextBlock(hostBlock.type) || hostBlock.type === 'code' || hostBlock.type === 'table')
    ) {
      return false
    }
  }

  return true
}

function stopMarqueeAutoScroll() {
  if (marqueeAutoScrollRaf) {
    cancelAnimationFrame(marqueeAutoScrollRaf)
    marqueeAutoScrollRaf = 0
  }
}

function elementCanScrollY(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + MARQUEE_SCROLL_EPS
}

function marqueeScrollMetrics(parent: HTMLElement): { top: number; max: number } {
  const top = parent.scrollTop
  const max = Math.max(0, parent.scrollHeight - parent.clientHeight)
  return { top, max }
}

/** True if the parent can still scroll in the given direction (dy sign). */
function canMarqueeScrollInDirection(parent: HTMLElement, dy: number): boolean {
  if (dy === 0 || !elementCanScrollY(parent)) return false
  const { top, max } = marqueeScrollMetrics(parent)
  if (max <= MARQUEE_SCROLL_EPS) return false
  if (dy < 0) return top > MARQUEE_SCROLL_EPS
  return top < max - MARQUEE_SCROLL_EPS
}

/**
 * Scroll parent for marquee auto-scroll. The app uses `#app { overflow: auto }`
 * rather than the window, so we must scroll that element (or the first overflow
 * ancestor). Returns null when nothing has real vertical overflow.
 */
function getMarqueeScrollParent(): HTMLElement | null {
  const root = rootEl
  let node: HTMLElement | null = root?.parentElement ?? null
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node)
    const overflowY = style.overflowY
    const overflowable =
      overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
    if (overflowable && elementCanScrollY(node)) return node
    node = node.parentElement
  }

  const app = document.querySelector('#app') as HTMLElement | null
  if (app && elementCanScrollY(app)) return app

  // html/body are overflow:hidden in this app — only use them if they truly scroll.
  const se = document.scrollingElement as HTMLElement | null
  if (se && elementCanScrollY(se)) return se
  return null
}

function getMarqueeScrollTop(): number {
  return getMarqueeScrollParent()?.scrollTop ?? 0
}

/** Convert document-space origin back to current client coordinates. */
function marqueeOriginClient(): { x: number; y: number } | null {
  if (!marqueeOriginDoc) return null
  return {
    x: marqueeOriginDoc.x,
    y: marqueeOriginDoc.y - getMarqueeScrollTop(),
  }
}

function scrollMarqueeBy(dy: number): number {
  if (dy === 0) return 0

  const parent = getMarqueeScrollParent()
  if (!parent || !canMarqueeScrollInDirection(parent, dy)) return 0

  const before = parent.scrollTop
  const max = Math.max(0, parent.scrollHeight - parent.clientHeight)
  const next = Math.min(max, Math.max(0, before + dy))
  parent.scrollTop = next
  return parent.scrollTop - before
}

/**
 * Edge auto-scroll dy for the current pointer. 0 when not near an edge, when
 * the page has no overflow, or when already at the top/bottom limit.
 */
function marqueeEdgeScrollDy(): number {
  if (!marqueeMoved) return 0

  const parent = getMarqueeScrollParent()
  if (!parent) return 0

  // Prefer the scroll parent's visible box so edges match the actual viewport.
  const bounds = parent.getBoundingClientRect()
  const y = marqueeLastClient.y
  const edgeTop = bounds.top + MARQUEE_EDGE_PX
  const edgeBottom = bounds.bottom - MARQUEE_EDGE_PX

  if (y < edgeTop) {
    if (!canMarqueeScrollInDirection(parent, -1)) return 0
    const dist = Math.max(0, y - bounds.top)
    return -MARQUEE_SCROLL_SPEED * Math.max(0.35, 1 - dist / MARQUEE_EDGE_PX)
  }

  if (y > edgeBottom) {
    if (!canMarqueeScrollInDirection(parent, 1)) return 0
    const dist = Math.max(0, bounds.bottom - y)
    return MARQUEE_SCROLL_SPEED * Math.max(0.35, 1 - dist / MARQUEE_EDGE_PX)
  }

  return 0
}

function tickMarqueeAutoScroll() {
  marqueeAutoScrollRaf = 0
  if (!marqueeActive || !marqueeOriginDoc || !marqueeMoved) return

  const dy = marqueeEdgeScrollDy()
  if (dy !== 0) {
    const actual = scrollMarqueeBy(dy)
    // Origin is document-stable — only refresh hit-test when content moved.
    if (actual !== 0) {
      updateMarqueeFromClient(marqueeLastClient.x, marqueeLastClient.y)
    }
  }

  // Keep the loop only while an edge can still scroll in that direction.
  if (marqueeActive && marqueeMoved && marqueeEdgeScrollDy() !== 0) {
    marqueeAutoScrollRaf = requestAnimationFrame(tickMarqueeAutoScroll)
  }
}

function ensureMarqueeAutoScroll() {
  // Nothing to do: no overflow, not selecting yet, or not near a live edge.
  if (!marqueeMoved || !getMarqueeScrollParent()) return
  if (marqueeEdgeScrollDy() === 0) return
  if (!marqueeAutoScrollRaf) {
    marqueeAutoScrollRaf = requestAnimationFrame(tickMarqueeAutoScroll)
  }
}

function releaseMarqueeCapture() {
  if (marqueeCaptureEl && marqueePointerId != null) {
    try {
      if (marqueeCaptureEl.hasPointerCapture?.(marqueePointerId)) {
        marqueeCaptureEl.releasePointerCapture(marqueePointerId)
      }
    } catch {
      // ignore
    }
  }
  marqueeCaptureEl = null
}

function activateMarqueeMode() {
  if (marqueeMoved) return
  marqueeMoved = true
  marqueeLive = true

  // Drop text carets / soft focus so block multi-select owns the gesture.
  clearDragSelectState()
  clearTextRangeSelection()
  focusedBlockId = null
  emit('focus-block', null)
  bubble = null
  closeSlash()
  window.getSelection()?.removeAllRanges()
  const active = document.activeElement
  if (active instanceof HTMLElement && rootEl?.contains(active) && active !== rootEl) {
    active.blur()
  }
  rootEl?.focus({ preventScroll: true })

  const capture = rootEl
  if (capture && marqueePointerId != null) {
    try {
      capture.setPointerCapture(marqueePointerId)
      marqueeCaptureEl = capture
    } catch {
      // Pointer capture is best-effort.
    }
  }
}

function updateMarqueeFromClient(clientX: number, clientY: number, pointerType?: string | null) {
  const origin = marqueeOriginClient()
  if (!origin) return
  marqueeLastClient = { x: clientX, y: clientY }
  const box = marqueeBox(origin, marqueeLastClient)
  const threshold = marqueeThresholdPx(pointerType)
  const moved = box.width >= threshold || box.height >= threshold

  if (!marqueeMoved && moved) {
    activateMarqueeMode()
  }

  if (!marqueeMoved) {
    marqueeRect = null
    return
  }

  marqueeRect = box
  setSelectedBlocks(hitTestMarqueeBlocks(box))
}

function beginMarquee(e: PointerEvent) {
  if (e.button !== 0 || !canStartMarquee(e)) return false
  // Ignore duplicate pointerdown (root + document listeners).
  if (marqueeActive && marqueePointerId === e.pointerId) return true

  marqueeActive = true
  marqueeMoved = false
  marqueeLive = false
  marqueePointerId = e.pointerId
  // Document-space origin so edge auto-scroll does not invent selection growth.
  marqueeOriginDoc = {
    x: e.clientX,
    y: e.clientY + getMarqueeScrollTop(),
  }
  marqueeLastClient = { x: e.clientX, y: e.clientY }
  marqueeRect = null
  // Don't preventDefault yet — only after threshold so simple clicks still work.
  return true
}

function endMarquee(e?: PointerEvent) {
  if (!marqueeActive) return
  if (e && marqueePointerId != null && e.pointerId !== marqueePointerId) return

  const moved = marqueeMoved
  const target = e?.target
  releaseMarqueeCapture()
  marqueeActive = false
  marqueePointerId = null
  marqueeOriginDoc = null
  marqueeMoved = false
  marqueeLive = false
  marqueeRect = null
  stopMarqueeAutoScroll()

  if (moved && selectedBlockIds.length > 0) {
    void tick().then(() => rootEl?.focus({ preventScroll: true }))
    return
  }

  // Click (no drag) outside a selected block clears multi/single selection.
  if (!moved && hasBlockSelection() && target instanceof HTMLElement) {
    const host = target.closest('[data-block-id]') as HTMLElement | null
    const id = host?.dataset.blockId
    if (!id || !isBlockSelected(id)) {
      clearBlockSelection()
    }
  }
}

function cancelMarqueeSelection() {
  endMarquee()
  clearBlockSelection()
}

// ─── Visibility (collapsed toggles) & numbering ──────────────────────────────

let visibleBlocks = $derived.by((): Block[] => {
  blocksRevision

  const out: Block[] = []
  let hideDeeperThan: number | null = null

  for (const b of blocks) {
    if (b.type === 'column_list' || b.type === 'column') {
      continue
    }

    const ind = b.props.indent ?? 0

    if (hideDeeperThan !== null) {
      if (ind > hideDeeperThan) {
continue
}

      hideDeeperThan = null
    }

    out.push(b)

    if (b.type === 'toggle' && b.props.collapsed) {
hideDeeperThan = ind
}
  }

  return out
})

let blocksForTree = $derived.by((): Block[] => {
  blocksRevision

  const out: Block[] = []
  let hideDeeperThan: number | null = null

  for (const b of blocks) {
    const ind = b.props.indent ?? 0

    if (hideDeeperThan !== null) {
      if (ind > hideDeeperThan) {
        continue
      }

      hideDeeperThan = null
    }

    out.push(b)

    if (b.type === 'toggle' && b.props.collapsed) {
      hideDeeperThan = ind
    }
  }

  return out
})

let renderEntries = $derived(buildBlockRenderTree(blocksForTree))

/** Writing direction per block; empty lines inherit the line above (RTL after RTL). */
let blockDirectionMap = $derived.by(() => {
  blocksRevision
  return buildBlockDirectionMap(blocks, editorProps.editorDir ?? 'ltr')
})

function directionFor(blockId: string): 'ltr' | 'rtl' {
  return blockDirectionMap.get(blockId) ?? editorProps.editorDir ?? 'ltr'
}

let numbering = $derived(computeListNumbering(visibleBlocks))

function visibleIndex(id: string): number {
  return visibleBlocks.findIndex(b => b.id === id)
}

function neighborBlock(id: string, dir: 1 | -1): Block | null {
  const idx = visibleIndex(id)

  if (idx === -1) {
return null
}

  return visibleBlocks[idx + dir] ?? null
}

/** Previous/next visible text block (skips non-text like image/divider). */
function neighborTextBlock(id: string, dir: 1 | -1): Block | null {
  let idx = visibleIndex(id)
  if (idx === -1) return null
  idx += dir
  while (idx >= 0 && idx < visibleBlocks.length) {
    const block = visibleBlocks[idx]
    if (isTextBlock(block.type)) return block
    idx += dir
  }
  return null
}

function blockIdFromEventTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null
}

/**
 * Shift+↑/↓: select whole current line (block) and the line above/below.
 * Runs even when focus is inside contenteditable (before native-input early-out).
 */
function handleShiftArrowLineSelect(e: KeyboardEvent): boolean {
  if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false
  if (e.altKey || e.ctrlKey || e.metaKey) return false

  const dir: 1 | -1 = e.key === 'ArrowDown' ? 1 : -1
  const fromDom = blockIdFromEventTarget(e.target)
  const baseBlockId =
    textRangeSelection?.focus.blockId
    ?? focusedBlockId
    ?? fromDom
    ?? selectedBlockId

  if (!baseBlockId) return false

  const current = byId(baseBlockId)
  if (!current || !isTextBlock(current.type)) return false

  const managedCross =
    hasActiveManagedSelection()
    && !!textRangeSelection
    && isCrossBlockTextRange(textRangeSelection, visibleBlocks)

  // Inside a multi-line block: leave soft-line selection to the browser until
  // the caret is on the first/last visual line (or we already span blocks).
  if (!managedCross) {
    const active = document.activeElement
    if (
      active instanceof HTMLElement
      && active.isContentEditable
      && rootEl?.contains(active)
    ) {
      if (dir === -1 && !isCaretOnFirstLine(active)) return false
      if (dir === 1 && !isCaretOnLastLine(active)) return false
    }
  }

  e.preventDefault()
  e.stopPropagation()

  if (!managedCross) {
    // First extension: full current line + full neighbor line.
    const neighbor = neighborTextBlock(baseBlockId, dir)
    const currentLen = blockLength(current)

    if (!neighbor) {
      // No neighbor — select the whole current line.
      setManagedTextRange(
        { blockId: baseBlockId, offset: dir === -1 ? currentLen : 0 },
        { blockId: baseBlockId, offset: dir === -1 ? 0 : currentLen },
      )
    } else if (dir === -1) {
      // Anchor at end of this line, focus at start of line above.
      setManagedTextRange(
        { blockId: baseBlockId, offset: currentLen },
        { blockId: neighbor.id, offset: 0 },
      )
    } else {
      // Anchor at start of this line, focus at end of line below.
      setManagedTextRange(
        { blockId: baseBlockId, offset: 0 },
        { blockId: neighbor.id, offset: blockLength(neighbor) },
      )
    }
  } else {
    const existing = textRangeSelection!
    const neighbor = neighborTextBlock(existing.focus.blockId, dir)
    if (!neighbor) {
      void tick().then(() => rootEl?.focus())
      return true
    }
    const focusOffset = dir === -1 ? 0 : blockLength(neighbor)
    setManagedTextRange(existing.anchor, { blockId: neighbor.id, offset: focusOffset })
  }

  void tick().then(() => rootEl?.focus())
  return true
}

// ─── Toggle nest context (flat indent model) ─────────────────────────────────

function blockIndent(block: Block): number {
  return block.props.indent ?? 0
}

/** Indent for blocks inserted from or after this anchor (toggle children nest one level deeper). */
function insertIndentForAnchor(anchor: Block): number {
  const base = blockIndent(anchor)

  if (anchor.type === 'toggle') {
    return base + 1
  }

  return base
}

function expandToggleAnchor(anchor: Block): void {
  if (anchor.type === 'toggle' && anchor.props.collapsed) {
    anchor.props = { ...anchor.props, collapsed: false }
    touchBlocks()
  }
}

function copyBlockIndent(from: Block, block: Block): Block {
  const ind = blockIndent(from)

  if (ind <= 0) {
    return block
  }

  return { ...block, props: { ...block.props, indent: ind } }
}

/** Apply anchor nesting to inserted blocks while preserving relative indent within the group. */
function withInsertIndent(anchor: Block, inserted: Block[]): Block[] {
  if (inserted.length === 0) {
    return inserted
  }

  const targetIndent = insertIndentForAnchor(anchor)
  const minPasted = Math.min(...inserted.map(b => blockIndent(b)))
  const offset = targetIndent - minPasted

  if (offset === 0) {
    return inserted
  }

  return inserted.map((block) => {
    const ind = blockIndent(block) + offset
    const props = { ...block.props }

    if (ind > 0) {
      props.indent = ind
    } else {
      delete props.indent
    }

    return { ...block, props }
  })
}

function blockPropsWithIndent(indent: number): Block['props'] {
  return indent > 0 ? { indent } : {}
}

/** Copy nest/dir from an existing block onto new default props (never writes indent: undefined). */
function propsKeepingNest(from: Block, defaults: Block['props'] = {}): Block['props'] {
  const props: Block['props'] = { ...defaults }
  const indent = from.props.indent

  if (typeof indent === 'number' && indent > 0) {
    props.indent = indent
  } else {
    delete props.indent
  }

  if (from.props.dir && from.props.dir !== 'auto') {
    props.dir = from.props.dir
  }

  if (from.props.dirManual) {
    props.dirManual = true
  }

  return props
}

/** Reindent a contiguous unit so its root matches `targetIndent`. */
function reindentUnitTo(unit: Block[], targetIndent: number): Block[] {
  if (unit.length === 0) {
    return unit
  }

  const base = blockIndent(unit[0])
  const delta = targetIndent - base

  if (delta === 0) {
    return unit
  }

  return unit.map((block) => {
    const next = Math.max(0, blockIndent(block) + delta)
    const props = { ...block.props }

    if (next > 0) {
      props.indent = next
    } else {
      delete props.indent
    }

    return { ...block, props }
  })
}

/** block editor: collapsed toggles keep a hidden empty child for later editing. */
function syncTogglePlaceholder(toggle: Block, options?: { history?: boolean }): void {
  if (ensureTogglePlaceholder(blocks, toggle)) {
    touchBlocks()

    if (options?.history !== false) {
      pushHistory(true)
    }
  }
}

function syncAllTogglePlaceholders(options?: { history?: boolean }): void {
  if (ensureTogglePlaceholders(blocks)) {
    touchBlocks()

    if (options?.history !== false) {
      pushHistory(true)
    }
  }
}

function afterRemovedBlockAt(idx: number, options?: { history?: boolean }): void {
  const parentToggleIdx = findContainingToggleIndex(blocks, idx)

  if (parentToggleIdx !== null) {
    syncTogglePlaceholder(blocks[parentToggleIdx], options)
  }
}

// ─── History (undo / redo) ────────────────────────────────────────────────────

let history = $state<string[]>([])
let historyIndex = $state(0)
let historyTimer: ReturnType<typeof setTimeout> | null = null

let canUndo = $derived(historyIndex > 0 || historyTimer !== null)
let canRedo = $derived(historyIndex < history.length - 1)

function snapshot(): string {
  return JSON.stringify(blocks)
}

function commitSnapshot() {
  if (historyTimer) {
 clearTimeout(historyTimer); historyTimer = null 
}

  const snap = snapshot()

  if (history[historyIndex] === snap) {
return
}

  history = history.slice(0, historyIndex + 1)
  history.push(snap)

  // Cap history depth — full-page JSON snapshots are expensive on large docs.
  if (history.length > 80) {
    history.shift()
  }

  historyIndex = history.length - 1
}

/**
 * @param immediate Commit undo snapshot now (structural edits).
 * @param structure Bump blocksRevision so the full tree re-renders. Typing in
 *   one block mutates spans in place — do NOT rebuild the whole tree each key.
 */
function pushHistory(immediate = false, structure = immediate) {
  if (editorProps.readonly) {
    return
  }

  if (structure) {
    touchBlocks()
  }
  // Parent collab save is debounced; still notify each edit so dirty/focus track.
  emit('change')

  if (immediate) {
    commitSnapshot()
  } else {
    if (historyTimer) {
      clearTimeout(historyTimer)
    }
    // Longer debounce on large pages reduces full-document JSON snapshots while typing.
    const delay = blocks.length > 120 ? 700 : 400
    historyTimer = setTimeout(commitSnapshot, delay)
  }
}

function restoreSnapshot(json: string) {
  const arr = JSON.parse(json) as Block[]
  blocks.splice(0, blocks.length, ...arr)
  ensureNotEmpty()
  touchBlocks()
  emit('change')
}

function undo() {
  if (historyTimer) {
commitSnapshot()
}

  if (historyIndex <= 0) {
return
}

  historyIndex -= 1
  restoreSnapshot(history[historyIndex])
}

function redo() {
  if (historyIndex >= history.length - 1) {
return
}

  historyIndex += 1
  restoreSnapshot(history[historyIndex])
}

function resetHistory() {
  if (historyTimer) {
 clearTimeout(historyTimer); historyTimer = null 
}

  history = [snapshot()]
  historyIndex = 0
}

function ensureNotEmpty() {
  if (blocks.length === 0) {
    blocks.push(makeBlock('paragraph'))
  }
}

function normalizeLoadedBlocks() {
  ensureNotEmpty()
  syncAllTogglePlaceholders({ history: false })
}

// Like Vue watch(() => props.modelValue): only when the array *reference* changes.
// Side effects must be untracked or resetHistory/touchBlocks re-enter forever.
$effect(() => {
  const mv = editorProps.modelValue
  untrack(() => {
    void mv
    normalizeLoadedBlocks()
    resetHistory()
    touchBlocks()
  })
})

$effect(() => {
  const value = editorProps.readonly
  if (!value) return
  untrack(() => {
    closeSlash()
    closeEmoji()
    bubble = null
    clearBlockSelection()
    clearTextRangeSelection()
    endMarquee()
  })
})

onMount(() => {
  normalizeLoadedBlocks()
  resetHistory()
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('pointermove', onDocPointerMove)
  document.addEventListener('pointerup', onDocPointerUp)
  document.addEventListener('pointercancel', onDocPointerUp)
  document.addEventListener('pointerdown', onBubbleToolbarPointerDown, true)
  document.addEventListener('pointerup', onBubbleToolbarPointerUp, true)
})

onDestroy(() => {
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('pointermove', onDocPointerMove)
  document.removeEventListener('pointerup', onDocPointerUp)
  document.removeEventListener('pointercancel', onDocPointerUp)
  document.removeEventListener('pointerdown', onBubbleToolbarPointerDown, true)
  document.removeEventListener('pointerup', onBubbleToolbarPointerUp, true)
  unbindVimDocumentListeners()
  stopMarqueeAutoScroll()
  closeExternalLinkModal()
  closeLinkContextMenu()

  if (historyTimer) {
clearTimeout(historyTimer)
}
})

// ─── Slash menu ───────────────────────────────────────────────────────────────

interface SlashState {
  blockId: string
  index: number
  query: string
  position: { x: number; y: number }
}

let slashState = $state<SlashState | null>(null)
type SlashMenuApi = { move: (dir: 1 | -1) => void; confirm: () => void }
type BubbleToolbarApi = {
  openCommentPanel: () => void
  openLinkEditor: (seed?: string | null) => void
}
let slashMenuRef = $state<SlashMenuApi | null>(null)
let bubbleToolbarRef = $state<BubbleToolbarApi | null>(null)
let iconPickerRequest = $state<{ blockId: string; tab: 'emoji' | 'icon' } | null>(null)
let pagePickerRequest = $state<{ blockId: string } | null>(null)

/** `:` emoji autocomplete (Slack style). */
interface EmojiMenuState {
  blockId: string
  /** Index of the opening `:`. */
  index: number
  query: string
  position: { x: number; y: number }
}

let emojiState = $state<EmojiMenuState | null>(null)
type EmojiMenuApi = { move: (dir: 1 | -1) => void; confirm: () => void }
let emojiMenuRef = $state<EmojiMenuApi | null>(null)

function closeSlash() {
  slashState = null
}

function closeEmoji() {
  emojiState = null
}

function isSlashMenuActiveAt(blockId: string, caret: number | null | undefined): boolean {
  const state = slashState

  if (!state || state.blockId !== blockId) {
    return false
  }

  const block = byId(blockId)

  if (!block || !isTextBlock(block.type)) {
    return false
  }

  const text = spansToText(block.content)

  if (text[state.index] !== '/') {
    return false
  }

  if (caret === undefined || caret === null || caret <= state.index) {
    return false
  }

  const queryEnd = state.index + 1 + state.query.length

  if (caret > queryEnd) {
    return false
  }

  const query = text.slice(state.index + 1, caret)

  return query === state.query && !/\s/.test(query) && query.length <= 24
}

function isSlashMenuActive(): boolean {
  const state = slashState

  if (!state) {
    return false
  }

  return isSlashMenuActiveAt(state.blockId, itemRefs.get(state.blockId)?.getSelection()?.start)
}

function slashPosition(): { x: number; y: number } {
  const rect = getCaretClientRect()
  const x = Math.min(rect?.left ?? 100, window.innerWidth - 300)
  let y = (rect?.bottom ?? 100) + 6

  if (y + 330 > window.innerHeight) {
y = Math.max(8, (rect?.top ?? 100) - 336)
}

  return { x, y }
}

function updateSlash(block: Block, spans: InlineSpan[], caret: number | null) {
  const text = spansToText(spans)
  const state = slashState

  if (state && state.blockId === block.id) {
    if (caret === null || caret <= state.index || text[state.index] !== '/') {
      closeSlash()

      return
    }

    const query = text.slice(state.index + 1, caret)

    if (/\s/.test(query) || query.length > 24) {
      closeSlash()

      return
    }

    state.query = query
    state.position = slashPosition()

    return
  }

  if (caret !== null && caret > 0 && text[caret - 1] === '/') {
    const before = caret >= 2 ? text[caret - 2] : ''

    if (before === '' || /\s/.test(before)) {
      closeEmoji()
      slashState = { blockId: block.id, index: caret - 1, query: '', position: slashPosition() }
    }
  }
}

function updateEmoji(block: Block, spans: InlineSpan[], caret: number | null) {
  const text = spansToText(spans)
  const state = emojiState

  if (state && state.blockId === block.id) {
    if (caret === null || caret <= state.index || text[state.index] !== ':') {
      closeEmoji()
      return
    }

    const query = text.slice(state.index + 1, caret)

    // Closing colon `:smile:` → insert best match if any.
    if (query.endsWith(':') && query.length > 1) {
      const name = query.slice(0, -1)
      if (/^[a-zA-Z0-9_+-]+$/.test(name)) {
        const matches = searchEmojis(name, 8)
        const exact = matches.find((m) => m.name === name) ?? matches[0]
        if (exact) {
          applyEmoji(block, state.index, state.index + 1 + query.length, exact)
          return
        }
      }
      closeEmoji()
      return
    }

    if (!/^[a-zA-Z0-9_+-]*$/.test(query) || query.length > 32) {
      closeEmoji()
      return
    }

    // Replace state object so Vue always re-renders the menu with the new query.
    emojiState = {
      blockId: state.blockId,
      index: state.index,
      query,
      position: slashPosition(),
    }
    return
  }

  if (caret !== null && caret > 0 && text[caret - 1] === ':') {
    const before = caret >= 2 ? text[caret - 2] : ''
    // Open only after start/whitespace (avoid times like 12:30 or https:).
    if (before === '' || /\s/.test(before)) {
      closeSlash()
      emojiState = {
        blockId: block.id,
        index: caret - 1,
        query: '',
        position: slashPosition(),
      }
    }
  }
}

function applyEmoji(block: Block, from: number, to: number, item: EmojiEntry) {
  const idx = blocks.findIndex((b) => b.id === block.id)
  const live = idx !== -1 ? blocks[idx] : block
  const text = spansToText(live.content)

  // Re-resolve the `:query` range from live text so we always strip the shortcode.
  let start = from
  let end = Math.min(to, text.length)
  if (text[start] !== ':') {
    // Fallback: last `:name` before caret/end.
    const slice = text.slice(0, Math.max(end, start + 1))
    const match = slice.match(/:([a-zA-Z0-9_+-]*)(?::)?$/)
    if (match && match.index !== undefined) {
      start = match.index
      end = match.index + match[0].length
    }
  } else {
    // Expand end to cover the whole shortcode token.
    let i = start + 1
    while (i < text.length && /[a-zA-Z0-9_+-]/.test(text[i])) i++
    if (text[i] === ':') i++
    end = Math.max(end, i)
  }

  let content = deleteRangeInSpans(live.content, start, end)
  content = insertTextInSpans(content, start, item.emoji)

  // New block identity so shallow parents / contenteditable watchers always update.
  const nextBlock: Block = { ...live, content }
  if (idx !== -1) {
    blocks[idx] = nextBlock
  } else {
    live.content = content
  }

  closeEmoji()
  touchBlocks()
  contentRevision++
  pushHistory(true)
  void tick().then(() => focusBlock(nextBlock.id, start + item.emoji.length))
}

function onEmojiSelect(item: EmojiEntry) {
  // Snapshot before anything can clear emojiState (blur / outside click).
  const state = emojiState
  if (!state) return
  const { blockId, index, query } = state
  const block = byId(blockId)
  if (!block || !isTextBlock(block.type)) {
    closeEmoji()
    return
  }
  const text = spansToText(block.content)
  let end = index + 1 + query.length
  if (text[end] === ':') end += 1
  // If query drifted, prefer token length from live text.
  if (text[index] === ':') {
    let i = index + 1
    while (i < text.length && /[a-zA-Z0-9_+-]/.test(text[i])) i++
    if (text[i] === ':') i++
    end = i
  }
  applyEmoji(block, index, end, item)
}

function focusInsertedBlock(block: Block, item: SlashItem) {
  if (item.type === 'page') {
    // Keep soft-lock / dirty protection on the new page block while the user
    // picks or creates the target page (selectBlock would clear focus).
    focusedBlockId = block.id
    selectedBlockId = block.id
    emit('focus-block', block.id)
    pagePickerRequest = { blockId: block.id }
    return
  }

  if (item.pickIcon) {
    iconPickerRequest = { blockId: block.id, tab: item.pickIcon }
  }

  if (isTextBlock(block.type) || block.type === 'code') {
    focusBlock(block.id, 'start')
  } else {
    selectBlock(block.id)
  }
}

/**
 * Insert any block type as a nested child of a toggle (block editor: toggles host
 * headings, lists, media, nested toggles, etc.).
 */
function insertInsideToggle(toggle: Block, item: SlashItem, textBeforeSlash: string): Block {
  expandToggleAnchor(toggle)
  const idx = blocks.indexOf(toggle)

  let created: Block
  if (item.type === 'code') {
    created = makeBlock('code', {
      props: {
        language: 'plaintext',
        // Title text stays on the toggle; body code starts empty.
        code: '',
      },
    })
  } else {
    created = makeBlock(item.type)
  }

  const nested = withInsertIndent(toggle, [created])
  blocks.splice(idx + 1, 0, ...nested)
  const inserted = nested[0]

  if (item.type === 'toggle') {
    syncTogglePlaceholder(inserted, { history: false })
  }

  // Prefer a single empty nested paragraph: if slash was used on an empty
  // toggle title and a placeholder already exists, replace that placeholder
  // when inserting a non-paragraph type so we don't stack empties.
  if (
    textBeforeSlash.trim() === ''
    && item.type !== 'paragraph'
  ) {
    const afterInserted = blocks[idx + 2]
    if (
      afterInserted
      && afterInserted.type === 'paragraph'
      && spansToText(afterInserted.content) === ''
      && blockIndent(afterInserted) === insertIndentForAnchor(toggle)
    ) {
      blocks.splice(idx + 2, 1)
    }
  }

  return inserted
}

function onSlashSelect(item: SlashItem) {
  const state = slashState

  if (!state) {
    return
  }

  const block = byId(state.blockId)
  closeSlash()

  if (!block) {
    return
  }

  const removeEnd = state.index + 1 + state.query.length
  const spans = deleteRangeInSpans(block.content, state.index, removeEnd)
  const textBeforeSlash = spansToText(spans)

  // Slash on a toggle title always inserts INSIDE the collapsible so it can
  // host any block type. Use the format toolbar "Turn into" to convert the
  // toggle itself.
  if (block.type === 'toggle') {
    block.content = spans
    block.props = { ...block.props, collapsed: false }

    // Empty "/text" on the title → jump into the existing nested body.
    if (item.type === 'paragraph' && textBeforeSlash.trim() === '') {
      syncTogglePlaceholder(block, { history: false })
      const child = blocks[blocks.indexOf(block) + 1]
      touchBlocks()
      pushHistory(true)
      if (child) {
        focusBlock(child.id, 'start')
      }
      return
    }

    const inserted = insertInsideToggle(block, item, textBeforeSlash)
    touchBlocks()
    pushHistory(true)
    focusInsertedBlock(inserted, item)
    return
  }

  // Code: convert the current block into a code block, keeping written text.
  if (item.type === 'code') {
    const defaults = makeBlock('code')
    block.type = 'code'
    block.content = []
    block.props = {
      ...propsKeepingNest(block, defaults.props),
      code: textBeforeSlash,
      language: block.props.language ?? defaults.props.language ?? 'plaintext',
    }
    touchBlocks()
    pushHistory(true)
    void tick().then(() => focusBlock(block.id, 'end'))
    return
  }

  const isInsertType = ['divider', 'image', 'table', 'page', 'poll'].includes(item.type)

  if (!isInsertType) {
    const defaults = makeBlock(item.type)
    block.type = item.type
    block.content = spans
    block.props = propsKeepingNest(block, defaults.props)
    if (item.type === 'toggle') {
      block.props = { ...block.props, collapsed: false }
      syncTogglePlaceholder(block, { history: false })
    }
    touchBlocks()
    pushHistory(true)
    focusBlock(block.id, Math.min(state.index, textBeforeSlash.length))

    if (item.pickIcon) {
      iconPickerRequest = { blockId: block.id, tab: item.pickIcon }
    }

    return
  }

  expandToggleAnchor(block)

  const idx = blocks.indexOf(block)

  if (textBeforeSlash.trim() === '') {
    blocks.splice(idx, 1, copyBlockIndent(block, makeBlock(item.type)))
  } else {
    block.content = spans
    blocks.splice(idx + 1, 0, ...withInsertIndent(block, [makeBlock(item.type)]))
  }

  const newBlock = textBeforeSlash.trim() !== ''
    ? blocks[idx + 1]
    : blocks[idx]

  pushHistory(true)
  focusInsertedBlock(newBlock, item)
}

function onPageBlockCreate(blockId: string, title: string) {
  const parentId = editorProps.currentPageId
  const block = byId(blockId)
  if (!block || block.type !== 'page') return

  // Hold focus on this block so collab merge cannot drop it mid-create.
  focusedBlockId = blockId
  emit('focus-block', blockId)

  const page = editorProps.createPage?.(title, parentId)
  if (!page?.id) {
    console.warn('[editor] createPage failed for page block', blockId, title)
    return
  }

  // Re-resolve in case a remote sync ran during createPage.
  const live = byId(blockId) ?? block
  if (live.type !== 'page') return

  // Replace block identity (same as patchProps) so page-ref UI sees pageId immediately.
  const nextProps = {
    ...live.props,
    pageId: page.id,
    pageTitle: page.title || title || 'Untitled',
    pageIcon: page.icon ?? '',
  }
  const idx = blocks.indexOf(live)
  const nextBlock = { ...live, props: nextProps }
  if (idx !== -1) {
    blocks[idx] = nextBlock
  } else {
    live.props = nextProps
  }

  pagePickerRequest = null
  touchBlocks()
  pushHistory(true)
  emit('change')
  // Keep focus protection through the parent save/sync that follows @change.
  focusedBlockId = blockId
  emit('focus-block', blockId)
}

function onPageBlockNavigate(pageId: string) {
  emit('navigate-page', pageId)
}

/** Modal confirm for external URLs (open or cancel). */
let externalLinkModal = $state<{
  url: string
  copied: boolean
} | null>(null)
let externalLinkCopiedTimer: ReturnType<typeof setTimeout> | null = null
let externalLinkModalKeyHandler: ((e: KeyboardEvent) => void) | null = null

function closeExternalLinkModal() {
  if (externalLinkCopiedTimer) {
    clearTimeout(externalLinkCopiedTimer)
    externalLinkCopiedTimer = null
  }
  if (externalLinkModalKeyHandler) {
    window.removeEventListener('keydown', externalLinkModalKeyHandler, true)
    externalLinkModalKeyHandler = null
  }
  externalLinkModal = null
}

function openExternalLinkModal(url: string) {
  if (externalLinkCopiedTimer) {
    clearTimeout(externalLinkCopiedTimer)
    externalLinkCopiedTimer = null
  }
  if (externalLinkModalKeyHandler) {
    window.removeEventListener('keydown', externalLinkModalKeyHandler, true)
  }
  externalLinkModal = { url, copied: false }
  externalLinkModalKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeExternalLinkModal()
    }
  }
  window.addEventListener('keydown', externalLinkModalKeyHandler, true)
}

/**
 * Open an external URL in a **new tab/window**.
 * Never navigates the current document (browser demo must stay open).
 * Prefer calling this synchronously from a click handler.
 */
function openUrlInNewTab(url: string): boolean {
  // 1) window.open — works when still inside a user gesture
  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (opened) {
      try {
        opened.opener = null
      } catch {
        // ignore
      }
      return true
    }
  } catch {
    // fall through
  }

  // 2) Synthetic <a target="_blank"> — still a new tab, never same-page
  try {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
  } catch {
    return false
  }
}

function openExternalLinkInBrowser() {
  const modal = externalLinkModal
  if (!modal) return
  const url = modal.url
  // Open first (keep user-gesture), then close the modal — never location.assign.
  const ok = openUrlInNewTab(url)
  if (ok) {
    closeExternalLinkModal()
  }
  // If both methods fail (locked-down webview), leave the modal open so the
  // user can Copy the URL.
}

async function copyExternalLink() {
  const modal = externalLinkModal
  if (!modal) return
  try {
    await navigator.clipboard.writeText(modal.url)
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = modal.url
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    } catch {
      return
    }
  }
  externalLinkModal = { ...modal, copied: true }
  if (externalLinkCopiedTimer) clearTimeout(externalLinkCopiedTimer)
  externalLinkCopiedTimer = setTimeout(() => {
    if (externalLinkModal) {
      externalLinkModal = { ...externalLinkModal, copied: false }
    }
    externalLinkCopiedTimer = null
  }, 1600)
}

function resolveAnchorHref(anchor: HTMLAnchorElement): string | null {
  const data = anchor.getAttribute('data-external-link')?.trim()
  if (data) return data
  const pageData = anchor.getAttribute('data-page-link')?.trim()
  if (pageData) return `page:${pageData}`
  const href = anchor.getAttribute('href')?.trim()
  if (!href) return null
  if (href === '#' || href.startsWith('javascript:')) return null
  return href
}

function tryResolvePageIdFromHref(href: string): string | null {
  const fromScheme = parsePageLink(href)
  if (fromScheme) return fromScheme
  if (typeof resolveInternalHref === 'function') {
    try {
      return resolveInternalHref(href)
    } catch {
      return null
    }
  }
  // Lightweight fallback: match page title to filename stem.
  const clean = href.trim().split('#')[0]?.split('?')[0] ?? ''
  if (!clean || /^(https?:|mailto:|tel:|\/\/)/i.test(clean)) return null
  const base = clean.replace(/\\/g, '/').split('/').pop() || clean
  const stem = base.replace(/\.md$/i, '').replace(/\.markdown$/i, '')
  const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const stemN = norm(stem)
  const list = pages ?? []
  for (const page of list) {
    const title = (page.title || '').trim()
    if (!title) continue
    if (title.toLowerCase() === stem.toLowerCase()) return page.id
    if (title.toLowerCase() === base.toLowerCase()) return page.id
    if (norm(title) === stemN) return page.id
  }
  return null
}

function eventTargetElement(event: Event): Element | null {
  const t = event.target
  if (t instanceof Element) return t
  // Clicks on text inside <a> often have a Text node as target.
  if (t instanceof Node) return t.parentElement
  return null
}

function findLinkAnchor(from: Element | null): HTMLAnchorElement | null {
  if (!from) return null
  const anchor = from.closest('a[href], a[data-external-link], a[data-page-link]')
  return anchor instanceof HTMLAnchorElement ? anchor : null
}

function isExternalLookingHref(href: string): boolean {
  const value = href.trim()
  if (!value) return false
  if (/^(https?:|mailto:|tel:|sms:|\/\/)/i.test(value)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('page:')) return true
  return false
}

/** Suppress duplicate click right after pointerdown link activation. */
let linkActivationGuardUntil = 0

/** Right-click menu for inline links (edit / copy / open / remove). */
let linkContextMenu = $state<{
  x: number
  y: number
  href: string
  label: string
  pageId: string | null
  blockId: string | null
} | null>(null)
let linkContextMenuKeyHandler: ((e: KeyboardEvent) => void) | null = null

function closeLinkContextMenu() {
  if (linkContextMenuKeyHandler) {
    window.removeEventListener('keydown', linkContextMenuKeyHandler, true)
    linkContextMenuKeyHandler = null
  }
  linkContextMenu = null
}

function openLinkContextMenu(
  anchor: HTMLAnchorElement,
  clientX: number,
  clientY: number,
) {
  const href = resolveAnchorHref(anchor)
  if (!href) return

  const label = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim() || href
  const pageId =
    anchor.getAttribute('data-page-link')?.trim() ||
    tryResolvePageIdFromHref(href) ||
    null

  // Select the whole link so Edit / Remove apply to the full mark.
  const blockEl = anchor.closest('[data-block-id]')
  const blockId = blockEl?.getAttribute('data-block-id') ?? null
  try {
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(anchor)
    sel?.removeAllRanges()
    sel?.addRange(range)
  } catch {
    // ignore selection failures
  }
  if (blockId) {
    focusedBlockId = blockId
    const offsets = itemRefs.get(blockId)?.getSelection()
    if (offsets && offsets.start !== offsets.end) {
      // keep native selection; bubble will recompute on edit
    }
  }

  if (linkContextMenuKeyHandler) {
    window.removeEventListener('keydown', linkContextMenuKeyHandler, true)
  }

  // Prefer below the link itself (not the raw cursor), so it doesn't cover the text.
  const linkRect = anchor.getBoundingClientRect()
  const pad = 8
  const gap = 6
  const estW = 240
  const estH = 230
  const vw = window.innerWidth
  const vh = window.innerHeight

  let x = linkRect.left
  // Keep left-aligned to the link; fall back toward cursor if link is tiny.
  if (linkRect.width < 8) x = clientX
  x = Math.max(pad, Math.min(x, vw - estW - pad))

  // Default: open below the link.
  let y = linkRect.bottom + gap
  if (y + estH > vh - pad) {
    // Flip above when there isn't enough room under the link.
    y = linkRect.top - estH - gap
  }
  if (y < pad) y = pad
  if (y + estH > vh - pad) y = Math.max(pad, vh - estH - pad)

  linkContextMenu = { x, y, href, label, pageId, blockId }
  linkContextMenuKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeLinkContextMenu()
    }
  }
  window.addEventListener('keydown', linkContextMenuKeyHandler, true)

  // After paint, re-clamp using the real menu size.
  void tick().then(() => {
    requestAnimationFrame(() => {
      const menu = document.querySelector('.be-link-context-menu') as HTMLElement | null
      if (!menu || !linkContextMenu) return
      const box = menu.getBoundingClientRect()
      let nx = linkContextMenu.x
      let ny = linkContextMenu.y
      const lr = linkRect

      nx = Math.max(pad, Math.min(lr.left, vw - box.width - pad))
      // Prefer below the link.
      ny = lr.bottom + gap
      if (ny + box.height > vh - pad) {
        ny = lr.top - box.height - gap
      }
      ny = Math.max(pad, Math.min(ny, vh - box.height - pad))

      if (nx !== linkContextMenu.x || ny !== linkContextMenu.y) {
        linkContextMenu = { ...linkContextMenu, x: nx, y: ny }
      }
    })
  })
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      return true
    } catch {
      return false
    }
  }
}

async function onLinkContextCopyLink() {
  const menu = linkContextMenu
  if (!menu) return
  await copyTextToClipboard(menu.href)
  closeLinkContextMenu()
}

async function onLinkContextCopyText() {
  const menu = linkContextMenu
  if (!menu) return
  await copyTextToClipboard(menu.label)
  closeLinkContextMenu()
}

function onLinkContextOpen() {
  const menu = linkContextMenu
  if (!menu) return
  closeLinkContextMenu()
  if (menu.pageId) {
    onPageBlockNavigate(menu.pageId)
    return
  }
  if (isExternalLookingHref(menu.href)) {
    openExternalLinkModal(menu.href)
    return
  }
  // Unresolved local path — still show target.
  openExternalLinkModal(menu.href)
}

async function onLinkContextEdit() {
  const menu = linkContextMenu
  if (!menu || editorProps.readonly || !editorProps.showBubbleToolbar) {
    closeLinkContextMenu()
    return
  }
  const href = menu.href
  const blockId = menu.blockId
  closeLinkContextMenu()

  // Reselect the link mark range from model when possible.
  if (blockId) {
    const block = byId(blockId)
    const offsets = itemRefs.get(blockId)?.getSelection()
    if (block && offsets && offsets.start !== offsets.end) {
      const range = { start: offsets.start, end: offsets.end }
      itemRefs.get(blockId)?.setSelection(range.start, range.end)
      await tick()
      let rect = getSelectionClientRect()
      if (!rect) {
        const blockEl = rootEl?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
        rect = blockEl?.getBoundingClientRect() ?? null
      }
      if (rect && isTextBlock(block.type)) {
        bubble = computeBubble(block, range, rect)
        await tick()
        if (!bubbleToolbarRef) await tick()
        bubbleToolbarRef?.openLinkEditor(href)
        return
      }
    }
  }

  // Fallback: use live selection + open bubble.
  await tick()
  const target = getTextCommentTarget()
  if (target) {
    const block = byId(target.blockId)
    if (block && isTextBlock(block.type)) {
      const range = { start: target.start, end: target.end }
      let rect = getSelectionClientRect()
      if (!rect) {
        const blockEl = rootEl?.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`)
        rect = blockEl?.getBoundingClientRect() ?? null
      }
      if (rect) {
        bubble = computeBubble(block, range, rect)
        await tick()
        bubbleToolbarRef?.openLinkEditor(href)
      }
    }
  }
}

async function onLinkContextRemove() {
  const menu = linkContextMenu
  if (!menu || editorProps.readonly) {
    closeLinkContextMenu()
    return
  }
  const blockId = menu.blockId
  closeLinkContextMenu()
  // Keep the full-link selection, then strip the link mark.
  if (blockId) {
    focusedBlockId = blockId
    await tick()
  }
  applyToolbarMark('link', null)
}

/** Activate an in-editor link: navigate internal pages or confirm external open. */
function activateEditorLink(anchor: HTMLAnchorElement, event?: Event): boolean {
  const href = resolveAnchorHref(anchor)
  if (!href) return false

  event?.preventDefault()
  event?.stopPropagation()
  if (typeof (event as MouseEvent | undefined)?.stopImmediatePropagation === 'function') {
    ;(event as MouseEvent).stopImmediatePropagation()
  }
  linkActivationGuardUntil = performance.now() + 400

  // Internal page → navigate in-app (relative .md / page: / bound paths).
  const pageId =
    anchor.getAttribute('data-page-link')?.trim() ||
    tryResolvePageIdFromHref(href) ||
    null
  if (pageId) {
    closeExternalLinkModal()
    onPageBlockNavigate(pageId)
    return true
  }

  // External URL → confirm modal.
  if (isExternalLookingHref(href)) {
    openExternalLinkModal(href)
    return true
  }

  // Relative / local path that did not resolve to a page — still show the target
  // so the click is never a silent no-op (missing file, unbound folder, etc.).
  openExternalLinkModal(href)
  return true
}

function onEditorClick(event: MouseEvent) {
  if (performance.now() < linkActivationGuardUntil) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (linkContextMenu) {
    const t = eventTargetElement(event)
    if (!t?.closest('.be-link-context-menu')) {
      closeLinkContextMenu()
    }
  }
  const anchor = findLinkAnchor(eventTargetElement(event))
  if (!anchor) return
  activateEditorLink(anchor, event)
}

/** Handle links on pointerdown so text-drag selection cannot swallow the click. */
function onEditorLinkPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  if (linkContextMenu) {
    const t = eventTargetElement(event)
    if (!t?.closest('.be-link-context-menu')) {
      closeLinkContextMenu()
    }
  }
  const anchor = findLinkAnchor(eventTargetElement(event))
  if (!anchor) return
  activateEditorLink(anchor, event)
}

/** Right-click on a link → custom link menu (not the browser default). */
function onEditorContextMenu(event: MouseEvent) {
  const anchor = findLinkAnchor(eventTargetElement(event))
  if (!anchor || !rootEl?.contains(anchor)) {
    if (linkContextMenu) closeLinkContextMenu()
    return
  }
  event.preventDefault()
  event.stopPropagation()
  closeExternalLinkModal()
  openLinkContextMenu(anchor, event.clientX, event.clientY)
}

// ─── Markdown shortcuts ───────────────────────────────────────────────────────

const MD_PATTERNS: Array<{ prefix: string; type: BlockType }> = [
  // Longest heading prefixes first so ###### matches before #.
  { prefix: '###### ', type: 'heading_6' },
  { prefix: '##### ', type: 'heading_5' },
  { prefix: '#### ', type: 'heading_4' },
  { prefix: '### ', type: 'heading_3' },
  { prefix: '## ', type: 'heading_2' },
  { prefix: '# ', type: 'heading_1' },
  { prefix: '- ', type: 'bulleted_list_item' },
  { prefix: '* ', type: 'bulleted_list_item' },
  // Western "1. " is handled by NUMBERED_LIST_PREFIX (also Persian/Arabic digits).
  { prefix: '[] ', type: 'to_do' },
  { prefix: '[ ] ', type: 'to_do' },
  { prefix: '> ', type: 'toggle' },
]

/** `1. ` / `12. ` and Persian/Arabic-Indic `۱. ` / `١٢. ` → numbered list. */
const NUMBERED_LIST_PREFIX = /^([0-9\u0660-\u0669\u06F0-\u06F9]+)\.\s/

function tryMarkdownShortcut(block: Block, spans: InlineSpan[], caret: number | null): boolean {
  if (!isTextBlock(block.type) || caret === null) {
    return false
  }

  const text = spansToText(spans)

  if (text === '```' && caret === 3) {
    const defaults = makeBlock('code')
    block.type = 'code'
    block.content = []
    block.props = propsKeepingNest(block, defaults.props)
    pushHistory(true)
    focusBlock(block.id, 'start')

    return true
  }

  if (text === '---' && caret === 3) {
    const nestIndent = blockIndent(block)
    block.type = 'divider'
    block.content = []
    block.props = propsKeepingNest(block, {})
    const idx = blocks.indexOf(block)
    const nb = makeBlock('paragraph', { props: blockPropsWithIndent(nestIndent) })
    blocks.splice(idx + 1, 0, nb)
    pushHistory(true)
    focusBlock(nb.id, 'start')

    return true
  }

  // Numbered list: Western or Eastern Arabic / Persian digits + ". "
  const numbered = text.match(NUMBERED_LIST_PREFIX)
  if (numbered && caret === numbered[0].length) {
    const defaults = makeBlock('numbered_list_item')
    block.type = 'numbered_list_item'
    block.content = deleteRangeInSpans(spans, 0, numbered[0].length)
    block.props = propsKeepingNest(block, defaults.props)
    pushHistory(true)
    focusBlock(block.id, 'start')
    return true
  }

  for (const { prefix, type } of MD_PATTERNS) {
    if (caret === prefix.length && text.startsWith(prefix)) {
      const defaults = makeBlock(type)
      block.type = type
      block.content = deleteRangeInSpans(spans, 0, prefix.length)
      block.props = propsKeepingNest(block, defaults.props)
      if (type === 'toggle') {
        block.props = { ...block.props, collapsed: false }
        syncTogglePlaceholder(block, { history: false })
      }
      pushHistory(true)
      focusBlock(block.id, 'start')

      return true
    }
  }

  return false
}

/** Convert `text` → inline code when the closing backtick is typed. */
function tryInlineMarkdownShortcut(block: Block, spans: InlineSpan[], caret: number | null): boolean {
  if (!isTextBlock(block.type) || caret === null || caret < 2) {
    return false
  }

  const text = spansToText(spans)
  if (text[caret - 1] !== '`') {
    return false
  }

  const close = caret - 1
  let open = -1
  for (let i = close - 1; i >= 0; i--) {
    if (text[i] === '`') {
      open = i
      break
    }
  }
  if (open < 0) {
    return false
  }

  const inner = text.slice(open + 1, close)
  if (!inner || inner.includes('\n') || inner.includes('`')) {
    return false
  }

  let next = deleteRangeInSpans(spans, close, close + 1)
  next = deleteRangeInSpans(next, open, open + 1)
  next = applyMarkToRange(next, open, open + inner.length, 'code', true)

  block.content = next
  contentRevision++
  pushHistory(true)

  const caretAfter = open + inner.length
  syncBlockDom(block.id, { start: caretAfter, end: caretAfter })
  void tick().then(() => focusBlock(block.id, caretAfter))

  return true
}

// ─── Text events ──────────────────────────────────────────────────────────────

function handleInput(block: Block, spans: InlineSpan[], caret: number | null) {
  if (editorProps.readonly || isBlockLocked(block.id)) {
return
}

  block.content = spans

  if (isTextBlock(block.type)) {
    // Always re-detect from the first strong character in the current text.
    // Previously we locked dir after the first detection (e.g. Farsi → rtl),
    // so clearing the line and typing English stayed rtl forever.
    syncBlockDirFromContent(block, spans)
  }

  if (tryMarkdownShortcut(block, spans, caret)) {
    closeSlash()
    closeEmoji()

    return
  }

  if (tryInlineMarkdownShortcut(block, spans, caret)) {
    closeSlash()
    closeEmoji()

    return
  }

  updateSlash(block, spans, caret)
  updateEmoji(block, spans, caret)
  pushHistory()
}

/** Keep block dir in sync with leading strong letters (Farsi/Arabic → rtl, English → ltr). */
function syncBlockDirFromContent(block: Block, spans: InlineSpan[]) {
  if (block.props.dirManual) {
    const text = spansToText(spans)
    if (text.trim()) return
    delete block.props.dirManual
    delete block.props.dir
    contentRevision++
    // Dir inheritance may change empty lines below — refresh tree rarely.
    touchBlocks()
    return
  }

  const text = spansToText(spans)
  if (!text.trim()) {
    if (block.props.dir !== undefined && block.props.dir !== 'auto') {
      delete block.props.dir
      contentRevision++
      touchBlocks()
    }
    return
  }

  const detected = detectDir(text)
  if (block.props.dir !== detected) {
    block.props.dir = detected
    contentRevision++
    // Only rebuild direction map when language direction actually flips.
    touchBlocks()
  }
}

/**
 * Indent for a new block continuing after `block`. If `block` lives inside a
 * toggle, never drop below the toggle body indent (keeps Enter inside collapse).
 */
function continuationIndent(block: Block, idx: number): number {
  let indent = blockIndent(block)
  const parentIdx = findContainingToggleIndex(blocks, idx)
  if (parentIdx !== null) {
    const minBody = blockIndent(blocks[parentIdx]) + 1
    indent = Math.max(indent, minBody)
  }
  return indent
}

/**
 * block leave: Enter on an empty line inside a toggle leaves the collapse
 * only when that empty line is the **last** body block (nothing else below it
 * still inside the toggle). Mid-body empty lines stay inside.
 */
function exitToggleBody(_block: Block, idx: number): boolean {
  if (!isDirectToggleBodyBlock(blocks, idx)) {
    return false
  }

  // Content still below inside the same toggle → do not leave.
  if (!isLastToggleDescendant(blocks, idx)) {
    return false
  }

  const parentIdx = findContainingToggleIndex(blocks, idx)
  if (parentIdx === null) {
    return false
  }

  const parent = blocks[parentIdx]
  const parentIndent = blockIndent(parent)

  const [moved] = blocks.splice(idx, 1)
  const descendants = toggleDescendantCount(blocks, parentIdx)
  const insertAt = parentIdx + 1 + descendants

  const props = { ...moved.props }
  if (parentIndent > 0) {
    props.indent = parentIndent
  } else {
    delete props.indent
  }
  moved.props = props
  moved.type = 'paragraph'
  moved.content = []

  blocks.splice(insertAt, 0, moved)
  // Keep an empty body slot inside the toggle (block editor empty state).
  syncTogglePlaceholder(parent, { history: false })
  pushHistory(true)
  focusBlock(moved.id, 'start')
  return true
}

/** Enter on empty mid-toggle body: insert another empty line still inside. */
function continueEmptyInsideToggle(block: Block, idx: number): boolean {
  if (!isDirectToggleBodyBlock(blocks, idx)) {
    return false
  }
  // Only when something remains below inside the toggle.
  if (isLastToggleDescendant(blocks, idx)) {
    return false
  }

  const contIndent = continuationIndent(block, idx)
  const nb = makeBlock('paragraph', {
    content: [],
    props: blockPropsWithIndent(contIndent),
  })
  blocks.splice(idx + 1, 0, nb)
  pushHistory(true)
  focusBlock(nb.id, 'start')
  return true
}

/**
 * Enter on toggle title → expand and put caret in the body
 * (first empty body paragraph, or a new one).
 */
function enterToggleBody(toggle: Block, idx: number): void {
  expandToggleAnchor(toggle)
  toggle.props = { ...toggle.props, collapsed: false }

  const bodyIndent = blockIndent(toggle) + 1

  // Prefer the first existing direct body child if it is an empty paragraph.
  const first = blocks[idx + 1]
  if (
    first
    && blockIndent(first) === bodyIndent
    && first.type === 'paragraph'
    && spansToText(first.content) === ''
  ) {
    touchBlocks()
    pushHistory(true)
    void tick().then(() => focusBlock(first.id, 'start'))
    return
  }

  // Ensure at least one body child, then focus the first body paragraph.
  if (toggleDescendantCount(blocks, idx) === 0) {
    const nb = makeBlock('paragraph', {
      content: [],
      props: blockPropsWithIndent(bodyIndent),
    })
    blocks.splice(idx + 1, 0, nb)
    touchBlocks()
    pushHistory(true)
    void tick().then(() => focusBlock(nb.id, 'start'))
    return
  }

  // Title Enter with existing body content: insert a fresh empty line at the
  // top of the body (block editor places the caret inside to type).
  const nb = makeBlock('paragraph', {
    content: [],
    props: blockPropsWithIndent(bodyIndent),
  })
  blocks.splice(idx + 1, 0, nb)
  touchBlocks()
  pushHistory(true)
  void tick().then(() => focusBlock(nb.id, 'start'))
}

function handleEnter(block: Block, offsets: { start: number; end: number }) {
  if (isSlashMenuActiveAt(block.id, offsets.start)) {
    slashMenuRef?.confirm()
    return
  }

  // If the emoji picker is open for this block, Enter always inserts (never newline).
  if (emojiState?.blockId === block.id) {
    if (emojiMenuRef) {
      emojiMenuRef.confirm()
    } else if (emojiState) {
      // Menu still mounting — insert top search hit directly.
      const hits = searchEmojis(emojiState.query, 1)
      if (hits[0]) onEmojiSelect(hits[0])
      else closeEmoji()
    }
    return
  }

  if (slashState) {
    closeSlash()
  }
  if (emojiState) {
    closeEmoji()
  }

  const idx = blocks.indexOf(block)
  if (idx === -1) {
    return
  }

  const text = spansToText(block.content)
  const listLike = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout']
  const indent = block.props.indent ?? 0

  // ── Empty block ──────────────────────────────────────────────────────────
  if (text === '') {
    // Empty + last line of a toggle body → leave the collapse.
    if (indent > 0 && exitToggleBody(block, idx)) {
      return
    }

    // Empty mid-toggle (more body content below) → stay inside, new empty line.
    if (indent > 0 && continueEmptyInsideToggle(block, idx)) {
      return
    }

    // Empty indented block (deeper nest / list): outdent one level.
    // Skip outdent when still inside a toggle mid-body (handled above).
    if (indent > 0 && !isDirectToggleBodyBlock(blocks, idx)) {
      const nextIndent = indent - 1
      const props = { ...block.props }
      if (nextIndent > 0) {
        props.indent = nextIndent
      } else {
        delete props.indent
      }
      block.props = props
      syncAllTogglePlaceholders({ history: false })
      pushHistory(true)
      focusBlock(block.id, 'start')
      return
    }

    // Empty toggle title → go into body (never destroy the toggle).
    if (block.type === 'toggle') {
      enterToggleBody(block, idx)
      return
    }

    // Empty list-like at root → convert to paragraph.
    if (listLike.includes(block.type)) {
      block.type = 'paragraph'
      pushHistory(true)
      focusBlock(block.id, 'start')
      return
    }
  }

  // ── Split at caret ───────────────────────────────────────────────────────
  const [before, rest] = splitSpansAt(block.content, offsets.start)
  const [, after] = splitSpansAt(rest, offsets.end - offsets.start)

  // Toggle title
  if (block.type === 'toggle') {
    block.content = before
    // Mid-title split with trailing text → sibling toggle (same level).
    if (spansToText(after).length > 0) {
      const sibling = makeBlock('toggle', {
        content: after,
        props: blockPropsWithIndent(indent),
      })
      blocks.splice(idx + 1, 0, sibling)
      syncTogglePlaceholder(sibling, { history: false })
      pushHistory(true)
      focusBlock(sibling.id, 'start')
      return
    }
    // Enter at end of title → body.
    enterToggleBody(block, idx)
    return
  }

  // Non-toggle: continue / split. Stay inside a parent toggle via indent.
  block.content = before

  const keepType = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout']
  let newType: BlockType = 'paragraph'

  if (keepType.includes(block.type)) {
    newType = block.type
  } else if (block.type.startsWith('heading') && spansToText(after).length > 0) {
    newType = block.type
  }

  const contIndent = continuationIndent(block, idx)
  const newProps: Block['props'] = {}
  if (contIndent > 0) {
    newProps.indent = contIndent
  }
  if (block.props.dir && block.props.dir !== 'auto') {
    newProps.dir = block.props.dir
  }
  if (newType === 'to_do') {
    newProps.checked = false
  }

  const nb = makeBlock(newType, { content: after, props: newProps })
  blocks.splice(idx + 1, 0, nb)
  pushHistory(true)
  focusBlock(nb.id, 'start')
}

/** Minimum indent allowed for a block (toggle body cannot lose its nest indent). */
function minAllowedIndent(_block: Block, idx: number): number {
  const parentIdx = findContainingToggleIndex(blocks, idx)
  if (parentIdx === null) return 0
  return blockIndent(blocks[parentIdx]) + 1
}

function handleBackspaceStart(block: Block) {
  const idx = blocks.indexOf(block)

  if (idx === -1) {
    return
  }

  if (isTextBlock(block.type) && block.type !== 'paragraph') {
    block.type = 'paragraph'
    pushHistory(true)
    focusBlock(block.id, 'start')

    return
  }

  const current = block.props.indent ?? 0
  const minIndent = minAllowedIndent(block, idx)

  // Outdent only when still above the floor (never strip required toggle body indent).
  if (current > minIndent) {
    const nextIndent = current - 1
    const props = { ...block.props }
    if (nextIndent <= 0) {
      delete props.indent
    } else {
      props.indent = nextIndent
    }
    block.props = props
    syncAllTogglePlaceholders({ history: false })
    pushHistory(true)
    focusBlock(block.id, 'start')

    return
  }

  // At toggle body floor (or root): merge with previous / focus previous — keep indent.
  const prev = neighborBlock(block.id, -1)

  if (!prev) {
return
}

  if (isTextBlock(prev.type)) {
    const prevLen = spansToText(prev.content).length
    prev.content = normalizeSpans([...prev.content, ...block.content])
    afterRemovedBlockAt(idx, { history: false })
    blocks.splice(idx, 1)
    pushHistory(true)
    focusBlock(prev.id, prevLen)
  } else if (prev.type === 'divider') {
    blocks.splice(blocks.indexOf(prev), 1)
    pushHistory(true)
    focusBlock(block.id, 'start')
  } else if (spansToText(block.content) === '') {
    afterRemovedBlockAt(idx, { history: false })
    blocks.splice(idx, 1)
    pushHistory(true)

    if (prev.type === 'code') {
focusBlock(prev.id, 'end')
} else {
selectBlock(prev.id)
}
  } else {
    if (prev.type === 'code') {
focusBlock(prev.id, 'end')
} else {
selectBlock(prev.id)
}
  }
}

function handleDeleteEnd(block: Block) {
  const next = neighborBlock(block.id, 1)

  if (!next) {
return
}

  if (isTextBlock(next.type)) {
    const len = spansToText(block.content).length
    block.content = normalizeSpans([...block.content, ...next.content])
    const nextIdx = blocks.indexOf(next)
    afterRemovedBlockAt(nextIdx, { history: false })
    blocks.splice(nextIdx, 1)
    pushHistory(true)
    focusBlock(block.id, len)
  } else if (next.type === 'divider') {
    blocks.splice(blocks.indexOf(next), 1)
    pushHistory(true)
  }
}

function handleTab(block: Block, shift: boolean) {
  if (!shift && isSlashMenuActiveAt(block.id, itemRefs.get(block.id)?.getSelection()?.start)) {
    slashMenuRef?.confirm()

    return
  }

  const idx = blocks.indexOf(block)
  const current = block.props.indent ?? 0
  const minIndent = idx !== -1 ? minAllowedIndent(block, idx) : 0
  const next = Math.max(minIndent, Math.min(6, current + (shift ? -1 : 1)))

  if (next === current) {
    return
  }

  const props = { ...block.props }
  if (next <= 0) {
    delete props.indent
  } else {
    props.indent = next
  }
  block.props = props

  pushHistory(true)
}

function handleArrow(block: Block, dir: 1 | -1) {
  const neighbor = neighborBlock(block.id, dir)

  if (!neighbor) {
    // ↓ from the last block with nowhere to go — create an empty paragraph
    // so the caret can leave code / trailing inline-code / the final line.
    if (dir === 1) {
      addBelow(block)
    }
    return
  }

  if (isTextBlock(neighbor.type)) {
    focusBlock(neighbor.id, dir === 1 ? 'start' : 'end')
  } else if (neighbor.type === 'code') {
    focusBlock(neighbor.id, dir === 1 ? 'start' : 'end')
  } else {
    selectBlock(neighbor.id)
  }
}

function resolveFormatRange(
  block: Block,
  offsets?: { start: number; end: number },
): { start: number; end: number } | null {
  if (offsets && offsets.end > offsets.start) {
    return offsets
  }

  if (bubble?.blockId === block.id && bubble.range.end > bubble.range.start) {
    return bubble.range
  }

  const sel = itemRefs.get(block.id)?.getSelection()
  if (!sel || sel.start === sel.end) {
    return null
  }

  return sel
}

function refreshBubbleRange(block: Block, range: { start: number; end: number }) {
  if (!bubble || bubble.blockId !== block.id) {
    return
  }

  const marks: Partial<Record<MarkName, boolean>> = {}
  for (const m of ['bold', 'italic', 'underline', 'strikethrough', 'code'] as MarkName[]) {
    marks[m] = rangeHasMark(block.content, range.start, range.end, m)
  }

  const slice = sliceSpans(block.content, range.start, range.end)
  const allLinked = slice.length > 0 && slice.every((span) => span.marks?.link)
  const currentLink = allLinked ? (slice[0].marks?.link ?? null) : null

  bubble = {
    ...bubble,
    range,
    activeMarks: marks,
    currentLink,
    currentColor: rangeMarkValue(block.content, range.start, range.end, 'color'),
    currentHighlight: rangeMarkValue(block.content, range.start, range.end, 'highlight'),
  }
}

function handleFormat(block: Block, mark: MarkName, offsets?: { start: number; end: number }) {
  focusedBlockId = block.id

  if (hasActiveManagedSelection() && textRangeSelection) {
    const has = rangeHasMarkAcrossSegments(
      textRangeSelection,
      blocks,
      visibleBlocks,
      mark,
    )
    applyMarkToTextRange(
      blocks,
      textRangeSelection,
      visibleBlocks,
      mark,
      has ? null : true,
    )
    pushHistory(true)
    contentRevision++
    const segments = getTextRangeSegments(
      textRangeSelection,
      blocks,
      visibleBlocks,
    )
    for (const segment of segments) {
      syncBlockDom(segment.blockId, { start: segment.start, end: segment.end })
    }

    return
  }

  const range = resolveFormatRange(block, offsets)
  if (!range) {
    return
  }

  const has = rangeHasMark(block.content, range.start, range.end, mark)
  block.content = applyMarkToRange(block.content, range.start, range.end, mark, has ? null : true)
  pushHistory(true)
  contentRevision++
  refreshBubbleRange(block, range)
  syncBlockDom(block.id, range)
}

// ─── Paste ────────────────────────────────────────────────────────────────────

function insertSpansAt(content: InlineSpan[], offset: number, inserted: InlineSpan[]): InlineSpan[] {
  const [before, after] = splitSpansAt(content, offset)

  return normalizeSpans([...before, ...inserted, ...after])
}

async function imageUrlFromFile(file: File): Promise<string> {
  if (editorProps.upload) {
    return editorProps.upload(file)
  }
  return fileToDataUrl(file)
}

function isEmptyImageBlock(block: Block): boolean {
  return block.type === 'image' && !block.props.url?.trim()
}

/**
 * Paste can hit both the capture handler and the text-block `pasted` path in the
 * same gesture. Only the first caller inserts images.
 */
let imagePasteInFlight = false

async function insertImagesAfterBlock(anchorBlock: Block, imageFiles: File[]) {
  const idx = blocks.indexOf(anchorBlock)
  if (idx === -1 || imageFiles.length === 0) return false
  if (imagePasteInFlight) return false

  imagePasteInFlight = true
  try {
    expandToggleAnchor(anchorBlock)
    const insertIndent = insertIndentForAnchor(anchorBlock)
    const imageProps = insertIndent > 0 ? { indent: insertIndent } : {}

    // One entry per logical image (already deduped by getClipboardImageFiles).
    const remaining = [...imageFiles]
    let focusId = anchorBlock.id
    let lastFilledIdx: number | null = null

    const fillCandidates = [anchorBlock, blocks[idx + 1]].filter(Boolean) as Block[]

    for (const candidate of fillCandidates) {
      if (remaining.length === 0) break

      const candidateIdx = blocks.indexOf(candidate)
      if (candidateIdx === -1 || !isEmptyImageBlock(candidate)) continue

      const url = await imageUrlFromFile(remaining.shift()!)
      // Avoid pushHistory-per-fill; commit once at the end.
      candidate.props = { ...candidate.props, url }
      focusId = candidate.id
      lastFilledIdx = candidateIdx
    }

    if (remaining.length > 0) {
      const insertAt = lastFilledIdx !== null ? lastFilledIdx + 1 : idx + 1
      const created: Block[] = []

      for (const file of remaining) {
        const url = await imageUrlFromFile(file)
        created.push(makeBlock('image', { props: { url, ...imageProps } }))
      }

      blocks.splice(insertAt, 0, ...created)
      focusId = created[created.length - 1]?.id ?? focusId
    }

    touchBlocks()
    pushHistory(true)
    selectBlock(focusId)
    return true
  } finally {
    // Unlock after the full paste event chain (capture + target) has settled.
    queueMicrotask(() => {
      imagePasteInFlight = false
    })
  }
}

function pasteAnchorBlock(): Block | null {
  if (focusedBlockId) {
    return byId(focusedBlockId) ?? null
  }
  if (selectedBlockId) {
    return byId(selectedBlockId) ?? null
  }
  return blocks[blocks.length - 1] ?? null
}

async function handlePasted(
  block: Block,
  payload: { html: string; text: string; files: File[]; offsets: { start: number; end: number } },
) {
  const idx = blocks.indexOf(block)

  if (idx === -1) {
    return
  }

  // Image files — capture-phase onPaste may already have handled this paste.
  const imageFiles = payload.files.filter(f => f.type.startsWith('image/'))

  if (imageFiles.length > 0) {
    await insertImagesAfterBlock(block, imageFiles)
    return
  }

  let content = block.content

  if (payload.offsets.end > payload.offsets.start) {
    content = deleteRangeInSpans(content, payload.offsets.start, payload.offsets.end)
  }

  const at = payload.offsets.start

  let pastedBlocks = payload.html && payload.html.includes('<') ? htmlToBlocks(payload.html) : []
  // Prefer structured markdown over flat HTML paragraph dumps of the same source.
  if (payload.text && looksLikeMarkdown(payload.text)) {
    const mdBlocks = markdownToBlocks(payload.text)
    if (mdBlocks.length > 0) {
      const htmlIsFlat = pastedBlocks.length === 0
        || pastedBlocks.every((b) => b.type === 'paragraph')
      const mdIsRich = mdBlocks.some((b) => b.type !== 'paragraph')
        || mdBlocks.some((b) => b.content.some((s) => s.marks && Object.keys(s.marks).length > 0))
      if (pastedBlocks.length === 0 || (htmlIsFlat && mdIsRich)) {
        pastedBlocks = mdBlocks
      }
    }
  }
  const htmlImageBlocks = pastedBlocks.filter((entry) => entry.type === 'image')

  // If this paste also carried image *files*, they were handled above. Never also
  // materialize <img> tags from the HTML alternative (that created duplicate blocks).
  if (htmlImageBlocks.length > 0 && payload.files.some(f => f.type.startsWith('image/'))) {
    return
  }

  if (pastedBlocks.length === 0) {
    const text = payload.text

    if (!text) {
      return
    }

    const lines = text.split(/\r?\n/)

    if (lines.length === 1 && isEmbeddableImageUrl(text)) {
      if (imagePasteInFlight) return
      expandToggleAnchor(block)
      blocks.splice(
        idx + 1,
        0,
        ...withInsertIndent(block, [makeBlock('image', { props: { url: text.trim() } })]),
      )
      pushHistory(true)
      return
    }

    // Markdown → structured blocks (headings, lists, code, etc.).
    if (looksLikeMarkdown(text)) {
      const mdBlocks = markdownToBlocks(text)
      if (mdBlocks.length > 0) {
        const [first, ...others] = mdBlocks
        const emptyHost = isTextBlock(block.type) && spansToText(content).length === 0

        if (emptyHost) {
          // Replace the empty host block with the first markdown block.
          const defaults = makeBlock(first.type, {
            content: first.content,
            props: { ...first.props, ...blockPropsWithIndent(insertIndentForAnchor(block)) },
          })
          block.type = defaults.type
          block.content = defaults.content
          block.props = defaults.props
          if (others.length > 0) {
            expandToggleAnchor(block)
            const nested = withInsertIndent(block, others)
            blocks.splice(idx + 1, 0, ...nested)
            pushHistory(true)
            focusAfterPaste(nested)
          } else {
            pushHistory(true)
            focusAfterPaste([block])
          }
          return
        }

        if (isTextBlock(first.type) && isTextBlock(block.type)) {
          block.content = insertSpansAt(content, at, first.content)
          if (others.length > 0) {
            expandToggleAnchor(block)
            const nested = withInsertIndent(block, others)
            blocks.splice(idx + 1, 0, ...nested)
            pushHistory(true)
            focusAfterPaste(nested)
          } else {
            pushHistory(true)
            focusBlock(block.id, at + spansToText(first.content).length)
          }
          return
        }

        expandToggleAnchor(block)
        const nested = withInsertIndent(block, mdBlocks)
        blocks.splice(idx + 1, 0, ...nested)
        pushHistory(true)
        focusAfterPaste(nested)
        return
      }
    }

    if (lines.length === 1 || !isTextBlock(block.type)) {
      block.content = insertSpansAt(content, at, [{ text }])
      pushHistory(true)
      focusBlock(block.id, at + text.length)
    } else {
      block.content = insertSpansAt(content, at, [{ text: lines[0] }])
      const nestProps = blockPropsWithIndent(insertIndentForAnchor(block))
      const newOnes = lines.slice(1).map(line => makeBlock('paragraph', {
        content: line ? [{ text: line }] : [],
        props: nestProps,
      }))
      blocks.splice(idx + 1, 0, ...newOnes)
      pushHistory(true)
      const last = newOnes[newOnes.length - 1]
      focusBlock(last.id, 'end')
    }

    return
  }

  if (htmlImageBlocks.length > 0 && pastedBlocks.every((entry) => entry.type === 'image')) {
    if (imagePasteInFlight) return
    // Deduplicate identical <img src> entries (some apps paste the same image twice in HTML).
    const seenSrc = new Set<string>()
    const uniqueImages = htmlImageBlocks.filter((entry) => {
      const src = entry.props.url?.trim() || ''
      if (!src || seenSrc.has(src)) return false
      seenSrc.add(src)
      return true
    })
    if (uniqueImages.length === 0) return

    imagePasteInFlight = true
    try {
      expandToggleAnchor(block)
      const nestedImages = withInsertIndent(block, uniqueImages)
      blocks.splice(idx + 1, 0, ...nestedImages)
      pushHistory(true)
      selectBlock(nestedImages[nestedImages.length - 1].id)
    } finally {
      queueMicrotask(() => {
        imagePasteInFlight = false
      })
    }
    return
  }

  const [first, ...others] = pastedBlocks

  if (first.type === 'paragraph' || spansToText(block.content).length > 0) {
    if (isTextBlock(first.type)) {
      block.content = insertSpansAt(content, at, first.content)
    } else {
      others.unshift(first)
      block.content = content
    }
  } else {
    others.unshift(first)
    block.content = content
  }

  if (others.length > 0) {
    expandToggleAnchor(block)
    const nestedOthers = withInsertIndent(block, others)
    blocks.splice(idx + 1, 0, ...nestedOthers)
    pushHistory(true)
    const last = nestedOthers[nestedOthers.length - 1]

    if (isTextBlock(last.type)) {
focusBlock(last.id, 'end')
}
  } else {
    pushHistory(true)
    focusBlock(block.id, at + spansToText(first.content).length)
  }
}

// ─── Clipboard (multi-block copy / cut / paste) ─────────────────────────────

function getBlocksForClipboard(): Block[] | null {
  // Full-page select (Ctrl+A): copy every selected block, including media.
  if (allVisibleBlocksSelected()) {
    const selected = selectedBlocksInOrder()
    return selected.length > 0 ? selected.map((b) => cloneBlock(b)) : null
  }

  if (hasActiveManagedSelection() && textRangeSelection) {
    const extracted = extractTextRangeAsBlocks(
      textRangeSelection,
      blocks,
      visibleBlocks,
    )

    // Merge any multi-selected non-text outside the text-span extract.
    const fromRange = new Set(extracted.map((b) => b.id))
    const extras = selectedBlocksInOrder().filter(
      (b) => !isTextBlock(b.type) && !fromRange.has(b.id),
    )
    if (extras.length > 0) {
      const merged = [...extracted]
      for (const extra of extras) {
        const live = byId(extra.id) ?? extra
        // Insert extras in document order
        const idx = blocks.findIndex((b) => b.id === live.id)
        let insertAt = merged.length
        for (let i = 0; i < merged.length; i++) {
          const mi = blocks.findIndex((b) => b.id === merged[i].id)
          if (mi > idx) {
            insertAt = i
            break
          }
        }
        merged.splice(insertAt, 0, cloneBlock(live))
      }
      return merged.length > 0 ? merged : null
    }

    return extracted.length > 0 ? extracted : null
  }

  const selected = selectedBlocksInOrder()
  if (selected.length > 0) {
    return selected
  }

  return null
}

function focusAfterPaste(pasted: Block[]) {
  const last = pasted[pasted.length - 1]

  if (!last) {
return
}

  if (isTextBlock(last.type) || last.type === 'code') {
focusBlock(last.id, 'end')
} else {
selectBlock(last.id)
}
}

function insertPastedInTextBlock(block: Block, pasted: Block[], offset: number) {
  const idx = blocks.indexOf(block)

  if (idx === -1) {
    return
  }

  const [before, afterParts] = splitSpansAt(block.content, offset)
  const first = pasted[0]
  const rest = pasted.slice(1)

  if (!first) {
    return
  }

  if (isTextBlock(first.type)) {
    block.content = normalizeSpans([...before, ...first.content])
    const toInsert = [...rest]

    if (spansToText(afterParts).length > 0) {
      if (rest.length > 0) {
        const last = rest[rest.length - 1]

        if (isTextBlock(last.type)) {
          last.content = normalizeSpans([...last.content, ...afterParts])
        } else {
          toInsert.push(makeBlock('paragraph', {
            content: afterParts,
            props: blockPropsWithIndent(insertIndentForAnchor(block)),
          }))
        }
      } else {
        block.content = normalizeSpans([...block.content, ...afterParts])
      }
    }

    if (toInsert.length > 0) {
      expandToggleAnchor(block)
      blocks.splice(idx + 1, 0, ...withInsertIndent(block, toInsert))
    }
  } else {
    block.content = before
    const trailing = spansToText(afterParts).length > 0
      ? [makeBlock('paragraph', {
        content: afterParts,
        props: blockPropsWithIndent(insertIndentForAnchor(block)),
      })]
      : []
    expandToggleAnchor(block)
    blocks.splice(idx + 1, 0, ...withInsertIndent(block, [...pasted, ...trailing]))
  }
}

function insertBlocksFromClipboard(pasted: Block[]) {
  if (pasted.length === 0) {
return
}

  if (hasActiveManagedSelection() && textRangeSelection) {
    const deleteResult = deleteTextRange(blocks, textRangeSelection, visibleBlocks)

    clearTextRangeSelection()
    ensureNotEmpty()

    if (deleteResult) {
      const block = byId(deleteResult.focusBlockId)

      if (block && isTextBlock(block.type)) {
        insertPastedInTextBlock(block, pasted, deleteResult.focusOffset)
        pushHistory(true)
        focusAfterPaste(pasted)

        return
      }
    }
  }

  if (focusedBlockId) {
    const block = byId(focusedBlockId)

    if (block && isTextBlock(block.type)) {
      const offsets = itemRefs.get(block.id)?.getSelection() ?? { start: 0, end: 0 }
      let offset = offsets.start

      if (offsets.end > offsets.start) {
        block.content = deleteRangeInSpans(block.content, offsets.start, offsets.end)
      } else {
        offset = offsets.start
      }

      insertPastedInTextBlock(block, pasted, offset)
      pushHistory(true)
      focusAfterPaste(pasted)

      return
    }

    if (block) {
      const idx = blocks.indexOf(block)
      expandToggleAnchor(block)
      const nested = withInsertIndent(block, pasted)
      blocks.splice(idx + 1, 0, ...nested)
      pushHistory(true)
      focusAfterPaste(nested)

      return
    }
  }

  const selected = selectedBlocksInOrder()
  if (selected.length > 0) {
    // Replace the current block selection with pasted content (block).
    const firstIdx = blocks.indexOf(selected[0])
    if (firstIdx !== -1) {
      for (const block of [...selected].reverse()) {
        const i = blocks.indexOf(block)
        if (i !== -1) blocks.splice(i, 1)
      }
      const insertAt = Math.min(firstIdx, blocks.length)
      const anchor = blocks[insertAt - 1] ?? blocks[insertAt]
      const nested = anchor
        ? withInsertIndent(anchor, pasted)
        : pasted
      blocks.splice(insertAt, 0, ...nested)
      clearBlockSelection()
      ensureNotEmpty()
      pushHistory(true)
      focusAfterPaste(nested)
      return
    }
  }

  blocks.push(...pasted)
  ensureNotEmpty()
  pushHistory(true)
  focusAfterPaste(pasted)
}

function removeSelectedBlocksBulk() {
  const selected = selectedBlocksInOrder()
  if (selected.length === 0) return

  const firstIdx = blocks.indexOf(selected[0])
  const prev = firstIdx > 0 ? blocks[firstIdx - 1] : null
  const last = selected[selected.length - 1]
  const lastIdx = blocks.indexOf(last)
  const next = lastIdx !== -1 && lastIdx + 1 < blocks.length
    ? blocks[lastIdx + 1]
    : null

  for (const block of [...selected].reverse()) {
    const i = blocks.indexOf(block)
    if (i === -1) continue
    const parentToggleIdx = findContainingToggleIndex(blocks, i)
    blocks.splice(i, 1)
    if (parentToggleIdx !== null) {
      const parent = blocks[parentToggleIdx]
      if (parent?.type === 'toggle') {
        syncTogglePlaceholder(parent, { history: false })
      }
    }
  }

  clearBlockSelection()
  ensureNotEmpty()
  pushHistory(true)

  const target = prev ?? next ?? blocks[0]
  if (target) {
    if (isTextBlock(target.type) || target.type === 'code') {
      focusBlock(target.id, 'end')
    } else {
      selectBlock(target.id)
    }
  }
}

function removeBlocksForCut() {
  if (hasActiveManagedSelection()) {
    deleteManagedTextRange()

    return
  }

  if (selectedBlockIds.length > 0 || selectedBlockId) {
    removeSelectedBlocksBulk()
  }
}

function onCopy(e: ClipboardEvent) {
  if (editorProps.readonly || isNativeInputTarget(e.target)) {
return
}

  const toCopy = getBlocksForClipboard()

  if (!toCopy?.length || !e.clipboardData) {
return
}

  e.preventDefault()
  writeBlocksToClipboardData(e.clipboardData, toCopy)
}

function onCut(e: ClipboardEvent) {
  if (editorProps.readonly || isNativeInputTarget(e.target)) {
return
}

  const toCopy = getBlocksForClipboard()

  if (!toCopy?.length || !e.clipboardData) {
return
}

  e.preventDefault()
  writeBlocksToClipboardData(e.clipboardData, toCopy)
  removeBlocksForCut()
}

async function onPaste(e: ClipboardEvent) {
  if (editorProps.readonly || !e.clipboardData || isNativeInputTarget(e.target)) {
    return
  }

  const nativeBlocks = parseBlocksFromClipboardData(e.clipboardData)

  if (nativeBlocks?.length) {
    e.preventDefault()
    e.stopPropagation()
    insertBlocksFromClipboard(nativeBlocks)

    return
  }

  // Prefer file bitmaps over HTML <img> mirrors of the same paste.
  const imageFiles = getClipboardImageFiles(e.clipboardData)
  if (imageFiles.length > 0) {
    const anchor = pasteAnchorBlock()
    if (anchor) {
      e.preventDefault()
      e.stopPropagation()
      await insertImagesAfterBlock(anchor, imageFiles)
      return
    }
  }

  if (hasActiveManagedSelection() || hasBlockSelection()) {
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    let external = html && html.includes('<') ? htmlToBlocks(html) : []
    if (text && looksLikeMarkdown(text)) {
      const mdBlocks = markdownToBlocks(text)
      if (mdBlocks.length > 0) {
        const htmlIsFlat = external.length === 0
          || external.every((b) => b.type === 'paragraph')
        const mdIsRich = mdBlocks.some((b) => b.type !== 'paragraph')
          || mdBlocks.some((b) => b.content.some((s) => s.marks && Object.keys(s.marks).length > 0))
        if (external.length === 0 || (htmlIsFlat && mdIsRich)) {
          external = mdBlocks
        }
      }
    }

    // Drop pure image HTML when we already decided there were no files — still
    // dedupe identical src attributes before inserting.
    if (external.length > 0) {
      const onlyImages = external.every((b) => b.type === 'image')
      if (onlyImages) {
        const seen = new Set<string>()
        const unique = external.filter((b) => {
          const src = b.props.url?.trim() || ''
          if (!src || seen.has(src)) return false
          seen.add(src)
          return true
        })
        if (unique.length === 0) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        insertBlocksFromClipboard(unique)
        return
      }

      e.preventDefault()
      e.stopPropagation()
      insertBlocksFromClipboard(external)

      return
    }

    if (text) {
      e.preventDefault()
      e.stopPropagation()
      if (looksLikeMarkdown(text)) {
        const mdBlocks = markdownToBlocks(text)
        if (mdBlocks.length > 0) {
          insertBlocksFromClipboard(mdBlocks)
          return
        }
      }
      const lines = text.split(/\r?\n/)
      const lineBlocks = lines.map(line => makeBlock('paragraph', { content: line ? [{ text: line }] : [] }))
      insertBlocksFromClipboard(lineBlocks)
    }
  }
}

// ─── Block utilities (gutter / menu actions) ─────────────────────────────────

function addBelow(block: Block) {
  if (editorProps.readonly) {
return
}

  const idx = blocks.indexOf(block)
  // block editor: + on a toggle always inserts a nested child inside it.
  if (block.type === 'toggle') {
    expandToggleAnchor(block)
  }
  const indent = insertIndentForAnchor(block)
  const nb = makeBlock('paragraph', { props: blockPropsWithIndent(indent) })
  blocks.splice(idx + 1, 0, nb)
  pushHistory(true)
  focusBlock(nb.id, 'start')
}

function duplicateBlock(block: Block) {
  if (editorProps.readonly) {
return
}

  const idx = blocks.indexOf(block)
  blocks.splice(idx + 1, 0, cloneBlock(block))
  pushHistory(true)
}

function removeBlock(block: Block) {
  if (editorProps.readonly) {
return
}

  const idx = blocks.indexOf(block)

  if (idx === -1) {
return
}

  const parentToggleIdx = findContainingToggleIndex(blocks, idx)
  const prev = neighborBlock(block.id, -1)
  const next = neighborBlock(block.id, 1)
  blocks.splice(idx, 1)
  ensureNotEmpty()

  if (parentToggleIdx !== null) {
    syncTogglePlaceholder(blocks[parentToggleIdx], { history: false })
  }

  pushHistory(true)
  const target = prev ?? next ?? blocks[0]

  if (target) {
    if (isTextBlock(target.type) || target.type === 'code') {
focusBlock(target.id, 'end')
} else {
selectBlock(target.id)
}
  }

  if (isBlockSelected(block.id)) {
    selectedBlockIds = selectedBlockIds.filter((id) => id !== block.id)
    if (selectedBlockId === block.id) {
      selectedBlockId = selectedBlockIds.length === 1
        ? selectedBlockIds[0]
        : null
    }
  }
}

function patchProps(block: Block, patch: Record<string, unknown>) {
  const idx = blocks.indexOf(block)

  // Replace props object so Vue re-renders (shallow props compare same block ref).
  const nextProps = { ...block.props, ...patch }
  block.props = nextProps

  // New block object reference so shallow parents / child props update immediately
  // (image width, icon, caption, etc. — not only after blur/click-away).
  const live = idx !== -1 ? { ...block, props: nextProps } : block
  if (idx !== -1) {
    blocks[idx] = live
  }

  if (live.type === 'toggle' && patch.collapsed === true) {
    syncTogglePlaceholder(live, { history: false })
  } else if (live.type === 'toggle' && patch.collapsed === false) {
    syncTogglePlaceholder(live, { history: false })
    const toggleIdx = idx !== -1 ? idx : blocks.indexOf(live)
    const child = toggleIdx !== -1 ? blocks[toggleIdx + 1] : undefined

    if (
      child
      && isTextBlock(child.type)
      && spansToText(child.content) === ''
      && blockIndent(child) === blockIndent(live) + 1
    ) {
      void tick().then(() => focusBlock(child.id, 'start'))
    }
  }

  if (live.type === 'page') {
    // Linking a page ref: keep focus so collab sync doesn't drop the block,
    // and do NOT force-reparent existing pages (that broke sidebar hierarchy).
    // New pages already get parentId from createPage(title, currentPageId).
    focusedBlockId = live.id
    emit('focus-block', live.id)
  }

  // Always bump revision — collapse/indent/checked/width must refresh visible tree.
  touchBlocks()
  pushHistory(true)
  contentRevision++
  emit('change')
}

function getTableCellContext(blockId: string) {
  const block = byId(blockId)

  if (!block || block.type !== 'table') {
    return null
  }

  const table = normalizeTableData(block.props.table)
  const focus = focusedTableCell?.blockId === blockId
    ? focusedTableCell
    : tableSelectedCells[0]
      ? { blockId, row: tableSelectedCells[0].row, col: tableSelectedCells[0].col }
      : null

  if (!focus) {
    return null
  }

  const cell = table.rows[focus.row]?.[focus.col]

  if (!cell || cell.hidden) {
    return null
  }

  return { block, table, row: focus.row, col: focus.col, cell }
}


function onTableCellFocus(block: Block, payload: { row: number; col: number; shiftKey: boolean }) {
  focusedBlockId = block.id
  focusedTableCell = { blockId: block.id, row: payload.row, col: payload.col }
  clearBlockSelection()
}

function onTableCellSelectionChange(_block: Block, cells: TableCellCoord[]) {
  tableSelectedCells = cells

  if (cells[0]) {
    focusedTableCell = { blockId: _block.id, row: cells[0].row, col: cells[0].col }
  }
}

function onTableCellInput(
  block: Block,
  payload: { row: number; col: number; content: InlineSpan[]; caret: number | null },
) {
  // Prefer the live model entry (tree props can be a stale object after merges).
  const live = byId(block.id) ?? block
  const table = normalizeTableData(live.props.table)
  const cell = table.rows[payload.row]?.[payload.col]

  if (!cell || cell.hidden) {
    return
  }

  cell.content = payload.content
  // Keep both refs in sync when the tree still holds a detached block object.
  live.props.table = table
  if (block !== live) {
    block.props.table = table
  }
  contentRevision++
  emit('change')
}

function handleTableFormat(
  block: Block,
  payload: { row: number; col: number; mark: MarkName },
) {
  const sel = itemRefs.get(block.id)?.getTableCellSelection?.(payload.row, payload.col)

  if (!sel || sel.start === sel.end) {
    return
  }

  const table = normalizeTableData(block.props.table)
  const cell = table.rows[payload.row]?.[payload.col]

  if (!cell || cell.hidden) {
    return
  }

  const has = rangeHasMark(cell.content, sel.start, sel.end, payload.mark)
  cell.content = applyMarkToRange(cell.content, sel.start, sel.end, payload.mark, has ? null : true)
  block.props.table = table
  pushHistory(true)
  contentRevision++
  void tick().then(() => itemRefs.get(block.id)?.setTableCellSelection?.(payload.row, payload.col, sel.start, sel.end))
}

function handleTableTab(
  block: Block,
  payload: { row: number; col: number; shift: boolean },
) {
  const table = normalizeTableData(block.props.table)
  const next = nextVisibleCellCoord(table, payload.row, payload.col, payload.shift ? -1 : 1)

  if (!next) {
    return
  }

  focusedTableCell = { blockId: block.id, row: next.row, col: next.col }
  tableSelectedCells = [{ row: next.row, col: next.col }]
  void tick().then(() => itemRefs.get(block.id)?.focusTableCell?.(next.row, next.col, 'start'))
}

function handleTableNavigate(
  block: Block,
  payload: { row: number; col: number; direction: 'up' | 'down' | 'left' | 'right' },
) {
  const table = normalizeTableData(block.props.table)

  if (payload.direction === 'up' || payload.direction === 'down') {
    const delta = payload.direction === 'up' ? -1 : 1
    const targetRow = payload.row + delta
    const targetCell = table.rows[targetRow]?.[payload.col]

    if (targetCell && !targetCell.hidden) {
      focusedTableCell = { blockId: block.id, row: targetRow, col: payload.col }
      tableSelectedCells = [{ row: targetRow, col: payload.col }]
      void tick().then(() => itemRefs.get(block.id)?.focusTableCell?.(targetRow, payload.col, payload.direction === 'up' ? 'end' : 'start'))

      return
    }

    handleArrow(block, payload.direction === 'up' ? -1 : 1)

    return
  }

  const delta = payload.direction === 'left' ? -1 : 1
  const next = nextVisibleCellCoord(table, payload.row, payload.col, delta as 1 | -1)

  if (next) {
    focusedTableCell = { blockId: block.id, row: next.row, col: next.col }
    tableSelectedCells = [{ row: next.row, col: next.col }]
    void tick().then(() => itemRefs.get(block.id)?.focusTableCell?.(next.row, next.col, payload.direction === 'left' ? 'end' : 'start'))
  }
}

function patchTableStyleForFocused(partial: Partial<TableStyle>) {
  const blockId = focusedTableCell?.blockId ?? focusedBlockId

  if (!blockId) {
    return
  }

  const block = byId(blockId)

  if (!block || block.type !== 'table') {
    return
  }

  block.props.table = patchTableStyle(normalizeTableData(block.props.table), partial)
  pushHistory(true)
  contentRevision++
  emit('change')
}

function patchTableCellBackgroundForFocused(color: string | null) {
  const blockId = focusedTableCell?.blockId ?? focusedBlockId

  if (!blockId) {
    return
  }

  const block = byId(blockId)

  if (!block || block.type !== 'table') {
    return
  }

  const cells = tableSelectedCells.length > 0
    ? tableSelectedCells
    : focusedTableCell
      ? [{ row: focusedTableCell.row, col: focusedTableCell.col }]
      : []

  if (cells.length === 0) {
    return
  }

  block.props.table = patchTableCellsBackground(normalizeTableData(block.props.table), cells, color)
  pushHistory(true)
  contentRevision++
  emit('change')
}

function applyMarkToFocusedTableCell(mark: MarkName, value: boolean | string | null) {
  const context = focusedTableCell
    ? getTableCellContext(focusedTableCell.blockId)
    : null

  if (!context) {
    return
  }

  const sel = itemRefs.get(context.block.id)?.getTableCellSelection?.(context.row, context.col)

  if (!sel || sel.start === sel.end) {
    return
  }

  const booleanMarks = ['bold', 'italic', 'underline', 'strikethrough', 'code'] as MarkName[]
  let markValue: boolean | string | null = value === false ? null : value

  if (booleanMarks.includes(mark) && typeof value === 'boolean') {
    markValue = rangeHasMark(context.cell.content, sel.start, sel.end, mark) ? null : true
  }

  context.cell.content = applyMarkToRange(
    context.cell.content,
    sel.start,
    sel.end,
    mark,
    normalizeMarkValue(mark, markValue),
  )
  context.block.props.table = context.table
  pushHistory(true)
  contentRevision++
  void tick().then(() =>
    itemRefs.get(context.block.id)?.setTableCellSelection?.(context.row, context.col, sel.start, sel.end),
  )
}

// ─── Bubble toolbar ───────────────────────────────────────────────────────────

interface BubbleState {
  blockId: string
  range: { start: number; end: number }
  /** Selection geometry in viewport coords (center x + top/bottom for placement). */
  position: { x: number; y: number; top: number; bottom: number }
  activeMarks: Partial<Record<MarkName, boolean>>
  currentLink: string | null
  currentColor: string | null
  currentHighlight: string | null
  blockType: BlockType
}

let bubble = $state<BubbleState | null>(null)

function computeBubble(block: Block, range: { start: number; end: number }, rect: DOMRect): BubbleState {
  const marks: Partial<Record<MarkName, boolean>> = {}

  for (const m of ['bold', 'italic', 'underline', 'strikethrough', 'code'] as MarkName[]) {
    marks[m] = rangeHasMark(block.content, range.start, range.end, m)
  }

  const slice = sliceSpans(block.content, range.start, range.end)
  const allLinked = slice.length > 0 && slice.every(s => s.marks?.link)
  const currentLink = allLinked ? (slice[0].marks?.link ?? null) : null
  const currentColor = rangeMarkValue(block.content, range.start, range.end, 'color')
  const currentHighlight = rangeMarkValue(block.content, range.start, range.end, 'highlight')
  // Anchor geometry only — final clamp (above the line + viewport bounds) lives in the toolbar.
  const x = rect.left + rect.width / 2
  const y = rect.top

  return {
    blockId: block.id,
    range,
    position: { x, y, top: rect.top, bottom: rect.bottom },
    activeMarks: marks,
    currentLink,
    currentColor,
    currentHighlight,
    blockType: block.type,
  }
}

function isBubbleToolbarTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('.editor-bubble-toolbar')
}

let bubbleToolbarPointerDown = false

function onBubbleToolbarPointerDown(event: PointerEvent) {
  bubbleToolbarPointerDown = isBubbleToolbarTarget(event.target)
}

function onBubbleToolbarPointerUp() {
  bubbleToolbarPointerDown = false
}

function onSelectionChange() {
  if (editorProps.readonly || hasActiveManagedSelection()) {
    bubble = null

    return
  }

  if (bubble && (bubbleToolbarPointerDown || isBubbleToolbarTarget(document.activeElement))) {
    return
  }

  const sel = window.getSelection()

  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    bubble = null

    return
  }

  const node = sel.anchorNode
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node?.parentElement
  const blockEl = el?.closest('[data-block-id]')

  if (!blockEl || !rootEl?.contains(blockEl)) {
    bubble = null

    return
  }

  const id = blockEl.getAttribute('data-block-id')
  const block = id ? byId(id) : undefined

  if (!block || !isTextBlock(block.type)) {
    bubble = null

    return
  }

  const range = itemRefs.get(block.id)?.getSelection()
  const rect = getSelectionClientRect()

  if (!range || range.start === range.end || !rect) {
    bubble = null

    return
  }

  bubble = computeBubble(block, range, rect)
}

function normalizeMarkValue(
  mark: MarkName,
  value: boolean | string | null,
): boolean | string | null {
  if (value === false || value === null) {
    return null
  }

  if ((mark === 'color' || mark === 'highlight') && typeof value === 'string') {
    return cssColorToHex(value) ?? value
  }

  return value
}

function onBubbleMark(mark: MarkName, value: boolean | string | null) {
  const markValue = normalizeMarkValue(mark, value)
  const state = bubble

  if (!state) {
    // Color panel may run after selection collapsed; fall back to live selection.
    applyToolbarMark(mark, markValue)
    return
  }

  const block = byId(state.blockId)

  if (!block) {
    return
  }

  const range = { ...state.range }
  if (range.end <= range.start) {
    return
  }

  block.content = applyMarkToRange(
    block.content,
    range.start,
    range.end,
    mark,
    markValue,
  )
  pushHistory(true)
  contentRevision++
  refreshBubbleRange(block, range)
  // Paint highlight/color immediately (don't wait for blur / deep watch).
  syncBlockDom(block.id, range)
}

function onBubbleTurnInto(type: BlockType) {
  turnIntoBlock(type)
}

function onBubbleComment(text: string) {
  const state = bubble
  if (!state) return

  const trimmed = text.trim()
  if (!trimmed) return

  const block = byId(state.blockId)
  if (!block) return

  const quote = spansToText(sliceSpans(block.content, state.range.start, state.range.end))
  emit('comment', {
    blockId: state.blockId,
    start: state.range.start,
    end: state.range.end,
    quote,
    text: trimmed,
  })
  bubble = null
  window.getSelection()?.removeAllRanges()
}

type TextCommentTarget = {
  blockId: string
  start: number
  end: number
  quote: string
}

function getTextCommentTarget(): TextCommentTarget | null {
  if (editorProps.readonly) return null

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null

  const node = sel.anchorNode
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node?.parentElement
  const blockEl = el?.closest('[data-block-id]')
  if (!blockEl || !rootEl?.contains(blockEl)) return null

  const id = blockEl.getAttribute('data-block-id')
  const block = id ? byId(id) : undefined
  if (!block || !isTextBlock(block.type)) return null

  const range = itemRefs.get(block.id)?.getSelection()
  if (!range || range.start === range.end) return null

  const quote = spansToText(sliceSpans(block.content, range.start, range.end)).trim()
  if (!quote) return null

  return {
    blockId: block.id,
    start: range.start,
    end: range.end,
    quote,
  }
}

async function openCommentOnSelection(target?: TextCommentTarget | null) {
  if (editorProps.readonly || !editorProps.showBubbleToolbar) return false

  const live = target ?? getTextCommentTarget()
  if (!live) return false

  const block = byId(live.blockId)
  if (!block || !isTextBlock(block.type)) return false

  const range = { start: live.start, end: live.end }
  itemRefs.get(block.id)?.setSelection(range.start, range.end)

  await tick()

  let rect = getSelectionClientRect()
  if (!rect) {
    const blockEl = rootEl?.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`)
    rect = blockEl?.getBoundingClientRect() ?? null
  }
  if (!rect) return false

  bubble = computeBubble(block, range, rect)
  await tick()
  if (!bubbleToolbarRef) await tick()
  await bubbleToolbarRef?.openCommentPanel()
  return true
}

function turnIntoBlock(type: BlockType) {
  const state = bubble
  const blockId = state?.blockId ?? focusedBlockId

  if (!blockId) {
return
}

  const block = byId(blockId)

  if (!block || !isTextBlock(block.type)) {
return
}

  const range = state?.range ?? itemRefs.get(block.id)?.getSelection() ?? { start: 0, end: 0 }
  const defaults = makeBlock(type)
  block.type = type
  block.props = propsKeepingNest(block, defaults.props)
  if (type === 'toggle') {
    block.props = { ...block.props, collapsed: false }
    syncTogglePlaceholder(block, { history: false })
  }
  // Force list re-render so heading classes remount with new type key.
  touchBlocks()
  pushHistory(true)
  void tick().then(() => itemRefs.get(block.id)?.setSelection(range.start, range.end))
}

function applyToolbarMark(mark: MarkName, value: boolean | string | null) {
  if (bubble) {
    onBubbleMark(mark, value)

    return
  }

  if (focusedTableCell || (focusedBlockId && byId(focusedBlockId)?.type === 'table')) {
    applyMarkToFocusedTableCell(mark, value)

    return
  }

  if (hasActiveManagedSelection() && textRangeSelection) {
    const booleanMarks = ['bold', 'italic', 'underline', 'strikethrough', 'code'] as MarkName[]
    let markValue: boolean | string | null = value === false ? null : value

    if (booleanMarks.includes(mark) && typeof value === 'boolean') {
      const applied = rangeHasMarkAcrossSegments(
        textRangeSelection,
        blocks,
        visibleBlocks,
        mark,
      )
      markValue = applied ? null : true
    }

    applyMarkToTextRange(
      blocks,
      textRangeSelection,
      visibleBlocks,
      mark,
      markValue,
    )
    pushHistory(true)
    contentRevision++
    // Multi-block managed selection: re-sync every text block in the range.
    const segments = getTextRangeSegments(
      textRangeSelection,
      blocks,
      visibleBlocks,
    )
    for (const segment of segments) {
      syncBlockDom(segment.blockId, { start: segment.start, end: segment.end })
    }

    return
  }

  const blockId = focusedBlockId

  if (!blockId) {
return
}

  const block = byId(blockId)

  if (!block || !isTextBlock(block.type)) {
return
}

  const sel = itemRefs.get(block.id)?.getSelection()

  if (!sel || sel.start === sel.end) {
return
}

  const range = { start: sel.start, end: sel.end }
  block.content = applyMarkToRange(
    block.content,
    range.start,
    range.end,
    mark,
    normalizeMarkValue(mark, value === false ? null : value),
  )
  pushHistory(true)
  contentRevision++
  // Always restore the range so color/highlight re-renders stay visible and
  // chained preset clicks keep targeting the same text.
  syncBlockDom(block.id, range)
}

function indentFocusedBlock() {
  const blockId = bubble?.blockId ?? focusedBlockId

  if (!blockId) {
return
}

  const block = byId(blockId)

  if (!block) {
return
}

  handleTab(block, false)
}

function outdentFocusedBlock() {
  const blockId = bubble?.blockId ?? focusedBlockId

  if (!blockId) {
return
}

  const block = byId(blockId)

  if (!block) {
return
}

  handleTab(block, true)
}

function setFocusedAlign(align: FormatToolbarAlign) {
  const blockId = bubble?.blockId ?? focusedBlockId

  if (!blockId) {
return
}

  const block = byId(blockId)

  if (!block) {
return
}

  if (block.type === 'table') {
    const context = getTableCellContext(blockId)

    if (!context) {
      return
    }

    const nextTable = patchTableCell(context.table, context.row, context.col, {
      align: align === 'left' ? undefined : align as TableCellAlign,
    })
    block.props.table = nextTable
    pushHistory(true)
    contentRevision++
    emit('change')

    return
  }

  if (!isTextBlock(block.type)) {
return
}

  if (align === 'left') {
delete block.props.align
} else if (align === 'justify') {
  return
} else {
block.props.align = align
}

  pushHistory(true)
}

function setFocusedDir(dir: 'auto' | 'ltr' | 'rtl') {
  const blockId = bubble?.blockId ?? focusedBlockId

  if (!blockId) {
return
}

  const block = byId(blockId)

  if (!block || !isTextBlock(block.type)) {
return
}

  if (dir === 'auto') {
    delete block.props.dir
    delete block.props.dirManual
  } else {
    block.props.dir = dir
    block.props.dirManual = true
  }

  contentRevision++
  pushHistory(true)
}

function setFocusedCalloutIcon(icon: string | null) {
  const blockId = bubble?.blockId ?? focusedBlockId

  if (!blockId) {
    return
  }

  const block = byId(blockId)

  if (!block || block.type !== 'callout') {
    return
  }

  patchProps(block, { icon: icon ?? '💡' })
}

let formatToolbarState = $derived.by(() => {
  const _revision = contentRevision
  void _revision

  if (bubble) {
    const block = byId(bubble.blockId)

      return {
        blockId: bubble.blockId,
        blockType: bubble.blockType,
        activeMarks: bubble.activeMarks,
        currentLink: bubble.currentLink,
        currentColor: bubble.currentColor,
        currentHighlight: bubble.currentHighlight,
        hasSelection: true,
        multiBlock: false,
        align: block?.props.align ?? 'left',
        indent: block?.props.indent ?? 0,
        dir: block?.props.dir ?? 'auto',
        calloutIcon: block?.type === 'callout' ? (block.props.icon ?? '💡') : null,
      }
  }

  if (hasActiveManagedSelection() && textRangeSelection) {
    const segments = getTextRangeSegments(
      textRangeSelection,
      blocks,
      visibleBlocks,
    )
    const first = segments[0]

    if (!first) {
      return null
    }

    const block = first.block
    const marks: Partial<Record<MarkName, boolean>> = {}
    const multiBlock = segments.length > 1 || isCrossBlockTextRange(textRangeSelection, visibleBlocks)

    for (const m of ['bold', 'italic', 'underline', 'strikethrough', 'code'] as MarkName[]) {
      marks[m] = rangeHasMarkAcrossSegments(
        textRangeSelection,
        blocks,
        visibleBlocks,
        m,
      )
    }

    const currentColor = multiBlock
      ? null
      : rangeMarkValueAcrossSegments(
          textRangeSelection,
          blocks,
          visibleBlocks,
          'color',
        )
    const currentHighlight = multiBlock
      ? null
      : rangeMarkValueAcrossSegments(
          textRangeSelection,
          blocks,
          visibleBlocks,
          'highlight',
        )

    return {
      blockId: first.blockId,
      blockType: block.type,
      activeMarks: marks,
      currentLink: null,
      currentColor,
      currentHighlight,
      hasSelection: true,
      multiBlock,
      align: block.props.align ?? 'left',
      indent: block.props.indent ?? 0,
      dir: block.props.dir ?? 'auto',
      calloutIcon: block.type === 'callout' ? (block.props.icon ?? '💡') : null,
    }
  }

  if (focusedBlockId) {
    const block = byId(focusedBlockId)

    if (block?.type === 'table') {
      const context = getTableCellContext(block.id)

      if (context) {
        const sel = itemRefs.get(block.id)?.getTableCellSelection?.(context.row, context.col)
        const hasSelection = !!sel && sel.start !== sel.end
        const marks: Partial<Record<MarkName, boolean>> = {}

        if (hasSelection && sel) {
          for (const m of ['bold', 'italic', 'underline', 'strikethrough', 'code'] as MarkName[]) {
            marks[m] = rangeHasMark(context.cell.content, sel.start, sel.end, m)
          }
        }

        const currentColor = hasSelection && sel
          ? rangeMarkValue(context.cell.content, sel.start, sel.end, 'color')
          : null
        const currentHighlight = hasSelection && sel
          ? rangeMarkValue(context.cell.content, sel.start, sel.end, 'highlight')
          : null

        return {
          blockId: block.id,
          blockType: 'table' as BlockType,
          activeMarks: marks,
          currentLink: hasSelection && sel
            ? rangeMarkValue(context.cell.content, sel.start, sel.end, 'link')
            : null,
          currentColor,
          currentHighlight,
          hasSelection: hasSelection || true,
          multiBlock: false,
          align: (context.cell.align ?? 'left') as FormatToolbarAlign,
          indent: 0,
          dir: 'auto' as const,
          calloutIcon: null,
          tableStyle: context.table.style,
          cellBackground: context.cell.background ?? null,
        }
      }
    }

    if (block && isTextBlock(block.type)) {
      const sel = itemRefs.get(block.id)?.getSelection()
      const hasSelection = !!sel && sel.start !== sel.end
      const marks: Partial<Record<MarkName, boolean>> = {}

      if (hasSelection && sel) {
        for (const m of ['bold', 'italic', 'underline', 'strikethrough', 'code'] as MarkName[]) {
          marks[m] = rangeHasMark(block.content, sel.start, sel.end, m)
        }
      }

      const currentColor = hasSelection && sel
        ? rangeMarkValue(block.content, sel.start, sel.end, 'color')
        : null
      const currentHighlight = hasSelection && sel
        ? rangeMarkValue(block.content, sel.start, sel.end, 'highlight')
        : null

      return {
        blockId: block.id,
        blockType: block.type,
        activeMarks: marks,
        currentLink: null,
        currentColor,
        currentHighlight,
        hasSelection,
        multiBlock: false,
        align: block.props.align ?? 'left',
        indent: block.props.indent ?? 0,
        dir: block.props.dir ?? 'auto',
        calloutIcon: block.type === 'callout' ? (block.props.icon ?? '💡') : null,
      }
    }
  }

  return null
})

$effect(() => {
  const state = formatToolbarState as any;
  void (formatToolbarState);
  emit('format-state', state)
})

// ─── Drag & drop ──────────────────────────────────────────────────────────────

let draggingId = $state<string | null>(null)
let dropTarget = $state<{ id: string; position: 'before' | 'after' | 'left' | 'right' } | null>(null)

function onDragHandleStart(block: Block, e: DragEvent) {
  if (editorProps.readonly) {
    e.preventDefault()

    return
  }

  // Reorder drag must not be stolen by marquee / text-range selection.
  cancelMarqueeSelection()
  clearDragSelectState()
  clearTextRangeSelection()
  clearBlockSelection()
  draggingId = block.id
  dropTarget = null

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox requires at least one data type or the drag is cancelled.
    e.dataTransfer.setData('text/plain', block.id)
    e.dataTransfer.setData('application/x-xpe-block-id', block.id)
    const blockEl = rootEl?.querySelector(`[data-block-id="${block.id}"]`)

    if (blockEl instanceof HTMLElement) {
      try {
        e.dataTransfer.setDragImage(blockEl, 12, 12)
      } catch {
        // Some environments reject setDragImage; native drag still works.
      }
    }
  }
}

function onDragOver(e: DragEvent) {
  if (editorProps.readonly || !draggingId) {
return
}

  e.preventDefault()

  if (e.dataTransfer) {
e.dataTransfer.dropEffect = 'move'
}

  const target = (e.target as HTMLElement).closest('[data-block-id]')

  if (!target) {
 dropTarget = null;

 return 
}

  const id = target.getAttribute('data-block-id')

  if (!id || id === draggingId) {
 dropTarget = null;

 return 
}

  const block = byId(id)
  const dragged = byId(draggingId!)
  const rect = target.getBoundingClientRect()

  if (!block || !dragged || !canColumnizeBlock(block) || !canColumnizeBlock(dragged)) {
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    dropTarget = { id, position }

    return
  }
  const offsetX = e.clientX - rect.left
  const offsetY = e.clientY - rect.top
  const edge = COLUMN_DROP_EDGE_PX

  let position: 'before' | 'after' | 'left' | 'right'

  if (offsetX < edge) {
    position = 'left'
  } else if (offsetX > rect.width - edge) {
    position = 'right'
  } else {
    position = offsetY < rect.height / 2 ? 'before' : 'after'
  }

  dropTarget = { id, position }
}

function onDrop(e: DragEvent) {
  if (editorProps.readonly) {
return
}

  e.preventDefault()
  const from = draggingId
  const target = dropTarget
  draggingId = null
  dropTarget = null

  if (!from || !target || from === target.id) {
return
}

  if (target.position === 'left' || target.position === 'right') {
    if (createColumnLayoutFromDrop(blocks, from, target.id, target.position)) {
      touchBlocks()
      pushHistory(true)
    }

    return
  }

  const fromIdx = blocks.findIndex(b => b.id === from)

  if (fromIdx === -1) {
    return
  }

  // Move toggle/column units as a whole so nested children stay together.
  const unitSpan = blockUnitSpan(blocks, fromIdx)
  const unit = blocks.splice(unitSpan.start, unitSpan.end - unitSpan.start)
  let toIdx = blocks.findIndex(b => b.id === target.id)

  if (toIdx === -1) {
    blocks.splice(fromIdx, 0, ...unit)
    return
  }

  const targetBlock = blocks[toIdx]
  // Dropping after a toggle nests inside it; otherwise match the target's indent.
  let targetIndent = blockIndent(targetBlock)
  if (target.position === 'after') {
    if (targetBlock.type === 'toggle') {
      targetIndent = blockIndent(targetBlock) + 1
      expandToggleAnchor(targetBlock)
    }
    // Insert after the whole target unit (toggle + its descendants).
    const targetSpan = blockUnitSpan(blocks, toIdx)
    toIdx = targetSpan.end
  }

  const reindented = reindentUnitTo(unit, targetIndent)
  blocks.splice(toIdx, 0, ...reindented)
  syncAllTogglePlaceholders({ history: false })
  touchBlocks()
  pushHistory(true)
}

function onDragEnd() {
  draggingId = null
  dropTarget = null
  clearDragSelectState()
}

// ─── Root keyboard handling ───────────────────────────────────────────────────

function resolveActiveBlock(target: HTMLElement): Block | undefined {
  const blockEl = target.closest('[data-block-id]')
  const blockId = blockEl?.getAttribute('data-block-id')

  if (blockId) {
return byId(blockId)
}

  if (selectedBlockId) {
return byId(selectedBlockId)
}

  if (focusedBlockId) {
return byId(focusedBlockId)
}

  return undefined
}

/** Ctrl/Cmd+A — always select the whole page in one press. */
function handleSelectAllShortcut(_target: HTMLElement) {
  selectAllBlocks()
}

function handleSlashMenuKeydown(e: KeyboardEvent): boolean {
  if (emojiState) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeEmoji()
      return true
    }
    // While emoji menu is open, capture navigation + commit keys in capture phase
    // so contenteditable never inserts a newline or steals the gesture.
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      emojiMenuRef?.move(1)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      emojiMenuRef?.move(-1)
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      if (emojiMenuRef) emojiMenuRef.confirm()
      else {
        const hits = searchEmojis(emojiState.query, 1)
        if (hits[0]) onEmojiSelect(hits[0])
        else closeEmoji()
      }
      return true
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      emojiMenuRef?.confirm()
      return true
    }
  }

  if (!slashState) {
    return false
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeSlash()
    return true
  }

  if (!isSlashMenuActive()) {
    return false
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopPropagation()
    slashMenuRef?.move(1)
    return true
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    slashMenuRef?.move(-1)
    return true
  }

  return false
}

/** Lazy-load vim engine so users who never enable vim don't pay for it. */
async function setupVimEngine() {
  if (vimEngine) return vimEngine
  const { createVimEngine } = await import('../vim/vimEngine')
  vimEngine = createVimEngine({
    isReadonly: () => !!editorProps.readonly,
    getVisibleBlocks: () => visibleBlocks,
    getBlock: (id) => byId(id),
    getText: (block) => (isTextBlock(block.type) ? spansToText(block.content) : ''),
    isTextLike: (block) => isTextBlock(block.type),
    getCaret: () => {
      // Prefer the block under the real DOM focus (contenteditable).
      const active = document.activeElement
      if (active instanceof HTMLElement) {
        const host = active.closest('[data-block-id]') as HTMLElement | null
        const id = host?.dataset.blockId
        if (id) {
          const block = byId(id)
          if (block && isTextBlock(block.type)) {
            const sel = itemRefs.get(id)?.getSelection()
            if (sel) {
              vimPreferredCol = sel.start
              return { blockId: id, offset: sel.start }
            }
            return { blockId: id, offset: 0 }
          }
        }
      }
      if (focusedBlockId) {
        const block = byId(focusedBlockId)
        if (block && isTextBlock(block.type)) {
          const sel = itemRefs.get(focusedBlockId)?.getSelection()
          if (sel) {
            vimPreferredCol = sel.start
            return { blockId: focusedBlockId, offset: sel.start }
          }
          return { blockId: focusedBlockId, offset: 0 }
        }
      }
      if (textRangeSelection) {
        return { ...textRangeSelection.focus }
      }
      const first = visibleBlocks.find((b) => isTextBlock(b.type))
      return first ? { blockId: first.id, offset: 0 } : null
    },
    setCaret: (blockId, offset) => {
      clearTextRangeSelection()
      clearBlockSelection()
      focusedBlockId = blockId
      vimPreferredCol = offset
      focusBlock(blockId, offset)
      void tick().then(() => refreshVimStatusline())
    },
    setVisualRange: (anchor, focus, linewise) => {
      if (linewise) {
        const aBlock = byId(anchor.blockId)
        const fBlock = byId(focus.blockId)
        if (!aBlock || !fBlock) return
        const aOff = isTextBlock(aBlock.type) ? 0 : 0
        const fLen = isTextBlock(fBlock.type) ? spansToText(fBlock.content).length : 0
        // Expand to full lines (blocks) between anchor and focus.
        const blocksList = visibleBlocks
        const ai = blocksList.findIndex((b) => b.id === anchor.blockId)
        const fi = blocksList.findIndex((b) => b.id === focus.blockId)
        if (ai < 0 || fi < 0) return
        const startB = blocksList[Math.min(ai, fi)]!
        const endB = blocksList[Math.max(ai, fi)]!
        const endLen = isTextBlock(endB.type) ? spansToText(endB.content).length : 0
        setManagedTextRange(
          { blockId: startB.id, offset: 0 },
          { blockId: endB.id, offset: endLen },
        )
        void aOff
        void fLen
        void tick().then(() => rootEl?.focus({ preventScroll: true }))
        return
      }
      setManagedTextRange(anchor, focus)
      void tick().then(() => rootEl?.focus({ preventScroll: true }))
    },
    clearVisual: () => {
      clearTextRangeSelection()
    },
    deleteRange: (a, b) => {
      if (a.blockId === b.blockId && a.offset === b.offset) {
        return { ...a }
      }
      const result = deleteTextRange(
        blocks,
        { anchor: a, focus: b },
        visibleBlocks,
      )
      clearTextRangeSelection()
      ensureNotEmpty()
      touchBlocks()
      pushHistory(true)
      if (result) {
        focusBlock(result.focusBlockId, result.focusOffset)
        return { blockId: result.focusBlockId, offset: result.focusOffset }
      }
      return null
    },
    replaceRange: (a, b, text) => {
      if (a.blockId === b.blockId) {
        const block = byId(a.blockId)
        if (!block || !isTextBlock(block.type)) return null
        const start = Math.min(a.offset, b.offset)
        const end = Math.max(a.offset, b.offset)
        let content = deleteRangeInSpans(block.content, start, end)
        content = insertTextInSpans(content, start, text)
        block.content = normalizeSpans(content)
        touchBlocks()
        pushHistory(true)
        const caret = start + text.length
        focusBlock(block.id, caret)
        syncBlockDom(block.id, { start: caret, end: caret })
        return { blockId: block.id, offset: caret }
      }
      // Multi-block: delete then insert at start
      const result = deleteTextRange(
        blocks,
        { anchor: a, focus: b },
        visibleBlocks,
      )
      clearTextRangeSelection()
      ensureNotEmpty()
      if (!result) return null
      const block = byId(result.focusBlockId)
      if (!block || !isTextBlock(block.type)) return null
      block.content = insertTextInSpans(block.content, result.focusOffset, text)
      block.content = normalizeSpans(block.content)
      touchBlocks()
      pushHistory(true)
      const caret = result.focusOffset + text.length
      focusBlock(block.id, caret)
      syncBlockDom(block.id, { start: caret, end: caret })
      return { blockId: block.id, offset: caret }
    },
    setBlockPlainText: (blockId, text, caret) => {
      const block = byId(blockId)
      if (!block || !isTextBlock(block.type)) return
      block.content = text ? [{ text }] : []
      touchBlocks()
      pushHistory(true)
      contentRevision++
      const offset = caret ?? text.length
      focusBlock(blockId, offset)
      syncBlockDom(blockId, { start: offset, end: offset })
    },
    insertText: (blockId, offset, text) => {
      const block = byId(blockId)
      if (!block || !isTextBlock(block.type)) return null
      block.content = normalizeSpans(insertTextInSpans(block.content, offset, text))
      touchBlocks()
      pushHistory(true)
      const caret = offset + text.length
      focusBlock(blockId, caret)
      return { blockId, offset: caret }
    },
    openLineBelow: (blockId) => {
      const block = byId(blockId)
      if (!block) return
      addBelow(block)
    },
    openLineAbove: (blockId) => {
      const block = byId(blockId)
      if (!block || editorProps.readonly) return
      const idx = blocks.indexOf(block)
      if (idx < 0) return
      const indent = block.props.indent ?? 0
      const nb = makeBlock('paragraph', {
        props: indent > 0 ? { indent } : {},
      })
      blocks.splice(idx, 0, nb)
      pushHistory(true)
      focusBlock(nb.id, 'start')
    },
    joinWithNext: (blockId) => {
      const block = byId(blockId)
      if (!block || !isTextBlock(block.type)) return
      handleDeleteEnd(block)
    },
    undo: () => undo(),
    redo: () => redo(),
    indentBlock: (blockId) => {
      const block = byId(blockId)
      if (block) handleTab(block, false)
    },
    outdentBlock: (blockId) => {
      const block = byId(blockId)
      if (block) handleTab(block, true)
    },
    focusNeighbor: (blockId, dir, prefer) => {
      const neighbor = neighborBlock(blockId, dir)
      if (!neighbor) return
      if (!isTextBlock(neighbor.type)) {
        selectBlock(neighbor.id)
        return
      }
      const len = spansToText(neighbor.content).length
      if (prefer === 'start') focusBlock(neighbor.id, 0)
      else if (prefer === 'end') focusBlock(neighbor.id, len)
      else focusBlock(neighbor.id, Math.min(vimPreferredCol, len))
    },
    getBlockIndex: (blockId) => visibleBlocks.findIndex((b) => b.id === blockId),
    focusBlockAtIndex: (index, pos) => {
      const block = visibleBlocks[index]
      if (!block) return
      if (isTextBlock(block.type)) focusBlock(block.id, pos)
      else selectBlock(block.id)
    },
    onModeChange: (mode, status) => {
      // Avoid churning revision / statusline when enable() re-asserts NORMAL.
      if (vimModeName !== mode) {
        vimModeName = mode
        vimEditRevision++
      }
      if (vimStatus !== status) vimStatus = status
      const pending = vimEngine?.getPendingKeys() ?? ''
      if (vimPendingKeys !== pending) vimPendingKeys = pending
      refreshVimStatusline()
    },
    writeClipboard: (text) => {
      try {
        void navigator.clipboard?.writeText(text)
      } catch {
        // ignore
      }
    },
    focusCmdline: () => {
      void tick().then(() => {
        const el = vimCmdlineInputRef
        if (!el) return
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      })
    },
    blurCmdline: () => {
      vimCmdlineInputRef?.blur()
      // Restore caret in the editor after leaving :/
      void tick().then(() => {
        const caretBlock = focusedBlockId
        if (caretBlock) {
          const sel = itemRefs.get(caretBlock)?.getSelection()
          focusBlock(caretBlock, sel?.start ?? 'start')
        } else {
          rootEl?.focus({ preventScroll: true })
        }
      })
    },
  })
  return vimEngine
}

function onVimCmdlineInput(value: string) {
  vimCmdline = value
  vimEngine?.setCmdline(value)
}

function onVimCmdlineKeydown(e: KeyboardEvent) {
  if (!vimEngine || vimModeName !== 'cmdline') return
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    vimEngine.setCmdline(vimCmdline)
    vimEngine.executeCmdline()
    refreshVimStatusline()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    vimEngine.setMode('normal')
    refreshVimStatusline()
  }
}

function isVimFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // Cmdline input is owned by vim — still allow document capture for Esc routing,
  // but treat other form fields as off-limits.
  if (target.closest('.be-vim-cmdline__input, .be-vim-bar')) return false
  // Never steal keys from real form controls or page-link picker.
  return !!target.closest(
    'input, textarea, select, .page-ref__picker, .slash-menu, .emoji-menu, [data-pro-editor-toolbar], .be-external-link-modal, .be-link-context-menu',
  )
}

function isVimEditorTarget(target: EventTarget | null): boolean {
  if (!rootEl) return false
  if (target === rootEl) return true
  if (target instanceof Node && rootEl.contains(target)) return true
  return false
}

/** Document-level capture so vim works even when focus is deep in contenteditable. */
function onVimDocumentKeydown(e: KeyboardEvent) {
  if (!editorProps.vimMode || !vimEngine || editorProps.readonly) return
  // Never swallow undo/redo — BlockEditor owns the document history stack.
  // Use physical keys so this works on Farsi and other layouts.
  if (isModLetter(e, 'z') || isModLetter(e, 'y', { shift: false })) return
  if (isVimFormField(e.target)) return
  if (!isVimEditorTarget(e.target) && document.activeElement !== rootEl) {
    // Allow Esc anywhere in the app shell to enter NORMAL if focus was lost mid-edit.
    if (e.key === 'Escape' && isVimEditorTarget(document.activeElement)) {
      // fall through
    } else if (!isVimEditorTarget(document.activeElement)) {
      return
    }
  }
  if (vimEngine.handleKeydown(e)) {
    refreshVimStatusline()
  }
}

function onVimBeforeInput(e: Event) {
  if (!editorProps.vimMode || !vimEngine || editorProps.readonly) return
  if (vimAllowsTextInput()) return
  if (!isVimEditorTarget(e.target)) return
  e.preventDefault()
}

function bindVimDocumentListeners() {
  if (vimDocListenersBound) return
  document.addEventListener('keydown', onVimDocumentKeydown, true)
  document.addEventListener('beforeinput', onVimBeforeInput, true)
  vimDocListenersBound = true
}

function unbindVimDocumentListeners() {
  if (!vimDocListenersBound) return
  document.removeEventListener('keydown', onVimDocumentKeydown, true)
  document.removeEventListener('beforeinput', onVimBeforeInput, true)
  vimDocListenersBound = false
}

function handleUndoRedoShortcut(e: KeyboardEvent): boolean {
  if (!hasMod(e) || e.altKey) return false

  // Ignore when typing in real form fields outside the block model
  // (poll option inputs still use browser undo for their own value).
  if (
    e.target instanceof HTMLElement
    && e.target.closest('input, textarea, select')
    && !e.target.closest('[contenteditable="true"]')
  ) {
    return false
  }

  // Only handle shortcuts that target the editor (or its contenteditable kids).
  const target = e.target
  const inEditor =
    target === rootEl
    || (target instanceof Node && !!rootEl?.contains(target))
  if (!inEditor) return false

  // Physical KeyZ/KeyY so undo/redo works on Farsi keyboard (layout-independent).
  // Ctrl/Cmd+Z → undo · Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y → redo
  if (isModLetter(e, 'z', { shift: false })) {
    e.preventDefault()
    e.stopPropagation()
    undo()
    return true
  }
  if (isModLetter(e, 'z', { shift: true }) || isModLetter(e, 'y', { shift: false })) {
    e.preventDefault()
    e.stopPropagation()
    redo()
    return true
  }
  return false
}

function onKeydownCapture(e: KeyboardEvent) {
  if (editorProps.readonly) {
    return
  }

  if (handleSlashMenuKeydown(e)) {
    return
  }

  // Undo/redo must work while focus is inside contenteditable (custom history,
  // not the browser stack). Handle before the native-input early return.
  if (handleUndoRedoShortcut(e)) {
    return
  }

  // Vim keys are handled on document capture (onVimDocumentKeydown).
  // If already handled (defaultPrevented), skip the rest of the editor map.
  if (editorProps.vimMode && e.defaultPrevented) {
    return
  }

  if (handleEditorEscape(e)) {
    return
  }

  // Shift+↑/↓ full-line select must work while typing in contenteditable.
  if (handleShiftArrowLineSelect(e)) {
    return
  }

  // Ctrl/Cmd+A: select entire page. Physical KeyA works on Farsi layout too.
  // Must run while focus is in contenteditable/textarea.
  const mod = hasMod(e)
  if (isModLetter(e, 'a', { shift: false })) {
    const target = e.target
    if (target instanceof HTMLElement && rootEl && (rootEl === target || rootEl.contains(target))) {
      e.preventDefault()
      e.stopPropagation()
      handleSelectAllShortcut(target)
      return
    }
  }

  // Managed multi-block text selection (e.g. Ctrl+A): replace/delete selection.
  // Runs before the native-input early-out so it still works if focus is odd.
  // Enter clears the selection (same as typing over a selection in block editor/docs).
  if (hasActiveManagedSelection()) {
    if (
      e.key === 'Backspace'
      || e.key === 'Delete'
      || (e.key === 'Enter' && !e.shiftKey && !mod)
    ) {
      e.preventDefault()
      e.stopPropagation()
      deleteManagedTextRange()
      return
    }
  }

  if (isNativeInputTarget(e.target)) {
    return
  }

  if (
    (e.key === 'Backspace' || e.key === 'Delete' || (e.key === 'Enter' && !e.shiftKey && !mod))
    && selectedBlockIds.length > 1
  ) {
    e.preventDefault()
    e.stopPropagation()
    removeSelectedBlocksBulk()
    return
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && selectedBlockId) {
    const block = byId(selectedBlockId)

    if (block && !isTextBlock(block.type) && block.type !== 'code' && block.type !== 'table') {
      e.preventDefault()
      e.stopPropagation()
      removeBlock(block)

      return
    }
  }
}

function onBlockPointerDown(block: Block, e: PointerEvent) {
  if (editorProps.readonly) {
return
}

  const target = e.target as HTMLElement

  if (target.closest('.ebi-reorder-handle, .ebi-gutter')) {
return
}

  if (e.shiftKey && !isTextBlock(block.type)) {
    // Shift+click/drag on non-text: extend text range to cover this whole block,
    // then keep tracking if the pointer moves (marquee-like multi-block select).
    const anchor = resolveSelectionAnchor() ?? { blockId: block.id, offset: 0 }
    const focus = { blockId: block.id, offset: blockLength(block) }
    dragSelectAnchor = anchor
    dragSelectOriginClient = { x: e.clientX, y: e.clientY }
    dragSelectPointerType = e.pointerType ?? null
    textRangeSelection = { anchor, focus }
    managedTextSelection = true
    isDragSelecting = true
    dragSelectPending = false
    clearBlockSelection()
    focusedBlockId = null
    closeSlash()
    bubble = null
    window.getSelection()?.removeAllRanges()
    e.preventDefault()
    void tick().then(() => rootEl?.focus())

    return
  }

  if (!e.shiftKey && hasActiveManagedSelection() && !isTextBlock(block.type)) {
    clearTextRangeSelection()
  }

  // Arm text drag from block chrome (padding, list markers, empty hits) — not only
  // from inside contenteditable. Document capture may also arm; this is a backup.
  if (
    isTextBlock(block.type)
    && rootEl
    && !target.closest('button, a, input, textarea, select, .ebi-gutter, .ebi-reorder-handle')
  ) {
    onSelectionPointerDown(block, {
      shiftKey: e.shiftKey,
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
    })
  }

  // Phone: first press often hits block padding / list chrome, not the
  // contenteditable. Focus the line immediately so editing does not need a second tap.
  if (
    isTouchLikePointer(e)
    && isTextBlock(block.type)
    && !target.closest('[contenteditable="true"], input, textarea, button, a')
    && rootEl
  ) {
    const point = caretPointFromClient(rootEl, e.clientX, e.clientY)
    const offset = point?.blockId === block.id ? point.offset : 'end'
    // Defer to pointerup-equivalent via rAF so we don't fight native focus if
    // the browser still routes the hit into the editable.
    requestAnimationFrame(() => {
      const active = document.activeElement
      const host = rootEl?.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`)
      if (active instanceof HTMLElement && host?.contains(active)) return
      if (isBlockLocked(block.id)) return
      focusBlock(block.id, offset)
    })
  }
}

function isDragSelectBlockedTarget(target: Element): boolean {
  if (target.closest('.ebi-gutter, .ebi-reorder-handle')) return true
  if (isEditorOverlayTarget(target as HTMLElement) || isFormatToolbarTarget(target as HTMLElement)) {
    return true
  }
  if (
    target.closest(
      '.slash-menu, .emoji-menu, .editor-bubble-toolbar, .xpe-icon-popover, [role="dialog"], .context-menu',
    )
  ) {
    return true
  }
  // Never start text-drag selection from a link — activateEditorLink owns those.
  if (target.closest('a[href], a[data-external-link], a[data-page-link]')) {
    return true
  }
  // Real controls — but not contenteditable text.
  if (
    target.closest('button, input, textarea, select, label')
    && !target.closest('[contenteditable="true"]')
  ) {
    return true
  }
  return false
}

function armTextDragFromPoint(
  e: PointerEvent,
  options?: { forceManaged?: boolean },
): boolean {
  if (!rootEl || editorProps.readonly) return false
  const point = caretPointFromClient(rootEl, e.clientX, e.clientY)
  if (!point) return false
  const block = byId(point.blockId)
  if (!block || !isTextBlock(block.type) || isBlockLocked(block.id)) return false

  onSelectionPointerDown(block, {
    shiftKey: e.shiftKey,
    clientX: e.clientX,
    clientY: e.clientY,
    pointerType: e.pointerType,
  })

  if (options?.forceManaged && dragSelectAnchor) {
    managedTextSelection = true
    window.getSelection()?.removeAllRanges()
  }

  // Keep receiving moves over gutters / outside the line.
  try {
    rootEl.setPointerCapture?.(e.pointerId)
  } catch {
    /* ignore */
  }
  return true
}

function onDocPointerDown(e: PointerEvent) {
  if (e.button !== 0 || editorProps.readonly) return
  if (draggingId) return
  if (!(e.target instanceof Element)) return

  // Never arm marquee (or preventDefault) on the block drag handle — that kills HTML5 reorder.
  if (
    e.target.closest('.ebi-gutter, .ebi-reorder-handle')
    || isOverBlockDragHandle(e.clientX, e.clientY)
  ) {
    return
  }

  const root = rootEl
  const inRoot = !!(root && (root === e.target || root.contains(e.target)))
  const inStrip = isPointerInMarqueeStrip(e.clientX)
  if (!inRoot && !inStrip) return

  if (isDragSelectBlockedTarget(e.target)) return

  // Text-range drag from anywhere in the editor (padding, gaps, markers, editables).
  // Side strips + Alt still prefer marquee block-select (below).
  const preferMarquee = e.altKey || inStrip
  if (!preferMarquee) {
    armTextDragFromPoint(e)
  }

  // Marquee block-select from strips / Alt / empty chrome / non-text blocks.
  if (beginMarquee(e) && preferMarquee) {
    // Prevent caret/text selection when intentionally marquee-selecting from strip/Alt.
    e.preventDefault()
    clearDragSelectState()
    try {
      root?.setPointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
  }
}

function onDocPointerMove(e: PointerEvent) {
  if (marqueeActive && marqueeOriginDoc) {
    if (marqueePointerId != null && e.pointerId !== marqueePointerId) return
    if (e.buttons === 0) {
      endMarquee(e)
      return
    }

    updateMarqueeFromClient(e.clientX, e.clientY, e.pointerType)
    if (marqueeMoved) {
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
    }
    ensureMarqueeAutoScroll()
    return
  }

  if (draggingId || e.buttons === 0 || !rootEl) {
    return
  }

  // Promote a pending touch press into a real text-range drag only after movement.
  if (dragSelectPending && dragSelectAnchor && dragSelectOriginClient) {
    const dx = e.clientX - dragSelectOriginClient.x
    const dy = e.clientY - dragSelectOriginClient.y
    if (Math.hypot(dx, dy) < textDragThresholdPx(dragSelectPointerType ?? e.pointerType)) {
      return
    }
    dragSelectPending = false
    isDragSelecting = true
  }

  if (!isDragSelecting || !dragSelectAnchor) {
    return
  }

  const point = caretPointFromClient(rootEl, e.clientX, e.clientY)

  if (!point) {
    return
  }

  textRangeSelection = { anchor: dragSelectAnchor, focus: point }

  if (point.blockId !== dragSelectAnchor.blockId) {
    // Cross-block drag (incl. Shift+drag): paint managed selection live.
    managedTextSelection = true
    window.getSelection()?.removeAllRanges()
    focusedBlockId = null
    bubble = null
    e.preventDefault()
  } else if (managedTextSelection) {
    // Was multi-block, dragged back into the anchor block — keep managed paint.
    window.getSelection()?.removeAllRanges()
    focusedBlockId = null
    e.preventDefault()
  } else {
    // Same-block drag: keep native selection in sync while moving.
    const start = Math.min(dragSelectAnchor.offset, point.offset)
    const end = Math.max(dragSelectAnchor.offset, point.offset)
    itemRefs.get(point.blockId)?.setSelection(start, end)
    focusedBlockId = point.blockId
  }
}

function onDocPointerUp(e?: PointerEvent) {
  if (e && rootEl?.hasPointerCapture?.(e.pointerId)) {
    try {
      rootEl.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  if (marqueeActive) {
    endMarquee(e)
  }

  // Pending touch press that never became a drag: leave the native caret alone
  // (or restore focus if chrome ate the first hit).
  if (dragSelectPending && dragSelectAnchor && !isDragSelecting) {
    const anchor = dragSelectAnchor
    clearDragSelectState()
    textRangeSelection = null
    managedTextSelection = false

    const active = document.activeElement
    const host = rootEl?.querySelector(`[data-block-id="${CSS.escape(anchor.blockId)}"]`)
    const alreadyInBlock = !!(
      active instanceof HTMLElement
      && host
      && host.contains(active)
    )
    if (!alreadyInBlock && !isBlockLocked(anchor.blockId)) {
      itemRefs.get(anchor.blockId)?.setSelection?.(anchor.offset, anchor.offset)
      focusedBlockId = anchor.blockId
    }
    return
  }

  if (isDragSelecting) {
    finalizeTextRangeSelection()
  }

  clearDragSelectState()
}

function onRootKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement

  // Page-link picker search input owns ArrowUp/Down for option list navigation.
  if (target.closest('.page-ref__picker, .page-ref__search-input')) {
    return
  }

  if (isNativeInputTarget(target)) {
    return
  }

  // After Ctrl+A, focus is on the editor root — capture may already handle this,
  // but keep a bubble-phase fallback so Enter always clears the page selection.
  if (hasActiveManagedSelection()) {
    if (
      e.key === 'Backspace'
      || e.key === 'Delete'
      || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)
    ) {
      e.preventDefault()
      deleteManagedTextRange()
    }
    return
  }

  const multi = selectedBlocksInOrder()
  if (multi.length > 1) {
    if (
      e.key === 'Backspace'
      || e.key === 'Delete'
      || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)
    ) {
      e.preventDefault()
      removeSelectedBlocksBulk()
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const edge = e.key === 'ArrowDown' ? multi[multi.length - 1] : multi[0]
      handleArrow(edge, e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    return
  }

  // Resolve selected non-text block (page / image / poll / …). Prefer explicit
  // selection; fall back to the block hosting focus (e.g. page-ref button).
  let id = selectedBlockId
  if (!id && target instanceof Element) {
    const host = target.closest('[data-block-id]') as HTMLElement | null
    const hostId = host?.dataset.blockId
    if (hostId) {
      const hostBlock = byId(hostId)
      if (
        hostBlock
        && !isTextBlock(hostBlock.type)
        && hostBlock.type !== 'code'
        && hostBlock.type !== 'table'
      ) {
        id = hostId
      }
    }
  }
  if (!id && focusedBlockId) {
    const focused = byId(focusedBlockId)
    if (
      focused
      && !isTextBlock(focused.type)
      && focused.type !== 'code'
      && focused.type !== 'table'
    ) {
      id = focused.id
    }
  }

  if (!id) {
return
}

  const block = byId(id)

  if (!block) {
 clearBlockSelection();

 return 
}

  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault()
    removeBlock(block)

    return
  }

  if (e.key === 'Enter') {
    // Page links handle Enter themselves (open / navigate).
    if (block.type === 'page' && target.closest('.page-ref')) {
      return
    }
    e.preventDefault()
    addBelow(block)

    return
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    // Ensure the block is selected so subsequent arrows keep working.
    if (selectedBlockId !== block.id) {
      selectBlock(block.id)
    }
    handleArrow(block, e.key === 'ArrowDown' ? 1 : -1)

    return
  }

}

function onDocMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement

  if (isEditorOverlayTarget(target)) {
    return
  }

  if (slashState && !target.closest('.slash-menu')) {
    closeSlash()
  }
  if (emojiState && !target.closest('.emoji-menu')) {
    closeEmoji()
  }

  // Keep multi/single block selection when interacting inside any selected block
  // (so copy/paste and toolbar still work). Clear when clicking elsewhere.
  if (hasBlockSelection() && !marqueeActive) {
    const host = target.closest('[data-block-id]') as HTMLElement | null
    const id = host?.dataset.blockId
    if (!id || !isBlockSelected(id)) {
      if (!rootEl?.contains(target)) {
        clearBlockSelection()
      }
    }
  }

  if (
    hasActiveManagedSelection()
    && !rootEl?.contains(target)
    && !isFormatToolbarTarget(target)
  ) {
    clearTextRangeSelection()
  }
}

// Click in the empty tail area appends/focuses a trailing paragraph
function onTailClick() {
  if (editorProps.readonly) {
return
}
  // Ignore click that ended a marquee drag.
  if (marqueeLive || marqueeMoved) return

  const last = blocks[blocks.length - 1]

  if (last && last.type === 'paragraph' && spansToText(last.content) === '') {
    focusBlock(last.id, 'start')

    return
  }

  const nb = makeBlock('paragraph')
  blocks.push(nb)
  pushHistory(true)
  focusBlock(nb.id, 'start')
}

function placeholderFor(block: Block): string | undefined {
  if (block.type !== 'paragraph') {
return undefined
}

  if (focusedBlockId === block.id) {
return "Type '/' for commands..."
}

  if (blocks.length === 1 && spansToText(block.content) === '') {
    return '+ Start writing or type / for plugins'
  }

  return undefined
}

function isEditorTextFocused() {
  const root = rootEl
  if (!root) return false

  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active) || active === root) {
    return false
  }

  if (isEditorOverlayTarget(active)) {
    return false
  }

  return !!active.closest('[contenteditable="true"], textarea, input')
}

function blurEditorFocus() {
  const active = document.activeElement

  if (active instanceof HTMLElement && rootEl?.contains(active)) {
    active.blur()
  }

  rootEl?.blur()
  focusedBlockId = null
  focusedTableCell = null
  tableSelectedCells = []
  clearTextRangeSelection()
  bubble = null
  closeSlash()
  clearBlockSelection()
  endMarquee()
  window.getSelection()?.removeAllRanges()
}

function handleEditorEscape(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape') return false

  if (externalLinkModal) {
    closeExternalLinkModal()
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  if (linkContextMenu) {
    closeLinkContextMenu()
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  if (bubble) {
    bubble = null
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  if (marqueeActive || marqueeRect) {
    cancelMarqueeSelection()
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  if (hasActiveManagedSelection()) {
    clearTextRangeSelection()
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  if (hasBlockSelection()) {
    clearBlockSelection()
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  if (isEditorTextFocused()) {
    blurEditorFocus()
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  return false
}

function isBlockLocked(blockId: string) {
  return Boolean(editorProps.lockedBlocks?.[blockId])
}

function lockFor(blockId: string) {
  return editorProps.lockedBlocks?.[blockId] ?? null
}

function onBlockFocus(block: Block) {
  // Don't claim focus / soft-lock a block another peer is editing.
  if (isBlockLocked(block.id)) {
    focusedBlockId = null
    emit('focus-block', null)
    return
  }

  focusedBlockId = block.id
  emit('focus-block', block.id)

  if (slashState?.blockId !== block.id) {
    closeSlash()
  }
  if (emojiState?.blockId !== block.id) {
    closeEmoji()
  }

  if (block.type !== 'table') {
    focusedTableCell = null
    tableSelectedCells = []
  }

  if (!hasActiveManagedSelection()) {
    clearBlockSelection()
  }
}

// Keep parent presence in sync when focus is cleared elsewhere.
// Only emit on actual change — re-emitting every flush caused effect loops
// with App onFocusBlock → lockedBlocks → tree re-render → focus churn.
let lastEmittedFocusBlock: string | null | undefined = undefined
$effect(() => {
  const id = focusedBlockId
  if (id === lastEmittedFocusBlock) return
  lastEmittedFocusBlock = id
  emit('focus-block', id)
})

/** Tracks last applied vimMode prop so enable/disable only run on edges. */
let vimModeApplied = false

$effect(() => {
  const enabled = !!editorProps.vimMode
  if (enabled === vimModeApplied) return
  vimModeApplied = enabled

  if (enabled) {
    void (async () => {
      await setupVimEngine()
      untrack(() => {
        bindVimDocumentListeners()
        vimEngine?.enable()
      })
      // Land caret so hjkl works immediately after enabling.
      await tick()
      untrack(() => {
        if (!editorProps.vimMode || !vimEngine) return
        const first = focusedBlockId
          ? byId(focusedBlockId)
          : visibleBlocks.find((b) => isTextBlock(b.type))
        if (first && isTextBlock(first.type)) {
          const sel = itemRefs.get(first.id)?.getSelection()
          focusBlock(first.id, sel?.start ?? 'start')
        } else if (first) {
          selectBlock(first.id)
        } else {
          rootEl?.focus({ preventScroll: true })
        }
        refreshVimStatusline()
      })
    })()
  } else {
    untrack(() => {
      unbindVimDocumentListeners()
      vimEngine?.disable()
    })
    vimStatus = ''
    vimPendingKeys = ''
    vimCmdline = ''
    vimMessage = ''
    vimModeName = 'insert'
  }
})

$effect(() => {
  // Statusline position only — do not call enable() from here.
  void focusedBlockId
  void editorProps.vimMode
  if (editorProps.vimMode) refreshVimStatusline()
})

setContext(BLOCK_EDITOR_CTX, {
  setItemRef,
  placeholderFor,
  isSelected: (blockId: string) => isBlockSelected(blockId),
  textHighlightFor: textHighlightForBlock,
  dropPositionFor: (blockId: string) =>
    dropTarget && dropTarget.id === blockId ? dropTarget.position : null,
  isReadonly: (blockId: string) => editorProps.readonly || isBlockLocked(blockId),
  lockFor,
  isDragging: (blockId: string) => draggingId === blockId,
  directionFor,
  iconPickerRequestFor: (blockId: string) =>
    iconPickerRequest && iconPickerRequest.blockId === blockId
      ? { tab: iconPickerRequest.tab }
      : null,
  pagePickerRequestFor: (blockId: string) => pagePickerRequest?.blockId === blockId,
  listNumberFor: (blockId: string) => numbering.get(blockId),
  resolveBlock: (blockId: string) => byId(blockId),
  handleInput,
  handleEnter,
  handleBackspaceStart,
  handleDeleteEnd,
  handleArrow,
  handleTab,
  handleFormat,
  handlePasted,
  onBlockFocus,
  patchProps,
  selectBlock,
  addBelow,
  duplicateBlock,
  removeBlock,
  onDragHandleStart,
  onBlockPointerDown,
  onSelectionPointerDown,
  onTableCellFocus,
  onTableCellInput,
  handleTableFormat,
  handleTableTab,
  handleTableNavigate,
  onTableCellSelectionChange,
  onPageBlockCreate,
  onPageBlockNavigate,
  clearIconPickerRequest: () => { iconPickerRequest = null },
  clearPagePickerRequest: () => { pagePickerRequest = null },
  // Live getters — plain `pages: editorProps.pages` was snapshotted at setup and never
  // saw newly created pages, so page-ref blocks showed "Missing" after create.
  get upload() { return editorProps.upload },
  get pickMedia() { return editorProps.pickMedia },
  get editorDir() { return editorProps.editorDir },
  get pages() { return editorProps.pages },
  get currentPageId() { return editorProps.currentPageId },
  get voterId() { return editorProps.voterId },
  getContentRevision: () => contentRevision,
  vimAllowsTextInput: () => vimAllowsTextInput(),
  isVimEnabled: () => !!editorProps.vimMode,
  getVimEditRevision: () => vimEditRevision,
})


// Expose public API (bind:this)
export {
  undo,
  redo,
  canUndo,
  canRedo,
  formatToolbarState,
  applyToolbarMark,
  turnIntoBlock,
  indentFocusedBlock,
  outdentFocusedBlock,
  setFocusedAlign,
  setFocusedDir,
  setFocusedCalloutIcon,
  getTextCommentTarget,
  openCommentOnSelection,
  patchTableStyleForFocused as patchTableStyle,
  patchTableCellBackgroundForFocused as patchTableCellBackground,
}
export function focusFirst() {
  const first = visibleBlocks[0]
  if (first) focusBlock(first.id, 'start')
}
export function focusEnd() {
  const last = visibleBlocks[visibleBlocks.length - 1]
  if (last) focusBlock(last.id, 'end')
}

</script>


<!-- Complex block editor surface: keyboard/pointer/clipboard handlers are intentional. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={rootEl}
  class={[
    'block-editor outline-none',
    marqueeLive && 'block-editor--marquee',
    vimMode && 'block-editor--vim',
    vimMode && vimModeName !== 'insert' && vimModeName !== 'replace' && 'block-editor--vim-normal',
  ].filter(Boolean).join(' ')}
  dir={editorDir ?? 'ltr'}
  aria-label="Block editor"
  tabindex="-1"
  onkeydowncapture={onKeydownCapture}
  onkeydown={onRootKeydown}
  oncopycapture={onCopy}
  oncutcapture={onCut}
  onpastecapture={onPaste}
  ondragover={onDragOver}
  ondrop={onDrop}
  ondragend={onDragEnd}
  onclickcapture={onEditorClick}
  onpointerdowncapture={onEditorLinkPointerDown}
  oncontextmenucapture={onEditorContextMenu}
  onpointerdown={onDocPointerDown}
>
  {#if !readonly}
    <div class="be-marquee-surface be-marquee-surface--start" title="Drag to select blocks" aria-hidden="true"></div>
    <div class="be-marquee-surface be-marquee-surface--end" title="Drag to select blocks" aria-hidden="true"></div>
  {/if}

  <EditorBlockTree
    entries={renderEntries}
    lockedBlocks={editorProps.lockedBlocks ?? null}
  />

  {#if !readonly}
    <div
      class="editor-tail"
      role="presentation"
      onpointerdown={onDocPointerDown}
      onclick={onTailClick}
    ></div>
  {/if}

  {#if slashState && !readonly}
    <EditorSlashMenu
      bind:this={slashMenuRef}
      query={slashState.query}
      position={slashState.position}
      onselect={onSlashSelect}
      onclose={closeSlash}
    />
  {/if}

  {#if emojiState && !readonly}
    <EditorEmojiMenu
      bind:this={emojiMenuRef}
      query={emojiState.query}
      position={emojiState.position}
      onselect={onEmojiSelect}
      onclose={closeEmoji}
    />
  {/if}

  {#if showBubbleToolbar && bubble && !readonly}
    <EditorBubbleToolbar
      bind:this={bubbleToolbarRef}
      position={bubble.position}
      activeMarks={bubble.activeMarks}
      currentLink={bubble.currentLink}
      currentColor={bubble.currentColor}
      currentHighlight={bubble.currentHighlight}
      blockType={bubble.blockType}
      pages={pages ?? []}
      {currentPageId}
      onmark={onBubbleMark}
      onturninto={onBubbleTurnInto}
      oncomment={onBubbleComment}
    />
  {/if}

  {#if marqueeRect}
    <div
      class="be-marquee"
      style="position:fixed;left:{marqueeRect.left}px;top:{marqueeRect.top}px;width:{Math.max(marqueeRect.width,2)}px;height:{Math.max(marqueeRect.height,2)}px;z-index:10000;pointer-events:none;box-sizing:border-box;border:none;border-radius:0;background:rgb(35 131 226 / 0.18);box-shadow:none"
      aria-hidden="true"
      use:portalToBody
    ></div>
  {/if}

  {#if vimMode}
    <div
      class={['be-vim-bar', `be-vim-bar--${vimModeName}`, vimModeName === 'cmdline' && 'be-vim-bar--cmdline'].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-label="Vim status"
      use:portalToBody
    >
      {#if vimModeName === 'cmdline'}
        <label class="be-vim-cmdline">
          <span class="be-vim-cmdline__prompt">{vimCmdlinePrompt}</span>
          <input
            bind:this={vimCmdlineInputRef}
            class="be-vim-cmdline__input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            value={vimCmdline}
            aria-label={vimCmdlinePrompt === '/' ? 'Vim search' : 'Vim command'}
            oninput={(e) => onVimCmdlineInput((e.currentTarget as HTMLInputElement).value)}
            onkeydown={onVimCmdlineKeydown}
          />
        </label>
      {:else}
        <div class="be-vim-bar__mode">
          <span class="be-vim-bar__mode-tag">{vimStatus || 'NORMAL'}</span>
          {#if vimPendingKeys}
            <span class="be-vim-bar__pending">{vimPendingKeys}</span>
          {/if}
        </div>
        <div class="be-vim-bar__mid">
          {#if vimMessage}
            <span class="be-vim-bar__message">{vimMessage}</span>
          {:else if vimModeName === 'insert'}
            <span class="be-vim-bar__hint">Esc → NORMAL</span>
          {:else if vimModeName === 'normal'}
            <span class="be-vim-bar__hint">:s / :%s replace · / search · n N · i insert</span>
          {:else if vimModeName === 'visual' || vimModeName === 'visual-line'}
            <span class="be-vim-bar__hint">d/y/c · Esc cancel</span>
          {:else}
            <span class="be-vim-bar__hint">…</span>
          {/if}
        </div>
        <div class="be-vim-bar__right">
          <span class="be-vim-bar__pos">{vimPos.line},{vimPos.col}</span>
          <span class="be-vim-bar__sep">|</span>
          <span class="be-vim-bar__pct">{vimPos.percent}%</span>
        </div>
      {/if}
    </div>
  {/if}

  {#if linkContextMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus a11y_no_static_element_interactions -->
    <div
      class="be-link-context-menu"
      role="menu"
      tabindex="-1"
      aria-label="Link options"
      style="left:{linkContextMenu.x}px;top:{linkContextMenu.y}px"
      use:portalToBody
      onmousedown={(e) => e.preventDefault()}
      onpointerdown={(e) => e.stopPropagation()}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <div class="be-link-context-menu__url" title={linkContextMenu.href}>
        {linkContextMenu.href}
      </div>
      <button
        type="button"
        class="be-link-context-menu__item"
        role="menuitem"
        onclick={onLinkContextOpen}
      >
        {linkContextMenu.pageId ? 'Open page' : 'Open link…'}
      </button>
      <button
        type="button"
        class="be-link-context-menu__item"
        role="menuitem"
        onclick={onLinkContextCopyLink}
      >
        Copy link
      </button>
      <button
        type="button"
        class="be-link-context-menu__item"
        role="menuitem"
        onclick={onLinkContextCopyText}
      >
        Copy link text
      </button>
      {#if !readonly}
        <div class="be-link-context-menu__sep" role="separator"></div>
        <button
          type="button"
          class="be-link-context-menu__item"
          role="menuitem"
          onclick={onLinkContextEdit}
        >
          Edit link…
        </button>
        <button
          type="button"
          class="be-link-context-menu__item be-link-context-menu__item--danger"
          role="menuitem"
          onclick={onLinkContextRemove}
        >
          Remove link
        </button>
      {/if}
    </div>
  {/if}

  {#if externalLinkModal}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus a11y_no_static_element_interactions -->
    <div
      class="be-external-link-modal"
      role="presentation"
      use:portalToBody
      onmousedown={(e) => e.stopPropagation()}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        if (e.target === e.currentTarget) closeExternalLinkModal()
      }}
    >
      <div
        class="be-external-link-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Open external link"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="be-external-link-modal__title">Open external link?</div>
        <p class="be-external-link-modal__hint">
          This link leaves the document. Confirm only if you trust the destination.
        </p>
        <div class="be-external-link-modal__url" title={externalLinkModal.url}>
          {externalLinkModal.url}
        </div>
        <div class="be-external-link-modal__actions">
          <button
            type="button"
            class="be-external-link-modal__btn"
            onclick={copyExternalLink}
          >
            {externalLinkModal.copied ? 'Copied' : 'Copy'}
          </button>
          <div class="be-external-link-modal__actions-end">
            <button
              type="button"
              class="be-external-link-modal__btn"
              onclick={closeExternalLinkModal}
            >
              Cancel
            </button>
            <button
              type="button"
              class="be-external-link-modal__btn be-external-link-modal__btn--primary"
              onclick={openExternalLinkInBrowser}
            >
              Open link
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>


<style>

.block-editor {
  position: relative;
  /* Keep marquee strips + block gutters in one stacking context so handles win. */
  isolation: isolate;
  background: var(--xpe-background, #fff);
  color: var(--xpe-foreground, #1f2937);
  min-height: 40vh;
  /*
   * No extra inline padding — body text must line up with the page title.
   * Marquee strips hang into the page content insets (outside the text column).
   */
  --be-marquee-gutter-start: var(--page-content-inset-start, 52px);
  --be-marquee-gutter-end: var(--page-content-inset-end, 44px);
  padding-inline: 0;
  overflow: visible;
}

.block-editor--marquee,
.block-editor--marquee :global([contenteditable='true']),
.block-editor--marquee :global(input),
.block-editor--marquee :global(textarea) {
  cursor: crosshair !important;
  user-select: none !important;
}

/* Invisible side strips hang outside the text column into page margins.
 * Stay *below* block gutters/drag handles (z-index 20+) so reorder drag still works. */
.be-marquee-surface {
  position: absolute;
  inset-block: 0;
  z-index: 1;
  cursor: crosshair;
  background: transparent;
}

.be-marquee-surface--start {
  inset-inline-start: calc(-1 * var(--be-marquee-gutter-start));
  width: var(--be-marquee-gutter-start);
}

.be-marquee-surface--end {
  inset-inline-end: calc(-1 * var(--be-marquee-gutter-end));
  width: var(--be-marquee-gutter-end);
}

.editor-tail {
  position: relative;
  z-index: 1;
  min-height: 72px;
  /* Expand into side insets so empty area is easy to drag-select. */
  margin-inline-start: calc(-1 * var(--be-marquee-gutter-start));
  margin-inline-end: calc(-1 * var(--be-marquee-gutter-end));
  padding-inline-start: var(--be-marquee-gutter-start);
  padding-inline-end: var(--be-marquee-gutter-end);
  cursor: crosshair;
}

/* Block caret in normal/visual. */
.block-editor--vim-normal :global([contenteditable='true']) {
  caret-color: var(--xpe-accent, #2383e2);
}

.block-editor--vim-normal :global([contenteditable='true']) {
  cursor: default;
}

/* Solid full-width vim statusline (bottom of the viewport). */
.be-vim-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 11000;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 28px;
  padding: 0 12px;
  box-sizing: border-box;
  font: 600 12px/28px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.02em;
  color: #e8e8e8;
  background: #2b2b2b;
  border-top: 1px solid rgb(0 0 0 / 0.35);
  box-shadow: 0 -4px 18px rgb(0 0 0 / 0.18);
  pointer-events: none;
  user-select: none;
}

.be-vim-bar--insert {
  background: #1f4d36;
  color: #d9f5e5;
}

.be-vim-bar--replace {
  background: #5c3d10;
  color: #ffe7b8;
}

.be-vim-bar--visual,
.be-vim-bar--visual-line {
  background: #1a3a66;
  color: #d7e8ff;
}

.be-vim-bar--normal,
.be-vim-bar--operator-pending {
  background: #2b2b2b;
  color: #e8e8e8;
}

.be-vim-bar--cmdline,
.be-vim-bar--cmdline.be-vim-bar--command,
.be-vim-bar--search {
  background: #1a1a1a;
  color: #f0f0f0;
  pointer-events: auto;
}

.be-vim-cmdline {
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  min-width: 0;
  font: inherit;
}

.be-vim-cmdline__prompt {
  flex-shrink: 0;
  padding-right: 2px;
  color: #ffd666;
  font-weight: 700;
}

.be-vim-cmdline__input {
  flex: 1;
  min-width: 0;
  height: 28px;
  margin: 0;
  padding: 0 4px 0 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  caret-color: #ffd666;
}

.be-vim-bar__message {
  color: #ffd666;
  font-weight: 600;
}

.be-vim-bar__mode {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.be-vim-bar__mode-tag {
  display: inline-block;
  min-width: 5.5em;
  padding: 0 8px;
  border-radius: 2px;
  background: rgb(255 255 255 / 0.12);
  text-align: center;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.be-vim-bar--insert .be-vim-bar__mode-tag {
  background: rgb(255 255 255 / 0.18);
}

.be-vim-bar__pending {
  color: #ffd666;
  min-width: 2em;
}

.be-vim-bar__mid {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.78;
  font-weight: 500;
}

.be-vim-bar__hint {
  opacity: 0.9;
}

.be-vim-bar__right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.be-vim-bar__sep {
  opacity: 0.45;
}

.be-vim-bar__pos,
.be-vim-bar__pct {
  opacity: 0.95;
}

/* Keep page content clear of the solid status bar while vim is on. */
.block-editor--vim {
  padding-bottom: 36px;
}

.be-external-link-modal {
  position: fixed;
  inset: 0;
  z-index: 12050;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(15 15 15 / 0.42);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.be-external-link-modal__panel {
  width: min(440px, 100%);
  padding: 18px 18px 14px;
  border-radius: 14px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  background: var(--xpe-popover-bg, #fff);
  box-shadow: 0 24px 60px rgb(15 15 15 / 0.28);
  color: var(--xpe-foreground, #37352f);
}

.be-external-link-modal__title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-bottom: 6px;
}

.be-external-link-modal__hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--xpe-muted-foreground, #9b9a97);
}

.be-external-link-modal__url {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  word-break: break-all;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--xpe-muted, #f7f6f3);
  border: 1px solid var(--xpe-border, #e9e9e7);
  color: var(--xpe-primary, #2383e2);
  user-select: text;
  cursor: text;
  max-height: 140px;
  overflow: auto;
}

.be-external-link-modal__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.be-external-link-modal__actions-end {
  display: flex;
  gap: 8px;
  margin-inline-start: auto;
}

.be-external-link-modal__btn {
  height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  background: transparent;
  color: var(--xpe-foreground, #37352f);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.be-external-link-modal__btn:hover {
  background: var(--xpe-hover, #f1f1ef);
}

.be-external-link-modal__btn--primary {
  border-color: transparent;
  background: var(--xpe-primary, #2383e2);
  color: #fff;
}

.be-external-link-modal__btn--primary:hover {
  filter: brightness(1.05);
  background: var(--xpe-primary, #2383e2);
}

.be-link-context-menu {
  position: fixed;
  z-index: 12060;
  min-width: 200px;
  max-width: min(320px, calc(100vw - 16px));
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  background: var(--xpe-popover-bg, #fff);
  box-shadow: 0 16px 40px rgb(15 15 15 / 0.16);
  color: var(--xpe-foreground, #37352f);
  /* Anchor under the link; avoid covering the linked text. */
  transform-origin: top left;
}

.be-link-context-menu__url {
  margin: 2px 6px 6px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--xpe-muted, #f7f6f3);
  border: 1px solid var(--xpe-border, #e9e9e7);
  color: var(--xpe-primary, #2383e2);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  /* One-line clip with … — full URL remains in the title attribute. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  user-select: text;
  cursor: text;
}

.be-link-context-menu__item {
  display: block;
  width: 100%;
  border: none;
  border-radius: 7px;
  background: transparent;
  padding: 8px 10px;
  text-align: start;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--xpe-foreground, #37352f);
  cursor: pointer;
}

.be-link-context-menu__item:hover {
  background: var(--xpe-hover, #f1f1ef);
}

.be-link-context-menu__item--danger {
  color: #e03e3e;
}

.be-link-context-menu__item--danger:hover {
  background: rgb(224 62 62 / 0.08);
}

.be-link-context-menu__sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--xpe-border, #e9e9e7);
}

</style>
