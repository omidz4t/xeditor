import { parseInlineNodes } from './html'
import {
  htmlFragmentToMarkdownSource,
  looksLikeMarkdown,
  markdownToBlocks,
} from './markdown'
import { applyBaseIndent, createBlock, generateBlockId, normalizeSpans } from './ops'
import { normalizeTableData, tableCellFromText } from './table'
import type { Block, BlockType, InlineMarks, InlineSpan, TableCell } from './types'
import { isBlocksContent } from './types'

// ─── TipTap JSON → blocks ─────────────────────────────────────────────────────

interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: TiptapMark[]
  text?: string
}

function tiptapMarksToInline(marks?: TiptapMark[]): InlineMarks | undefined {
  if (!marks || marks.length === 0) {
return undefined
}

  const out: InlineMarks = {}

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold': out.bold = true; break
      case 'italic': out.italic = true; break
      case 'underline': out.underline = true; break
      case 'strike': out.strikethrough = true; break
      case 'code': out.code = true; break
      case 'link': {
        const href = mark.attrs?.href

        if (typeof href === 'string') {
out.link = href
}

        break
      }
      case 'textStyle': {
        const color = mark.attrs?.color

        if (typeof color === 'string') {
out.color = color
}

        break
      }
      case 'highlight': {
        const color = mark.attrs?.color
        out.highlight = typeof color === 'string' ? color : '#fef08a'
        break
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined
}

function tiptapInlineToSpans(nodes?: TiptapNode[]): InlineSpan[] {
  if (!nodes) {
return []
}

  const spans: InlineSpan[] = []

  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      spans.push({ text: node.text, marks: tiptapMarksToInline(node.marks) })
    } else if (node.type === 'hardBreak') {
      spans.push({ text: '\n' })
    } else if (node.type === 'inlineIcon') {
      const name = node.attrs?.emoji ?? node.attrs?.icon ?? ''

      if (typeof name === 'string' && name) {
spans.push({ text: name })
}
    } else if (node.content) {
      spans.push(...tiptapInlineToSpans(node.content))
    }
  }

  return normalizeSpans(spans)
}

function parseColorFromStyle(style: string, property: 'color' | 'background-color'): string | undefined {
  const match = style.match(new RegExp(`${property}\\s*:\\s*([^;]+)`, 'i'))

  return match?.[1]?.trim()
}

function parseHtmlTableCell(cell: Element): TableCell {
  const content = normalizeSpans(parseInlineNodes(cell.childNodes))
  const colspan = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10)
  const rowspan = Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10)
  const style = cell.getAttribute('style') ?? ''
  const background = parseColorFromStyle(style, 'background-color') ?? cell.getAttribute('bgcolor') ?? undefined
  const textAlign = (cell as HTMLElement).style?.textAlign || style.match(/text-align:\s*([^;]+)/i)?.[1]?.trim()
  const align = textAlign === 'center' || textAlign === 'right' || textAlign === 'justify' || textAlign === 'left'
    ? textAlign
    : undefined

  return {
    content: content.length > 0 ? content : tableCellFromText(cell.textContent?.trim() ?? '').content,
    colspan: colspan > 1 ? colspan : undefined,
    rowspan: rowspan > 1 ? rowspan : undefined,
    background,
    align: align === 'left' ? undefined : align,
  }
}

function tiptapTableCell(node: TiptapNode): TableCell {
  return {
    content: tiptapInlineToSpans(node.content),
    colspan: typeof node.attrs?.colspan === 'number' && node.attrs.colspan > 1 ? node.attrs.colspan : undefined,
    rowspan: typeof node.attrs?.rowspan === 'number' && node.attrs.rowspan > 1 ? node.attrs.rowspan : undefined,
  }
}

function tiptapNodeText(node: TiptapNode): string {
  if (node.text) {
return node.text
}

  return (node.content ?? []).map(tiptapNodeText).join('')
}

function dirFromAttrs(attrs?: Record<string, unknown>): 'rtl' | 'ltr' | undefined {
  const dir = attrs?.dir

  return dir === 'rtl' || dir === 'ltr' ? dir : undefined
}

function dirFromElement(el: Element): 'rtl' | 'ltr' | undefined {
  const dir = el.getAttribute('dir')

  return dir === 'rtl' || dir === 'ltr' ? dir : undefined
}

function propsWithDir(el: Element, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const dir = dirFromElement(el)

  return dir ? { ...extra, dir } : extra
}

function convertTiptapNodes(nodes: TiptapNode[], indent: number, out: Block[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        const spans = tiptapInlineToSpans(node.content)
        out.push(createBlock('paragraph', {
          content: spans,
          props: { ...(indent ? { indent } : {}), ...(dirFromAttrs(node.attrs) ? { dir: dirFromAttrs(node.attrs) } : {}) },
        }))
        break
      }
      case 'heading': {
        const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
        out.push(createBlock(`heading_${level}` as BlockType, {
          content: tiptapInlineToSpans(node.content),
          props: dirFromAttrs(node.attrs) ? { dir: dirFromAttrs(node.attrs) } : {},
        }))
        break
      }
      case 'bulletList':
      case 'orderedList': {
        const itemType: BlockType = node.type === 'bulletList' ? 'bulleted_list_item' : 'numbered_list_item'

        for (const li of node.content ?? []) {
          let firstParagraphUsed = false

          for (const child of li.content ?? []) {
            if (child.type === 'paragraph' && !firstParagraphUsed) {
              out.push(createBlock(itemType, {
                content: tiptapInlineToSpans(child.content),
                props: indent ? { indent } : {},
              }))
              firstParagraphUsed = true
            } else if (child.type === 'bulletList' || child.type === 'orderedList') {
              convertTiptapNodes([child], indent + 1, out)
            } else {
              convertTiptapNodes([child], indent + 1, out)
            }
          }
        }

        break
      }
      case 'taskList': {
        for (const li of node.content ?? []) {
          const checked = li.attrs?.checked === true
          const para = (li.content ?? []).find(c => c.type === 'paragraph')
          out.push(createBlock('to_do', {
            content: tiptapInlineToSpans(para?.content),
            props: { checked, ...(indent ? { indent } : {}) },
          }))
        }

        break
      }
      case 'blockquote': {
        // Flatten quote children into quote blocks
        for (const child of node.content ?? []) {
          if (child.type === 'paragraph') {
            out.push(createBlock('quote', { content: tiptapInlineToSpans(child.content) }))
          } else {
            convertTiptapNodes([child], indent, out)
          }
        }

        break
      }
      case 'codeBlock': {
        out.push(createBlock('code', {
          props: {
            language: typeof node.attrs?.language === 'string' && node.attrs.language ? node.attrs.language : 'plaintext',
            code: tiptapNodeText(node),
          },
        }))
        break
      }
      case 'horizontalRule':
        out.push(createBlock('divider'))
        break
      case 'image': {
        const src = node.attrs?.src

        if (typeof src === 'string' && src) {
          out.push(createBlock('image', {
            props: {
              url: src,
              caption: typeof node.attrs?.title === 'string' ? node.attrs.title : (typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''),
            },
          }))
        }

        break
      }
      case 'table': {
        const rows: TableCell[][] = []
        let hasHeader = false

        for (const row of node.content ?? []) {
          if (row.type !== 'tableRow') {
continue
}

          const cells: TableCell[] = []

          for (const cell of row.content ?? []) {
            if (cell.type === 'tableHeader' && rows.length === 0) {
hasHeader = true
}

            cells.push(tiptapTableCell(cell))
          }

          rows.push(cells)
        }

        if (rows.length > 0) {
          out.push(createBlock('table', { props: { table: normalizeTableData({ hasHeader, rows }) } }))
        }

        break
      }
      default: {
        if (node.content) {
convertTiptapNodes(node.content, indent, out)
}
      }
    }
  }
}

export function tiptapToBlocks(doc: Record<string, unknown>): Block[] {
  const out: Block[] = []
  const content = Array.isArray(doc.content) ? (doc.content as TiptapNode[]) : []
  convertTiptapNodes(content, 0, out)

  return out
}

// ─── HTML → blocks (client only, requires DOMParser) ─────────────────────────

/** Block-level tags that open a new block when walking mixed HTML containers. */
const HTML_BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'hr',
  'img',
  'table',
  'div',
  'section',
  'article',
  'details',
  'summary',
])

function indentProps(indent: number, el?: Element): Record<string, unknown> {
  return {
    ...(indent ? { indent } : {}),
    ...(el ? propsWithDir(el) : {}),
  }
}

/**
 * Serialize details body DOM → text/markdown source.
 * Preserves newlines at block boundaries so markdown lists/headings parse.
 */
function serializeDetailsBodyToSource(nodes: Node[], host: Element): string {
  const doc = host.ownerDocument
  if (!doc) {
    return nodes
      .map((n) => n.textContent ?? '')
      .join('\n')
      .trim()
  }
  const wrap = doc.createElement('div')
  for (const n of nodes) {
    wrap.appendChild(n.cloneNode(true))
  }
  return htmlFragmentToMarkdownSource(wrap.innerHTML)
}

/**
 * Prefer markdown parse when the body still carries MD syntax (common when
 * pasting GitHub-flavored docs: details wrap raw markdown, not full HTML).
 * Use structural HTML path when the body is already real lists/headings/etc.
 * *without* leftover MD markers.
 */
function shouldParseDetailsBodyAsMarkdown(source: string, bodyNodes: Node[]): boolean {
  if (!source.trim()) return false
  if (looksLikeMarkdown(source)) return true

  // Structured HTML only (ul/ol/h*) → keep HTML conversion.
  let hasStructuralHtml = false
  for (const n of bodyNodes) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue
    const tag = (n as Element).tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol' || tag === 'table' || tag === 'pre' || /^h[1-6]$/.test(tag)) {
      hasStructuralHtml = true
      break
    }
    // Nested structural tags inside a wrapper
    if ((n as Element).querySelector?.('ul, ol, table, pre, h1, h2, h3, h4, h5, h6')) {
      hasStructuralHtml = true
      break
    }
  }
  if (hasStructuralHtml) return false

  // Multi-line prose / bullets without classic MD markers still benefit from
  // markdown line splitting (blank lines → paragraphs).
  return source.includes('\n')
}

/**
 * Walk a list of DOM nodes into blocks (paragraphs for loose inline runs).
 * Used for container bodies (div/details) and mixed content.
 */
function convertHtmlNodes(nodes: Iterable<Node>, indent: number, out: Block[]): void {
  let inlineBuffer: Node[] = []
  const flush = () => {
    if (inlineBuffer.length === 0) return
    const spans = normalizeSpans(parseInlineNodes(inlineBuffer))
    if (spans.some((s) => s.text.trim())) {
      out.push(
        createBlock('paragraph', {
          content: spans,
          props: indentProps(indent),
        }),
      )
    }
    inlineBuffer = []
  }

  for (const child of Array.from(nodes)) {
    if (
      child.nodeType === Node.ELEMENT_NODE
      && HTML_BLOCK_TAGS.has((child as Element).tagName.toLowerCase())
    ) {
      flush()
      convertHtmlElement(child as Element, indent, out)
    } else if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? '').trim()) {
      // skip pure whitespace between block children
      continue
    } else {
      inlineBuffer.push(child)
    }
  }
  flush()
}

function convertHtmlElement(el: Element, indent: number, out: Block[]): void {
  const tag = el.tagName.toLowerCase()

  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Math.min(Math.max(Number(tag[1]) || 1, 1), 6)
      out.push(createBlock(`heading_${level}` as BlockType, {
        content: normalizeSpans(parseInlineNodes(el.childNodes)),
        props: indentProps(indent, el),
      }))
      break
    }
    case 'p': {
      const spans = normalizeSpans(parseInlineNodes(el.childNodes))
      out.push(createBlock('paragraph', {
        content: spans,
        props: indentProps(indent, el),
      }))
      break
    }
    case 'blockquote': {
      const paragraphs = el.querySelectorAll(':scope > p')

      if (paragraphs.length > 0) {
        paragraphs.forEach(p => out.push(createBlock('quote', {
          content: normalizeSpans(parseInlineNodes(p.childNodes)),
          props: indentProps(indent, p),
        })))
      } else {
        out.push(createBlock('quote', {
          content: normalizeSpans(parseInlineNodes(el.childNodes)),
          props: indentProps(indent, el),
        }))
      }

      break
    }
    case 'pre': {
      const codeEl = el.querySelector('code')
      out.push(createBlock('code', {
        props: {
          language: 'plaintext',
          code: (codeEl ?? el).textContent ?? '',
          ...(indent ? { indent } : {}),
        },
      }))
      break
    }
    case 'ul':
    case 'ol': {
      const itemType: BlockType = tag === 'ul' ? 'bulleted_list_item' : 'numbered_list_item'

      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== 'li') {
continue
}

        const nestedLists = Array.from(li.children).filter(c => ['ul', 'ol'].includes(c.tagName.toLowerCase()))
        const inlineNodes = Array.from(li.childNodes).filter(n => !nestedLists.includes(n as Element))
        out.push(createBlock(itemType, {
          content: normalizeSpans(parseInlineNodes(inlineNodes)),
          props: indentProps(indent, li),
        }))

        for (const nested of nestedLists) {
convertHtmlElement(nested, indent + 1, out)
}
      }

      break
    }
    case 'hr':
      out.push(createBlock('divider', { props: indent ? { indent } : {} }))
      break
    case 'img': {
      const src = el.getAttribute('src')

      if (src) {
        out.push(createBlock('image', {
          props: {
            url: src,
            caption: el.getAttribute('alt') ?? '',
            ...(indent ? { indent } : {}),
          },
        }))
      }

      break
    }
    case 'table': {
      const rows: TableCell[][] = []
      let hasHeader = false
      el.querySelectorAll('tr').forEach((tr, i) => {
        const cells: TableCell[] = []
        tr.querySelectorAll('th, td').forEach((cell) => {
          if (cell.tagName.toLowerCase() === 'th' && i === 0) {
hasHeader = true
}

          cells.push(parseHtmlTableCell(cell))
        })

        if (cells.length) {
rows.push(cells)
}
      })

      if (rows.length) {
        out.push(createBlock('table', {
          props: {
            table: normalizeTableData({ hasHeader, rows }),
            ...(indent ? { indent } : {}),
          },
        }))
      }

      break
    }
    /**
     * GitHub / MD details → editor toggle (collapse).
     * Summary → title. Body is often *raw markdown* inside HTML (or mixed);
     * parse as markdown when it looks like MD so lists/headings/bold apply.
     */
    case 'details': {
      let summaryEl: Element | null = null
      const bodyNodes: Node[] = []
      for (const child of Array.from(el.childNodes)) {
        if (
          child.nodeType === Node.ELEMENT_NODE
          && (child as Element).tagName.toLowerCase() === 'summary'
        ) {
          summaryEl = child as Element
        } else {
          bodyNodes.push(child)
        }
      }

      const titleSpans = summaryEl
        ? normalizeSpans(parseInlineNodes(summaryEl.childNodes))
        : []
      const hasTitle = titleSpans.some((s) => (s.text ?? '').trim())
      // Absent `open` → start collapsed (matches common MD/details UX).
      const collapsed = !el.hasAttribute('open')

      out.push(
        createBlock('toggle', {
          content: hasTitle ? titleSpans : [{ text: 'Toggle' }],
          props: {
            ...indentProps(indent, el),
            collapsed,
          },
        }),
      )

      const bodySource = serializeDetailsBodyToSource(bodyNodes, el)
      const before = out.length

      if (bodySource.trim() && shouldParseDetailsBodyAsMarkdown(bodySource, bodyNodes)) {
        const nested = markdownToBlocks(bodySource)
        if (nested.length) {
          out.push(...applyBaseIndent(nested, indent + 1))
        }
      } else {
        convertHtmlNodes(bodyNodes, indent + 1, out)
      }

      // Empty body: leave a nested paragraph so the toggle can hold content.
      if (out.length === before) {
        out.push(
          createBlock('paragraph', {
            content: [],
            props: { indent: indent + 1 },
          }),
        )
      }
      break
    }
    case 'summary': {
      // Orphan summary (outside details) — plain paragraph.
      const spans = normalizeSpans(parseInlineNodes(el.childNodes))
      if (spans.some((s) => s.text.trim())) {
        out.push(
          createBlock('paragraph', {
            content: spans,
            props: indentProps(indent, el),
          }),
        )
      }
      break
    }
    case 'div':
    case 'section':
    case 'article': {
      const children = Array.from(el.children)

      if (children.length === 0) {
        const spans = normalizeSpans(parseInlineNodes(el.childNodes))

        if (spans.length) {
          out.push(
            createBlock('paragraph', {
              content: spans,
              props: indentProps(indent, el),
            }),
          )
        }
      } else {
        convertHtmlNodes(el.childNodes, indent, out)
      }

      break
    }
    default: {
      const spans = normalizeSpans(parseInlineNodes([el]))

      if (spans.some(s => s.text.trim())) {
        out.push(
          createBlock('paragraph', {
            content: spans,
            props: indentProps(indent),
          }),
        )
      }
    }
  }
}

export function htmlToBlocks(html: string): Block[] {
  if (typeof DOMParser === 'undefined') {
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

    return text ? [createBlock('paragraph', { content: [{ text }] })] : []
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: Block[] = []
  let inlineBuffer: Node[] = []
  const flush = () => {
    if (inlineBuffer.length === 0) {
return
}

    const spans = normalizeSpans(parseInlineNodes(inlineBuffer))

    if (spans.some(s => s.text.trim())) {
out.push(createBlock('paragraph', { content: spans }))
}

    inlineBuffer = []
  }

  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      flush()
      convertHtmlElement(node as Element, 0, out)
    } else {
      inlineBuffer.push(node)
    }
  }

  flush()

  return out
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function sanitizeBlocks(blocks: Block[]): Block[] {
  return blocks.map(b => ({
    id: typeof b.id === 'string' && b.id ? b.id : generateBlockId(),
    type: b.type,
    content: Array.isArray(b.content) ? normalizeSpans(b.content) : [],
    props: b.props && typeof b.props === 'object' ? b.props : {},
  }))
}

/**
 * Convert any stored document content (blocks / legacy TipTap JSON / legacy HTML)
 * into the canonical Block[] model.
 */
export function normalizeContent(content: Record<string, unknown> | null | undefined): Block[] {
  if (!content || typeof content !== 'object') {
return []
}

  if (isBlocksContent(content)) {
return sanitizeBlocks(content.blocks as Block[])
}

  if (content.format === 'html' && typeof content.html === 'string') {
    return htmlToBlocks(content.html)
  }

  if (content.type === 'doc') {
return tiptapToBlocks(content)
}

  return []
}
