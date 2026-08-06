import { escapeHtml, spansToHtml } from './html'
import { cloneBlock } from './ops'
import { blockToPlainText } from './serialize'
import {
  getResolvedTableWidth,
  normalizeTableData,
  tableCellStyle,
  tableWrapperStyle,
} from './table'
import type { Block, TableCell } from './types'
import { isBlocksContent, isTextBlock } from './types'

/** Custom MIME for lossless round-trip paste inside xlog. */
export const BLOCKS_CLIPBOARD_MIME = 'application/x-xlog-blocks+json'

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Clipboard often exposes the same bitmap twice (via `files` and `items`) with
 * different auto-generated names or lastModified. Prefer size+type so one paste
 * yields one image file.
 */
function clipboardImageFileKey(file: File): string {
  return `${file.size}|${file.type || 'image/*'}`
}

export function getClipboardImageFiles(data: DataTransfer): File[] {
  const seen = new Set<string>()
  const files: File[] = []

  const add = (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return

    const key = clipboardImageFileKey(file)
    if (seen.has(key)) return

    seen.add(key)
    files.push(file)
  }

  // Prefer `items` first (more reliable for screenshots), then `files`.
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      add(item.getAsFile())
    }
  }

  for (const file of Array.from(data.files ?? [])) {
    add(file)
  }

  return files
}

export function isEmbeddableImageUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('data:image/')) return true

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function cloneBlocksForClipboard(blocks: Block[]): Block[] {
  return blocks.map(b => cloneBlock(b, true))
}

export function blocksToPlainTextExport(blocks: Block[]): string {
  return blocks.map(blockToPlainText).join('\n')
}

function dirAttr(block: Block): string {
  const dir = block.props.dir

  return dir && dir !== 'auto' ? ` dir="${dir}"` : ''
}

function renderTableCellHtml(
  cell: TableCell,
  rowIdx: number,
  _colIdx: number,
  hasHeader: boolean,
  style: ReturnType<typeof normalizeTableData>['style'],
): string {
  if (cell.hidden) {
    return ''
  }

  const cellTag = hasHeader && rowIdx === 0 ? 'th' : 'td'
  const attrs: string[] = []
  const inlineStyle = Object.entries(tableCellStyle(cell, rowIdx, hasHeader, style))
    .map(([key, value]) => `${key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}:${value}`)
    .join(';')

  if (cell.colspan && cell.colspan > 1) {
    attrs.push(`colspan="${cell.colspan}"`)
  }

  if (cell.rowspan && cell.rowspan > 1) {
    attrs.push(`rowspan="${cell.rowspan}"`)
  }

  if (inlineStyle) {
    attrs.push(`style="${inlineStyle}"`)
  }

  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''

  return `<${cellTag}${attrStr}>${spansToHtml(cell.content)}</${cellTag}>`
}

function blockToHtmlFragment(block: Block): string {
  const indent = block.props.indent ?? 0
  const indentAttr = indent ? ` style="margin-inline-start:${indent * 28}px"` : ''
  const direction = dirAttr(block)

  switch (block.type) {
    case 'heading_1':
      return `<h1${direction}${indentAttr}>${spansToHtml(block.content)}</h1>`
    case 'heading_2':
      return `<h2${direction}${indentAttr}>${spansToHtml(block.content)}</h2>`
    case 'heading_3':
      return `<h3${direction}${indentAttr}>${spansToHtml(block.content)}</h3>`
    case 'heading_4':
      return `<h4${direction}${indentAttr}>${spansToHtml(block.content)}</h4>`
    case 'heading_5':
      return `<h5${direction}${indentAttr}>${spansToHtml(block.content)}</h5>`
    case 'heading_6':
      return `<h6${direction}${indentAttr}>${spansToHtml(block.content)}</h6>`
    case 'quote':
      return `<blockquote${direction}${indentAttr}><p>${spansToHtml(block.content)}</p></blockquote>`
    case 'code':
      return `<pre><code>${escapeHtml(block.props.code ?? '')}</code></pre>`
    case 'divider':
      return '<hr>'
    case 'image': {
      const url = block.props.url ?? ''

      if (!url) {
return ''
}

      const alt = escapeHtml(block.props.caption ?? '')

      return `<img src="${escapeHtml(url)}" alt="${alt}">`
    }
    case 'poll': {
      const question = spansToHtml(block.content) || 'Poll'
      const options = (block.props.pollOptions ?? [])
        .map((opt) => `<li>${escapeHtml(opt.text || 'Option')} (${opt.votes?.length ?? 0})</li>`)
        .join('')
      return `<div data-block-type="poll"><p><strong>${question}</strong></p><ul>${options}</ul></div>`
    }
    case 'table': {
      const table = normalizeTableData(block.props.table)

      if (!table.rows.length) {
return ''
}

      const width = getResolvedTableWidth(table.width)
      const tableStyle = [
        ...Object.entries(tableWrapperStyle(table.style, width)).map(([k, v]) => `${k}:${v}`),
        'border-collapse:collapse',
      ].join(';')

      const rows = table.rows.map((row, i) => {
        const cells = row
          .map((cell, cIdx) => renderTableCellHtml(cell, i, cIdx, table.hasHeader, table.style))
          .filter(Boolean)
          .join('')

        return `<tr>${cells}</tr>`
      }).join('')

      return `<table style="${tableStyle}">${rows}</table>`
    }
    default:
      if (isTextBlock(block.type)) {
        return `<p${direction}${indentAttr}>${spansToHtml(block.content)}</p>`
      }

      return ''
  }
}

/** HTML body for external apps; lists are grouped into ul/ol. */
export function blocksToHtmlContent(blocks: Block[]): string {
  const parts: string[] = []
  let i = 0

  while (i < blocks.length) {
    const b = blocks[i]

    if (b.type === 'bulleted_list_item') {
      const items: string[] = []

      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        items.push(`<li>${spansToHtml(blocks[i].content)}</li>`)
        i++
      }

      parts.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (b.type === 'numbered_list_item') {
      const items: string[] = []

      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        items.push(`<li>${spansToHtml(blocks[i].content)}</li>`)
        i++
      }

      parts.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const frag = blockToHtmlFragment(b)

    if (frag) {
parts.push(frag)
}

    i++
  }

  return parts.join('')
}

export function blocksToClipboardJson(blocks: Block[]): string {
  return JSON.stringify({
    format: 'blocks',
    version: 1,
    blocks: cloneBlocksForClipboard(blocks),
  })
}

export function blocksToClipboardPayload(blocks: Block[]): { json: string; plain: string; html: string } {
  const json = blocksToClipboardJson(blocks)
  const plain = blocksToPlainTextExport(blocks)
  const body = blocksToHtmlContent(blocks)
  const html = `<meta charset="utf-8"><div data-xlog-blocks="${encodeURIComponent(json)}">${body}</div>`

  return { json, plain, html }
}

function parseBlocksJson(json: string): Block[] | null {
  try {
    const parsed = JSON.parse(json) as unknown

    if (!parsed || typeof parsed !== 'object') {
return null
}

    if (isBlocksContent(parsed)) {
      return cloneBlocksForClipboard(parsed.blocks)
    }

    const blocks = (parsed as { blocks?: Block[] }).blocks

    if (Array.isArray(blocks) && blocks.length > 0) {
      return blocks.map(b => cloneBlock(b, true))
    }
  } catch {
    /* ignore malformed clipboard */
  }

  return null
}

function parseBlocksFromHtml(html: string): Block[] | null {
  const match = html.match(/data-xlog-blocks="([^"]+)"/)

  if (!match?.[1]) {
return null
}

  try {
    return parseBlocksJson(decodeURIComponent(match[1]))
  } catch {
    return null
  }
}

/** Read xlog-native blocks from clipboard (null = use default text/html paste). */
export function parseBlocksFromClipboardData(data: DataTransfer): Block[] | null {
  const custom = data.getData(BLOCKS_CLIPBOARD_MIME)

  if (custom) {
    const blocks = parseBlocksJson(custom)

    if (blocks) {
return blocks
}
  }

  const html = data.getData('text/html')

  if (html) {
    const fromAttr = parseBlocksFromHtml(html)

    if (fromAttr) {
return fromAttr
}
  }

  const plain = data.getData('text/plain')

  if (plain.startsWith('{') && plain.includes('"format"') && plain.includes('"blocks"')) {
    const blocks = parseBlocksJson(plain)

    if (blocks) {
return blocks
}
  }

  return null
}

/** Write blocks to a DataTransfer (copy/cut events). */
export function writeBlocksToClipboardData(data: DataTransfer, blocks: Block[]): void {
  const { json, plain, html } = blocksToClipboardPayload(blocks)
  data.clearData()
  data.setData('text/plain', plain)
  data.setData('text/html', html)

  try {
    data.setData(BLOCKS_CLIPBOARD_MIME, json)
  } catch {
    /* some browsers restrict custom MIME on DataTransfer */
  }
}
