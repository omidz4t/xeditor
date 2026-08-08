<script lang="ts">
import { tick } from 'svelte'
import { portal } from './lib/portal'

/** Comment toast enter/leave — mirrors Vue Transition name="comment-toast". */
function commentToastTransition(
  _node: Element,
  { duration = 220 }: { duration?: number } = {},
) {
  return {
    duration,
    css: (t: number) => {
      const y = (1 - t) * 10
      return `opacity: ${t}; transform: translateX(-50%) translateY(${y}px)`
    },
  }
}
import MessageCircle from '@lucide/svelte/icons/message-circle'
import {
  ProEditor,
  createBlock,
  sanitizeBlocksEscapes,
  spansToText,
  type Block,
} from '@xproeditor/svelte'
import '@xproeditor/svelte/style.css'
import {
  copyCurrentPageHtml,
  copyCurrentPageMarkdown,
  copyCurrentPagePlainText,
  exportCurrentPageHtml,
  exportCurrentPageMarkdown,
  exportCurrentPagePlainText,
  exportWorkspaceJson,
  exportWorkspaceMarkdown,
  exportWorkspaceMarkdownZip,
  exportWorkspaceWebxdc,
} from './collab/export-document'
import {
  collabDocumentToImportSpecs,
  filesLookLikeMarkdownFolder,
  isMarkdownFile,
  parseCollabJsonFile,
  parseHtmlImport,
  parseMarkdownFolderFiles,
  parseMarkdownImport,
  parseMarkdownZipFile,
  parsePlainTextImport,
  rekeyBlocks,
  type ImportedPageSpec,
  type ImportResult,
} from './collab/import-document'
import {
  bindMarkdownFolder,
  canBindFolder,
  clearFolderBinding,
  getFolderBinding,
  isFolderAutosaveEnabled,
  pathForPage,
  markBoundPageDirty,
  registerBoundPagePaths,
  restoreFolderBinding,
  savePageToBoundFolder,
  setFolderAutosaveEnabled,
  suggestPathForTitle,
  setBoundPagePath,
} from './collab/folder-binding'
import { resolveInternalHref } from './collab/internal-link'
import ImportDialog from './components/ImportDialog.svelte'

type ImportDialogAction =
  | 'md-files'
  | 'md-folder-native'
  | 'md-folder-legacy'
  | 'md-zip'
  | 'json-workspace'
  | 'md-replace'
import {
  shareDocumentFileToChat,
  shareWebxdcWithDocumentToChat,
} from './collab/share-to-chat'
import type { SettingsTabId } from './components/settingsTypes'
import CommandPalette from './components/CommandPalette.svelte'
import ContextMenu from './components/ContextMenu.svelte'
import PageHeader from './components/PageHeader.svelte'
import PageSidebar from './components/PageSidebar.svelte'
import PageTitle from './components/PageTitle.svelte'
import { useSidebar } from './composables/useSidebar'
import { useCommentsPanel } from './composables/useCommentsPanel'
import {
  bindUiLayer,
  dismissTopUiLayer,
  editorOwnsEscape,
} from './composables/useUiLayers'
import PeerCursors from './components/PeerCursors.svelte'
import ReactionPie from './components/ReactionPie.svelte'
import CommentGutter from './components/CommentGutter.svelte'
import CommentPanel from './components/CommentPanel.svelte'
import SettingsPopup from './components/SettingsPopup.svelte'
import ShareDialog from './components/ShareDialog.svelte'
import ShortcutsHelp from './components/ShortcutsHelp.svelte'
import PageDeleteDialog from './components/PageDeleteDialog.svelte'
import SyncModeSetup from './components/SyncModeSetup.svelte'
import { useAppCommands } from './composables/useAppCommands'
import { useVimMode } from './composables/useVimMode'
import { createPageRouting, type PageNavigateOptions } from './composables/usePageRouting'
import {
  isPageDescendant,
  PAGE_COMMENT_BLOCK_ID,
  type PageComment,
  type PageMeta,
} from './collab/document'
import { createCollabSession } from './collab/webxdc-yjs'
import { isBrowserWebxdcMock, type CollabSyncMode } from './collab/sync-mode'
import type { FollowInvite, PeerPresence, PresenceHandle } from './collab/presence'
import { mergeBlocksForPush, mergeRemoteBlocks } from './collab/block-merge'

let blocks = $state<Block[]>([])
let editorRef = $state<any>(null)
let editorAnchor = $state<HTMLElement | null>(null)
let ready = $state(false)
/** Stable per-device voter identity for poll blocks (webxdc address when available). */
const voterId = window.webxdc?.selfAddr || `local-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())}`
let settingsOpen = $state(false)
let settingsInitialTab = $state<SettingsTabId | null>(null)
/**
 * Snapshotted peers/pages for settings so continuous collab presence updates
 * do not re-render the dialog while scrolling Import / Export.
 * Scalars (layout, title, sync) stay live so controls remain responsive.
 */
let settingsPeers = $state<PeerPresence[]>([])
let settingsPages = $state<PageMeta[]>([])
let shareOpen = $state(false)
const commentsPanelApi = useCommentsPanel()
let commentsOpen = $state(commentsPanelApi.getCommentsOpen())
$effect(() => {
  const unsub = commentsPanelApi.commentsOpen.subscribe((v) => {
    const next = !!v
    if (commentsOpen !== next) commentsOpen = next
  })
  return unsub
})
// Keep the store aligned when local bindable state changes (CommentPanel, etc.).
$effect(() => {
  if (commentsPanelApi.getCommentsOpen() !== commentsOpen) {
    commentsPanelApi.setCommentsOpen(commentsOpen)
  }
})
let shortcutsOpen = $state(false)
let deleteDialogOpen = $state(false)
/** First-open (chat-wide) sync mode picker — only when no mode in history yet. */
let syncModeSetupOpen = $state(false)
let collabSyncMode = $state<CollabSyncMode | null>(null)
let resolveSyncModePick: ((mode: CollabSyncMode) => void) | null = null
/** Page ids pending delete confirmation (may be multi-select). */
let deleteTargetPageIds = $state<string[]>([])
let paletteOpen = $state(false)
let contextMenuOpen = $state(false)
let contextMenuX = $state(0)
let contextMenuY = $state(0)
let contextCommentTarget = $state<{
  blockId: string
  start: number
  end: number
  quote: string
} | null>(null)
let presence = $state<PresenceHandle | null>(null)
let onlinePeers = $state<PeerPresence[]>([])
/** Browser/Pages demo — no multi-peer UI. */
const browserDemoOnly = $derived(isBrowserWebxdcMock())
/** Peer addr we're actively following (viewport tracks their cursor/block). */
let followedPeerAddr = $state<string | null>(null)
/** Incoming “please follow me” invite from a peer (ephemeral). */
let followInvite = $state<FollowInvite | null>(null)
let followInviteTimer: ReturnType<typeof setTimeout> | undefined
let pageTitle = $state('')
let pageIcon = $state<string | undefined>(undefined)
let pageCover = $state<string | undefined>(undefined)
/** Current page layout. Original/default is container (not full width). */
let pageFullWidth = $state(false)
let pages = $state<PageMeta[]>([])
let currentPageId = $state('')
let rootPageId = $state('')
let comments = $state<PageComment[]>([])
let activeCommentId = $state<string | null>(null)
let pageSwitching = $state(false)
/** Block the local user is currently editing — protected from remote overwrites. */
let focusedBlockId = $state<string | null>(null)
/** In-app toast for remote comment notifications (not shown to the author). */
let commentToast = $state<{ text: string; id: number } | null>(null)
let commentToastTimer: ReturnType<typeof setTimeout> | undefined
const knownCommentMessageIds = new Set<string>()
let commentToastSeq = 0

const sidebarApi = useSidebar()
/** Seed from store/localStorage — do NOT start as false or we wipe "open" on mount. */
let sidebarOpen = $state(sidebarApi.getSidebarOpen())
/** Avoid feedback loops between bind:open, local state, and the shared store. */
let sidebarSyncing = false

function toggleSidebar() {
  setSidebarOpen(!sidebarOpen)
}

function setSidebarOpen(open: boolean) {
  const next = !!open
  if (sidebarOpen === next) {
    // Still persist in case store/localStorage drifted.
    sidebarApi.setSidebarOpen(next)
    return
  }
  sidebarSyncing = true
  sidebarOpen = next
  sidebarApi.setSidebarOpen(next)
  // Release after this tick so bind:open writes from PageSidebar don't race.
  queueMicrotask(() => {
    sidebarSyncing = false
  })
}

// When the sidebar closes itself (backdrop / mobile navigate), persist that.
$effect(() => {
  const open = !!sidebarOpen
  if (sidebarSyncing) return
  sidebarApi.setSidebarOpen(open)
})

// Pull store → local when command palette / other callers flip it.
$effect(() => {
  const unsub = sidebarApi.sidebarOpen.subscribe((v) => {
    if (sidebarSyncing) return
    const next = !!v
    if (sidebarOpen !== next) sidebarOpen = next
  })
  return unsub
})
const vimApi = useVimMode()
let vimEnabled = $state(false)
$effect(() => {
  const unsub = vimApi.vimEnabled.subscribe((v) => { vimEnabled = v })
  return unsub
})

function snapshotSettingsListProps() {
  settingsPeers = onlinePeers
  settingsPages = pages
}

function openSettings(tab: SettingsTabId | null = null) {
  snapshotSettingsListProps()
  settingsInitialTab = tab
  settingsOpen = true
}

/** Stable callback — avoid inline arrows that force Settings re-renders. */
function importMarkdownAsPagesForSettings(files: File[]) {
  return importMarkdownFiles(files, { insertRefs: true })
}

// Keep People tab data reasonably fresh without streaming cursor presence.
let settingsPeopleRefreshTimer: ReturnType<typeof setInterval> | undefined
$effect(() => {
  const isOpen = settingsOpen
  if (!isOpen) settingsInitialTab = null
  if (settingsPeopleRefreshTimer) {
    clearInterval(settingsPeopleRefreshTimer)
    settingsPeopleRefreshTimer = undefined
  }
  if (!isOpen) return
  snapshotSettingsListProps()
  settingsPeopleRefreshTimer = setInterval(() => {
    if (!settingsOpen) return
    settingsPeers = onlinePeers
    settingsPages = pages
  }, 2000)
  return () => {
    if (settingsPeopleRefreshTimer) {
      clearInterval(settingsPeopleRefreshTimer)
      settingsPeopleRefreshTimer = undefined
    }
  }
})

const appCommandsApi = useAppCommands({
  onOpenSettings: () => {
    openSettings(null)
  },
  onOpenImportExport: () => {
    openSettings('transfer')
  },
  onToggleSidebar: () => {
    toggleSidebar()
  },
  onToggleComments: () => {
    toggleCommentsPanel()
  },
  onCreatePage: () => {
    onNewPage()
  },
  onOpenShortcuts: () => {
    shortcutsOpen = true
  },
  onExportPageMarkdown: () => {
    exportPageAsMarkdown()
  },
  onExportPagePlainText: () => {
    exportPageAsPlainText()
  },
  onExportPageHtml: () => {
    exportPageAsHtml()
  },
  onCopyPageMarkdown: () => {
    void copyPageMarkdown()
  },
  onCopyPagePlainText: () => {
    void copyPagePlainText()
  },
  onCopyPageHtml: () => {
    void copyPageHtml()
  },
  onExportAllMarkdown: () => {
    exportAllMarkdown()
  },
  onExportAllMarkdownZip: () => {
    exportAllMarkdownZip()
  },
  onExportWorkspaceJson: () => {
    exportAllJson()
  },
  onExportWebxdc: () => {
    void exportAllWebxdc()
  },
  onShareWebxdc: () => {
    void shareAsWebxdcFromCommands()
  },
  onShareJson: () => {
    void shareAsJsonFromCommands()
  },
  onImportMarkdownPages: () => {
    openImportDialog()
  },
  onImportReplaceMarkdown: () => {
    openImportDialog()
  },
  onImportReplaceHtml: () => {
    openCommandImportPicker('html-replace')
  },
  onImportReplaceText: () => {
    openCommandImportPicker('txt-replace')
  },
  onImportWorkspaceJson: () => {
    openImportDialog()
  },
  onImportMarkdownZip: () => {
    openImportDialog()
  },
  onImportMarkdownFolder: () => {
    openImportDialog()
  },
  sidebarOpen: sidebarApi.sidebarOpen,
  commentsOpen: commentsPanelApi.commentsOpen,
})

let commands = $state<import('./composables/useAppCommands').AppCommand[]>([])
$effect(() => {
  const unsub = appCommandsApi.commands.subscribe((v) => { commands = v })
  return unsub
})


const contextMenuCommands = $derived.by(() => {
  const list = [...commands]
  if (contextCommentTarget) {
    list.unshift({
      id: 'add-selection-comment',
      label: 'Add comment',
      keywords: ['comment', 'selection', 'annotate', 'discuss', 'feedback'],
      run: () => {
        const target = contextCommentTarget
        void editorRef?.openCommentOnSelection?.(target)
        contextCommentTarget = null
      },
    })
  }
  return list
})

let session: Awaited<ReturnType<typeof createCollabSession>> | null = null
let stopPeers: (() => void) | undefined
let stopFollowInvites: (() => void) | undefined
let stopSyncModeWatch: (() => void) | undefined
let stopPageRouting: (() => void) | undefined
let pageRouting: ReturnType<typeof createPageRouting> | null = null
let applyingRemote = false
/** Skip applying remote block lists while we create/link pages (avoids wiping the page block). */
let suppressBlockPull = false
/** Local blocks edited since last clean remote merge — protected from remote clobber. */
const dirtyBlockIds = new Set<string>()
/** Block ids removed locally until the deletion is persisted to Yjs. */
const removedBlockIds = new Set<string>()
let lastKnownBlockIds = new Set<string>()
/** Per-page scroll offsets so browser back restores where you left off. */
const pageScrollPositions = new Map<string, number>()

function getAppScrollRoot(): HTMLElement | Window {
  const app = document.getElementById('app')
  if (app) return app
  return window
}

function getAppScrollY(): number {
  const root = getAppScrollRoot()
  if (root instanceof HTMLElement) return root.scrollTop
  return window.scrollY || document.documentElement.scrollTop || 0
}

function setAppScrollY(y: number) {
  const root = getAppScrollRoot()
  if (root instanceof HTMLElement) {
    root.scrollTop = y
    return
  }
  window.scrollTo(0, y)
}

function rememberCurrentPageScroll() {
  const id = currentPageId
  if (!id) return
  pageScrollPositions.set(id, getAppScrollY())
}

function applyPageScroll(pageId: string, restore: boolean) {
  // Wait for layout (title/blocks) so scrollHeight is correct before restoring.
  void tick().then(() => {
    requestAnimationFrame(() => {
      if (restore) {
        setAppScrollY(pageScrollPositions.get(pageId) ?? 0)
      } else {
        setAppScrollY(0)
      }
    })
  })
}

function resetBlockListTracking(nextBlocks: Block[]) {
  removedBlockIds.clear()
  lastKnownBlockIds = new Set(nextBlocks.map((block) => block.id))
}

function trackBlockRemovals(current: Block[]) {
  const currentIds = new Set(current.map((block) => block.id))

  for (const id of lastKnownBlockIds) {
    if (!currentIds.has(id)) {
      removedBlockIds.add(id)
      dirtyBlockIds.delete(id)
    }
  }

  lastKnownBlockIds = currentIds
}

function prunePersistedRemovals() {
  if (!session || !currentPageId) return

  const remoteIds = new Set(session.getBlocks(currentPageId).map((block) => block.id))
  for (const id of removedBlockIds) {
    if (!remoteIds.has(id)) {
      removedBlockIds.delete(id)
    }
  }
}

/**
 * Drop legacy video blocks and strip residual Markdown over-escapes
 * (e.g. `madmail\-v2`, `\[link\]\(url\)`) left by older saves.
 */
function stripVideoBlocks(pageBlocks: Block[]): Block[] {
  const cleaned = sanitizeBlocksEscapes(pageBlocks)
  return cleaned.filter((block) => {
    if ((block.type as string) !== 'video') return true
    removedBlockIds.add(block.id)
    dirtyBlockIds.delete(block.id)
    return false
  })
}

/** Blocks peers are editing — soft locks (colored dot on the block grabber). */
const lockedBlocks = $derived.by(() => {
  const locks: Record<string, { name: string; color: string }> = {}
  const pageId = currentPageId
  for (const peer of onlinePeers) {
    if (!peer.editingBlockId) continue
    // Only soft-lock for peers known to be on this page.
    if (!peer.pageId || peer.pageId !== pageId) continue
    if (locks[peer.editingBlockId]) continue
    locks[peer.editingBlockId] = { name: peer.name, color: peer.color }
  }
  return locks
})

/**
 * Mark blocks that need publishing. Avoid JSON.stringify of every block on a
 * large page — focus + new ids cover typing; re-check only already-dirty ones.
 */
function markChangedBlocksDirty(local: Block[], remote: Block[]) {
  const remoteById = new Map(remote.map((block) => [block.id, block]))

  if (focusedBlockId) dirtyBlockIds.add(focusedBlockId)

  // Brand-new local blocks (insert / split) are always dirty.
  for (const block of local) {
    if (!remoteById.has(block.id)) {
      dirtyBlockIds.add(block.id)
    }
  }

  // Cheap re-verify of known dirty set (drop ones that match remote).
  for (const id of [...dirtyBlockIds]) {
    if (id === focusedBlockId) continue
    const localBlock = local.find((block) => block.id === id)
    if (!localBlock) {
      dirtyBlockIds.delete(id)
      continue
    }
    const remoteBlock = remoteById.get(id)
    if (remoteBlock && JSON.stringify(localBlock) === JSON.stringify(remoteBlock)) {
      dirtyBlockIds.delete(id)
    }
  }
}

function protectedBlockIds(): Set<string> {
  const ids = new Set(dirtyBlockIds)
  if (focusedBlockId) ids.add(focusedBlockId)
  return ids
}

function pruneCleanDirty(local: Block[], remote: Block[]) {
  const remoteById = new Map(remote.map((block) => [block.id, block]))
  for (const id of [...dirtyBlockIds]) {
    const localBlock = local.find((block) => block.id === id)
    if (!localBlock) {
      dirtyBlockIds.delete(id)
      continue
    }
    const remoteBlock = remoteById.get(id)
    if (remoteBlock && JSON.stringify(localBlock) === JSON.stringify(remoteBlock)) {
      dirtyBlockIds.delete(id)
    }
  }
}

function syncFromSession() {
  if (!session) return
  applyingRemote = true
  rootPageId = session.getRootPageId()
  if (!currentPageId || !session.getDocument().pages[currentPageId]) {
    currentPageId = rootPageId
  }
  pages = session.getPages()

  let pendingVideoStripSave = false

  if (!suppressBlockPull) {
    const remoteBlocks = session.getBlocks(currentPageId)
    const removedBefore = removedBlockIds.size
    // Y already merged peer edits per-block; keep only unpushed local edits.
    const merged = stripVideoBlocks(
      mergeRemoteBlocks(
        blocks,
        remoteBlocks,
        protectedBlockIds(),
        removedBlockIds,
      ),
    )
    pendingVideoStripSave = removedBlockIds.size > removedBefore
    // Vue compares full JSON so same-id content edits still apply live.
    // Shallow id-only equality made body updates wait until Enter (structure change).
    if (JSON.stringify(blocks) !== JSON.stringify(merged)) {
      blocks = merged
    }
    pruneCleanDirty(blocks, remoteBlocks)
    lastKnownBlockIds = new Set(blocks.map((block) => block.id))
  }

  // Drop local focus if that block disappeared.
  if (focusedBlockId && !blocks.some((block) => block.id === focusedBlockId)) {
    focusedBlockId = null
    presence?.updateEditingBlock(null)
  }

  const remotePage = session.getDocument().pages[currentPageId]
  const remoteTitle = remotePage?.title ?? ''
  if (pageTitle !== remoteTitle) {
    pageTitle = remoteTitle
  }
  const remoteIcon = remotePage?.icon
  if (pageIcon !== remoteIcon) {
    pageIcon = remoteIcon
  }
  const remoteCover = remotePage?.cover
  if (pageCover !== remoteCover) {
    pageCover = remoteCover
  }
  const remoteFullWidth = !!remotePage?.fullWidth
  if (pageFullWidth !== remoteFullWidth) {
    pageFullWidth = remoteFullWidth
  }

  const nextComments = session.getComments(currentPageId)
  detectRemoteCommentNotifications(nextComments)
  comments = nextComments
  if (activeCommentId && !comments.some((comment) => comment.id === activeCommentId)) {
    activeCommentId = null
  }
  applyingRemote = false

  if (pendingVideoStripSave) {
    saveCurrentPage()
  }
}

function rememberCommentMessages(list: PageComment[]) {
  for (const comment of list) {
    for (const message of comment.messages) {
      knownCommentMessageIds.add(message.id)
    }
  }
}

function showCommentToast(text: string) {
  commentToastSeq += 1
  commentToast = { text, id: commentToastSeq }
  if (commentToastTimer) clearTimeout(commentToastTimer)
  commentToastTimer = setTimeout(() => {
    commentToast = null
  }, 4500)
}

/** Peers only — never toast about our own comments. */
function detectRemoteCommentNotifications(next: PageComment[]) {
  const selfName = window.webxdc?.selfName ?? ''
  let latestRemote: { author: string; text: string } | null = null

  for (const comment of next) {
    for (const message of comment.messages) {
      if (knownCommentMessageIds.has(message.id)) continue
      knownCommentMessageIds.add(message.id)
      if (message.author && message.author !== selfName) {
        latestRemote = { author: message.author, text: message.text }
      }
    }
  }

  if (!latestRemote) return

  const preview = latestRemote.text.length > 80
    ? `${latestRemote.text.slice(0, 77)}…`
    : latestRemote.text
  showCommentToast(`${latestRemote.author}: ${preview}`)
}

function notifyPeersAboutComment(kind: 'comment' | 'reply', text: string) {
  if (!session) return
  const selfName = window.webxdc?.selfName ?? 'Someone'
  const pageLabel = pageTitle.trim() || 'a page'
  const preview = text.trim().length > 60 ? `${text.trim().slice(0, 57)}…` : text.trim()
  const message = kind === 'reply'
    ? `${selfName} replied on “${pageLabel}”: ${preview}`
    : `${selfName} commented on “${pageLabel}”: ${preview}`
  session.notifyComment(message)
}

function saveCurrentPage() {
  if (!session || applyingRemote || !currentPageId) return

  trackBlockRemovals(blocks)

  const latest = session.getBlocks(currentPageId)
  markChangedBlocksDirty(blocks, latest)

  const protectedIds = protectedBlockIds()

  // Match Vue collab: dirty/focused blocks from local, everything else from Y.
  // pushBlocks always writes full block JSON into Y (setIfChanged) — no onlyIds.
  const toPush = mergeBlocksForPush(
    blocks,
    latest,
    protectedIds,
    focusedBlockId,
    removedBlockIds,
  )

  const aligned = mergeRemoteBlocks(
    blocks,
    toPush,
    protectedIds,
    removedBlockIds,
  )
  if (!blockListsShallowEqual(blocks, aligned)) {
    blocks = aligned
  }

  // No onlyIds — Vue never filtered; that filter made body lag until Enter.
  session.pushBlocks(currentPageId, toPush)
  prunePersistedRemovals()
  lastKnownBlockIds = new Set(blocks.map((block) => block.id))

  // Optional: write Markdown back to the bound local folder (collab already saved).
  if (isFolderAutosaveEnabled() && getFolderBinding()) {
    void saveCurrentPageToBoundFolder({ quiet: true, skipCollabFlush: true })
  }
}

let boundFolderLabel = $state<string | null>(null)
let folderAutosave = $state(isFolderAutosaveEnabled())
let boundSaveStatus = $state<string | null>(null)
let boundSaveStatusTimer: ReturnType<typeof setTimeout> | undefined

function refreshBoundFolderLabel() {
  boundFolderLabel = getFolderBinding()?.name ?? null
}

function setBoundSaveStatus(text: string | null, ms = 2400) {
  if (boundSaveStatusTimer) clearTimeout(boundSaveStatusTimer)
  boundSaveStatus = text
  if (text) {
    boundSaveStatusTimer = setTimeout(() => {
      boundSaveStatus = null
    }, ms)
  }
}

async function saveCurrentPageToBoundFolder(options: {
  quiet?: boolean
  /** When true, caller already flushed collab (avoid recursion from saveCurrentPage). */
  skipCollabFlush?: boolean
} = {}): Promise<boolean> {
  if (!session || !currentPageId) return false
  if (!getFolderBinding()) {
    if (!options.quiet) setBoundSaveStatus('No folder bound — use Bind folder first')
    return false
  }
  if (!options.skipCollabFlush) {
    flushPendingEditorSave()
    session.flush()
  }
  const title = pageTitle.trim() || 'Untitled'
  if (!pathForPage(currentPageId)) {
    setBoundPagePath(currentPageId, suggestPathForTitle(title))
  }
  const result = await savePageToBoundFolder(currentPageId, title, blocks)
  if (!result.ok) {
    if (!options.quiet) setBoundSaveStatus(result.reason)
    return false
  }
  if (!options.quiet) {
    setBoundSaveStatus(
      result.wrote === false
        ? `Unchanged — ${result.path}`
        : `Saved ${result.path}`,
    )
  }
  return true
}

/** Ctrl+S — collab flush + write current page to bound folder when bound. */
async function saveBoundFolderNow(options: { notify?: boolean } = {}) {
  flushPendingEditorSave()
  session?.flush()
  if (!getFolderBinding()) {
    if (options.notify) setBoundSaveStatus('Saved in workspace (no folder bound)')
    return
  }
  await saveCurrentPageToBoundFolder({ quiet: !options.notify, skipCollabFlush: true })
}

function onFolderAutosaveChange(enabled: boolean) {
  setFolderAutosaveEnabled(enabled)
  folderAutosave = enabled
}

async function bindFolderFromUi(): Promise<ImportResult> {
  if (!canBindFolder()) {
    return { ok: false, reason: 'Folder binding needs a browser with File System Access (Chrome/Edge).' }
  }
  try {
    const bound = await bindMarkdownFolder()
    if (!bound) return { ok: false, reason: 'cancelled' }
    if (bound.specs.length === 0) {
      refreshBoundFolderLabel()
      return { ok: false, reason: 'No Markdown files found in that folder.' }
    }
    const result = await applyImportedPageSpecs(bound.specs, {
      parentId: currentPageId,
      insertRefs: false,
      navigateToFirst: true,
      bindKeyPaths: bound.keyPaths,
      originalByKey: bound.originalByKey,
    })
    refreshBoundFolderLabel()
    if (result.ok) {
      return {
        ok: true,
        message: `Bound “${bound.root.name}” — Ctrl+S saves Markdown to this folder`,
      }
    }
    return result
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not bind folder.'
    return { ok: false, reason }
  }
}

function unbindFolderFromUi() {
  clearFolderBinding()
  refreshBoundFolderLabel()
  setBoundSaveStatus('Folder unbound')
}

/** Cheap structural equality for block lists (id + length); avoids full JSON. */
function blockListsShallowEqual(a: Block[], b: Block[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && a[i].id !== b[i].id) return false
    // Same id but possibly different content — treat as equal for UI list
    // reassignment; content is already local for dirty/focused blocks.
    if (a[i] !== b[i] && a[i].id === b[i].id) {
      // If either side is protected, keep local reference (no reassign).
      continue
    }
  }
  return true
}

function onFocusBlock(blockId: string | null) {
  focusedBlockId = blockId
  if (blockId) dirtyBlockIds.add(blockId)
  presence?.updateEditingBlock(blockId)
}

function openPalette() {
  contextMenuOpen = false
  paletteOpen = true
}

function isInsideEditorShell(node: EventTarget | Node | null): boolean {
  const el =
    node instanceof Element
      ? node
      : node instanceof Node
        ? node.parentElement
        : null
  if (!el) return false
  return Boolean(
    el.closest(
      [
        '.block-editor',
        '.pro-editor',
        '.page-inner',
        '[contenteditable="true"]',
        'textarea',
        'input',
      ].join(', '),
    ),
  )
}

/** Prefer native Copy/Cut/Paste when the user has a real selection in the editor. */
function shouldUseNativeContextMenu(event: MouseEvent): boolean {
  if (!isInsideEditorShell(event.target)) return false

  // Links use the editor’s custom link menu — never the browser default.
  const t0 = event.target
  const el0 =
    t0 instanceof Element ? t0 : t0 instanceof Node ? t0.parentElement : null
  if (el0?.closest?.('a[href], a[data-external-link], a[data-page-link]')) {
    return false
  }

  // Text selection (contenteditable / page body)
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && (sel.toString().length > 0)) {
    if (isInsideEditorShell(sel.anchorNode) || isInsideEditorShell(sel.focusNode)) {
      return true
    }
  }

  // Input / textarea selection
  const t = event.target
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
    const start = t.selectionStart
    const end = t.selectionEnd
    if (start != null && end != null && start !== end) return true
  }

  // Multi-block / block marquee selection
  if (t instanceof Element && t.closest('.ebi-selected')) {
    return true
  }

  return false
}

function onContextMenu(event: MouseEvent) {
  // Inline links: BlockEditor owns the menu (capture). Don't open the app menu.
  const t = event.target
  const el =
    t instanceof Element ? t : t instanceof Node ? t.parentElement : null
  if (el?.closest?.('a[href], a[data-external-link], a[data-page-link], .be-link-context-menu')) {
    contextMenuOpen = false
    contextCommentTarget = null
    return
  }

  // Keep browser Copy / Cut / Paste / Select all when text or a selected block is involved.
  if (shouldUseNativeContextMenu(event)) {
    contextMenuOpen = false
    contextCommentTarget = null
    return
  }

  event.preventDefault()
  paletteOpen = false
  contextCommentTarget = editorRef?.getTextCommentTarget?.() ?? null
  contextMenuX = event.clientX
  contextMenuY = event.clientY
  contextMenuOpen = true
}

function hasMod(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey
}

/** Physical key first so shortcuts work on Farsi (and other non-Latin) layouts. */
function isKey(event: KeyboardEvent, code: string, letter: string) {
  if (event.code === code) return true
  // Latin key only — never match Farsi glyphs like ش against "a"
  const k = event.key
  return k.length === 1 && /[a-zA-Z]/.test(k) && k.toLowerCase() === letter.toLowerCase()
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest?.('[contenteditable="true"]')) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function onGlobalKeydown(event: KeyboardEvent) {
  // Escape — dismiss top UI layer (dialogs → menus → comments → left sidebar).
  // Editor-owned overlays (slash menu, bubble, link menus) win when present.
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (editorOwnsEscape()) return
    if (dismissTopUiLayer()) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    return
  }

  // Shift+? — keyboard shortcuts help (skip while typing so "?" still works in text)
  if (
    !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && (event.key === '?' || (event.shiftKey && event.code === 'Slash'))
  ) {
    if (!isTypingTarget(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      shortcutsOpen = !shortcutsOpen
      return
    }
  }

  if (!hasMod(event) || event.altKey) return

  // Ctrl/Cmd+K or Ctrl/Cmd+P — command palette (toggle)
  if (
    !event.shiftKey
    && (isKey(event, 'KeyK', 'k') || isKey(event, 'KeyP', 'p'))
  ) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    if (paletteOpen) {
      paletteOpen = false
      return
    }

    openPalette()
    return
  }

  // Ctrl/Cmd+B — bold in the editor (do not steal for sidebar).
  // Toggle left sidebar with Ctrl/Cmd+\ instead (VS Code–style panel toggle).
  if (!event.shiftKey && (event.code === 'Backslash' || event.key === '\\')) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    toggleSidebar()
    return
  }

  // Ctrl/Cmd+N — create new page
  if (!event.shiftKey && isKey(event, 'KeyN', 'n')) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    paletteOpen = false
    onNewPage()
    return
  }

  // Ctrl/Cmd+S — save to bound folder (and flush collab)
  if (!event.shiftKey && isKey(event, 'KeyS', 's')) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    void saveBoundFolderNow({ notify: true })
    return
  }

  // Ctrl/Cmd+Shift+C — toggle comments panel
  if (event.shiftKey && isKey(event, 'KeyC', 'c')) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    toggleCommentsPanel()
  }
}

function broadcastCurrentPage() {
  if (currentPageId) {
    presence?.updatePage(currentPageId)
  }
}

const followedPeer = $derived(
  followedPeerAddr
    ? onlinePeers.find((peer) => peer.addr === followedPeerAddr) ?? null
    : null,
)

let followScrollTimer: ReturnType<typeof setTimeout> | undefined
let lastFollowScrollKey = ''

function stopFollow() {
  followedPeerAddr = null
  lastFollowScrollKey = ''
  if (followScrollTimer) {
    clearTimeout(followScrollTimer)
    followScrollTimer = undefined
  }
}

/**
 * Scroll the viewport to a peer’s editing block or last known pointer.
 * Pointer coords are relative to the editor anchor (same as PeerCursors).
 */
function scrollToPeerLocation(peer: PeerPresence, smooth = true) {
  const anchor = editorAnchor
  if (!anchor) return

  if (peer.editingBlockId) {
    const el = anchor.querySelector(
      `[data-block-id="${CSS.escape(peer.editingBlockId)}"]`,
    ) as HTMLElement | null
    if (el) {
      el.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'center',
        inline: 'nearest',
      })
      return
    }
  }

  if (!peer.pointer) return

  const rect = anchor.getBoundingClientRect()
  const absoluteY = window.scrollY + rect.top + peer.pointer.y
  const targetTop = Math.max(0, absoluteY - window.innerHeight / 2)
  window.scrollTo({
    top: targetTop,
    behavior: smooth ? 'smooth' : 'auto',
  })
}

function locatePeer(peer: PeerPresence, options?: { smooth?: boolean; force?: boolean }) {
  const smooth = options?.smooth ?? true
  const force = options?.force ?? false
  const key = [
    peer.addr,
    peer.pageId ?? '',
    peer.editingBlockId ?? '',
    peer.pointer ? `${Math.round(peer.pointer.x)}:${Math.round(peer.pointer.y)}` : '',
  ].join('|')

  if (!force && key === lastFollowScrollKey) return
  lastFollowScrollKey = key

  const targetPageId = peer.pageId
  if (targetPageId && targetPageId !== currentPageId) {
    navigateToPage(targetPageId)
    // Wait for page switch / layout before scrolling.
    window.setTimeout(() => scrollToPeerLocation(peer, smooth), 120)
    window.setTimeout(() => scrollToPeerLocation(peer, false), 320)
    return
  }

  scrollToPeerLocation(peer, smooth)
}

function findPeer(peer: PeerPresence) {
  locatePeer(peer, { smooth: true, force: true })
}

function followPeer(peer: PeerPresence) {
  followedPeerAddr = peer.addr
  lastFollowScrollKey = ''
  locatePeer(peer, { smooth: true, force: true })
}

function dismissFollowInvite() {
  followInvite = null
  if (followInviteTimer) {
    clearTimeout(followInviteTimer)
    followInviteTimer = undefined
  }
}

function showFollowInvite(invite: FollowInvite) {
  followInvite = invite
  if (followInviteTimer) clearTimeout(followInviteTimer)
  // Auto-dismiss if the user ignores it.
  followInviteTimer = setTimeout(() => {
    if (followInvite?.id === invite.id) {
      followInvite = null
    }
    followInviteTimer = undefined
  }, 20_000)
}

function acceptFollowInvite() {
  const invite = followInvite
  if (!invite) return
  dismissFollowInvite()

  if (invite.pageId && invite.pageId !== currentPageId) {
    navigateToPage(invite.pageId)
  }

  const live = onlinePeers.find((peer) => peer.addr === invite.addr)
  if (live) {
    followPeer(live)
    return
  }

  // Peer may not have a full presence row yet — still start following from the invite.
  followPeer({
    addr: invite.addr,
    name: invite.name,
    color: invite.color,
    colorLight: invite.color,
    pageId: invite.pageId,
    lastSeen: Date.now(),
  })
}

function scheduleFollowScroll(peer: PeerPresence) {
  if (followScrollTimer) clearTimeout(followScrollTimer)
  // Throttle continuous follow so we don't fight the user on every pointer tick.
  followScrollTimer = setTimeout(() => {
    followScrollTimer = undefined
    if (followedPeerAddr !== peer.addr) return
    const live = onlinePeers.find((entry) => entry.addr === peer.addr)
    if (!live) {
      stopFollow()
      return
    }
    locatePeer(live, { smooth: true })
  }, 180)
}

$effect(() => {
  const peers = onlinePeers
  const addr = followedPeerAddr
  if (!addr) return
  const peer = peers.find((entry) => entry.addr === addr)
  if (!peer) {
    stopFollow()
    return
  }
  scheduleFollowScroll(peer)
})

/** Resolve markdown relative / internal hrefs to a workspace page id. */
function resolveEditorInternalHref(href: string): string | null {
  if (!session || !href) return null
  return resolveInternalHref(href, {
    pages,
    currentPageId,
    pageExists: (pageId) => Boolean(session?.getDocument().pages[pageId]),
  })
}

function navigateToPage(pageId: string, options: PageNavigateOptions = {}) {
  if (!session || !pageId) return

  // Flush in-progress edits (including newly linked /page refs) before leaving.
  if (!applyingRemote) {
    flushPendingEditorSave()
    session.flush()
  }

  const doc = session.getDocument()
  if (!doc.pages[pageId]) {
    // One more refresh in case the page was just created.
    pages = session.getPages()
    if (!session.getDocument().pages[pageId]) {
      console.warn('[collab] navigateToPage: unknown page', pageId)
      return
    }
  }

  if (pageId === currentPageId) {
    pageRouting?.noteNavigation(pageId)
    return
  }

  // Remember where we were so history back can restore this page's scroll.
  rememberCurrentPageScroll()

  activeCommentId = null
  focusedBlockId = null
  removedBlockIds.clear()
  dirtyBlockIds.clear()
  presence?.updateEditingBlock(null)
  pageSwitching = true
  currentPageId = pageId
  applyingRemote = true
  // Read after save/flush so page embeds on the page we left are durable.
  const page = session.getDocument().pages[pageId]
  blocks = stripVideoBlocks(session.getBlocks(pageId))
  lastKnownBlockIds = new Set(blocks.map((block) => block.id))
  pageTitle = page?.title ?? ''
  pageIcon = page?.icon
  pageCover = page?.cover
  pageFullWidth = !!page?.fullWidth
  pages = session.getPages()
  applyingRemote = false
  if (removedBlockIds.size > 0) {
    saveCurrentPage()
  }
  broadcastCurrentPage()
  pageRouting?.noteNavigation(pageId)

  // Forward nav → top; browser back/forward → restore prior offset.
  applyPageScroll(pageId, options.restoreScroll === true)

  window.setTimeout(() => {
    pageSwitching = false
  }, 280)
}

function createSidebarPage(title?: string) {
  const current = currentPageId
  const root = rootPageId
  let parent = root
  let insertAfter: string | undefined

  if (current && current !== root) {
    const currentMeta = pages.find((page) => page.id === current)
    parent = currentMeta?.parentId ?? root
    insertAfter = current
  }

  return createPage(title, parent, insertAfter)
}

function onPaletteCreatePage(title: string) {
  const page = createSidebarPage(title.trim())
  if (page.id) navigateToPage(page.id)
}

function createPage(title?: string, parentId?: string, insertAfterPageId?: string) {
  if (!session) return { id: '', title: 'Untitled' }
  const parent = parentId ?? currentPageId ?? rootPageId
  // Creating a page writes to Y and would re-enter syncFromSession mid-link.
  // Keep the in-progress page block intact while the editor attaches pageId.
  suppressBlockPull = true
  markChangedBlocksDirty(blocks, session.getBlocks(currentPageId))
  let page: PageMeta
  try {
    page = session.createPage(title, parent, insertAfterPageId)
    pages = session.getPages()
  } finally {
    suppressBlockPull = false
  }
  return page
}

function setPageParent(pageId: string, parentId: string) {
  if (!session || !pageId || !parentId || pageId === parentId) return
  suppressBlockPull = true
  try {
    session.setPageParent(pageId, parentId)
    pages = session.getPages()
  } finally {
    suppressBlockPull = false
  }
}

function onMovePage(payload: { pageId: string; parentId: string; insertBeforePageId?: string }) {
  if (!session || !payload.pageId || !payload.parentId || payload.pageId === payload.parentId) return
  session.movePage(payload.pageId, payload.parentId, payload.insertBeforePageId)
  pages = session.getPages()
}

function onNewPage(payload?: { parentId: string; insertAfterPageId?: string }) {
  const page = payload?.parentId
    ? createPage(undefined, payload.parentId, payload.insertAfterPageId)
    : createSidebarPage()
  if (page.id) navigateToPage(page.id)
}

function onRenamePage(pageId: string, title: string) {
  if (!session) return
  session.setPageTitle(pageId, title)
  pages = session.getPages()
  if (pageId === currentPageId) {
    pageTitle = title
  }
}

function deleteTargetTitle() {
  const ids = deleteTargetPageIds
  if (ids.length === 0) return 'Untitled'
  if (ids.length === 1) {
    const pageId = ids[0]
    const page = pages.find((entry) => entry.id === pageId)
    return page?.title ?? session?.getDocument().pages[pageId]?.title ?? 'Untitled'
  }
  return `${ids.length} pages`
}

function deleteTargetCount() {
  return deleteTargetPageIds.length
}

function deleteTargetDescendantCount() {
  if (!session || deleteTargetPageIds.length === 0) return 0
  const doc = session.getDocument()
  const selected = new Set(deleteTargetPageIds)
  // Extra pages removed only because they are nested under a selected page.
  const extra = new Set<string>()
  for (const pageId of deleteTargetPageIds) {
    for (const page of Object.values(doc.pages)) {
      if (selected.has(page.id) || page.id === pageId) continue
      if (isPageDescendant(doc, pageId, page.id)) {
        extra.add(page.id)
      }
    }
  }
  return extra.size
}

function onRequestDeletePage(pageIds: string | string[]) {
  if (!session) return
  const list = (Array.isArray(pageIds) ? pageIds : [pageIds])
    .filter((id) => id && id !== rootPageId && session?.getDocument().pages[id])
  const unique = [...new Set(list)]
  if (unique.length === 0) return
  deleteTargetPageIds = unique
  deleteDialogOpen = true
}

function confirmDeletePage() {
  if (!session || deleteTargetPageIds.length === 0) return

  const pageIds = [...deleteTargetPageIds]
  const previouslyCurrent = currentPageId
  flushPendingEditorSave()

  let fallbackPageId: string | null = null

  for (const pageId of pageIds) {
    if (!session.getDocument().pages[pageId]) continue
    const nextFallback = session.deletePage(pageId)
    if (nextFallback) fallbackPageId = nextFallback
  }

  pages = session.getPages()
  deleteTargetPageIds = []

  if (!session.getDocument().pages[previouslyCurrent]) {
    navigateToPage(fallbackPageId || rootPageId)
    return
  }

  syncFromSession()
}

function navigateHome() {
  if (rootPageId) navigateToPage(rootPageId)
}

function requestSyncModeFromUser(): Promise<CollabSyncMode> {
  return new Promise((resolve) => {
    resolveSyncModePick = resolve
    syncModeSetupOpen = true
  })
}

function onSyncModeSelected(mode: CollabSyncMode) {
  syncModeSetupOpen = false
  const resolve = resolveSyncModePick
  resolveSyncModePick = null
  resolve?.(mode)
}

let mounted = false
async function mountApp() {
  if (mounted) return
  mounted = true

  window.addEventListener('keydown', onGlobalKeydown, { capture: true })

  session = await createCollabSession({
    requestSyncMode: requestSyncModeFromUser,
  })
  collabSyncMode = session.syncMode
  syncModeSetupOpen = false
  resolveSyncModePick = null

  syncFromSession()
  resetBlockListTracking(blocks)
  // Seed known messages so historical comments don't toast on open.
  rememberCommentMessages(comments)

  pageRouting = createPageRouting({
    getCurrentPageId: () => currentPageId,
    navigate: navigateToPage,
  })
  stopPageRouting = pageRouting.install()

  const initialPageId = pageRouting.readInitialPageId(currentPageId)
  if (initialPageId !== currentPageId && session.getDocument().pages[initialPageId]) {
    navigateToPage(initialPageId)
  } else {
    pageRouting.pushPageUrl(currentPageId, true)
  }

  ready = true
  bindPresence(session.presence)

  if (typeof session.onSyncModeChange === 'function') {
    stopSyncModeWatch = session.onSyncModeChange((mode) => {
      collabSyncMode = mode
      bindPresence(session?.presence ?? null)
    })
  } else {
    console.warn('[collab] session.onSyncModeChange missing — hard-refresh the app')
  }

  session.onDocumentChange(() => {
    syncFromSession()
  })

  // Restore previously bound folder handle (user may need to re-approve permission).
  void restoreFolderBinding().then((ok) => {
    if (ok) refreshBoundFolderLabel()
  })
}

function bindPresence(handle: PresenceHandle | null) {
  stopPeers?.()
  stopFollowInvites?.()
  stopPeers = undefined
  stopFollowInvites = undefined
  onlinePeers = []
  followedPeerAddr = null
  dismissFollowInvite()
  presence = handle
  if (!handle) return
  stopPeers = handle.onPeersChanged((peers) => {
    // Fresh array every tick so lockedBlocks / people UI re-derive (Svelte 5).
    onlinePeers = peers.slice()
  })
  stopFollowInvites = handle.onFollowInvite((invite) => {
    showFollowInvite(invite)
  })
  broadcastCurrentPage()
  // Re-announce focus so peers see soft-lock + caret after channel reconnect.
  if (focusedBlockId) handle.updateEditingBlock(focusedBlockId)
}

function onSyncModeChange(mode: CollabSyncMode) {
  if (!session || mode === collabSyncMode) return
  if (typeof session.setSyncMode !== 'function') {
    console.warn('[collab] session.setSyncMode missing — hard-refresh the app')
    return
  }
  session.setSyncMode(mode)
  collabSyncMode = session.syncMode
  bindPresence(session.presence)
}

$effect(() => {
  void currentPageId
  broadcastCurrentPage()
})

function unmountApp() {
  window.removeEventListener('keydown', onGlobalKeydown, { capture: true })
  if (commentToastTimer) clearTimeout(commentToastTimer)
  dismissFollowInvite()
  stopPeers?.()
  stopFollowInvites?.()
  stopSyncModeWatch?.()
  stopPageRouting?.()
  pageRouting = null
  if (settingsPeopleRefreshTimer) {
    clearInterval(settingsPeopleRefreshTimer)
    settingsPeopleRefreshTimer = undefined
  }
  try {
    flushPendingEditorSave()
    session?.flush()
  } catch {
    // ignore during teardown
  }
  session?.destroy()
  session = null
}

/** Debounce only for pure local mode (no live peers). */
let savePageTimer: ReturnType<typeof setTimeout> | undefined

function saveDebounceMs(): number {
  const blockN = blocks.length
  const pageN = pages.length
  if (blockN > 400 || pageN > 200) return 450
  if (blockN > 150 || pageN > 80) return 280
  return 180
}

function onEditorChange() {
  if (focusedBlockId) dirtyBlockIds.add(focusedBlockId)
  if (currentPageId && getFolderBinding()) markBoundPageDirty(currentPageId)

  // Live collab (Vue parity): publish every keystroke immediately so body +
  // carets stay in sync — do not wait for Enter / block structure changes.
  const mode = session?.syncMode
  if (mode === 'realtime' || mode === 'chat') {
    if (savePageTimer) {
      clearTimeout(savePageTimer)
      savePageTimer = undefined
    }
    saveCurrentPage()
    return
  }

  if (savePageTimer) clearTimeout(savePageTimer)
  savePageTimer = setTimeout(() => {
    savePageTimer = undefined
    saveCurrentPage()
  }, saveDebounceMs())
}

/** Flush pending debounced save (page switch, export, unmount). */
function flushPendingEditorSave() {
  if (savePageTimer) {
    clearTimeout(savePageTimer)
    savePageTimer = undefined
  }
  saveCurrentPage()
}

/** Download the current page as a best-effort Markdown file. */
function exportPageAsMarkdown() {
  prepareShare()
  exportCurrentPageMarkdown(getShareDocument(), currentPageId)
}

function exportPageAsPlainText() {
  prepareShare()
  exportCurrentPagePlainText(getShareDocument(), currentPageId)
}

function exportPageAsHtml() {
  prepareShare()
  exportCurrentPageHtml(getShareDocument(), currentPageId)
}

async function copyPageMarkdown() {
  prepareShare()
  await copyCurrentPageMarkdown(getShareDocument(), currentPageId)
}

async function copyPagePlainText() {
  prepareShare()
  await copyCurrentPagePlainText(getShareDocument(), currentPageId)
}

async function copyPageHtml() {
  prepareShare()
  await copyCurrentPageHtml(getShareDocument(), currentPageId)
}

function exportAllMarkdown() {
  prepareShare()
  exportWorkspaceMarkdown(getShareDocument(), pageTitle)
}

function exportAllMarkdownZip() {
  prepareShare()
  exportWorkspaceMarkdownZip(getShareDocument(), pageTitle)
}

function exportAllJson() {
  prepareShare()
  exportWorkspaceJson(getShareDocument(), pageTitle)
}

async function exportAllWebxdc() {
  prepareShare()
  await exportWorkspaceWebxdc(getShareDocument(), pageTitle)
}

async function shareAsWebxdcFromCommands() {
  prepareShare()
  const result = await shareWebxdcWithDocumentToChat(getShareDocument(), pageTitle)
  if (!result.ok && result.reason === 'unavailable') {
    shareOpen = true
  }
}

async function shareAsJsonFromCommands() {
  prepareShare()
  const result = await shareDocumentFileToChat(getShareDocument(), pageTitle)
  if (!result.ok && result.reason === 'unavailable') {
    shareOpen = true
  }
}

type CommandImportKind =
  | 'md-pages'
  | 'md-replace'
  | 'html-replace'
  | 'txt-replace'
  | 'json-workspace'
  | 'md-zip'

let markdownFileInput = $state<HTMLInputElement | null>(null)
let markdownFolderInput = $state<HTMLInputElement | null>(null)
let commandImportInput = $state<HTMLInputElement | null>(null)
let pendingCommandImportKind = $state<CommandImportKind | null>(null)
/** When set, the next single-file pick replaces the current page (from Import modal). */
let pendingReplaceMarkdown = $state(false)
let importDialogOpen = $state(false)
let importBusy = $state(false)
let importStatus = $state<string | null>(null)
let mdDropActive = $state(false)
let mdDropDepth = 0

// Register open surfaces for Escape stack (topmost closes first, sidebar last).
$effect(() => {
  bindUiLayer('delete-dialog', deleteDialogOpen, () => {
    deleteDialogOpen = false
  })
})
$effect(() => {
  bindUiLayer('sync-mode', syncModeSetupOpen, () => {
    syncModeSetupOpen = false
  })
})
$effect(() => {
  bindUiLayer('import-dialog', importDialogOpen, () => {
    importDialogOpen = false
  })
})
$effect(() => {
  bindUiLayer('share-dialog', shareOpen, () => {
    shareOpen = false
  })
})
$effect(() => {
  bindUiLayer('settings', settingsOpen, () => {
    settingsOpen = false
  })
})
$effect(() => {
  bindUiLayer('command-palette', paletteOpen, () => {
    paletteOpen = false
  })
})
$effect(() => {
  bindUiLayer('context-menu', contextMenuOpen, () => {
    contextMenuOpen = false
    contextCommentTarget = null
  })
})
$effect(() => {
  bindUiLayer('shortcuts', shortcutsOpen, () => {
    shortcutsOpen = false
  })
})
$effect(() => {
  bindUiLayer('comments', commentsOpen, () => {
    setCommentsOpen(false)
  })
})
$effect(() => {
  bindUiLayer('sidebar', sidebarOpen, () => {
    setSidebarOpen(false)
  })
})

function acceptForCommandImport(kind: CommandImportKind): string {
  switch (kind) {
    case 'md-pages':
    case 'md-replace':
      return '.md,.markdown,.mdown,text/markdown,text/plain'
    case 'html-replace':
      return '.html,.htm,text/html'
    case 'txt-replace':
      return '.txt,.text,text/plain'
    case 'json-workspace':
      return '.json,.collab-doc.json,application/json'
    case 'md-zip':
      return '.zip,application/zip'
  }
}

function openCommandImportPicker(kind: CommandImportKind) {
  pendingCommandImportKind = kind
  const input = commandImportInput
  if (!input) return
  input.accept = acceptForCommandImport(kind)
  input.multiple = kind === 'md-pages'
  input.value = ''
  input.click()
}

async function onCommandImportInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  const kind = pendingCommandImportKind
  input.value = ''
  pendingCommandImportKind = null
  if (!kind || files.length === 0) return

  importBusy = true
  try {
    let result: ImportResult | undefined
    switch (kind) {
      case 'md-pages':
        result = await importMarkdownFiles(files, { insertRefs: true })
        break
      case 'md-replace':
        result = await importReplaceCurrentFromMarkdown(files[0])
        break
      case 'html-replace':
        result = await importReplaceCurrentFromHtml(files[0])
        break
      case 'txt-replace':
        result = await importReplaceCurrentFromText(files[0])
        break
      case 'json-workspace':
        result = await importWorkspaceJson(files[0])
        break
      case 'md-zip':
        result = await importMarkdownZip(files[0])
        break
    }
    if (result) {
      importStatus = result.ok ? result.message : result.reason
      if (result.ok && importDialogOpen) {
        window.setTimeout(() => {
          importDialogOpen = false
          importStatus = null
        }, 900)
      }
    }
  } finally {
    importBusy = false
  }
}

function markdownFilesFromList(list: FileList | File[] | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter(isMarkdownFile)
}

function insertPageReferenceBlock(page: { id: string; title: string; icon?: string }) {
  if (!page.id || !currentPageId) return
  const refBlock = createBlock('page', {
    props: {
      pageId: page.id,
      pageTitle: page.title || 'Untitled',
      pageIcon: page.icon ?? '',
    },
  })
  // Drop empty trailing placeholder if present so the ref lands cleanly.
  const list = [...blocks]
  const last = list[list.length - 1]
  if (
    last
    && last.type === 'paragraph'
    && spansToText(last.content).trim() === ''
    && list.length > 0
  ) {
    list[list.length - 1] = refBlock
  } else {
    list.push(refBlock)
  }
  // Keep a trailing empty paragraph for typing after the ref.
  list.push(createBlock('paragraph', { content: [] }))
  blocks = list
  dirtyBlockIds.add(refBlock.id)
  lastKnownBlockIds = new Set(list.map((block) => block.id))
  onEditorChange()
}

/**
 * Import one or more markdown files as new pages under the current page.
 * When `insertRefs` is true (drag-drop onto a page), page reference blocks are
 * added on the current page.
 */
async function importMarkdownFiles(
  files: File[],
  options: { insertRefs?: boolean; navigateToFirst?: boolean } = {},
): Promise<ImportResult> {
  if (!session || !currentPageId || files.length === 0) {
    return { ok: false, reason: 'Nothing to import.' }
  }

  const insertRefs = options.insertRefs ?? true
  const navigateToFirst = options.navigateToFirst ?? false
  const parentId = currentPageId

  // Persist current page first so we don't lose in-progress edits.
  flushPendingEditorSave()

  // Parse files first (async I/O), then write all pages in one Y transaction.
  const batch: Array<{ title: string; parentId: string; blocks: Block[] }> = []
  for (const file of files) {
    try {
      const { title, blocks: pageBlocks } = await parseMarkdownImport(file)
      batch.push({ title, parentId, blocks: rekeyBlocks(pageBlocks) })
    } catch {
      console.warn('[import] failed to read markdown file', file.name)
    }
  }

  if (batch.length === 0) {
    return { ok: false, reason: 'Could not import any Markdown files.' }
  }

  suppressBlockPull = true
  let created: Array<{ id: string; title: string; icon?: string }> = []
  try {
    if (session.importPagesBatch) {
      created = session.importPagesBatch(batch, { defaultParentId: parentId }).created
    } else {
      created = batch.map((item) => {
        const page = session!.createPage(item.title, item.parentId)
        if (page?.id) session!.pushBlocks(page.id, item.blocks)
        return page
      }).filter((p) => p?.id)
    }
    pages = session.getPages()
  } finally {
    suppressBlockPull = false
  }

  if (created.length === 0) {
    return { ok: false, reason: 'Could not import any Markdown files.' }
  }

  if (insertRefs) {
    for (const page of created) {
      insertPageReferenceBlock(page)
    }
  }

  if (navigateToFirst && created[0]?.id) {
    navigateToPage(created[0].id)
  } else {
    syncFromSession()
  }

  session.flush()
  const n = created.length
  return {
    ok: true,
    message: n === 1 ? `Imported “${created[0].title}” as a new page.` : `Imported ${n} pages.`,
  }
}

async function replaceCurrentPageContent(
  blocksIn: Block[],
  options: { title?: string } = {},
): Promise<ImportResult> {
  if (!session || !currentPageId) {
    return { ok: false, reason: 'No page selected.' }
  }
  saveCurrentPage()
  const nextBlocks = rekeyBlocks(blocksIn)
  suppressBlockPull = true
  try {
    if (options.title?.trim()) {
      session.setPageTitle(currentPageId, options.title.trim())
      pageTitle = options.title.trim()
    }
    session.pushBlocks(currentPageId, nextBlocks)
    pages = session.getPages()
  } finally {
    suppressBlockPull = false
  }
  blocks = nextBlocks
  dirtyBlockIds.clear()
  removedBlockIds.clear()
  lastKnownBlockIds = new Set(nextBlocks.map((b) => b.id))
  for (const b of nextBlocks) dirtyBlockIds.add(b.id)
  saveCurrentPage()
  syncFromSession()
  return { ok: true, message: 'Replaced current page content.' }
}

async function importReplaceCurrentFromMarkdown(file: File): Promise<ImportResult> {
  try {
    const { title, blocks: pageBlocks } = await parseMarkdownImport(file)
    return replaceCurrentPageContent(pageBlocks, { title })
  } catch {
    return { ok: false, reason: 'Could not read Markdown file.' }
  }
}

async function importReplaceCurrentFromHtml(file: File): Promise<ImportResult> {
  try {
    const { title, blocks: pageBlocks } = await parseHtmlImport(file)
    return replaceCurrentPageContent(pageBlocks, { title })
  } catch {
    return { ok: false, reason: 'Could not read HTML file.' }
  }
}

async function importReplaceCurrentFromText(file: File): Promise<ImportResult> {
  try {
    const { title, blocks: pageBlocks } = await parsePlainTextImport(file)
    return replaceCurrentPageContent(pageBlocks, { title })
  } catch {
    return { ok: false, reason: 'Could not read text file.' }
  }
}

async function applyImportedPageSpecs(
  specs: ImportedPageSpec[],
  options: {
    parentId?: string
    insertRefs?: boolean
    navigateToFirst?: boolean
    /** When binding a folder, map import keys → disk-relative paths. */
    bindKeyPaths?: Map<string, string>
    /** Original file text by import key (skip rewrites when unedited). */
    originalByKey?: Map<string, string>
  } = {},
): Promise<ImportResult> {
  if (!session || specs.length === 0) {
    return { ok: false, reason: 'Nothing to import.' }
  }

  flushPendingEditorSave()
  const attachParent = options.parentId ?? currentPageId ?? rootPageId
  let idMap = new Map<string, string>()
  let created: Array<{ id: string; title: string; icon?: string }> = []

  suppressBlockPull = true
  try {
    if (session.importPagesBatch) {
      // Two logical passes inside one Y transaction (shells then bodies).
      // First batch creates the tree; second fills remapped content.
      const shellResult = session.importPagesBatch(
        specs.map((spec) => ({
          key: spec.key,
          parentKey: spec.parentKey,
          title: spec.title,
          blocks: [],
          icon: spec.icon,
          cover: spec.cover,
          fullWidth: spec.fullWidth,
        })),
        { defaultParentId: attachParent },
      )
      idMap = shellResult.idMap
      created = shellResult.created

      // Fill bodies with remapped internal page links (still one page at a time,
      // but each push is the fast silent path — no full workspace re-parse).
      for (const spec of specs) {
        const pageId = idMap.get(spec.key)
        if (!pageId) continue
        session.pushBlocks(pageId, rekeyBlocks(spec.blocks, idMap))
      }
    } else {
      for (const spec of specs) {
        const parentId = spec.parentKey && idMap.has(spec.parentKey)
          ? idMap.get(spec.parentKey)!
          : attachParent
        const page = session.createPage(spec.title, parentId)
        if (!page?.id) continue
        idMap.set(spec.key, page.id)
        created.push(page)
      }
      for (const spec of specs) {
        const pageId = idMap.get(spec.key)
        if (!pageId) continue
        session.pushBlocks(pageId, rekeyBlocks(spec.blocks, idMap))
        if (spec.icon) session.setPageIcon(pageId, spec.icon)
        if (spec.cover) session.setPageCover(pageId, spec.cover)
        if (spec.fullWidth) session.setPageFullWidth(pageId, true)
      }
    }

    if (options.bindKeyPaths) {
      registerBoundPagePaths(idMap, options.bindKeyPaths, options.originalByKey)
    }

    pages = session.getPages()
  } finally {
    suppressBlockPull = false
  }

  if (created.length === 0) {
    return { ok: false, reason: 'Could not import pages.' }
  }

  if (options.insertRefs) {
    for (const page of created.filter((p) => {
      const spec = specs.find((s) => idMap.get(s.key) === p.id)
      return spec && !(spec.parentKey && idMap.has(spec.parentKey))
    })) {
      insertPageReferenceBlock(page)
    }
  }

  if (options.navigateToFirst && created[0]?.id) {
    navigateToPage(created[0].id)
  } else {
    syncFromSession()
  }

  session.flush()
  const n = created.length
  return {
    ok: true,
    message: n === 1 ? `Imported “${created[0].title}”.` : `Imported ${n} pages.`,
  }
}

async function importWorkspaceJson(file: File): Promise<ImportResult> {
  try {
    const doc = await parseCollabJsonFile(file)
    if (!doc) return { ok: false, reason: 'Not a valid XEditor workspace JSON file.' }
    const specs = collabDocumentToImportSpecs(doc)
    if (specs.length === 0) return { ok: false, reason: 'Workspace JSON has no pages.' }
    return applyImportedPageSpecs(specs, {
      parentId: currentPageId,
      insertRefs: false,
      navigateToFirst: true,
    })
  } catch {
    return { ok: false, reason: 'Could not read workspace JSON.' }
  }
}

async function importMarkdownZip(file: File): Promise<ImportResult> {
  try {
    const specs = await parseMarkdownZipFile(file)
    if (specs.length === 0) {
      return { ok: false, reason: 'ZIP has no Markdown files.' }
    }
    return applyImportedPageSpecs(specs, {
      parentId: currentPageId,
      insertRefs: false,
      navigateToFirst: true,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not read Markdown ZIP.'
    return { ok: false, reason }
  }
}

/**
 * Import a directory of Markdown files, preserving nested folders as page hierarchy.
 */
async function importMarkdownFolder(
  files: File[],
  options: { insertRefs?: boolean; navigateToFirst?: boolean } = {},
): Promise<ImportResult> {
  if (!session || !currentPageId || files.length === 0) {
    return { ok: false, reason: 'Nothing to import.' }
  }
  try {
    const specs = await parseMarkdownFolderFiles(files)
    if (specs.length === 0) {
      return { ok: false, reason: 'Folder has no Markdown files.' }
    }
    return applyImportedPageSpecs(specs, {
      parentId: currentPageId,
      insertRefs: options.insertRefs ?? false,
      navigateToFirst: options.navigateToFirst ?? true,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not read Markdown folder.'
    return { ok: false, reason }
  }
}

function importMarkdownFolderForSettings(files: File[]) {
  return importMarkdownFolder(files, { insertRefs: false, navigateToFirst: true })
}

function openImportDialog() {
  importStatus = null
  importBusy = false
  importDialogOpen = true
}

function openMarkdownImportPicker() {
  openImportDialog()
}

function openMarkdownFolderPicker() {
  openImportDialog()
}

/** Enable folder selection on a hidden file input (webkitdirectory / directory). */
function enableDirectoryPicker(node: HTMLInputElement) {
  node.setAttribute('webkitdirectory', '')
  node.setAttribute('directory', '')
  // Some Chromium builds also honor this property.
  try {
    ;(node as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true
  } catch {
    // ignore
  }
}

function resetMarkdownFileInputMode(multiple: boolean) {
  const input = markdownFileInput
  if (!input) return
  // Never leave directory-picker flags on the file input (that forces folder UX).
  input.removeAttribute('webkitdirectory')
  input.removeAttribute('directory')
  try {
    ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = false
  } catch {
    // ignore
  }
  input.multiple = multiple
  input.accept = '.md,.markdown,.mdown,text/markdown,text/plain'
  input.value = ''
}

async function pickMarkdownFilesWithPicker(): Promise<File[] | null> {
  const w = window as Window & {
    showOpenFilePicker?: (options?: {
      multiple?: boolean
      excludeAcceptAllOption?: boolean
      types?: Array<{ description?: string; accept: Record<string, string[]> }>
    }) => Promise<FileSystemFileHandle[]>
  }
  if (typeof w.showOpenFilePicker !== 'function') return null
  try {
    const handles = await w.showOpenFilePicker({
      multiple: true,
      excludeAcceptAllOption: false,
      types: [
        {
          description: 'Markdown',
          accept: {
            'text/markdown': ['.md', '.markdown', '.mdown'],
            'text/plain': ['.md', '.markdown', '.mdown', '.txt'],
          },
        },
      ],
    })
    const files = await Promise.all(handles.map((h) => h.getFile()))
    return files
  } catch (error) {
    // User cancelled the picker.
    if (error instanceof DOMException && error.name === 'AbortError') return []
    return null
  }
}

async function pickMarkdownFiles() {
  pendingReplaceMarkdown = false
  // Prefer the modern file picker (single-click select + Open) when available.
  const picked = await pickMarkdownFilesWithPicker()
  if (picked) {
    if (picked.length === 0) return
    await importSelectedMarkdownFiles(picked, false)
    return
  }
  resetMarkdownFileInputMode(true)
  markdownFileInput?.click()
}

function pickMarkdownFolderLegacy() {
  markdownFolderInput?.click()
}

async function pickMarkdownReplace() {
  pendingReplaceMarkdown = true
  const w = window as Window & {
    showOpenFilePicker?: (options?: {
      multiple?: boolean
      excludeAcceptAllOption?: boolean
      types?: Array<{ description?: string; accept: Record<string, string[]> }>
    }) => Promise<FileSystemFileHandle[]>
  }
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const handles = await w.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: false,
        types: [
          {
            description: 'Markdown',
            accept: {
              'text/markdown': ['.md', '.markdown', '.mdown'],
              'text/plain': ['.md', '.markdown', '.mdown', '.txt'],
            },
          },
        ],
      })
      const file = await handles[0]?.getFile()
      if (!file) {
        pendingReplaceMarkdown = false
        return
      }
      await importSelectedMarkdownFiles([file], true)
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        pendingReplaceMarkdown = false
        return
      }
      // fall through to input
    }
  }
  resetMarkdownFileInputMode(false)
  markdownFileInput?.click()
}

async function importSelectedMarkdownFiles(files: File[], replace: boolean) {
  pendingReplaceMarkdown = false
  if (files.length === 0) return
  importBusy = true
  try {
    if (replace) {
      const result = await importReplaceCurrentFromMarkdown(files[0])
      importStatus = result.ok ? result.message : result.reason
    } else {
      const md = markdownFilesFromList(files)
      if (md.length === 0) {
        importStatus = 'No Markdown files selected.'
        return
      }
      const result = await importMarkdownFiles(md, { insertRefs: true, navigateToFirst: false })
      importStatus = result.ok ? result.message : result.reason
    }
    if (importDialogOpen) {
      window.setTimeout(() => {
        importDialogOpen = false
        importStatus = null
      }, 900)
    }
  } finally {
    importBusy = false
  }
}

function pickMarkdownZip() {
  openCommandImportPicker('md-zip')
}

function pickWorkspaceJson() {
  openCommandImportPicker('json-workspace')
}

async function importFromNativeDirectory(): Promise<ImportResult> {
  // Prefer bind (read+write) so Ctrl+S can save back to the same folder.
  return bindFolderFromUi()
}

async function onImportDialogAction(action: ImportDialogAction) {
  if (importBusy) return
  importStatus = null

  switch (action) {
    case 'md-files':
      void pickMarkdownFiles()
      return
    case 'md-folder-legacy':
      pickMarkdownFolderLegacy()
      return
    case 'md-zip':
      pickMarkdownZip()
      return
    case 'json-workspace':
      pickWorkspaceJson()
      return
    case 'md-replace':
      void pickMarkdownReplace()
      return
    case 'md-folder-native':
      break
    default:
      return
  }

  importBusy = true
  importStatus = 'Reading folder…'
  try {
    const result = await importFromNativeDirectory()
    if (!result.ok) {
      if (result.reason === 'cancelled') {
        importStatus = null
        return
      }
      importStatus = result.reason
      return
    }
    importStatus = result.message
    // Close shortly after success so the user sees the status.
    window.setTimeout(() => {
      if (importStatus === result.message) {
        importDialogOpen = false
        importStatus = null
      }
    }, 900)
  } finally {
    importBusy = false
  }
}

async function onMarkdownFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  const replace = pendingReplaceMarkdown
  pendingReplaceMarkdown = false
  resetMarkdownFileInputMode(true)
  if (files.length === 0) return
  await importSelectedMarkdownFiles(files, replace)
}

async function onMarkdownFolderInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  importBusy = true
  importStatus = 'Importing folder…'
  try {
    const result = await importMarkdownFolder(files, { insertRefs: false, navigateToFirst: true })
    importStatus = result.ok ? result.message : result.reason
    if (result.ok) {
      window.setTimeout(() => {
        importDialogOpen = false
        importStatus = null
      }, 900)
    }
  } finally {
    importBusy = false
  }
}

function hasMarkdownDataTransfer(dt: DataTransfer | null): boolean {
  if (!dt) return false
  if (dt.files && markdownFilesFromList(dt.files).length > 0) return true
  // Some browsers only expose types during dragover.
  return Array.from(dt.types ?? []).some((t) => t === 'Files')
}

function onPageMarkdownDragEnter(event: DragEvent) {
  // Don't steal focus / show drop UI while a modal (import) is open.
  if (importDialogOpen || importBusy) return
  if (!hasMarkdownDataTransfer(event.dataTransfer)) return
  event.preventDefault()
  mdDropDepth += 1
  mdDropActive = true
}

function onPageMarkdownDragOver(event: DragEvent) {
  if (importDialogOpen || importBusy) return
  if (!hasMarkdownDataTransfer(event.dataTransfer)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  mdDropActive = true
}

function onPageMarkdownDragLeave(event: DragEvent) {
  if (importDialogOpen || importBusy) {
    mdDropDepth = 0
    mdDropActive = false
    return
  }
  if (!hasMarkdownDataTransfer(event.dataTransfer)) return
  event.preventDefault()
  mdDropDepth = Math.max(0, mdDropDepth - 1)
  if (mdDropDepth === 0) mdDropActive = false
}

async function onPageMarkdownDrop(event: DragEvent) {
  if (importDialogOpen || importBusy) {
    mdDropDepth = 0
    mdDropActive = false
    return
  }
  const all = Array.from(event.dataTransfer?.files ?? [])
  mdDropDepth = 0
  mdDropActive = false
  if (all.length === 0) return
  event.preventDefault()
  event.stopPropagation()

  // Folder drops include nested webkitRelativePath — preserve hierarchy.
  if (filesLookLikeMarkdownFolder(all)) {
    await importMarkdownFolder(all, { insertRefs: false, navigateToFirst: true })
    return
  }

  const files = markdownFilesFromList(all)
  if (files.length === 0) return
  await importMarkdownFiles(files, { insertRefs: true, navigateToFirst: false })
}

const openCommentCount = $derived(
  comments.filter((comment) => !comment.resolved).length,
)

function onAddComment(payload: {
  blockId: string
  start: number
  end: number
  quote: string
  text: string
}) {
  if (!session || !currentPageId) return
  const comment = session.addComment(currentPageId, payload)
  comments = session.getComments(currentPageId)
  rememberCommentMessages(comments)
  activeCommentId = comment.id
  // Notify peers only (webxdc notify "*"); no self toast.
  notifyPeersAboutComment('comment', payload.text)
}

function onAddPageComment(text: string) {
  if (!session || !currentPageId) return
  const trimmed = text.trim()
  if (!trimmed) return

  // Whole-page comment — no text selection / mention required.
  const comment = session.addComment(currentPageId, {
    blockId: PAGE_COMMENT_BLOCK_ID,
    start: 0,
    end: 0,
    quote: pageTitle.trim() || 'Page comment',
    text: trimmed,
  })
  comments = session.getComments(currentPageId)
  rememberCommentMessages(comments)
  activeCommentId = comment.id
  // Keep panel open for the author; do not toast ourselves.
  setCommentsOpen(true)
  notifyPeersAboutComment('comment', trimmed)
}

function onCommentReply(commentId: string, text: string) {
  if (!session || !currentPageId) return
  const trimmed = text.trim()
  if (!trimmed) return
  session.addCommentReply(currentPageId, commentId, trimmed)
  comments = session.getComments(currentPageId)
  rememberCommentMessages(comments)
  notifyPeersAboutComment('reply', trimmed)
}

function setCommentsOpen(open: boolean) {
  const next = !!open
  if (commentsOpen === next) {
    commentsPanelApi.setCommentsOpen(next)
    return
  }
  commentsOpen = next
  commentsPanelApi.setCommentsOpen(next)
}

function toggleCommentsPanel() {
  setCommentsOpen(!commentsOpen)
}

function prepareShare() {
  flushPendingEditorSave()
  session?.flush()
}

function getShareDocument() {
  return session?.getDocument() ?? { version: 2 as const, pages: {} }
}

// Vue used watch() without immediate — only persist *user* changes, not the
// initial hydrate from session (which would race and wipe icon/cover).
let metaPersistReady = false
let metaPersistPageId = ''
$effect(() => {
  const pageId = currentPageId
  const title = pageTitle
  const icon = pageIcon
  const cover = pageCover
  if (!session || applyingRemote || !pageId) return

  if (!metaPersistReady || metaPersistPageId !== pageId) {
    metaPersistReady = true
    metaPersistPageId = pageId
    return
  }

  session.setPageTitle(pageId, title)
  // IconEmojiPicker may emit null when removing; persist as cleared.
  session.setPageIcon(pageId, icon || undefined)
  session.setPageCover(pageId, cover || undefined)
  pages = session.getPages()
})

/**
 * Enter / ArrowDown in the page title (block editor): ensure a body block at the
 * start of the page and move focus into it.
 */
function onTitleEnter() {
  const list = blocks
  const first = list[0]
  const firstIsEmptyParagraph =
    first
    && first.type === 'paragraph'
    && spansToText(first.content).trim() === ''

  if (!firstIsEmptyParagraph) {
    const nb = createBlock('paragraph', { content: [] })
    blocks = [nb, ...list]
    dirtyBlockIds.add(nb.id)
    onEditorChange()
  }

  void tick().then(() => {
    // ProEditor → BlockEditor exports; optional chaining if bind:this not ready.
    editorRef?.focusFirst?.()
  })
}

function onPageLayoutChange(mode: 'container' | 'full') {
  if (!session || !currentPageId) return
  const fullWidth = mode === 'full'
  pageFullWidth = fullWidth
  session.setPageFullWidth(currentPageId, fullWidth)
  pages = session.getPages()
}


$effect(() => {
  void mountApp()
  return () => {
    if (mounted) unmountApp()
  }
})
</script>


<CommandPalette
  bind:open={paletteOpen}
  {commands}
  {pages}
  currentPageId={currentPageId}
  onnavigate={navigateToPage}
  oncreatePage={onPaletteCreatePage}
/>
<ContextMenu
  bind:open={contextMenuOpen}
  commands={contextMenuCommands}
  x={contextMenuX}
  y={contextMenuY}
/>
<SyncModeSetup
  bind:open={syncModeSetupOpen}
  onselect={onSyncModeSelected}
/>
<SettingsPopup
  bind:open={settingsOpen}
  peers={browserDemoOnly ? [] : settingsPeers}
  pages={settingsPages}
  currentPageId={currentPageId}
  pageTitle={pageTitle}
  pageLayout={pageFullWidth ? 'full' : 'container'}
  syncMode={collabSyncMode}
  initialTab={settingsInitialTab}
  getDocument={getShareDocument}
  onBeforeExport={prepareShare}
  importMarkdownAsPages={importMarkdownAsPagesForSettings}
  importMarkdownFolder={importMarkdownFolderForSettings}
  importReplaceMarkdown={importReplaceCurrentFromMarkdown}
  importReplaceHtml={importReplaceCurrentFromHtml}
  importReplaceText={importReplaceCurrentFromText}
  importWorkspaceJson={importWorkspaceJson}
  importMarkdownZip={importMarkdownZip}
  boundFolderName={boundFolderLabel}
  folderAutosave={folderAutosave}
  canBindFolder={canBindFolder()}
  onbindFolder={async () => {
    importBusy = true
    importStatus = 'Binding folder…'
    try {
      const result = await bindFolderFromUi()
      if (result.ok) {
        importStatus = result.message
        setBoundSaveStatus(result.message)
      } else if (result.reason !== 'cancelled') {
        importStatus = result.reason
        setBoundSaveStatus(result.reason)
      }
      return result
    } finally {
      importBusy = false
    }
  }}
  onunbindFolder={unbindFolderFromUi}
  onfolderAutosaveChange={onFolderAutosaveChange}
  onsaveBoundFolder={() => saveBoundFolderNow({ notify: true })}
  onpageLayoutChange={onPageLayoutChange}
  onsyncModeChange={onSyncModeChange}
/>
<ShareDialog
  bind:open={shareOpen}
  pageTitle={pageTitle}
  getDocument={getShareDocument}
  onBeforeShare={prepareShare}
/>
<ImportDialog
  bind:open={importDialogOpen}
  busy={importBusy}
  status={importStatus}
  onaction={onImportDialogAction}
/>
<CommentPanel
  bind:open={commentsOpen}
  {comments}
  pageTitle={pageTitle}
  activeId={activeCommentId}
  onselect={(id) => (activeCommentId = id)}
  onadd={onAddPageComment}
  onreply={onCommentReply}
/>
<ShortcutsHelp bind:open={shortcutsOpen} />
{#if commentToast}
  <button
    use:portal
    type="button"
    class="comment-toast"
    transition:commentToastTransition
    onclick={() => { setCommentsOpen(true); commentToast = null }}
  >
    <MessageCircle class="comment-toast__icon" size={16} strokeWidth={2} />
    <span class="comment-toast__text">{commentToast.text}</span>
  </button>
{/if}
{#if boundSaveStatus}
  <div use:portal class="bound-save-toast" role="status">{boundSaveStatus}</div>
{/if}
<PageDeleteDialog
  bind:open={deleteDialogOpen}
  pageTitle={deleteTargetTitle()}
  pageCount={deleteTargetCount()}
  descendantCount={deleteTargetDescendantCount()}
  onconfirm={confirmDeletePage}
/>

<input
  bind:this={markdownFileInput}
  type="file"
  class="md-file-input"
  accept=".md,.markdown,.mdown,text/markdown,text/plain"
  multiple
  onchange={onMarkdownFileInputChange}
/>
<input
  bind:this={markdownFolderInput}
  type="file"
  class="md-file-input"
  multiple
  use:enableDirectoryPicker
  onchange={onMarkdownFolderInputChange}
/>
<input
  bind:this={commandImportInput}
  type="file"
  class="md-file-input"
  onchange={onCommandImportInputChange}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="page" oncontextmenu={onContextMenu}>
  {#if !ready && !syncModeSetupOpen}
    <div class="page-loading">Loading…</div>
  {:else}
    <div class="app-shell">
      <PageSidebar
        bind:open={sidebarOpen}
        {pages}
        peers={browserDemoOnly ? [] : onlinePeers}
        currentPageId={currentPageId}
        rootPageId={rootPageId}
        onnavigate={navigateToPage}
        onrename={onRenamePage}
        onnewPage={onNewPage}
        onimportMarkdown={openImportDialog}
        onimportMarkdownFiles={(files) => {
          if (filesLookLikeMarkdownFolder(files)) {
            void importMarkdownFolder(files, { insertRefs: false, navigateToFirst: true })
            return
          }
          void importMarkdownFiles(files, { insertRefs: true })
        }}
        onmove={onMovePage}
        onrequestDelete={onRequestDeletePage}
      />

      <div
        class="app-main"
        class:app-main--md-drop={mdDropActive}
        ondragenter={onPageMarkdownDragEnter}
        ondragover={onPageMarkdownDragOver}
        ondragleave={onPageMarkdownDragLeave}
        ondrop={onPageMarkdownDrop}
      >
        <PageHeader
          title={pageTitle}
          {pages}
          peers={browserDemoOnly ? [] : onlinePeers}
          currentPageId={currentPageId}
          rootPageId={rootPageId}
          sidebarOpen={sidebarOpen}
          commentsOpen={commentsOpen}
          commentCount={openCommentCount}
          followedPeerAddr={followedPeerAddr}
          writing={!!focusedBlockId}
          ontoggleSidebar={toggleSidebar}
          onnavigateHome={navigateHome}
          onopenShare={() => (shareOpen = true)}
          onopenSettings={() => openSettings(null)}
          onopenComments={toggleCommentsPanel}
          onnavigatePage={navigateToPage}
          onfindPeer={findPeer}
          onfollowPeer={followPeer}
          onstopFollow={stopFollow}
          onexportMarkdown={exportPageAsMarkdown}
          onimportMarkdown={openImportDialog}
        />

        {#if mdDropActive}
          <div class="md-drop-banner" role="status">
            Drop Markdown to create a new page and link it here
          </div>
        {/if}

        {#if !browserDemoOnly && followInvite}
          <div class="follow-invite-banner" role="status">
            <span
              class="follow-banner__dot"
              style="background: {followInvite.color}"
              aria-hidden="true"
            ></span>
            <span class="follow-banner__text">
              <strong>{followInvite.name}</strong> wants you to follow them
            </span>
            <button type="button" class="follow-banner__stop follow-invite-banner__accept" onclick={acceptFollowInvite}>
              Follow
            </button>
            <button type="button" class="follow-banner__stop" onclick={dismissFollowInvite}>
              Dismiss
            </button>
          </div>
        {/if}

        {#if !browserDemoOnly && followedPeer}
          <div class="follow-banner" role="status">
            <span
              class="follow-banner__dot"
              style="background: {followedPeer.color}"
              aria-hidden="true"
            ></span>
            <span class="follow-banner__text">
              Following <strong>{followedPeer.name}</strong>
            </span>
            <button type="button" class="follow-banner__stop" onclick={stopFollow}>
              Stop
            </button>
          </div>
        {/if}

        <PageTitle
          bind:value={pageTitle}
          bind:icon={pageIcon}
          bind:cover={pageCover}
          class={"page-title-shell page-switch-surface" + (pageSwitching ? " page-switch-surface--active" : "")}
          contentFullWidth={pageFullWidth}
          onaddComment={toggleCommentsPanel}
          onenter={onTitleEnter}
        />

        <div class="page-inner" class:page-inner--full={pageFullWidth}>
          <div class="page-content">
            <div bind:this={editorAnchor} class="editor-container">
              {#if !browserDemoOnly}
                <ReactionPie
                  presence={presence}
                  anchor={editorAnchor}
                  currentPageId={currentPageId}
                />
              {/if}
              <CommentGutter
                {comments}
                anchor={editorAnchor}
                activeId={activeCommentId}
                onselect={(id) => (activeCommentId = id)}
                onreply={onCommentReply}
              />
              <div class="page-switch-surface" class:page-switch-surface--active={pageSwitching}>
                <ProEditor
                  bind:this={editorRef}
                  modelValue={blocks}
                  toolbar="floating"
                  {pages}
                  currentPageId={currentPageId}
                  createPage={createPage}
                  setPageParent={setPageParent}
                  lockedBlocks={browserDemoOnly ? {} : lockedBlocks}
                  voterId={voterId}
                  vimMode={vimEnabled}
                  onchange={onEditorChange}
                  onnavigatepage={navigateToPage}
                  oncomment={onAddComment}
                  onfocusblock={onFocusBlock}
                  resolveInternalHref={resolveEditorInternalHref}
                />
              </div>
              <!--
                Peer carets/cursors above the editor so they are not covered
                by contenteditable layers (indicators paint over the page).
              -->
              {#if !browserDemoOnly}
                <PeerCursors
                  presence={presence}
                  anchor={editorAnchor}
                  currentPageId={currentPageId}
                />
              {/if}
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>


<style>

.md-file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.app-main--md-drop {
  outline: 2px dashed color-mix(in srgb, var(--xpe-primary, #2383e2) 55%, transparent);
  outline-offset: -4px;
}

.md-drop-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--header-border, #e9e9e7);
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 12%, var(--page-bg, #fff));
  color: var(--page-text, #37352f);
  font-size: 13px;
  font-weight: 600;
}

.follow-banner,
.follow-invite-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--header-border, #e9e9e7);
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 8%, var(--page-bg, #fff));
  color: var(--page-text, #37352f);
  font-size: 13px;
}

.follow-invite-banner {
  background: color-mix(in srgb, #2ecc71 12%, var(--page-bg, #fff));
}

.follow-invite-banner__accept {
  border-color: color-mix(in srgb, #2ecc71 40%, var(--header-border, #e9e9e7));
  background: color-mix(in srgb, #2ecc71 16%, var(--page-bg, #fff));
}

.follow-banner__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.follow-banner__text {
  flex: 1;
  min-width: 0;
}

.follow-banner__stop {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--header-border, #e9e9e7);
  border-radius: 6px;
  background: var(--page-bg, #fff);
  color: var(--page-text, #37352f);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.follow-banner__stop:hover {
  background: var(--header-hover, #f1f1ef);
}

.page {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--page-bg);
  /* Sticky header islands pin against #app, not a nested overflow parent. */
  overflow: visible;
}

.app-shell {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: visible;
}

.app-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 100vh;
  min-height: 100dvh;
  /*
   * Clip horizontal bleed without creating a second vertical scrollport
   * (that would break sticky header islands and add a duplicate scrollbar).
   */
  overflow-x: clip;
  overflow-y: visible;
}

.page-loading {
  display: grid;
  place-items: center;
  min-height: 100vh;
  color: var(--page-muted);
  font-size: 14px;
}

/* Full-bleed page header (cover + title). Title column matches page-inner. */
.page-title-shell {
  width: 100%;
  max-width: none;
  flex-shrink: 0;
  /* Avoid transform scale during page switch shrinking the cover band. */
  align-self: stretch;
}

.page-inner {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  max-width: var(--page-width);
  margin: 0 auto;
  padding: 0 var(--page-padding-x) 96px;
  min-height: 0;
}

/* Explicit full-width mode (Settings → Page layout). Default remains container. */
.page-inner--full {
  max-width: none;
}

/*
 * Single content column: page title/header and block text share one left edge.
 * Inset leaves room for absolute block gutters hanging outside the text column.
 */
.page-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  /* Shared left edge for title + blocks; gutters hang into this inset. */
  padding-inline: var(--page-content-inset-start) var(--page-content-inset-end);
  overflow: visible;
}

.page-switch-surface {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.page-switch-surface--active {
  opacity: 0.55;
  transform: translateY(6px) scale(0.995);
}

.editor-container {
  position: relative;
  /* Peer cursor layer (z-index 30+) stacks above editor chrome. */
  isolation: isolate;
  flex: 1;
  min-height: 0;
}

.editor-container > .page-switch-surface {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 100%;
}

.editor-container :global(.xpe-pro-editor) {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.editor-container :global(.block-editor) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 100%;
}

.editor-container :global(.editor-tail) {
  flex: 1;
  min-height: 48px;
}

@media (max-width: 768px) {
  /* Phones always use full width — ignore Settings “container” max-width. */
  .page-inner,
  .page-inner--full {
    max-width: none;
    width: 100%;
    padding: 0 16px 64px;
  }

  .page-content {
    padding-inline: 8px 8px;
  }

  /* PageTitle sits outside .page-inner — force full width shell too. */
  :global(.page-title-root),
  :global(.page-title-shell) {
    width: 100%;
    max-width: none;
  }

  :global(.xeditor-page-header) {
    width: 100%;
    max-width: none !important;
    margin-inline: 0;
  }
}

/* iOS WebXDC phone mode (html[data-phone-ui] from phoneUi.ts) */
:global(html[data-phone-ui]) .page-inner,
:global(html[data-phone-ui]) .page-inner--full {
  max-width: none;
  width: 100%;
  padding: 0 16px 64px;
}

:global(html[data-phone-ui]) .page-content {
  padding-inline: 8px 8px;
}

:global(html[data-phone-ui]) .page-title-root,
:global(html[data-phone-ui]) .page-title-shell {
  width: 100%;
  max-width: none;
}

:global(html[data-phone-ui]) .xeditor-page-header {
  width: 100%;
  max-width: none !important;
  margin-inline: 0;
}

.comment-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 120;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 12px 14px;
  border: 1px solid var(--comment-panel-border, #e9e9e7);
  border-radius: 12px;
  background: var(--comment-panel-bg, #fff);
  color: var(--comment-text, #37352f);
  box-shadow: 0 12px 32px rgb(15 15 15 / 0.16);
  transform: translateX(-50%);
  cursor: pointer;
  font: inherit;
  text-align: start;
}

.comment-toast__icon {
  flex-shrink: 0;
  color: var(--comment-accent, #2383e2);
}

.comment-toast__text {
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
}

.comment-toast-enter-active,
.comment-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.22s ease;
}

.comment-toast-enter-from,
.comment-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.bound-save-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 121;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 14px;
  border: 1px solid var(--comment-panel-border, #e9e9e7);
  border-radius: 10px;
  background: var(--comment-panel-bg, #fff);
  color: var(--comment-text, #37352f);
  box-shadow: 0 10px 28px rgb(15 15 15 / 0.14);
  transform: translateX(-50%);
  font-size: 13px;
  line-height: 1.35;
  pointer-events: none;
}

</style>
