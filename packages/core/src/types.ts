/**
 * Block-based document model used by the custom ProEditor
 * and the public docs renderer. Stored in `document.content` as:
 * { format: 'blocks', version: 1, blocks: Block[], text: string }
 */

export type BlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'heading_4'
  | 'heading_5'
  | 'heading_6'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'to_do'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'image'
  | 'table'
  | 'page'
  /** Collaborative poll / voting block. */
  | 'poll'
  /** Side-by-side column row (column_list / vbox). */
  | 'column_list'
  /** Single column slot inside a column_list. */
  | 'column'

/** One option in a poll block. */
export interface PollOption {
  id: string
  text: string
  /** Stable voter ids (webxdc addr or local device id). */
  votes: string[]
}

export interface InlineMarks {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  code?: boolean
  link?: string
  color?: string
  highlight?: string
}

export type MarkName = keyof InlineMarks

/** A run of text sharing the same marks. */
export interface InlineSpan {
  text: string
  marks?: InlineMarks
}

export type TableCellAlign = 'left' | 'center' | 'right' | 'justify'

export type TableBorderWidth = 0 | 1 | 2 | 3 | 4

export type TableBorderStyleKind = 'solid' | 'dashed' | 'dotted' | 'none'

export interface TableBorderStyle {
  color?: string
  width?: TableBorderWidth
  style?: TableBorderStyleKind
}

export interface TableStyle {
  background?: string
  headerBackground?: string
  border?: TableBorderStyle
}

export interface TableCell {
  content: InlineSpan[]
  colspan?: number
  rowspan?: number
  align?: TableCellAlign
  background?: string
  hidden?: boolean
}

export interface TableWidth {
  /** `auto` sizes from content; `percent` / `pixel` are fixed. */
  mode: 'percent' | 'pixel' | 'auto'
  value: number
}

export interface TableData {
  hasHeader: boolean
  rows: TableCell[][]
  width?: TableWidth
  style?: TableStyle
  /**
   * When true, the table breaks out of the text column (page content insets /
   * page padding) for a full-width layout — like the editor’s full-width table.
   */
  expanded?: boolean
  /** Per-column widths (index matches column). Used by the width toolbar for the selected column. */
  columnWidths?: TableWidth[]
}

export interface TableCellCoord {
  row: number
  col: number
}

export interface BlockProps {
  /** list / to_do / toggle nesting depth (flat model, block rendering) */
  indent?: number
  /** to_do */
  checked?: boolean
  /** toggle */
  collapsed?: boolean
  /** code */
  language?: string
  code?: string
  /** image */
  url?: string
  caption?: string
  /** image width percent (10-100); also column flex share percent in column layouts */
  width?: number
  /** callout */
  icon?: string
  color?: string
  /** table */
  table?: TableData
  /** page reference */
  pageId?: string
  pageTitle?: string
  pageIcon?: string
  /** poll */
  pollOptions?: PollOption[]
  /** Allow selecting more than one option */
  pollAllowMultiple?: boolean
  /** When true, voting is locked */
  pollClosed?: boolean
  /** text direction */
  dir?: 'auto' | 'ltr' | 'rtl'
  /**
   * When true, `dir` was set via the format toolbar and should not be
   * overwritten by auto-detection from content. Cleared when content is
   * emptied or the user picks Auto.
   */
  dirManual?: boolean
  align?: 'left' | 'center' | 'right'
}

export interface Block {
  id: string
  type: BlockType
  content: InlineSpan[]
  props: BlockProps
}

export interface BlocksContent {
  format: 'blocks'
  version: 1
  blocks: Block[]
  /** derived plain text for backend full-text search (content->>'text') */
  text: string
}

/** Block types whose main body is editable rich text. */
export const TEXT_BLOCK_TYPES: BlockType[] = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'heading_4',
  'heading_5',
  'heading_6',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
]

/** Block types that participate in flat indent nesting. */
export const INDENTABLE_TYPES: BlockType[] = [
  'paragraph',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
]

export function isTextBlock(type: BlockType): boolean {
  return TEXT_BLOCK_TYPES.includes(type)
}

export function isBlocksContent(content: unknown): content is BlocksContent {
  return (
    !!content &&
    typeof content === 'object' &&
    (content as Record<string, unknown>).format === 'blocks' &&
    Array.isArray((content as Record<string, unknown>).blocks)
  )
}
