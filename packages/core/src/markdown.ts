/**
 * Lightweight Markdown → Block[] converter for clipboard paste.
 * Supports common GFM-ish constructs without external dependencies.
 */

import { createBlock, normalizeSpans } from './ops'
import { normalizeTableData } from './table'
import type { Block, BlockType, InlineMarks, InlineSpan, TableCell } from './types'

/** True when plain text likely contains markdown structure worth converting. */
export function looksLikeMarkdown(text: string): boolean {
  const sample = text.replace(/\r\n/g, '\n')
  if (!sample.trim()) return false

  return (
    /^#{1,6}\s+\S/m.test(sample)
    || /^```/m.test(sample)
    || /^~~~/m.test(sample)
    || /^ {0,3}([-*+])\s+\S/m.test(sample)
    || /^ {0,3}([0-9\u0660-\u0669\u06F0-\u06F9]+)\.\s+\S/m.test(sample)
    || /^ {0,3}([-*+])\s+\[[ xX]\]\s/m.test(sample)
    || /^ {0,3}>\s?/m.test(sample)
    || /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/m.test(sample)
    || /!\[[^\]]*]\([^)\s]+\)/.test(sample)
    || /\[[^\]]+]\([^)\s]+\)/.test(sample)
    || /(\*\*|__)[^*_\n]+(\*\*|__)/.test(sample)
    || /(?<!\*)\*[^*\n]+\*(?!\*)/.test(sample)
    || /~~[^~\n]+~~/.test(sample)
    || /`[^`\n]+`/.test(sample)
    || /^\|.+\|$/m.test(sample)
  )
}

/**
 * Parse markdown source into editor blocks.
 * Plain lines become paragraphs; structural markdown becomes typed blocks.
 */
export function markdownToBlocks(source: string): Block[] {
  const text = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!text.trim()) return []

  const lines = text.split('\n')
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blank line — skip (paragraph breaks)
    if (!trimmed) {
      i++
      continue
    }

    // Fenced code block
    const fence = trimmed.match(/^(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const marker = fence[1][0]
      const fenceLen = fence[1].length
      const lang = fence[2].trim() || 'plaintext'
      const body: string[] = []
      i++
      while (i < lines.length) {
        const close = lines[i].trim().match(/^(`{3,}|~{3,})\s*$/)
        if (
          close
          && close[1][0] === marker
          && close[1].length >= fenceLen
        ) {
          i++
          break
        }
        body.push(lines[i])
        i++
      }
      out.push(createBlock('code', {
        props: { code: body.join('\n'), language: lang || 'plaintext' },
      }))
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) && trimmed.length >= 3) {
      out.push(createBlock('divider'))
      i++
      continue
    }

    // ATX headings (h1–h6)
    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6
      const type = (`heading_${level}`) as BlockType
      out.push(createBlock(type, { content: parseInlineMarkdown(heading[2]) }))
      i++
      continue
    }

    // Standalone image line: ![alt](url)
    const imageOnly = trimmed.match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)$/)
    if (imageOnly) {
      out.push(createBlock('image', {
        props: { url: imageOnly[2], caption: imageOnly[1] || '' },
      }))
      i++
      continue
    }

    // Table (GFM)
    if (
      trimmed.startsWith('|')
      && i + 1 < lines.length
      && isTableSeparator(lines[i + 1].trim())
    ) {
      const headerCells = splitTableRow(trimmed)
      i += 2
      const rows: TableCell[][] = [
        headerCells.map((cell) => ({ content: parseInlineMarkdown(cell) })),
      ]
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitTableRow(lines[i].trim())
        // Pad / trim to header width
        while (cells.length < headerCells.length) cells.push('')
        rows.push(
          cells.slice(0, headerCells.length).map((cell) => ({
            content: parseInlineMarkdown(cell),
          })),
        )
        i++
      }
      out.push(createBlock('table', {
        props: {
          table: normalizeTableData({ hasHeader: true, rows }),
        },
      }))
      continue
    }

    // Block quote (single-level; consecutive lines merge)
    if (/^ {0,3}>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^ {0,3}>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^ {0,3}>\s?/, ''))
        i++
      }
      const quoteText = quoteLines.join('\n').trim()
      out.push(createBlock('quote', {
        content: parseInlineMarkdown(quoteText),
      }))
      continue
    }

    // Task list / bullet / numbered list item
    const todo = line.match(/^ {0,3}([-*+])\s+\[([ xX])\]\s+(.*)$/)
    if (todo) {
      out.push(createBlock('to_do', {
        content: parseInlineMarkdown(todo[3]),
        props: { checked: todo[2].toLowerCase() === 'x' },
      }))
      i++
      continue
    }

    const bullet = line.match(/^ {0,3}([-*+])\s+(.*)$/)
    if (bullet) {
      out.push(createBlock('bulleted_list_item', {
        content: parseInlineMarkdown(bullet[2]),
      }))
      i++
      continue
    }

    // Western 1. / Persian ۱. / Arabic-Indic ١٢. numbered lists
    const numbered = line.match(/^ {0,3}([0-9\u0660-\u0669\u06F0-\u06F9]+)\.\s+(.*)$/)
    if (numbered) {
      out.push(createBlock('numbered_list_item', {
        content: parseInlineMarkdown(numbered[2]),
      }))
      i++
      continue
    }

    // Paragraph — merge consecutive non-blank, non-structural lines
    const paraLines: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const next = lines[i]
      const nextTrim = next.trim()
      if (!nextTrim) break
      if (isStructuralLine(next)) break
      paraLines.push(nextTrim)
      i++
    }
    out.push(createBlock('paragraph', {
      content: parseInlineMarkdown(paraLines.join(' ')),
    }))
  }

  return out
}

function isStructuralLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (/^(`{3,}|~{3,})/.test(trimmed)) return true
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true
  if (/^#{1,6}\s+\S/.test(trimmed)) return true
  if (/^ {0,3}>\s?/.test(line)) return true
  if (/^ {0,3}([-*+])\s+/.test(line)) return true
  if (/^ {0,3}([0-9\u0660-\u0669\u06F0-\u06F9]+)\.\s+/.test(line)) return true
  if (/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.test(trimmed)) return true
  if (trimmed.startsWith('|') && isTableSeparator(trimmed)) return true
  if (trimmed.startsWith('|')) return true
  return false
}

function isTableSeparator(line: string): boolean {
  // | --- | :---: | ---: |
  const cells = splitTableRow(line)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function splitTableRow(line: string): string[] {
  let raw = line.trim()
  if (raw.startsWith('|')) raw = raw.slice(1)
  if (raw.endsWith('|')) raw = raw.slice(0, -1)
  return raw.split('|').map((cell) => cell.trim())
}

/**
 * Undo Markdown backslash-escapes for punctuation (and backslash itself).
 * Also collapses residual over-escaping left in already-corrupted documents
 * (e.g. `madmail\-v2`, `\[link\]\(url\)`, `01\-architecture\.md`).
 */
export function unescapeMarkdownPunctuation(text: string): string {
  if (!text || !text.includes('\\')) return text
  // Common GFM/CommonMark escapable set + a few extras we used to over-escape.
  const re = /\\([\\`*_{}[\]()#+\-.!|>~])/g
  let prev = ''
  let cur = text
  // Collapse double/triple escapes from older save cycles.
  while (prev !== cur) {
    prev = cur
    cur = cur.replace(re, '$1')
  }
  return cur
}

/** Sanitize span text that still contains over-escaped markdown punctuation. */
export function sanitizeSpanEscapes(spans: InlineSpan[] | undefined | null): InlineSpan[] {
  if (!spans?.length) return spans ?? []
  return normalizeSpans(
    spans.map((span) => {
      const text = unescapeMarkdownPunctuation(span.text ?? '')
      const marks = span.marks ? { ...span.marks } : undefined
      if (marks?.link) {
        marks.link = unescapeMarkdownPunctuation(String(marks.link))
      }
      return marks && Object.keys(marks).length > 0
        ? { text, marks }
        : { text }
    }),
  )
}

/** Deep-clean a block tree of residual markdown over-escapes (in-place-safe copy). */
export function sanitizeBlocksEscapes(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    const next: Block = {
      ...block,
      content: sanitizeSpanEscapes(block.content),
      props: { ...block.props },
    }
    if (next.props.table?.rows) {
      next.props = {
        ...next.props,
        table: {
          ...next.props.table,
          rows: next.props.table.rows.map((row) =>
            row.map((cell) => ({
              ...cell,
              content: sanitizeSpanEscapes(cell.content),
            })),
          ),
        },
      }
    }
    return next
  })
}

/** Parse inline markdown into spans (bold, italic, code, links, strike). */
export function parseInlineMarkdown(input: string, options?: { raw?: boolean }): InlineSpan[] {
  if (!input) return []

  // Collapse residual over-escapes first so scanners see real `[text](url)` / `**bold**`
  // (old exports left `\[label\]\(path\.md\)` which never matched as links).
  // Nested re-entry uses `raw: true` to avoid re-processing already-clean text.
  const source = options?.raw ? input : unescapeMarkdownPunctuation(input)

  const spans: InlineSpan[] = []
  let i = 0
  let plain = ''

  const flushPlain = () => {
    if (!plain) return
    spans.push({ text: plain })
    plain = ''
  }

  const pushMarked = (text: string, marks: InlineMarks) => {
    if (!text) return
    flushPlain()
    spans.push({ text, marks })
  }

  /** Parse nested inline inside bold/italic/strike and merge outer mark. */
  const pushNested = (inner: string, outer: InlineMarks) => {
    flushPlain()
    const nested = parseInlineMarkdown(inner, { raw: true })
    if (!nested.length) {
      if (inner) spans.push({ text: inner, marks: outer })
      return
    }
    for (const span of nested) {
      spans.push({
        text: span.text,
        marks: { ...span.marks, ...outer },
      })
    }
  }

  while (i < source.length) {
    // Escaped character
    if (source[i] === '\\' && i + 1 < source.length) {
      plain += source[i + 1]
      i += 2
      continue
    }

    // Inline code `...`
    if (source[i] === '`') {
      const end = source.indexOf('`', i + 1)
      if (end > i + 1) {
        // Keep code body literal (do not strip backslashes inside code).
        flushPlain()
        spans.push({ text: source.slice(i + 1, end), marks: { code: true } })
        i = end + 1
        continue
      }
    }

    // Image ![alt](url) — keep as plain alt text in paragraphs
    if (source.startsWith('![', i)) {
      const m = source.slice(i).match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/)
      if (m) {
        plain += m[1] || m[2] || ''
        i += m[0].length
        continue
      }
    }

    // Link [text](url)
    if (source[i] === '[') {
      const m = source.slice(i).match(/^\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)/)
      if (m) {
        pushMarked(m[1], { link: m[2] })
        i += m[0].length
        continue
      }
    }

    // Strikethrough ~~text~~
    if (source.startsWith('~~', i)) {
      const end = source.indexOf('~~', i + 2)
      if (end > i + 2) {
        pushNested(source.slice(i + 2, end), { strikethrough: true })
        i = end + 2
        continue
      }
    }

    // Bold **text** or __text__
    if (source.startsWith('**', i) || source.startsWith('__', i)) {
      const marker = source.slice(i, i + 2)
      const end = source.indexOf(marker, i + 2)
      if (end > i + 2) {
        pushNested(source.slice(i + 2, end), { bold: true })
        i = end + 2
        continue
      }
    }

    // Italic *text* or _text_ (not bold)
    if (
      (source[i] === '*' || source[i] === '_')
      && source[i + 1] !== source[i]
    ) {
      const marker = source[i]
      // Avoid list-like leftovers; require closing marker
      const end = findClosingItalic(source, i, marker)
      if (end > i + 1) {
        pushNested(source.slice(i + 1, end), { italic: true })
        i = end + 1
        continue
      }
    }

    plain += source[i]
    i++
  }

  flushPlain()
  return normalizeSpans(spans)
}

function findClosingItalic(input: string, start: number, marker: string): number {
  for (let j = start + 1; j < input.length; j++) {
    if (input[j] === '\\') {
      j++
      continue
    }
    if (input[j] === marker) {
      // Don't treat ** as italic close
      if (input[j + 1] === marker) return -1
      return j
    }
    if (input[j] === '\n') return -1
  }
  return -1
}

// ─── Export: Block[] → Markdown ───────────────────────────────────────────────

/**
 * Minimal escaping for plain text segments.
 * Avoid escaping `. ( ) # + - ! | > { } [ ]` — aggressive escaping broke
 * round-trips (links, paths, crate names) when saving bound Markdown files.
 * Bold/italic/code/links are expressed via marks, not by escaping every glyph.
 * First strip residual over-escapes so re-save does not keep `\.` `\(`.
 */
function escapeMdText(text: string): string {
  const cleaned = unescapeMarkdownPunctuation(text)
  return cleaned
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
}

/** Serialize inline spans to markdown (best-effort; colors/highlights dropped). */
export function spansToMarkdown(spans: InlineSpan[]): string {
  if (!spans.length) return ''

  let out = ''
  for (const span of spans) {
    let text = span.text ?? ''
    if (!text) continue
    const marks = span.marks

    // Code spans: no nested marks in common markdown.
    if (marks?.code) {
      const safe = text.replace(/`/g, '´')
      out += '`' + safe + '`'
      continue
    }

    // Drop residual over-escapes before writing.
    text = unescapeMarkdownPunctuation(text)

    // Escape plain text; links wrap the label (label itself must not escape []).
    let body = escapeMdText(text)

    // Link first, then emphasis wrappers so **[label](url)** round-trips.
    if (marks?.link) {
      // Keep URL readable; only break spaces which terminate markdown destinations.
      const href = unescapeMarkdownPunctuation(String(marks.link)).replace(/\s+/g, '%20')
      const label = text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
      body = `[${label}](${href})`
    }
    if (marks?.bold) body = `**${body}**`
    if (marks?.italic) body = `*${body}*`
    if (marks?.strikethrough) body = `~~${body}~~`

    out += body
  }
  return out
}

function indentPrefix(indent: number | undefined): string {
  const n = Math.max(0, indent ?? 0)
  return n > 0 ? '  '.repeat(n) : ''
}

function blockToMarkdown(block: Block, listNumbers: Map<string, number>): string {
  const indent = indentPrefix(block.props.indent)
  const inline = () => spansToMarkdown(block.content)

  switch (block.type) {
    case 'heading_1':
      return `# ${inline()}`.trimEnd()
    case 'heading_2':
      return `## ${inline()}`.trimEnd()
    case 'heading_3':
      return `### ${inline()}`.trimEnd()
    case 'heading_4':
      return `#### ${inline()}`.trimEnd()
    case 'heading_5':
      return `##### ${inline()}`.trimEnd()
    case 'heading_6':
      return `###### ${inline()}`.trimEnd()
    case 'paragraph':
    case 'callout': {
      const text = inline()
      if (block.type === 'callout') {
        const icon = block.props.icon ? `${block.props.icon} ` : ''
        return text ? `> ${icon}${text}` : ''
      }
      return text ? `${indent}${text}` : ''
    }
    case 'quote': {
      const text = inline()
      if (!text) return ''
      return text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    }
    case 'bulleted_list_item':
      return `${indent}- ${inline()}`.trimEnd()
    case 'numbered_list_item': {
      const n = listNumbers.get(block.id) ?? 1
      return `${indent}${n}. ${inline()}`.trimEnd()
    }
    case 'to_do': {
      const mark = block.props.checked ? 'x' : ' '
      return `${indent}- [${mark}] ${inline()}`.trimEnd()
    }
    case 'toggle': {
      const title = inline() || 'Toggle'
      return `${indent}<details>\n${indent}<summary>${title}</summary>\n${indent}</details>`
    }
    case 'code': {
      const lang = (block.props.language || '').replace(/[^\w#+.-]/g, '') || ''
      const code = block.props.code ?? ''
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }
    case 'divider':
      return '---'
    case 'image': {
      const url = block.props.url?.trim()
      if (!url) return ''
      const alt = (block.props.caption || 'image').replace(/[[\]]/g, '')
      return `![${alt}](${url})`
    }
    case 'table': {
      const table = normalizeTableData(block.props.table)
      if (!table.rows.length) return ''
      const rows = table.rows.map((row) =>
        row
          .filter((cell) => !cell.hidden)
          .map((cell) => spansToMarkdown(cell.content).replace(/\|/g, '\\|') || ' ')
      )
      if (!rows.length) return ''
      const width = Math.max(...rows.map((r) => r.length), 1)
      const pad = (row: string[]) => {
        const copy = [...row]
        while (copy.length < width) copy.push(' ')
        return copy.slice(0, width)
      }
      const header = pad(rows[0])
      const sep = header.map(() => '---')
      const body = rows.slice(1).map((r) => pad(r))
      const line = (cells: string[]) => `| ${cells.join(' | ')} |`
      return [line(header), line(sep), ...body.map(line)].join('\n')
    }
    case 'page': {
      const title = block.props.pageTitle?.trim() || 'Untitled'
      return `${indent}📄 ${title}`
    }
    case 'poll': {
      const q = inline() || 'Poll'
      const options = (block.props.pollOptions ?? [])
        .map((opt) => `${indent}- ${opt.text || 'Option'} (${opt.votes?.length ?? 0})`)
        .join('\n')
      return options ? `${indent}**${q}**\n${options}` : `${indent}**${q}**`
    }
    case 'column_list':
    case 'column':
      // Structural only — children are exported as normal blocks.
      return ''
    default:
      return inline() ? `${indent}${inline()}` : ''
  }
}

/**
 * Export blocks to markdown. Best-effort: colors, columns layout, collaborative
 * poll voters, etc. are simplified or omitted.
 */
export function blocksToMarkdown(blocks: Block[]): string {
  const listNumbers = (() => {
    const map = new Map<string, number>()
    const counters: Record<number, number> = {}
    for (const b of blocks) {
      const ind = b.props.indent ?? 0
      if (b.type === 'numbered_list_item') {
        counters[ind] = (counters[ind] ?? 0) + 1
        for (const k of Object.keys(counters)) {
          if (Number(k) > ind) delete counters[Number(k)]
        }
        map.set(b.id, counters[ind])
      } else {
        for (const k of Object.keys(counters)) {
          if (Number(k) >= ind) delete counters[Number(k)]
        }
      }
    }
    return map
  })()

  const listLike = (type: string) =>
    type === 'bulleted_list_item' || type === 'numbered_list_item' || type === 'to_do'

  const rendered: Array<{ type: string; md: string }> = []
  for (const block of blocks) {
    if (block.type === 'column_list' || block.type === 'column') continue
    const md = blockToMarkdown(block, listNumbers)
    if (md) rendered.push({ type: block.type, md })
  }

  const out: string[] = []
  for (let i = 0; i < rendered.length; i++) {
    out.push(rendered[i].md)
    const next = rendered[i + 1]
    if (!next) continue
    // Keep list items adjacent; otherwise blank line between blocks.
    if (listLike(rendered[i].type) && listLike(next.type)) continue
    out.push('')
  }

  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return text ? `${text}\n` : ''
}
