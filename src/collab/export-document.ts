import {
  blocksToHtmlContent,
  blocksToMarkdown,
  blocksToPlainText,
  type Block,
} from '@xproeditor/core'
import { zipSync } from 'fflate'
import {
  getPageBlocks,
  listPagesNested,
  resolvePageTitle,
  serializeDocument,
  type CollabDocument,
} from './document'
import { buildWebxdcPackageBlob, canPackWebxdcPackage } from './pack-webxdc'
import { buildDocumentFilename } from './share-to-chat'

export type ExportResult =
  | { ok: true }
  | { ok: false; reason: string }

export function sanitizeExportFilename(name: string, fallback = 'document'): string {
  const base = (name || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 80)
    .trim()
  return base || fallback
}

export function withExtension(filename: string, ext: string): string {
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`
  const lower = filename.toLowerCase()
  if (lower.endsWith(cleanExt.toLowerCase())) return filename
  return `${filename}${cleanExt}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function downloadText(
  text: string,
  filename: string,
  mime = 'text/plain;charset=utf-8',
): void {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

export async function copyText(text: string): Promise<ExportResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return { ok: true }
    }
  } catch {
    // fall through to execCommand
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok ? { ok: true } : { ok: false, reason: 'Clipboard copy is not available.' }
  } catch {
    return { ok: false, reason: 'Clipboard copy is not available.' }
  }
}

function pageMarkdown(title: string, blocks: Block[]): string {
  const body = blocksToMarkdown(blocks).trim()
  return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`
}

function pagePlainText(title: string, blocks: Block[]): string {
  const body = blocksToPlainText(blocks).trim()
  return body ? `${title}\n\n${body}\n` : `${title}\n`
}

function pageHtmlDocument(title: string, blocks: Block[]): string {
  const body = blocksToHtmlContent(blocks)
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; max-width: 46rem; margin: 2rem auto; padding: 0 1.25rem; color: #222; }
    h1,h2,h3,h4,h5,h6 { line-height: 1.25; }
    pre { overflow: auto; padding: 0.75rem 1rem; background: #f4f4f5; border-radius: 8px; }
    blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid #d4d4d8; color: #52525b; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e4e4e7; padding: 0.4rem 0.6rem; vertical-align: top; }
    img { max-width: 100%; height: auto; }
    hr { border: none; border-top: 1px solid #e4e4e7; margin: 1.5rem 0; }
  </style>
</head>
<body>
  <article>
    <h1>${safeTitle}</h1>
    ${body}
  </article>
</body>
</html>
`
}

export function exportCurrentPageMarkdown(
  doc: CollabDocument,
  pageId: string,
): ExportResult {
  const page = doc.pages[pageId]
  if (!page) return { ok: false, reason: 'Page not found.' }
  const title = resolvePageTitle(doc, pageId)
  const text = pageMarkdown(title, getPageBlocks(doc, pageId))
  downloadText(text, withExtension(sanitizeExportFilename(title, 'page'), '.md'), 'text/markdown;charset=utf-8')
  return { ok: true }
}

export function exportCurrentPagePlainText(
  doc: CollabDocument,
  pageId: string,
): ExportResult {
  const page = doc.pages[pageId]
  if (!page) return { ok: false, reason: 'Page not found.' }
  const title = resolvePageTitle(doc, pageId)
  const text = pagePlainText(title, getPageBlocks(doc, pageId))
  downloadText(text, withExtension(sanitizeExportFilename(title, 'page'), '.txt'))
  return { ok: true }
}

export function exportCurrentPageHtml(
  doc: CollabDocument,
  pageId: string,
): ExportResult {
  const page = doc.pages[pageId]
  if (!page) return { ok: false, reason: 'Page not found.' }
  const title = resolvePageTitle(doc, pageId)
  const html = pageHtmlDocument(title, getPageBlocks(doc, pageId))
  downloadText(html, withExtension(sanitizeExportFilename(title, 'page'), '.html'), 'text/html;charset=utf-8')
  return { ok: true }
}

export async function copyCurrentPageMarkdown(
  doc: CollabDocument,
  pageId: string,
): Promise<ExportResult> {
  const page = doc.pages[pageId]
  if (!page) return { ok: false, reason: 'Page not found.' }
  const title = resolvePageTitle(doc, pageId)
  return copyText(pageMarkdown(title, getPageBlocks(doc, pageId)))
}

export async function copyCurrentPagePlainText(
  doc: CollabDocument,
  pageId: string,
): Promise<ExportResult> {
  const page = doc.pages[pageId]
  if (!page) return { ok: false, reason: 'Page not found.' }
  const title = resolvePageTitle(doc, pageId)
  return copyText(pagePlainText(title, getPageBlocks(doc, pageId)))
}

export async function copyCurrentPageHtml(
  doc: CollabDocument,
  pageId: string,
): Promise<ExportResult> {
  const page = doc.pages[pageId]
  if (!page) return { ok: false, reason: 'Page not found.' }
  const body = blocksToHtmlContent(getPageBlocks(doc, pageId))
  return copyText(body || `<p></p>`)
}

/** Single Markdown file with every page, separated by rules. */
export function exportWorkspaceMarkdown(doc: CollabDocument, filenameHint?: string): ExportResult {
  const pages = listPagesNested(doc)
  if (pages.length === 0) return { ok: false, reason: 'No pages to export.' }

  const parts: string[] = []
  for (const meta of pages) {
    const title = meta.title?.trim() || 'Untitled'
    const depth = Math.max(0, meta.depth ?? 0)
    const indentNote = depth > 0 ? `\n<!-- depth: ${depth} -->` : ''
    parts.push(pageMarkdown(title, getPageBlocks(doc, meta.id)).trimEnd() + indentNote)
  }

  const rootTitle = resolvePageTitle(doc, pages[0].id)
  const name = withExtension(
    sanitizeExportFilename(filenameHint || rootTitle || 'workspace', 'workspace') + '-all',
    '.md',
  )
  downloadText(parts.join('\n\n---\n\n') + '\n', name, 'text/markdown;charset=utf-8')
  return { ok: true }
}

function uniqueZipPath(used: Set<string>, path: string): string {
  if (!used.has(path)) {
    used.add(path)
    return path
  }
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  const ext = dot > 0 ? path.slice(dot) : ''
  let i = 2
  while (used.has(`${stem}-${i}${ext}`)) i++
  const next = `${stem}-${i}${ext}`
  used.add(next)
  return next
}

/** ZIP of one Markdown file per page (folder structure from page tree). */
export function exportWorkspaceMarkdownZip(
  doc: CollabDocument,
  filenameHint?: string,
): ExportResult {
  const pages = listPagesNested(doc)
  if (pages.length === 0) return { ok: false, reason: 'No pages to export.' }

  const byId = new Map(pages.map((p) => [p.id, p]))
  const used = new Set<string>()
  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()

  for (const meta of pages) {
    const chain: string[] = []
    let cursor: string | undefined = meta.id
    while (cursor) {
      chain.unshift(cursor)
      const parentId: string | undefined = byId.get(cursor)?.parentId
      cursor = parentId && byId.has(parentId) ? parentId : undefined
      if (chain.length > 64) break
    }

    const segments = chain.map((id, i) => {
      const title = sanitizeExportFilename(resolvePageTitle(doc, id), `page-${i + 1}`)
      return i === chain.length - 1 ? withExtension(title, '.md') : title
    })

    const rel = uniqueZipPath(used, segments.join('/') || 'page.md')
    const title = resolvePageTitle(doc, meta.id)
    const text = pageMarkdown(title, getPageBlocks(doc, meta.id))
    files[rel] = encoder.encode(text)
  }

  const zipped = zipSync(files)
  const rootTitle = resolvePageTitle(doc, pages[0].id)
  const name = withExtension(
    sanitizeExportFilename(filenameHint || rootTitle || 'workspace', 'workspace') + '-pages',
    '.zip',
  )
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), name)
  return { ok: true }
}

export function exportWorkspaceJson(doc: CollabDocument, filenameHint?: string): ExportResult {
  const pages = listPagesNested(doc)
  if (pages.length === 0) return { ok: false, reason: 'No pages to export.' }
  const rootTitle = resolvePageTitle(doc, pages[0].id)
  const name = buildDocumentFilename(filenameHint || rootTitle)
  downloadText(serializeDocument(doc), name, 'application/json;charset=utf-8')
  return { ok: true }
}

export async function exportWorkspaceWebxdc(
  doc: CollabDocument,
  filenameHint?: string,
): Promise<ExportResult> {
  const pages = listPagesNested(doc)
  if (pages.length === 0) return { ok: false, reason: 'No pages to export.' }

  if (!(await canPackWebxdcPackage())) {
    return {
      ok: false,
      reason: 'WebXDC package export needs the packaged app (make build), not the bare dev server.',
    }
  }

  try {
    const rootTitle = resolvePageTitle(doc, pages[0].id)
    const base = sanitizeExportFilename(filenameHint || rootTitle || 'document', 'document')
    const xdcName = withExtension(base, '.xdc')
    const blob = await buildWebxdcPackageBlob(serializeDocument(doc), xdcName)
    downloadBlob(blob, xdcName)
    return { ok: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg === 'pack-dev-index' || msg === 'pack-not-production') {
      return {
        ok: false,
        reason:
          'WebXDC export needs the packaged app (make build / open the .xdc in Delta Chat), not the Vite dev server.',
      }
    }
    return { ok: false, reason: 'Could not build a WebXDC package. Rebuild the app and try again.' }
  }
}
