import { createBlock, type Block } from '@xproeditor/core'
import * as Y from 'yjs'
import {
  normalizeLegacySeedIcons,
  parseDocument,
  type CollabDocument,
  type PageComment,
  type PageRecord,
} from './document'

/** Shared Yjs map of pages. Each page is a Y.Map with LWW fields + per-block CRDT maps. */
export const PAGES_KEY = 'pages'
/** Legacy whole-document JSON text — migrated once then cleared. */
export const LEGACY_CONTENT_KEY = 'content'

const PAGE_TITLE = 'title'
const PAGE_ICON = 'icon'
const PAGE_COVER = 'cover'
const PAGE_PARENT_ID = 'parentId'
const PAGE_SORT_ORDER = 'sortOrder'
const PAGE_CREATED_AT = 'createdAt'
/** 0 = container (default), 1 = full width */
const PAGE_FULL_WIDTH = 'fullWidth'
/** @deprecated Whole-page LWW blob — migrated to per-block storage. */
const PAGE_BLOCKS_JSON = 'blocksJson'
const PAGE_COMMENTS_JSON = 'commentsJson'
/** Y.Map<blockId, blockJson> — concurrent edits to different blocks merge cleanly. */
const PAGE_BLOCKS = 'blocks'
/** Y.Array<blockId> — document order of blocks. */
const PAGE_BLOCK_ORDER = 'blockOrder'

function seedBlocks(): Block[] {
  return [createBlock('paragraph', { content: [] })]
}

function safeParseBlock(raw: unknown): Block | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && typeof (parsed as Block).id === 'string') {
      return parsed as Block
    }
  } catch {
    // ignore
  }
  return null
}

function safeParseBlocks(raw: unknown): Block[] {
  if (typeof raw !== 'string' || !raw) {
    return seedBlocks()
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as Block[]
    }
  } catch {
    // keep fallback — never invent a whole empty document from corrupt page JSON
  }
  return seedBlocks()
}

function safeParseComments(raw: unknown): PageComment[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed as PageComment[]
    }
  } catch {
    // ignore corrupt comments rather than wiping the page
  }
  return undefined
}

function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map
}

function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array
}

function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  const current = map.get(key)
  if (current === value) return
  if (typeof current === 'number' && typeof value === 'number' && Number.isNaN(current) && Number.isNaN(value)) {
    return
  }
  map.set(key, value)
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function ensureBlocksMap(yPage: Y.Map<unknown>): Y.Map<unknown> {
  const existing = yPage.get(PAGE_BLOCKS)
  if (isYMap(existing)) return existing
  const map = new Y.Map<unknown>()
  yPage.set(PAGE_BLOCKS, map)
  return map
}

function ensureBlockOrder(yPage: Y.Map<unknown>): Y.Array<string> {
  const existing = yPage.get(PAGE_BLOCK_ORDER)
  if (isYArray(existing)) return existing as Y.Array<string>
  const arr = new Y.Array<string>()
  yPage.set(PAGE_BLOCK_ORDER, arr)
  return arr
}

function readOrderIds(order: Y.Array<string> | Y.Array<unknown>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of order.toArray()) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function readBlocksFromPage(yPage: Y.Map<unknown>): Block[] {
  const blocksMap = yPage.get(PAGE_BLOCKS)
  const order = yPage.get(PAGE_BLOCK_ORDER)

  if (isYMap(blocksMap) && isYArray(order) && order.length > 0) {
    const out: Block[] = []
    const seen = new Set<string>()
    // Dedupe order ids — concurrent full rewrites of Y.Array can leave duplicates.
    for (const id of order.toArray()) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue
      seen.add(id)
      const block = safeParseBlock(blocksMap.get(id))
      if (block) out.push(block)
    }
    if (out.length > 0) return out
  }

  // Per-block map without order — fall back to map iteration order.
  if (isYMap(blocksMap) && blocksMap.size > 0) {
    const out: Block[] = []
    const seen = new Set<string>()
    blocksMap.forEach((value, id) => {
      if (seen.has(id)) return
      const block = safeParseBlock(value)
      if (block) {
        seen.add(block.id)
        out.push(block)
      }
    })
    if (out.length > 0) return out
  }

  // Legacy whole-page JSON.
  return safeParseBlocks(yPage.get(PAGE_BLOCKS_JSON))
}

/**
 * Incrementally sync block order without delete-all + reinsert.
 *
 * Concurrent full rewrites of a Y.Array (delete entire list, insert new list)
 * merge into *duplicated* ids under Yjs — which showed up as every block
 * appearing twice when two people typed at once. Only insert/delete/move
 * individual entries so concurrent peer edits compose cleanly.
 */
function syncBlockOrder(order: Y.Array<string>, nextIds: string[]): void {
  const nextSet = new Set(nextIds)

  // 1) Drop unknown entries + duplicates (keep first occurrence of each id).
  const firstIndex = new Map<string, number>()
  for (let i = 0; i < order.length; i++) {
    const id = order.get(i)
    if (typeof id !== 'string') continue
    if (!firstIndex.has(id)) firstIndex.set(id, i)
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order.get(i)
    if (typeof id !== 'string' || !nextSet.has(id) || firstIndex.get(id) !== i) {
      order.delete(i, 1)
    }
  }

  // 2) Insert missing ids relative to already-present neighbors.
  let current = readOrderIds(order)
  for (let i = 0; i < nextIds.length; i++) {
    const id = nextIds[i]
    if (current.includes(id)) continue

    let insertAt = current.length
    for (let j = i - 1; j >= 0; j--) {
      const prevIdx = current.indexOf(nextIds[j])
      if (prevIdx >= 0) {
        insertAt = prevIdx + 1
        break
      }
    }
    if (insertAt === current.length) {
      for (let j = i + 1; j < nextIds.length; j++) {
        const nextIdx = current.indexOf(nextIds[j])
        if (nextIdx >= 0) {
          insertAt = nextIdx
          break
        }
      }
    }
    order.insert(Math.max(0, Math.min(insertAt, order.length)), [id])
    current = readOrderIds(order)
  }

  // 3) Fix local reorders (drag) with minimal moves — never rewrite the whole array.
  current = readOrderIds(order)
  if (arraysEqual(current, nextIds)) return

  for (let target = 0; target < nextIds.length; target++) {
    current = readOrderIds(order)
    const want = nextIds[target]
    if (current[target] === want) continue
    const from = current.indexOf(want)
    if (from < 0) continue
    order.delete(from, 1)
    const insertAt = from < target ? target - 1 : target
    order.insert(Math.max(0, Math.min(insertAt, order.length)), [want])
  }
}

/**
 * Sync page blocks into per-block Y structures so two peers editing different
 * blocks do not last-write-win the entire page.
 *
 * @param onlyIds When set, only re-serialize these block ids (still removes
 *   deleted ids and syncs order). Used for typing so we don't JSON.stringify
 *   every block on a large page each keystroke.
 */
function syncBlocksToPage(
  yPage: Y.Map<unknown>,
  nextBlocks: Block[],
  onlyIds?: ReadonlySet<string> | null,
): void {
  const blocksMap = ensureBlocksMap(yPage)
  const order = ensureBlockOrder(yPage)
  // Guard against accidental duplicate ids in the local list before writing.
  const seenLocal = new Set<string>()
  const uniqueBlocks = nextBlocks.filter((block) => {
    if (!block?.id || seenLocal.has(block.id)) return false
    seenLocal.add(block.id)
    return true
  })
  const nextIds = uniqueBlocks.map((block) => block.id)
  const nextById = new Map(uniqueBlocks.map((block) => [block.id, block]))

  // Remove deleted blocks.
  const toDelete: string[] = []
  blocksMap.forEach((_value, id) => {
    if (!nextById.has(id)) toDelete.push(id)
  })
  for (const id of toDelete) {
    blocksMap.delete(id)
  }

  // Upsert changed block payloads (LWW per block id — independent peers merge).
  // When onlyIds is a non-empty set, skip re-stringifying clean blocks (typing hot path).
  // Empty Set must NOT mean "write nothing" — that silently dropped body edits when
  // dirty/focus tracking missed a keystroke (title still worked; body did not).
  const limitIds = onlyIds && onlyIds.size > 0 ? onlyIds : null
  for (const block of uniqueBlocks) {
    if (limitIds && !limitIds.has(block.id)) {
      // New blocks not yet in Y must still be written.
      if (blocksMap.has(block.id)) continue
    }
    const json = JSON.stringify(block)
    setIfChanged(blocksMap, block.id, json)
  }

  // Incremental order sync — never delete-all + reinsert (Yjs would duplicate).
  const currentOrder = readOrderIds(order)
  if (!arraysEqual(currentOrder, nextIds)) {
    syncBlockOrder(order, nextIds)
  }

  // Clear legacy blob once migrated so it can't resurrect on peers.
  if (yPage.has(PAGE_BLOCKS_JSON)) {
    yPage.delete(PAGE_BLOCKS_JSON)
  }
}

/**
 * Fast path: write one page's blocks into Y without reading the whole document.
 * Returns false if the page map is missing (caller should fall back).
 */
export function syncPageBlocksToY(
  doc: Y.Doc,
  pageId: string,
  nextBlocks: Block[],
  origin?: unknown,
  onlyIds?: ReadonlySet<string> | null,
): boolean {
  const yPages = getPagesMap(doc)
  const existing = yPages.get(pageId)
  if (!isYMap(existing)) return false
  doc.transact(() => {
    syncBlocksToPage(existing, nextBlocks, onlyIds)
  }, origin)
  return true
}

function yPageToRecord(pageId: string, yPage: Y.Map<unknown>): PageRecord {
  const parentRaw = yPage.get(PAGE_PARENT_ID)
  const parentId = typeof parentRaw === 'string' && parentRaw ? parentRaw : undefined
  const iconRaw = yPage.get(PAGE_ICON)
  const icon = typeof iconRaw === 'string' && iconRaw ? iconRaw : undefined
  const coverRaw = yPage.get(PAGE_COVER)
  const cover = typeof coverRaw === 'string' && coverRaw ? coverRaw : undefined
  const sortRaw = yPage.get(PAGE_SORT_ORDER)
  const createdRaw = yPage.get(PAGE_CREATED_AT)
  const comments = safeParseComments(yPage.get(PAGE_COMMENTS_JSON))

  const fullWidthRaw = yPage.get(PAGE_FULL_WIDTH)
  const fullWidth =
    fullWidthRaw === true || fullWidthRaw === 1 || fullWidthRaw === '1'

  const record: PageRecord = {
    id: pageId,
    title: String(yPage.get(PAGE_TITLE) ?? ''),
    icon,
    parentId,
    sortOrder: typeof sortRaw === 'number' ? sortRaw : undefined,
    createdAt: typeof createdRaw === 'number' ? createdRaw : undefined,
    blocks: readBlocksFromPage(yPage),
  }

  if (cover) {
    record.cover = cover
  }

  if (fullWidth) {
    record.fullWidth = true
  }

  if (comments?.length) {
    record.comments = comments
  }

  return record
}

export function getPagesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(PAGES_KEY)
}

export function readDocumentFromY(doc: Y.Doc): CollabDocument {
  const yPages = getPagesMap(doc)
  if (yPages.size === 0) {
    return { version: 2, pages: {} }
  }

  const pages: Record<string, PageRecord> = {}
  yPages.forEach((value, pageId) => {
    if (!isYMap(value)) return
    pages[pageId] = yPageToRecord(pageId, value)
  })

  if (Object.keys(pages).length === 0) {
    return { version: 2, pages: {} }
  }

  return { version: 2, pages }
}

/**
 * Apply only the fields / blocks that changed between `before` and `after`.
 * Block bodies are stored per-id so concurrent edits on different blocks merge.
 *
 * Unchanged page object references are skipped entirely — important when the
 * workspace has hundreds of pages and only one was created/updated.
 */
export function syncDocumentToY(
  doc: Y.Doc,
  before: CollabDocument,
  after: CollabDocument,
  origin?: unknown,
): void {
  const yPages = getPagesMap(doc)

  doc.transact(() => {
    for (const pageId of Object.keys(before.pages)) {
      if (!after.pages[pageId]) {
        yPages.delete(pageId)
      }
    }

    for (const [pageId, page] of Object.entries(after.pages)) {
      const prev = before.pages[pageId]
      // Same record object → nothing changed for this page (batch create path).
      if (prev === page) continue

      const existing = yPages.get(pageId)
      const yPage: Y.Map<unknown> = isYMap(existing) ? existing : new Y.Map<unknown>()
      if (!isYMap(existing)) {
        yPages.set(pageId, yPage)
      }

      setIfChanged(yPage, PAGE_TITLE, page.title ?? '')
      setIfChanged(yPage, PAGE_ICON, page.icon ?? '')
      setIfChanged(yPage, PAGE_COVER, page.cover ?? '')
      setIfChanged(yPage, PAGE_PARENT_ID, page.parentId ?? '')
      setIfChanged(yPage, PAGE_SORT_ORDER, page.sortOrder ?? 0)
      setIfChanged(yPage, PAGE_CREATED_AT, page.createdAt ?? 0)
      // Persist 0 for container so peers without the field still default correctly.
      setIfChanged(yPage, PAGE_FULL_WIDTH, page.fullWidth ? 1 : 0)

      if (!prev || prev.comments !== page.comments) {
        const nextComments = JSON.stringify(page.comments ?? [])
        const prevComments = JSON.stringify(prev?.comments ?? [])
        if (!prev || prevComments !== nextComments) {
          setIfChanged(yPage, PAGE_COMMENTS_JSON, nextComments)
        }
      }

      const nextBlocks = page.blocks?.length ? page.blocks : seedBlocks()
      // Only touch block maps when the blocks array identity changed (or new page).
      if (!prev || prev.blocks !== page.blocks || !isYMap(yPage.get(PAGE_BLOCKS))) {
        syncBlocksToPage(yPage, nextBlocks)
      }
    }
  }, origin)
}

export function migrateLegacyContentIfNeeded(doc: Y.Doc, origin?: unknown): boolean {
  const yPages = getPagesMap(doc)
  if (yPages.size > 0) {
    // Migrate any pages still on blocksJson into per-block maps.
    let migrated = false
    doc.transact(() => {
      yPages.forEach((value) => {
        if (!isYMap(value)) return
        if (isYMap(value.get(PAGE_BLOCKS)) && isYArray(value.get(PAGE_BLOCK_ORDER))) return
        const legacy = value.get(PAGE_BLOCKS_JSON)
        if (typeof legacy !== 'string' || !legacy) return
        const blocks = safeParseBlocks(legacy)
        syncBlocksToPage(value, blocks)
        migrated = true
      })
    }, origin)

    const before = readDocumentFromY(doc)
    const after = normalizeLegacySeedIcons(before)
    if (after !== before) {
      syncDocumentToY(doc, before, after, origin)
      migrated = true
    }

    return migrated
  }

  const legacy = doc.getText(LEGACY_CONTENT_KEY)
  if (legacy.length === 0) return false

  const raw = legacy.toString()
  let migratedDoc: CollabDocument
  try {
    migratedDoc = parseDocument(raw)
  } catch {
    return false
  }

  if (Object.keys(migratedDoc.pages).length === 0) {
    return false
  }

  if (!raw.includes('"version"') && !raw.trimStart().startsWith('[')) {
    return false
  }

  syncDocumentToY(doc, { version: 2, pages: {} }, migratedDoc, origin)

  doc.transact(() => {
    if (legacy.length > 0) {
      legacy.delete(0, legacy.length)
    }
  }, origin)

  return true
}

export function hasYDocumentContent(doc: Y.Doc): boolean {
  if (getPagesMap(doc).size > 0) return true
  return doc.getText(LEGACY_CONTENT_KEY).length > 0
}

export function waitForYDocumentContent(
  doc: Y.Doc,
  timeoutMs: number,
  remoteOrigins: ReadonlySet<unknown>,
): Promise<void> {
  return new Promise((resolve) => {
    if (hasYDocumentContent(doc)) {
      resolve()
      return
    }

    const deadline = window.setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)

    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (remoteOrigins.has(origin) || hasYDocumentContent(doc)) {
        cleanup()
        resolve()
      }
    }

    const yPages = getPagesMap(doc)
    const onPages = () => {
      if (hasYDocumentContent(doc)) {
        cleanup()
        resolve()
      }
    }

    const cleanup = () => {
      window.clearTimeout(deadline)
      doc.off('updateV2', onUpdate)
      yPages.unobserve(onPages)
    }

    doc.on('updateV2', onUpdate)
    yPages.observe(onPages)
  })
}
