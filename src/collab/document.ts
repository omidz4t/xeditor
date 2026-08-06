import { createBlock, parsePageLink, type Block, type InlineSpan, type TableCell } from '@xproeditor/core'

/** Sentinel block id for page-level comments (not anchored to a text range). */
export const PAGE_COMMENT_BLOCK_ID = '__page__'

export type CommentMessage = {
  id: string
  author: string
  text: string
  createdAt: number
}

export type PageComment = {
  id: string
  blockId: string
  start: number
  end: number
  quote?: string
  resolved?: boolean
  messages: CommentMessage[]
  createdAt: number
}

export type PageRecord = {
  id: string
  title: string
  icon?: string
  /**
   * Page cover preset id, e.g. `color:blue` or `pattern:dots`.
   * Undefined = no cover.
   */
  cover?: string
  parentId?: string
  /** Sidebar sibling order (lower = higher in the list). */
  sortOrder?: number
  /** Milliseconds since epoch; legacy fallback for ordering. */
  createdAt?: number
  /**
   * Page content width.
   * - false / undefined = container (default, constrained max-width)
   * - true = full width
   */
  fullWidth?: boolean
  blocks: Block[]
  comments?: PageComment[]
}

export type PageMeta = {
  id: string
  title: string
  icon?: string
  parentId?: string
  depth?: number
}

export type CollabDocument = {
  version: 2
  pages: Record<string, PageRecord>
}

export function generatePageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `pg-${crypto.randomUUID()}`
  }
  return `pg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function seedBlocks(): Block[] {
  return [createBlock('paragraph', { content: [] })]
}

export function createEmptyDocument(): CollabDocument {
  const rootId = generatePageId()
  return {
    version: 2,
    pages: {
      [rootId]: {
        id: rootId,
        title: '',
        createdAt: 0,
        blocks: seedBlocks(),
      },
    },
  }
}

export function getRootPageId(doc: CollabDocument): string {
  return Object.values(doc.pages)[0]?.id ?? ''
}

export function migrateBlocksArray(blocks: Block[]): CollabDocument {
  const rootId = generatePageId()
  const normalized = Array.isArray(blocks) && blocks.length > 0 ? blocks : seedBlocks()
  return {
    version: 2,
    pages: {
      [rootId]: {
        id: rootId,
        title: '',
        blocks: normalized,
      },
    },
  }
}

/** Root pages used to ship with a default emoji; strip it so icons are opt-in. */
const LEGACY_ROOT_SEED_ICON = '📝'

export function normalizeLegacySeedIcons(doc: CollabDocument): CollabDocument {
  const rootId = getRootPageId(doc)
  const root = doc.pages[rootId]
  if (!root || root.icon !== LEGACY_ROOT_SEED_ICON) return doc
  const nextPage: PageRecord = { ...root }
  delete nextPage.icon
  return {
    ...doc,
    pages: {
      ...doc.pages,
      [rootId]: nextPage,
    },
  }
}

export function parseDocument(raw: string): CollabDocument {
  if (!raw) return createEmptyDocument()

  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as CollabDocument).version === 2 &&
      (parsed as CollabDocument).pages
    ) {
      const doc = parsed as CollabDocument & { currentPageId?: string }
      if (Object.keys(doc.pages).length === 0) return createEmptyDocument()
      return normalizeLegacySeedIcons({ version: 2, pages: doc.pages })
    }

    if (Array.isArray(parsed)) {
      return normalizeLegacySeedIcons(migrateBlocksArray(parsed as Block[]))
    }
  } catch {
    // Corrupt / mid-merge JSON must not be treated as a blank document for callers
    // that may persist the result. Return empty only as a typed fallback.
    // Quiet in production noise: only log when the payload looked like JSON.
    const preview = typeof raw === 'string' ? raw.trim().slice(0, 40) : ''
    if (preview.startsWith('{') || preview.startsWith('[')) {
      console.warn('[collab] parseDocument failed; ignoring corrupt payload')
    }
  }

  return createEmptyDocument()
}

export function serializeDocument(doc: CollabDocument): string {
  return JSON.stringify(doc)
}

export function getPageBlocks(doc: CollabDocument, pageId: string): Block[] {
  const page = doc.pages[pageId]
  return page?.blocks?.length ? page.blocks : seedBlocks()
}

export function setPageBlocks(doc: CollabDocument, pageId: string, blocks: Block[]): CollabDocument {
  const page = doc.pages[pageId]
  if (!page) return doc
  return {
    ...doc,
    pages: {
      ...doc.pages,
      [pageId]: {
        ...page,
        blocks: blocks.length > 0 ? blocks : seedBlocks(),
      },
    },
  }
}

function deriveParentMap(doc: CollabDocument): Map<string, string> {
  const parents = new Map<string, string>()

  for (const page of Object.values(doc.pages)) {
    for (const block of page.blocks) {
      if (block.type !== 'page') continue

      const childId = block.props.pageId
      if (typeof childId !== 'string' || !childId || childId === page.id || !doc.pages[childId]) {
        continue
      }

      if (!parents.has(childId)) {
        parents.set(childId, page.id)
      }
    }
  }

  return parents
}

function resolveParentId(
  page: PageRecord,
  rootPageId: string,
  derived: Map<string, string>,
): string {
  if (page.id === rootPageId) {
    return rootPageId
  }

  return page.parentId ?? derived.get(page.id) ?? rootPageId
}

function toPageMeta(page: PageRecord, parentId?: string): PageMeta {
  return {
    id: page.id,
    title: page.title.trim() || 'Untitled',
    icon: page.icon,
    parentId,
  }
}

function buildInsertionOrder(doc: CollabDocument): Map<string, number> {
  const insertionOrder = new Map<string, number>()
  let insertionIndex = 0

  for (const page of Object.values(doc.pages)) {
    insertionOrder.set(page.id, insertionIndex++)
  }

  return insertionOrder
}

function pageSortKey(page: PageRecord, insertionOrder: Map<string, number>): number {
  if (page.sortOrder != null) {
    return page.sortOrder
  }

  if (page.createdAt != null) {
    return page.createdAt
  }

  const match = page.id.match(/^pg-([0-9a-z]+)-/i)
  if (match) {
    const parsed = Number.parseInt(match[1], 36)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }

  return (insertionOrder.get(page.id) ?? 0) * 1000
}

function compareSiblingPages(a: PageRecord, b: PageRecord, insertionOrder: Map<string, number>): number {
  const diff = pageSortKey(a, insertionOrder) - pageSortKey(b, insertionOrder)
  if (diff !== 0) {
    return diff
  }

  return a.id.localeCompare(b.id)
}

function getSiblingPages(
  doc: CollabDocument,
  parentId: string,
  insertionOrder: Map<string, number>,
): PageRecord[] {
  const rootPageId = getRootPageId(doc)
  const derived = deriveParentMap(doc)

  return Object.values(doc.pages)
    .filter((page) => page.id !== rootPageId && resolveParentId(page, rootPageId, derived) === parentId)
    .sort((a, b) => compareSiblingPages(a, b, insertionOrder))
}

function computeInsertSortOrder(
  doc: CollabDocument,
  parentId: string,
  insertAfterPageId?: string,
  excludePageId?: string,
): number {
  const insertionOrder = buildInsertionOrder(doc)
  const siblings = getSiblingPages(doc, parentId, insertionOrder).filter(
    (page) => page.id !== excludePageId,
  )

  if (!insertAfterPageId) {
    const first = siblings[0]
    return first ? pageSortKey(first, insertionOrder) - 1000 : 0
  }

  const index = siblings.findIndex((page) => page.id === insertAfterPageId)
  if (index < 0) {
    const last = siblings[siblings.length - 1]
    return last ? pageSortKey(last, insertionOrder) + 1000 : 0
  }

  const afterOrder = pageSortKey(siblings[index], insertionOrder)
  const next = siblings[index + 1]
  if (!next) {
    return afterOrder + 1000
  }

  return (afterOrder + pageSortKey(next, insertionOrder)) / 2
}

export function listPages(doc: CollabDocument): PageMeta[] {
  return listPagesNested(doc)
}

export function listPagesNested(doc: CollabDocument): PageMeta[] {
  const rootPageId = getRootPageId(doc)
  const root = doc.pages[rootPageId]
  if (!root) return []

  const derived = deriveParentMap(doc)
  const childrenOf = new Map<string, PageRecord[]>()
  const insertionOrder = buildInsertionOrder(doc)

  for (const page of Object.values(doc.pages)) {
    if (page.id === rootPageId) continue

    const parentId = resolveParentId(page, rootPageId, derived)
    const siblings = childrenOf.get(parentId) ?? []
    siblings.push(page)
    childrenOf.set(parentId, siblings)
  }

  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => compareSiblingPages(a, b, insertionOrder))
  }

  const out: PageMeta[] = [
    {
      ...toPageMeta(root),
      depth: 0,
    },
  ]

  const walk = (parentId: string, depth: number) => {
    for (const page of childrenOf.get(parentId) ?? []) {
      out.push({
        ...toPageMeta(page, parentId === rootPageId ? rootPageId : parentId),
        depth,
      })
      walk(page.id, depth + 1)
    }
  }

  walk(rootPageId, 1)
  return out
}

export function createPage(
  doc: CollabDocument,
  title = '',
  parentId?: string,
  insertAfterPageId?: string,
): { doc: CollabDocument; page: PageRecord } {
  const id = generatePageId()
  const rootPageId = getRootPageId(doc)
  const parent = parentId && parentId !== id ? parentId : rootPageId
  const page: PageRecord = {
    id,
    title,
    parentId: parent,
    sortOrder: computeInsertSortOrder(doc, parent, insertAfterPageId),
    createdAt: Date.now(),
    blocks: seedBlocks(),
  }
  return {
    doc: {
      ...doc,
      pages: {
        ...doc.pages,
        [id]: page,
      },
    },
    page,
  }
}

function collectPageDeletionTargets(doc: CollabDocument, pageId: string): Set<string> {
  const targets = new Set<string>()

  for (const page of Object.values(doc.pages)) {
    if (isPageDescendant(doc, pageId, page.id)) {
      targets.add(page.id)
    }
  }

  return targets
}

function cleanInlineSpans(spans: InlineSpan[], deletedIds: Set<string>): InlineSpan[] {
  return spans.map((span) => {
    const link = span.marks?.link
    if (!link) return span

    const linkedPageId = parsePageLink(link)
    if (!linkedPageId || !deletedIds.has(linkedPageId)) {
      return span
    }

    const marks = span.marks ?? {}
    const { link: _removed, ...rest } = marks
    const nextMarks = Object.keys(rest).length > 0 ? rest : undefined
    return nextMarks ? { ...span, marks: nextMarks } : { text: span.text }
  })
}

function cleanTableCells(cells: TableCell[][] | undefined, deletedIds: Set<string>): TableCell[][] | undefined {
  if (!cells?.length) return cells

  return cells.map((row) =>
    row.map((cell) => ({
      ...cell,
      content: cleanInlineSpans(cell.content ?? [], deletedIds),
    })),
  )
}

function stripDeletedPageReferences(blocks: Block[], deletedIds: Set<string>): Block[] {
  return blocks
    .filter((block) => {
      if (block.type !== 'page') return true

      const childId = block.props.pageId
      return !(typeof childId === 'string' && childId && deletedIds.has(childId))
    })
    .map((block) => {
      const content = cleanInlineSpans(block.content ?? [], deletedIds)
      const table = block.props.table
        ? {
            ...block.props.table,
            rows: cleanTableCells(block.props.table.rows, deletedIds) ?? block.props.table.rows,
          }
        : block.props.table

      if (content === block.content && table === block.props.table) {
        return block
      }

      return {
        ...block,
        content,
        props: {
          ...block.props,
          table,
        },
      }
    })
}

export function countPageDescendants(doc: CollabDocument, pageId: string): number {
  let count = 0

  for (const page of Object.values(doc.pages)) {
    if (page.id !== pageId && isPageDescendant(doc, pageId, page.id)) {
      count++
    }
  }

  return count
}

export function deletePage(
  doc: CollabDocument,
  pageId: string,
): { doc: CollabDocument; fallbackPageId: string } | null {
  const rootPageId = getRootPageId(doc)
  if (!pageId || pageId === rootPageId || !doc.pages[pageId]) {
    return null
  }

  const deletedIds = collectPageDeletionTargets(doc, pageId)
  const page = doc.pages[pageId]
  const derived = deriveParentMap(doc)
  const parentId = resolveParentId(page, rootPageId, derived)
  let fallbackPageId = deletedIds.has(parentId) ? rootPageId : parentId

  const nextPages: Record<string, PageRecord> = {}
  for (const [id, record] of Object.entries(doc.pages)) {
    if (deletedIds.has(id)) continue

    nextPages[id] = {
      ...record,
      blocks: stripDeletedPageReferences(record.blocks, deletedIds),
    }
  }

  if (!nextPages[fallbackPageId]) {
    fallbackPageId = rootPageId
  }

  return {
    doc: {
      version: 2,
      pages: nextPages,
    },
    fallbackPageId,
  }
}

export function isPageDescendant(
  doc: CollabDocument,
  ancestorId: string,
  maybeDescendantId: string,
): boolean {
  if (ancestorId === maybeDescendantId) return true

  const rootPageId = getRootPageId(doc)
  const derived = deriveParentMap(doc)
  let current = maybeDescendantId
  const visited = new Set<string>()

  while (current && current !== rootPageId) {
    const page = doc.pages[current]
    if (!page) break

    const parent = resolveParentId(page, rootPageId, derived)
    if (parent === ancestorId) return true

    if (visited.has(current)) break
    visited.add(current)
    current = parent
  }

  return false
}

export function canSetPageParent(
  doc: CollabDocument,
  pageId: string,
  parentId: string,
): boolean {
  const rootPageId = getRootPageId(doc)
  if (!pageId || !parentId || pageId === parentId || pageId === rootPageId) return false
  if (!doc.pages[pageId] || !doc.pages[parentId]) return false
  if (isPageDescendant(doc, pageId, parentId)) return false
  return true
}

/**
 * Remove "page" embed blocks that point at `pageId` from every page body,
 * optionally keeping them on `exceptContainerId` (the new parent).
 *
 * This is used when reparenting in the sidebar so old parents lose the embed,
 * without wiping the intentional page-reference block on the new parent
 * (e.g. after `/page` create-and-link).
 */
function detachPageBlocksReferencing(
  doc: CollabDocument,
  pageId: string,
  exceptContainerId?: string,
): CollabDocument {
  let next = doc

  for (const [containerId, page] of Object.entries(doc.pages)) {
    if (exceptContainerId && containerId === exceptContainerId) continue

    const blocks = page.blocks.filter((block) => {
      if (block.type !== 'page') return true
      return block.props.pageId !== pageId
    })

    if (blocks.length === page.blocks.length) continue

    next = setPageBlocks(next, containerId, blocks)
  }

  return next
}

function resolveInsertAfterPageId(
  doc: CollabDocument,
  parentId: string,
  insertBeforePageId: string | undefined,
  excludePageId: string,
): string | undefined {
  const insertionOrder = buildInsertionOrder(doc)
  const siblings = getSiblingPages(doc, parentId, insertionOrder).filter(
    (page) => page.id !== excludePageId,
  )

  if (!insertBeforePageId) {
    return siblings[siblings.length - 1]?.id
  }

  const index = siblings.findIndex((page) => page.id === insertBeforePageId)
  if (index <= 0) {
    return undefined
  }

  return siblings[index - 1].id
}

export function movePage(
  doc: CollabDocument,
  pageId: string,
  parentId: string,
  insertBeforePageId?: string,
): CollabDocument {
  const page = doc.pages[pageId]
  if (!page || !canSetPageParent(doc, pageId, parentId)) {
    return doc
  }

  const alreadyUnderParent = (page.parentId ?? getRootPageId(doc)) === parentId
  // Sidebar reorder among siblings still needs a new sortOrder.
  const insertAfterPageId = resolveInsertAfterPageId(doc, parentId, insertBeforePageId, pageId)
  const sortOrder = computeInsertSortOrder(doc, parentId, insertAfterPageId, pageId)

  if (alreadyUnderParent && page.sortOrder === sortOrder && insertBeforePageId === undefined) {
    return doc
  }

  let next: CollabDocument = {
    ...doc,
    pages: {
      ...doc.pages,
      [pageId]: {
        ...page,
        parentId,
        sortOrder,
      },
    },
  }

  // Keep page-reference blocks on the new parent (the `/page` embed);
  // only strip embeds from other containers.
  if (!alreadyUnderParent) {
    next = detachPageBlocksReferencing(next, pageId, parentId)
  }
  return next
}

export function setPageParent(
  doc: CollabDocument,
  pageId: string,
  parentId: string,
): CollabDocument {
  return movePage(doc, pageId, parentId)
}

/**
 * Ensure every linked page embed under `containerPageId` has that container as
 * its parentId — without deleting the embed block itself.
 */
export function syncPageParentsFromBlocks(
  doc: CollabDocument,
  containerPageId: string,
): CollabDocument {
  const container = doc.pages[containerPageId]
  if (!container) return doc

  let next = doc
  for (const block of container.blocks) {
    if (block.type !== 'page') continue

    const childId = block.props.pageId
    if (typeof childId !== 'string' || !childId || childId === containerPageId) {
      continue
    }

    const child = next.pages[childId]
    if (!child) continue

    // Already correctly parented — leave blocks alone.
    if ((child.parentId ?? getRootPageId(next)) === containerPageId) {
      continue
    }

    next = setPageParent(next, childId, containerPageId)
  }

  return next
}

export function setPageTitle(doc: CollabDocument, pageId: string, title: string): CollabDocument {
  const page = doc.pages[pageId]
  if (!page) return doc
  // No-op when unchanged so applyMutation does not emit a redundant document change.
  if (page.title === title) return doc
  return {
    ...doc,
    pages: {
      ...doc.pages,
      [pageId]: {
        ...page,
        title,
      },
    },
  }
}

export function setPageIcon(
  doc: CollabDocument,
  pageId: string,
  icon: string | undefined,
): CollabDocument {
  const page = doc.pages[pageId]
  if (!page) return doc
  const nextIcon = icon?.trim() ? icon.trim() : undefined
  if (page.icon === nextIcon || (!page.icon && !nextIcon)) {
    return doc
  }
  const nextPage: PageRecord = { ...page }
  if (nextIcon) {
    nextPage.icon = nextIcon
  } else {
    delete nextPage.icon
  }
  return {
    ...doc,
    pages: {
      ...doc.pages,
      [pageId]: nextPage,
    },
  }
}

export function setPageCover(
  doc: CollabDocument,
  pageId: string,
  cover: string | undefined,
): CollabDocument {
  const page = doc.pages[pageId]
  if (!page) return doc
  const nextCover = cover?.trim() ? cover.trim() : undefined
  if (page.cover === nextCover || (!page.cover && !nextCover)) {
    return doc
  }
  const nextPage: PageRecord = { ...page }
  if (nextCover) {
    nextPage.cover = nextCover
  } else {
    delete nextPage.cover
  }
  return {
    ...doc,
    pages: {
      ...doc.pages,
      [pageId]: nextPage,
    },
  }
}

/** Default is container (`false`). Only store `true` when full width is enabled. */
export function setPageFullWidth(
  doc: CollabDocument,
  pageId: string,
  fullWidth: boolean,
): CollabDocument {
  const page = doc.pages[pageId]
  if (!page) return doc
  const nextFullWidth = fullWidth ? true : undefined
  if (page.fullWidth === nextFullWidth || (!page.fullWidth && !nextFullWidth)) {
    return doc
  }
  const nextPage: PageRecord = { ...page }
  if (nextFullWidth) {
    nextPage.fullWidth = true
  } else {
    delete nextPage.fullWidth
  }
  return {
    ...doc,
    pages: {
      ...doc.pages,
      [pageId]: nextPage,
    },
  }
}

export function resolvePageTitle(doc: CollabDocument, pageId: string, fallback = 'Untitled'): string {
  const title = doc.pages[pageId]?.title?.trim()
  return title || fallback
}

export function generateCommentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cm-${crypto.randomUUID()}`
  }
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `msg-${crypto.randomUUID()}`
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function getPageComments(doc: CollabDocument, pageId: string): PageComment[] {
  const page = doc.pages[pageId]
  if (!page?.comments?.length) return []
  return [...page.comments].sort((a, b) => a.createdAt - b.createdAt)
}

export function isPageLevelComment(comment: Pick<PageComment, 'blockId' | 'start' | 'end'>): boolean {
  return (
    comment.blockId === PAGE_COMMENT_BLOCK_ID
    || comment.blockId === ''
    || (comment.start === 0 && comment.end === 0 && comment.blockId.startsWith('__'))
  )
}

export function addPageComment(
  doc: CollabDocument,
  pageId: string,
  payload: {
    blockId: string
    start: number
    end: number
    quote?: string
    author: string
    text: string
  },
): { doc: CollabDocument; comment: PageComment } {
  const trimmed = payload.text.trim()
  const now = Date.now()
  const comment: PageComment = {
    id: generateCommentId(),
    blockId: payload.blockId || PAGE_COMMENT_BLOCK_ID,
    start: payload.start ?? 0,
    end: payload.end ?? 0,
    quote: payload.quote,
    messages: trimmed
      ? [
          {
            id: generateMessageId(),
            author: payload.author,
            text: trimmed,
            createdAt: now,
          },
        ]
      : [],
    createdAt: now,
  }

  const page = doc.pages[pageId]
  if (!page) {
    // Still return a comment object, but cannot persist without a page record.
    return { doc, comment }
  }

  return {
    doc: {
      ...doc,
      pages: {
        ...doc.pages,
        [pageId]: {
          ...page,
          comments: [...(page.comments ?? []), comment],
        },
      },
    },
    comment,
  }
}

export function addCommentReply(
  doc: CollabDocument,
  pageId: string,
  commentId: string,
  author: string,
  text: string,
): CollabDocument {
  const page = doc.pages[pageId]
  if (!page?.comments?.length) return doc

  const trimmed = text.trim()
  if (!trimmed) return doc

  const now = Date.now()
  const comments = page.comments.map((comment) => {
    if (comment.id !== commentId) return comment
    return {
      ...comment,
      messages: [
        ...comment.messages,
        {
          id: generateMessageId(),
          author,
          text: trimmed,
          createdAt: now,
        },
      ],
    }
  })

  return {
    ...doc,
    pages: {
      ...doc.pages,
      [pageId]: {
        ...page,
        comments,
      },
    },
  }
}