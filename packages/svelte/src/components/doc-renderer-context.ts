import type { Block, TableCell } from '@xproeditor/core'

export interface DocRendererContext {
  listNumber: (blockId: string) => number
  anchorFor: (blockId: string) => string | undefined
  isCopiedAnchor: (anchorId: string) => boolean
  openLightbox: (url: string) => void
  editorDir?: 'ltr' | 'rtl'
  isCollapsed: (block: Block) => boolean
  setCollapsed: (block: Block, collapsed: boolean) => void
  blockDirection: (block: Block) => 'ltr' | 'rtl'
  inlineHtml: (block: Block) => string
  headingTag: (type: string) => string
  highlightCode: (code: string, language?: string) => string
  tableForBlock: (block: Block) => ReturnType<typeof import('@xproeditor/core').normalizeTableData>
  renderCellStyle: (cell: TableCell, rowIdx: number, hasHeader: boolean, block: Block) => string
  copyAnchor: (id: string) => void
}

export const DOC_RENDERER_CTX = Symbol('doc-renderer-context')
