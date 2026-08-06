import { normalizeSpans } from './ops'
import { pageLinkHash, pageLinkMark, parsePageLink } from './page-link'
import type { InlineMarks, InlineSpan } from './types'

export type SpansToHtmlOptions = {
  resolvePageLink?: (pageId: string) => string | undefined
}

export function escapeHtml(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Normalize CSS color strings (hex / rgb / rgba) to lowercase `#rrggbb`. */
export function cssColorToHex(input: string | null | undefined): string | undefined {
  if (!input) return undefined

  const value = input.trim().toLowerCase()

  if (value === 'transparent' || value === 'inherit' || value === 'initial' || value === 'unset') {
    return undefined
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) {
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    }
    return value
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/)
  if (rgb) {
    const toByte = (part: string) => Math.max(0, Math.min(255, Math.round(Number(part))))
    const hex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${hex(toByte(rgb[1]))}${hex(toByte(rgb[2]))}${hex(toByte(rgb[3]))}`
  }

  return undefined
}

/**
 * Render spans to the inline HTML used inside contenteditable text blocks
 * and the public renderer. Round-trips with `parseInlineHtml`.
 */
export function spansToHtml(spans: InlineSpan[], options?: SpansToHtmlOptions): string {
  return spans
    .map((span) => {
      let html = escapeHtml(span.text)
      const m = span.marks

      if (!m) {
return html
}

      if (m.code) {
html = `<code>${html}</code>`
}

      if (m.bold) {
html = `<strong>${html}</strong>`
}

      if (m.italic) {
html = `<em>${html}</em>`
}

      if (m.underline) {
html = `<u>${html}</u>`
}

      if (m.strikethrough) {
html = `<s>${html}</s>`
}

      const styles: string[] = []

      if (m.color) {
        const color = cssColorToHex(m.color) ?? m.color
        styles.push(`color:${color}`)
      }

      if (m.highlight) {
        const highlight = cssColorToHex(m.highlight) ?? m.highlight
        styles.push(`background-color:${highlight}`)
      }

      if (styles.length) {
        const attrs: string[] = [`style="${styles.join(';')}"`]
        if (m.color) {
          attrs.push(`data-text-color="${escapeHtml(cssColorToHex(m.color) ?? m.color)}"`)
        }
        if (m.highlight) {
          attrs.push(`data-highlight="${escapeHtml(cssColorToHex(m.highlight) ?? m.highlight)}"`)
        }
        html = `<span ${attrs.join(' ')}>${html}</span>`
      }

      if (m.link) {
        const pageId = parsePageLink(m.link)

        if (pageId) {
          const label = (options?.resolvePageLink?.(pageId) ?? span.text.trim()) || 'Untitled'
          html = `<a href="${escapeHtml(pageLinkHash(pageId))}" data-page-link="${escapeHtml(pageId)}" class="page-inline-link">${escapeHtml(label)}</a>`
        } else {
          // External links: no target=_blank (webxdc can't open browser pages).
          // Click handler shows the URL and a copy action instead.
          const href = escapeHtml(m.link)
          html = `<a href="${href}" class="external-inline-link" data-external-link="${href}" rel="noopener noreferrer">${html}</a>`
        }
      }

      return html
    })
    .join('')
}

/** Caret-exit hosts used outside sticky marks — never store as document text. */
function stripCaretHosts(text: string): string {
  return text.replace(/[\u200b\uFEFF]/g, '')
}

/** Parse inline DOM (a contenteditable block's children) back into spans. */
export function parseInlineNodes(nodes: Iterable<Node>, inherited: InlineMarks = {}): InlineSpan[] {
  const spans: InlineSpan[] = []

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Drop zero-width caret parking spots inserted when leaving trailing ``code``.
      const text = stripCaretHosts(node.textContent ?? '')

      if (text) {
        const hasMarks = Object.keys(inherited).length > 0
        spans.push({ text, marks: hasMarks ? { ...inherited } : undefined })
      }

      continue
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
continue
}

    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()

    if (tag === 'br') {
      spans.push({ text: '\n', marks: Object.keys(inherited).length ? { ...inherited } : undefined })
      continue
    }

    const marks: InlineMarks = { ...inherited }

    if (tag === 'strong' || tag === 'b') {
marks.bold = true
}

    if (tag === 'em' || tag === 'i') {
marks.italic = true
}

    if (tag === 'u') {
marks.underline = true
}

    if (tag === 's' || tag === 'strike' || tag === 'del') {
marks.strikethrough = true
}

    if (tag === 'code') {
marks.code = true
}

    if (tag === 'a') {
      const href = el.getAttribute('href')
      const dataPageId = el.getAttribute('data-page-link')
      const pageId = dataPageId || parsePageLink(href)

      if (pageId) {
        marks.link = pageLinkMark(pageId)
      } else if (href) {
        marks.link = href
      }
    }

    // Prefer data attrs (stable hex) then inline style (browsers often expose rgb()).
    const dataColor = el.getAttribute('data-text-color')
    const dataHighlight = el.getAttribute('data-highlight')
    const color = cssColorToHex(dataColor) ?? cssColorToHex(el.style?.color)
    if (color) {
      marks.color = color
    }

    const bg = cssColorToHex(dataHighlight) ?? cssColorToHex(el.style?.backgroundColor)
    if (bg) {
      marks.highlight = bg
    }

    const fw = el.style?.fontWeight

    if (fw === 'bold' || Number(fw) >= 600) {
marks.bold = true
}

    if (el.style?.fontStyle === 'italic') {
marks.italic = true
}

    const deco = el.style?.textDecorationLine || el.style?.textDecoration || ''

    if (deco.includes('underline')) {
marks.underline = true
}

    if (deco.includes('line-through')) {
marks.strikethrough = true
}

    spans.push(...parseInlineNodes(el.childNodes, marks))
  }

  return spans
}

export function parseInlineHtml(html: string): InlineSpan[] {
  if (typeof DOMParser === 'undefined') {
return [{ text: html.replace(/<[^>]*>/g, '') }]
}

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild

  if (!root) {
return []
}

  return normalizeSpans(parseInlineNodes(root.childNodes))
}

/** Read spans straight from a live contenteditable element. */
export function elementToSpans(el: HTMLElement): InlineSpan[] {
  return normalizeSpans(parseInlineNodes(el.childNodes))
}
