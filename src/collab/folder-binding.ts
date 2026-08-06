/**
 * Bind a local Markdown folder (File System Access API) so pages can be
 * written back with Ctrl+S / autosave. This is a *binding*, not a one-shot upload.
 */

import { blocksToMarkdown, type Block } from '@xproeditor/core'
import {
  canUseDirectoryPicker,
  parseMarkdownTreeEntries,
  type ImportedPageSpec,
  type MarkdownTreeEntry,
} from './import-document'

const IDB_NAME = 'xeditor-folder-binding'
const IDB_VERSION = 1
const STORE = 'handles'
const HANDLE_KEY = 'bound-root'
const AUTOSAVE_KEY = 'xeditor-folder-autosave'

export type FolderBindingState = {
  name: string
  /** pageId → path relative to the bound directory handle */
  pagePaths: Record<string, string>
}

type DirHandle = FileSystemDirectoryHandle
type FileHandle = FileSystemFileHandle

let boundRoot: DirHandle | null = null
let bindingState: FolderBindingState | null = null
let autosaveEnabled = readAutosavePref()
/** Last known file text on disk (or last successful write) per pageId. */
const originalSourceByPageId = new Map<string, string>()
/** Pages whose editor content changed since last successful folder write. */
const dirtyBoundPages = new Set<string>()

function readAutosavePref(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) === '1'
  } catch {
    return false
  }
}

export function isFolderAutosaveEnabled(): boolean {
  return autosaveEnabled
}

export function setFolderAutosaveEnabled(enabled: boolean): void {
  autosaveEnabled = enabled
  try {
    localStorage.setItem(AUTOSAVE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore
  }
}

export function canBindFolder(): boolean {
  return canUseDirectoryPicker()
}

export function getFolderBinding(): FolderBindingState | null {
  return bindingState
}

export function getBoundFolderHandle(): DirHandle | null {
  return boundRoot
}

export function clearFolderBinding(): void {
  boundRoot = null
  bindingState = null
  originalSourceByPageId.clear()
  dirtyBoundPages.clear()
  void idbDeleteHandle()
}

export function markBoundPageDirty(pageId: string): void {
  if (!pageId || !bindingState) return
  dirtyBoundPages.add(pageId)
}

export function isBoundPageDirty(pageId: string): boolean {
  return dirtyBoundPages.has(pageId)
}

export function setOriginalSourceForPage(pageId: string, text: string): void {
  if (!pageId) return
  originalSourceByPageId.set(pageId, normalizeNewlines(text))
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** True when serialized text matches what we last loaded/wrote for this page. */
export function boundPageContentUnchanged(pageId: string, nextText: string): boolean {
  const prev = originalSourceByPageId.get(pageId)
  if (prev === undefined) return false
  return normalizeNewlines(prev) === normalizeNewlines(nextText)
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSaveHandle(handle: DirHandle): Promise<void> {
  try {
    const db = await openIdb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(handle, HANDLE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Handle storage may be unsupported; in-memory bind still works this session.
  }
}

async function idbLoadHandle(): Promise<DirHandle | null> {
  try {
    const db = await openIdb()
    const handle = await new Promise<DirHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(HANDLE_KEY)
      req.onsuccess = () => resolve((req.result as DirHandle) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return handle
  } catch {
    return null
  }
}

async function idbDeleteHandle(): Promise<void> {
  try {
    const db = await openIdb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(HANDLE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore
  }
}

async function ensurePermission(handle: DirHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  const opts = { mode } as const
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = handle as any
  if (typeof h.queryPermission === 'function') {
    let perm = await h.queryPermission(opts)
    if (perm === 'granted') return true
    if (typeof h.requestPermission === 'function') {
      perm = await h.requestPermission(opts)
      return perm === 'granted'
    }
  }
  return true
}

async function walkDirectoryHandle(
  dir: DirHandle,
  basePath: string,
  out: MarkdownTreeEntry[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iterator = (dir as any).entries?.() as AsyncIterable<[string, FileSystemHandle]> | undefined
  if (!iterator) return

  for await (const [name, handle] of iterator) {
    const path = basePath ? `${basePath}/${name}` : name
    if (handle.kind === 'directory') {
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
    const lower = name.toLowerCase()
    if (!lower.endsWith('.md') && !lower.endsWith('.markdown') && !lower.endsWith('.mdown')) {
      continue
    }
    try {
      const file = await (handle as FileHandle).getFile()
      const text = await file.text()
      out.push({ path, text })
    } catch {
      console.warn('[bind] failed to read', path)
    }
  }
}

/**
 * Build write path for a page import key (relative to the bound root handle).
 * Synthetic folder keys (`folder:Notes`) map to `Notes.md`.
 */
export function writePathForSpecKey(key: string): string | null {
  if (!key) return null
  if (key.startsWith('folder:')) {
    const folder = key.slice('folder:'.length).replace(/^\/+|\/+$/g, '')
    if (!folder) return null
    return `${folder}.md`
  }
  return key.replace(/^\/+/, '')
}

export function pageMarkdownForSave(title: string, blocks: Block[]): string {
  const body = blocksToMarkdown(blocks).trim()
  const t = title.trim() || 'Untitled'
  return body ? `# ${t}\n\n${body}\n` : `# ${t}\n`
}

async function ensureFileHandle(root: DirHandle, relativePath: string): Promise<FileHandle> {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error('Invalid path')
  let dir: DirHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: true })
  }
  return dir.getFileHandle(parts[parts.length - 1]!, { create: true })
}

export async function writeTextToBoundFolder(
  relativePath: string,
  text: string,
): Promise<{ ok: true; wrote: boolean } | { ok: false; reason: string }> {
  if (!boundRoot) return { ok: false, reason: 'No folder bound.' }
  const allowed = await ensurePermission(boundRoot, 'readwrite')
  if (!allowed) return { ok: false, reason: 'Folder write permission denied.' }
  try {
    const file = await ensureFileHandle(boundRoot, relativePath)
    // Skip write when on-disk content already matches (keeps git clean).
    try {
      const existing = await file.getFile()
      const current = normalizeNewlines(await existing.text())
      if (current === normalizeNewlines(text)) {
        return { ok: true, wrote: false }
      }
    } catch {
      // File may not exist yet — fall through to create/write.
    }
    const writable = await file.createWritable()
    await writable.write(text)
    await writable.close()
    return { ok: true, wrote: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not write file.'
    return { ok: false, reason }
  }
}

/**
 * Open native folder picker with write access, read Markdown tree, keep the handle bound.
 */
export async function bindMarkdownFolder(): Promise<{
  root: DirHandle
  specs: ImportedPageSpec[]
  /** import key → relative write path */
  keyPaths: Map<string, string>
  /** import key → original file text (for git-clean no-op saves) */
  originalByKey: Map<string, string>
} | null> {
  if (!canBindFolder()) {
    throw new Error('Folder binding is not available in this browser.')
  }
  const pick = window.showDirectoryPicker
  if (!pick) throw new Error('Folder binding is not available in this browser.')

  let root: DirHandle
  try {
    root = await pick({
      id: 'xeditor-md-bind',
      mode: 'readwrite',
      startIn: 'documents',
    })
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
      return null
    }
    throw error
  }

  const allowed = await ensurePermission(root, 'readwrite')
  if (!allowed) {
    throw new Error('Write permission is required to bind a folder.')
  }

  const entries: MarkdownTreeEntry[] = []
  // Paths relative to the handle (no fake root segment) so writes match disk.
  await walkDirectoryHandle(root, '', entries)
  const originalByPath = new Map(entries.map((e) => [e.path, e.text]))
  const specs = parseMarkdownTreeEntries(entries)

  const keyPaths = new Map<string, string>()
  const originalByKey = new Map<string, string>()
  for (const spec of specs) {
    const path = writePathForSpecKey(spec.key)
    if (path) {
      keyPaths.set(spec.key, path)
      const original = originalByPath.get(path) ?? originalByPath.get(spec.key)
      if (typeof original === 'string') {
        originalByKey.set(spec.key, original)
      }
    }
  }

  boundRoot = root
  bindingState = {
    name: root.name?.trim() || 'Folder',
    pagePaths: {},
  }
  originalSourceByPageId.clear()
  dirtyBoundPages.clear()
  await idbSaveHandle(root)

  return { root, specs, keyPaths, originalByKey }
}

/**
 * Register pageId → relative path after import idMap is known.
 * Optionally seed original file text so untouched pages are never rewritten.
 */
export function registerBoundPagePaths(
  idMap: Map<string, string>,
  keyPaths: Map<string, string>,
  originalByKey?: Map<string, string>,
): void {
  if (!bindingState) {
    bindingState = { name: boundRoot?.name || 'Folder', pagePaths: {} }
  }
  const next = { ...bindingState.pagePaths }
  for (const [key, pageId] of idMap) {
    const path = keyPaths.get(key) ?? writePathForSpecKey(key)
    if (path && pageId) {
      next[pageId] = path
      dirtyBoundPages.delete(pageId)
      const original = originalByKey?.get(key)
      if (typeof original === 'string') {
        originalSourceByPageId.set(pageId, normalizeNewlines(original))
      }
    }
  }
  bindingState = { ...bindingState, pagePaths: next }
}

export function setBoundPagePath(pageId: string, relativePath: string): void {
  if (!bindingState) {
    bindingState = { name: boundRoot?.name || 'Folder', pagePaths: {} }
  }
  bindingState = {
    ...bindingState,
    pagePaths: { ...bindingState.pagePaths, [pageId]: relativePath },
  }
}

export function pathForPage(pageId: string): string | undefined {
  return bindingState?.pagePaths[pageId]
}

/**
 * Suggest a path for a page that is not yet mapped (new page under a bound folder).
 */
export function suggestPathForTitle(title: string): string {
  const base = (title || 'Untitled')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || 'Untitled'
  return `${base}.md`
}

export async function savePageToBoundFolder(
  pageId: string,
  title: string,
  blocks: Block[],
  options: { force?: boolean } = {},
): Promise<{ ok: true; path: string; wrote: boolean; skipped?: string } | { ok: false; reason: string }> {
  if (!boundRoot || !bindingState) {
    return { ok: false, reason: 'No folder bound.' }
  }
  let path = bindingState.pagePaths[pageId]
  if (!path) {
    path = suggestPathForTitle(title)
    setBoundPagePath(pageId, path)
  }

  // If the user never edited this page, keep the original file bytes (git-clean).
  if (!options.force && !dirtyBoundPages.has(pageId) && originalSourceByPageId.has(pageId)) {
    return { ok: true, path, wrote: false, skipped: 'unchanged' }
  }

  const text = pageMarkdownForSave(title, blocks)

  // If re-serialize matches what we loaded, do not touch the file.
  if (!options.force && boundPageContentUnchanged(pageId, text)) {
    dirtyBoundPages.delete(pageId)
    return { ok: true, path, wrote: false, skipped: 'unchanged' }
  }

  const result = await writeTextToBoundFolder(path, text)
  if (!result.ok) return result

  originalSourceByPageId.set(pageId, normalizeNewlines(text))
  dirtyBoundPages.delete(pageId)
  return { ok: true, path, wrote: result.wrote }
}

/** Try restore a previously bound handle (user may need to re-grant permission). */
export async function restoreFolderBinding(): Promise<boolean> {
  const handle = await idbLoadHandle()
  if (!handle) return false
  const ok = await ensurePermission(handle, 'readwrite')
  if (!ok) return false
  boundRoot = handle
  if (!bindingState) {
    bindingState = { name: handle.name?.trim() || 'Folder', pagePaths: {} }
  } else {
    bindingState = { ...bindingState, name: handle.name?.trim() || bindingState.name }
  }
  return true
}
