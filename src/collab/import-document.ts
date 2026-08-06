import {
  cloneBlock,
  createBlock,
  htmlToBlocks,
  markdownToBlocks,
  type Block,
} from '@xproeditor/core'
import { unzipSync, strFromU8 } from 'fflate'
import {
  getPageBlocks,
  getRootPageId,
  listPagesNested,
  parseDocument,
  type CollabDocument,
  type PageRecord,
} from './document'

export type ImportResult =
  | { ok: true; message: string }
  | { ok: false; reason: string }

export type ImportedPageSpec = {
  /** Stable key for parent mapping (original page id or zip path). */
  key: string
  parentKey?: string
  title: string
  icon?: string
  cover?: string
  fullWidth?: boolean
  blocks: Block[]
}

export function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdown')) return true
  const type = (file.type || '').toLowerCase()
  return type === 'text/markdown' || type === 'text/x-markdown'
}

export function isHtmlFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.html') || name.endsWith('.htm')) return true
  const type = (file.type || '').toLowerCase()
  return type === 'text/html' || type === 'application/xhtml+xml'
}

export function isPlainTextFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.txt') || name.endsWith('.text')) return true
  const type = (file.type || '').toLowerCase()
  return type === 'text/plain'
}

export function isCollabJsonFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.collab-doc.json') || name.endsWith('.json')) return true
  const type = (file.type || '').toLowerCase()
  return type === 'application/json' || type === 'text/json'
}

export function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) return true
  const type = (file.type || '').toLowerCase()
  return type === 'application/zip' || type === 'application/x-zip-compressed'
}

export function titleFromMarkdownSource(fileName: string, text: string): string {
  const h1 = text.match(/^\s*#\s+(.+?)\s*$/m)
  if (h1?.[1]?.trim()) return h1[1].trim().slice(0, 120)
  const base = fileName
    .replace(/\.(md|markdown|mdown|html|htm|txt|text)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return base || 'Imported page'
}

export function blocksFromMarkdown(text: string): Block[] {
  const parsed = markdownToBlocks(text)
  if (parsed.length > 0) return parsed
  const trimmed = text.trim()
  if (!trimmed) return [createBlock('paragraph', { content: [] })]
  return [createBlock('paragraph', { content: [{ text: trimmed }] })]
}

export function blocksFromPlainText(text: string): Block[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const paragraphs = normalized.split(/\n{2,}/)
  const blocks = paragraphs
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .map((line) => createBlock('paragraph', { content: [{ text: line }] }))
  return blocks.length > 0 ? blocks : [createBlock('paragraph', { content: [] })]
}

export function blocksFromHtml(html: string): Block[] {
  const parsed = htmlToBlocks(html)
  if (parsed.length > 0) return parsed
  return [createBlock('paragraph', { content: [] })]
}

export function titleFromHtml(html: string, fileName: string): string {
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleTag?.[1]?.trim()) return titleTag[1].trim().slice(0, 120)
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1?.[1]) {
    const text = h1[1].replace(/<[^>]+>/g, '').trim()
    if (text) return text.slice(0, 120)
  }
  return titleFromMarkdownSource(fileName, '')
}

/** Strip a leading ATX h1 that matches the page title so we don't duplicate it. */
export function stripLeadingTitleHeading(blocks: Block[], title: string): Block[] {
  if (blocks.length === 0) return blocks
  const first = blocks[0]
  if (!/^heading_[1-6]$/.test(first.type)) return blocks
  const text = first.content.map((s) => s.text ?? '').join('').trim()
  if (text && title && text.toLowerCase() === title.toLowerCase()) {
    return blocks.slice(1)
  }
  return blocks
}

export async function readFileText(file: File): Promise<string> {
  return file.text()
}

export async function parseMarkdownImport(file: File): Promise<{ title: string; blocks: Block[] }> {
  const text = await readFileText(file)
  const title = titleFromMarkdownSource(file.name, text)
  let blocks = blocksFromMarkdown(text)
  blocks = stripLeadingTitleHeading(blocks, title)
  return { title, blocks }
}

export async function parseHtmlImport(file: File): Promise<{ title: string; blocks: Block[] }> {
  const text = await readFileText(file)
  const title = titleFromHtml(text, file.name)
  let blocks = blocksFromHtml(text)
  blocks = stripLeadingTitleHeading(blocks, title)
  return { title, blocks }
}

export async function parsePlainTextImport(file: File): Promise<{ title: string; blocks: Block[] }> {
  const text = await readFileText(file)
  const title = titleFromMarkdownSource(file.name, text)
  return { title, blocks: blocksFromPlainText(text) }
}

export function parseCollabJsonText(raw: string): CollabDocument | null {
  const doc = parseDocument(raw)
  if (!doc.pages || Object.keys(doc.pages).length === 0) return null
  // parseDocument returns empty on failure — reject if input wasn't empty JSON-ish
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    if (Array.isArray(parsed)) return doc
    if ((parsed as CollabDocument).version === 2 && (parsed as CollabDocument).pages) {
      return doc
    }
    return null
  } catch {
    return null
  }
}

export async function parseCollabJsonFile(file: File): Promise<CollabDocument | null> {
  const text = await readFileText(file)
  return parseCollabJsonText(text)
}

export function rekeyBlocks(blocks: Block[], pageIdMap?: Map<string, string>): Block[] {
  return blocks.map((block) => {
    const next = cloneBlock(block, true)
    if (next.type === 'page' && next.props.pageId && pageIdMap) {
      const mapped = pageIdMap.get(String(next.props.pageId))
      if (mapped) next.props.pageId = mapped
    }
    if (next.content?.length && pageIdMap) {
      next.content = next.content.map((span) => {
        const link = span.marks?.link
        if (!link || typeof link !== 'string') return span
        const match = link.match(/^page:(.+)$/i)
        if (!match) return span
        const mapped = pageIdMap.get(match[1])
        if (!mapped) return span
        return {
          ...span,
          marks: { ...span.marks, link: `page:${mapped}` },
        }
      })
    }
    return next
  })
}

/** Flatten a collab document into create-order page specs (parents before children). */
export function collabDocumentToImportSpecs(doc: CollabDocument): ImportedPageSpec[] {
  const nested = listPagesNested(doc)
  const rootId = getRootPageId(doc)
  return nested.map((meta) => {
    const record: PageRecord | undefined = doc.pages[meta.id]
    return {
      key: meta.id,
      parentKey: meta.id === rootId ? undefined : meta.parentId,
      title: meta.title?.trim() || 'Untitled',
      icon: record?.icon,
      cover: record?.cover,
      fullWidth: record?.fullWidth,
      blocks: getPageBlocks(doc, meta.id),
    }
  })
}

export type MarkdownTreeEntry = {
  /** Relative path using `/` separators (e.g. `Notes/Ideas/todo.md`). */
  path: string
  text: string
}

function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
}

function isIgnoredTreePath(path: string): boolean {
  if (!path || path.endsWith('/')) return true
  return path.split('/').some((part) => {
    if (!part) return true
    if (part === '.DS_Store' || part === '__MACOSX') return true
    if (part === 'node_modules' || part === '.git') return true
    // Ignore hidden segments except we still allow files like `.env.md`? Prefer skip dotdirs.
    if (part.startsWith('.') && part !== '.') return true
    return false
  })
}

function isMarkdownTreePath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdown')
}

function titleFromFolderName(folder: string): string {
  const base = folder.split('/').pop() || folder
  return base.replace(/[-_]+/g, ' ').trim() || 'Folder'
}

function findPathCaseInsensitive(paths: Iterable<string>, candidate: string): string | undefined {
  const target = candidate.toLowerCase()
  for (const path of paths) {
    if (path.toLowerCase() === target) return path
  }
  return undefined
}

/**
 * Resolve which page key represents a folder directory.
 * Prefers export-style `Folder.md`, then common index/readme names, else a synthetic key.
 */
function resolveFolderPageKey(folder: string, mdPaths: Set<string>): string {
  const candidates = [
    `${folder}.md`,
    `${folder}.markdown`,
    `${folder}.mdown`,
    `${folder}/index.md`,
    `${folder}/Index.md`,
    `${folder}/README.md`,
    `${folder}/readme.md`,
    `${folder}/Readme.md`,
  ]
  for (const candidate of candidates) {
    if (mdPaths.has(candidate)) return candidate
    const hit = findPathCaseInsensitive(mdPaths, candidate)
    if (hit) return hit
  }
  return `folder:${folder}`
}

function sortSpecsParentsFirst(specs: ImportedPageSpec[]): ImportedPageSpec[] {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]))
  const depth = (key: string, guard = 0): number => {
    if (guard > 64) return guard
    const spec = byKey.get(key)
    if (!spec?.parentKey || !byKey.has(spec.parentKey)) return 0
    return 1 + depth(spec.parentKey, guard + 1)
  }
  return [...specs].sort((a, b) => {
    const da = depth(a.key)
    const db = depth(b.key)
    if (da !== db) return da - db
    return a.key.localeCompare(b.key)
  })
}

/**
 * Build import specs from a set of markdown paths (ZIP or picked folder).
 * Preserves folder hierarchy; creates lightweight folder pages when a directory
 * has no matching `.md` / `index.md` / `README.md`.
 */
export function parseMarkdownTreeEntries(entries: MarkdownTreeEntry[]): ImportedPageSpec[] {
  const byPath = new Map<string, string>()
  for (const entry of entries) {
    const path = normalizeTreePath(entry.path)
    if (isIgnoredTreePath(path) || !isMarkdownTreePath(path)) continue
    byPath.set(path, entry.text)
  }

  if (byPath.size === 0) return []

  const mdPaths = new Set(byPath.keys())
  const folderKeys = new Set<string>()
  for (const path of mdPaths) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      folderKeys.add(parts.slice(0, i).join('/'))
    }
  }

  const folderPageKey = new Map<string, string>()
  for (const folder of folderKeys) {
    folderPageKey.set(folder, resolveFolderPageKey(folder, mdPaths))
  }

  const specs: ImportedPageSpec[] = []
  const seen = new Set<string>()

  // Synthetic folder pages (no markdown file for that directory).
  const foldersSorted = [...folderKeys].sort((a, b) => {
    const da = a.split('/').length
    const db = b.split('/').length
    if (da !== db) return da - db
    return a.localeCompare(b)
  })
  for (const folder of foldersSorted) {
    const key = folderPageKey.get(folder)!
    if (seen.has(key) || mdPaths.has(key) || !key.startsWith('folder:')) continue
    seen.add(key)
    const parentFolder = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
    const parentKey = parentFolder ? folderPageKey.get(parentFolder) : undefined
    specs.push({
      key,
      parentKey,
      title: titleFromFolderName(folder),
      blocks: [createBlock('paragraph', { content: [] })],
    })
  }

  const mdSorted = [...mdPaths].sort((a, b) => {
    const da = a.split('/').length
    const db = b.split('/').length
    if (da !== db) return da - db
    return a.localeCompare(b)
  })

  for (const path of mdSorted) {
    if (seen.has(path)) continue
    seen.add(path)
    const text = byPath.get(path) ?? ''
    const baseName = path.split('/').pop() || path
    const title = titleFromMarkdownSource(baseName, text)
    let blocks = blocksFromMarkdown(text)
    blocks = stripLeadingTitleHeading(blocks, title)

    const parts = path.split('/').filter(Boolean)
    let parentKey: string | undefined
    if (parts.length > 1) {
      const parentFolder = parts.slice(0, -1).join('/')
      parentKey = folderPageKey.get(parentFolder)
      // This file is the folder page itself (Folder.md / index.md / README.md).
      if (parentKey === path) {
        const grand = parts.length > 2 ? parts.slice(0, -2).join('/') : ''
        parentKey = grand ? folderPageKey.get(grand) : undefined
      }
    }

    specs.push({ key: path, parentKey, title, blocks })
  }

  return sortSpecsParentsFirst(specs)
}

/**
 * Parse a directory of Markdown files (from `<input webkitdirectory>` or drag-drop).
 * Uses each file's `webkitRelativePath` when present so nesting is preserved.
 */
export async function parseMarkdownFolderFiles(files: File[]): Promise<ImportedPageSpec[]> {
  const entries: MarkdownTreeEntry[] = []
  for (const file of files) {
    if (!isMarkdownFile(file) && !isMarkdownTreePath(file.name)) continue
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim()
      || file.name
    if (isIgnoredTreePath(normalizeTreePath(rel))) continue
    try {
      const text = await readFileText(file)
      entries.push({ path: rel, text })
    } catch {
      console.warn('[import] failed to read markdown file', rel)
    }
  }
  return parseMarkdownTreeEntries(entries)
}

/** True when the browser supports native folder pick (`showDirectoryPicker`). */
export function canUseDirectoryPicker(): boolean {
  return typeof globalThis !== 'undefined'
    && typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

type DirHandle = FileSystemDirectoryHandle
type FileHandle = FileSystemFileHandle

async function walkDirectoryHandle(
  dir: DirHandle,
  basePath: string,
  out: MarkdownTreeEntry[],
): Promise<void> {
  // File System Access API — recursive read of a user-bound folder.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iterator = (dir as any).entries?.() as AsyncIterable<[string, FileSystemHandle]> | undefined
  if (!iterator) return

  for await (const [name, handle] of iterator) {
    const path = basePath ? `${basePath}/${name}` : name
    if (isIgnoredTreePath(normalizeTreePath(path)) && handle.kind === 'directory') {
      continue
    }
    if (handle.kind === 'directory') {
      // Skip common junk folders even if path filter missed them.
      if (
        name === 'node_modules'
        || name === '.git'
        || name === '__MACOSX'
        || name.startsWith('.')
      ) {
        continue
      }
      await walkDirectoryHandle(handle as DirHandle, path, out)
      continue
    }
    if (handle.kind !== 'file') continue
    if (!isMarkdownTreePath(name)) continue
    if (isIgnoredTreePath(normalizeTreePath(path))) continue
    try {
      const file = await (handle as FileHandle).getFile()
      const text = await file.text()
      out.push({ path, text })
    } catch {
      console.warn('[import] failed to read folder file', path)
    }
  }
}

/**
 * Open the browser’s native folder picker (File System Access API) and parse
 * all nested Markdown into import specs. Falls back is the caller’s job when
 * `canUseDirectoryPicker()` is false.
 */
export async function pickAndParseMarkdownDirectory(): Promise<ImportedPageSpec[]> {
  if (!canUseDirectoryPicker()) {
    throw new Error('Folder picker is not available in this browser.')
  }
  let root: DirHandle
  try {
    const pick = (globalThis as unknown as {
      showDirectoryPicker?: (options?: {
        id?: string
        mode?: 'read' | 'readwrite'
        startIn?: string
      }) => Promise<DirHandle>
    }).showDirectoryPicker
    if (!pick) throw new Error('Folder picker is not available in this browser.')
    root = await pick({
      id: 'xeditor-md-import',
      mode: 'read',
      startIn: 'documents',
    })
  } catch (error) {
    // User cancelled the picker — not a hard failure.
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
      return []
    }
    throw error
  }

  const entries: MarkdownTreeEntry[] = []
  // Prefix with the folder name so the tree has a clear root page.
  const rootName = root.name?.trim() || 'Imported'
  await walkDirectoryHandle(root, rootName, entries)
  return parseMarkdownTreeEntries(entries)
}

/**
 * Parse an already-granted directory handle (e.g. re-import a bound folder).
 */
export async function parseMarkdownDirectoryHandle(
  root: FileSystemDirectoryHandle,
  options: { includeRootName?: boolean } = {},
): Promise<ImportedPageSpec[]> {
  const includeRoot = options.includeRootName !== false
  const base = includeRoot ? (root.name?.trim() || 'Imported') : ''
  const entries: MarkdownTreeEntry[] = []
  await walkDirectoryHandle(root, base, entries)
  return parseMarkdownTreeEntries(entries)
}

/** True when the file list looks like a directory pick / folder drop (nested relative paths). */
export function filesLookLikeMarkdownFolder(files: File[]): boolean {
  if (files.length === 0) return false
  let mdCount = 0
  let nested = false
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim() || ''
    if (rel.includes('/')) nested = true
    if (isMarkdownFile(file) || isMarkdownTreePath(file.name)) mdCount += 1
  }
  // Folder picker often returns many non-md files; require at least one md + nested path,
  // or several md files that share a relative path prefix.
  return mdCount > 0 && (nested || files.length > 1 && files.every((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || ''
    return rel.length > 0
  }))
}

/**
 * Parse a Markdown ZIP produced by export (nested folders + .md files).
 * Parent of each page is derived from the folder path.
 */
export async function parseMarkdownZipFile(file: File): Promise<ImportedPageSpec[]> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(buf)
  } catch {
    throw new Error('Invalid or corrupted ZIP file.')
  }

  const entries: MarkdownTreeEntry[] = []
  for (const path of Object.keys(files)) {
    const normalized = normalizeTreePath(path)
    if (isIgnoredTreePath(normalized) || !isMarkdownTreePath(normalized)) continue
    entries.push({ path: normalized, text: strFromU8(files[path]) })
  }

  return parseMarkdownTreeEntries(entries)
}
