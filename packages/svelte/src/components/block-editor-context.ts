import type { Block, InlineSpan, MarkName, TableCellCoord } from '@xproeditor/core'

export interface BlockEditorContext {
  setItemRef: (blockId: string, el: unknown) => void
  placeholderFor: (block: Block) => string | undefined
  isSelected: (blockId: string) => boolean
  textHighlightFor: (blockId: string) => { start: number; end: number } | null
  dropPositionFor: (blockId: string) => 'before' | 'after' | 'left' | 'right' | null
  isReadonly: (blockId: string) => boolean
  lockFor: (blockId: string) => { name: string; color: string } | null
  isDragging: (blockId: string) => boolean
  iconPickerRequestFor: (blockId: string) => { tab: 'emoji' | 'icon' } | null
  pagePickerRequestFor: (blockId: string) => boolean
  listNumberFor: (blockId: string) => number | undefined
  /** Live block by id (after patchProps may replace object identity). */
  resolveBlock?: (blockId: string) => Block | undefined
  handleInput: (block: Block, spans: InlineSpan[], caret: number | null) => void
  handleEnter: (block: Block, offsets: { start: number; end: number }) => void
  handleBackspaceStart: (block: Block) => void
  handleDeleteEnd: (block: Block) => void
  handleArrow: (block: Block, dir: 1 | -1) => void
  handleTab: (block: Block, shift: boolean) => void
  handleFormat: (block: Block, mark: MarkName, offsets?: { start: number; end: number }) => void
  handlePasted: (block: Block, payload: { html: string; text: string; files: File[]; offsets: { start: number; end: number } }) => void
  onBlockFocus: (block: Block) => void
  patchProps: (block: Block, patch: Record<string, unknown>) => void
  selectBlock: (blockId: string) => void
  addBelow: (block: Block) => void
  duplicateBlock: (block: Block) => void
  removeBlock: (block: Block) => void
  onDragHandleStart: (block: Block, e: DragEvent) => void
  onBlockPointerDown: (block: Block, e: PointerEvent) => void
  onSelectionPointerDown: (block: Block, payload: { shiftKey: boolean; clientX: number; clientY: number }) => void
  onTableCellFocus: (block: Block, payload: { row: number; col: number; shiftKey: boolean }) => void
  onTableCellInput: (block: Block, payload: { row: number; col: number; content: InlineSpan[]; caret: number | null }) => void
  handleTableFormat: (block: Block, payload: { row: number; col: number; mark: MarkName }) => void
  handleTableTab: (block: Block, payload: { row: number; col: number; shift: boolean }) => void
  handleTableNavigate: (block: Block, payload: { row: number; col: number; direction: 'up' | 'down' | 'left' | 'right' }) => void
  onTableCellSelectionChange: (block: Block, cells: TableCellCoord[]) => void
  onPageBlockCreate: (blockId: string, title: string) => void
  onPageBlockNavigate: (pageId: string) => void
  clearIconPickerRequest: () => void
  clearPagePickerRequest: () => void
  upload?: (file: File) => Promise<string>
  pickMedia?: (options: { accept: string[]; title?: string }) => Promise<{ url: string; alt?: string; caption?: string } | null>
  editorDir?: 'ltr' | 'rtl'
  /** Resolved writing direction (inherits previous line when empty). */
  directionFor?: (blockId: string) => 'ltr' | 'rtl'
  pages?: Array<{ id: string; title: string; icon?: string }>
  currentPageId?: string
  /** Stable voter identity for poll blocks (e.g. webxdc selfAddr). */
  voterId?: string
  /**
   * Bumped when span marks/content change without remounting blocks
   * (e.g. highlight/color). Text blocks re-sync contenteditable DOM.
   */
  getContentRevision?: () => number
  /**
   * When vim mode is on and not insert/replace, text blocks must not accept typing.
   * Returns true if the contenteditable may receive text input.
   */
  vimAllowsTextInput?: () => boolean
  /** True when modal vim keybindings are enabled. */
  isVimEnabled?: () => boolean
  /** Bumped when vim mode changes so text blocks recompute contenteditable. */
  getVimEditRevision?: () => number
}

export const BLOCK_EDITOR_CTX = Symbol('block-editor-context')
