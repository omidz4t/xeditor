/**
 * Resolve markdown hrefs to in-app page ids (bound folder paths, titles, page: links).
 */

import { isPageLink, parsePageLink } from '@xproeditor/core'
import { getFolderBinding, pathForPage } from './folder-binding'

export function isExternalHref(href: string): boolean {
  const value = href.trim()
  if (!value) return false
  if (isPageLink(value)) return false
  if (/^(https?:|mailto:|tel:|sms:|\/\/)/i.test(value)) return true
  // Protocol-like but not a relative path (e.g. ftp:)
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('page:')) return true
  return false
}

function stripQueryHash(href: string): string {
  return href.trim().split('#')[0]?.split('?')[0]?.trim() ?? ''
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

/** Join a relative href against the current file path (posix-style). */
export function resolveRelativePath(fromFilePath: string | undefined, href: string): string {
  let rel = normalizeSlashes(stripQueryHash(href))
  // Drop leading ./ 
  while (rel.startsWith('./')) rel = rel.slice(2)
  // Absolute-from-root style (/foo.md) → relative to bound root
  if (rel.startsWith('/')) {
    return rel.replace(/^\/+/, '')
  }

  const baseDir = fromFilePath
    ? normalizeSlashes(fromFilePath).includes('/')
      ? normalizeSlashes(fromFilePath).replace(/\/[^/]*$/, '')
      : ''
    : ''

  const parts = baseDir ? baseDir.split('/').filter(Boolean) : []
  for (const part of rel.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function basename(path: string): string {
  const norm = normalizeSlashes(path)
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

function stripMdExt(name: string): string {
  return name.replace(/\.md$/i, '').replace(/\.markdown$/i, '')
}

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export type InternalLinkPage = { id: string; title: string }

/**
 * Map a link href to a page id, or null if it should be treated as external / unknown.
 */
export function resolveInternalHref(
  href: string | null | undefined,
  options: {
    pages: InternalLinkPage[]
    currentPageId?: string | null
    /** page exists in workspace */
    pageExists?: (pageId: string) => boolean
  },
): string | null {
  if (!href) return null
  const raw = href.trim()
  if (!raw || raw === '#' || raw.startsWith('javascript:')) return null

  const pageFromScheme = parsePageLink(raw)
  if (pageFromScheme) {
    if (options.pageExists && !options.pageExists(pageFromScheme)) return null
    return pageFromScheme
  }

  if (isExternalHref(raw)) return null

  const decoded = decodeMaybe(stripQueryHash(raw))
  if (!decoded) return null

  const currentPath = options.currentPageId ? pathForPage(options.currentPageId) : undefined
  const targetPath = resolveRelativePath(currentPath, decoded)
  const targetBase = basename(targetPath)
  const targetStem = stripMdExt(targetBase).toLowerCase()
  const targetPathLower = targetPath.toLowerCase()
  const targetBaseLower = targetBase.toLowerCase()

  const binding = getFolderBinding()
  const paths = binding?.pagePaths ?? {}

  // Exact path match (bound folder).
  for (const [pageId, path] of Object.entries(paths)) {
    const p = normalizeSlashes(path)
    if (p.toLowerCase() === targetPathLower || p.toLowerCase() === targetBaseLower) {
      return pageId
    }
  }

  // Basename match among bound paths.
  for (const [pageId, path] of Object.entries(paths)) {
    if (basename(path).toLowerCase() === targetBaseLower) {
      return pageId
    }
  }

  const normKey = (s: string) =>
    s
      .toLowerCase()
      .replace(/\.md$/i, '')
      .replace(/\.markdown$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  // Title match (with or without .md / hyphen vs space).
  const pages = options.pages
  const stemKey = normKey(targetStem)
  for (const page of pages) {
    const title = (page.title || '').trim()
    if (!title) continue
    if (title.toLowerCase() === targetStem) return page.id
    if (title.toLowerCase() === targetBaseLower) return page.id
    if (`${title}.md`.toLowerCase() === targetBaseLower) return page.id
    if (normKey(title) === stemKey) return page.id
  }

  // Stem match on bound paths (01-architecture.md ↔ path .../01-architecture.md).
  for (const [pageId, path] of Object.entries(paths)) {
    const base = basename(path)
    if (base.toLowerCase() === targetBaseLower) return pageId
    if (stripMdExt(base).toLowerCase() === targetStem) return pageId
    if (normKey(base) === stemKey) return pageId
    // Path suffix: href `RFC/README.md` vs bound `docs/TDD/RFC/README.md`
    const p = normalizeSlashes(path).toLowerCase()
    if (p.endsWith('/' + targetPathLower) || p.endsWith(targetPathLower)) return pageId
  }

  // Without binding: match page titles that look like the filename stem after
  // titleFromMarkdownSource style ("01-architecture" → "01 architecture").
  for (const page of pages) {
    const title = (page.title || '').trim()
    if (!title) continue
    if (normKey(title) === stemKey) return page.id
  }

  return null
}
