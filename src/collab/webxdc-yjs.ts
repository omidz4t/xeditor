import type { Block } from '@xproeditor/core'
import type { RealtimeListener } from '@webxdc/types'
import * as Y from 'yjs'
import {
  loadLocalYjsState,
  localDocStoreKey,
  saveLocalYjsState,
} from './local-doc-idb'
import WebxdcProvider, { CHAT_ORIGIN } from './y-webxdc-provider'
import { PresenceManager, type PresenceHandle } from './presence'
import {
  encodeSyncStep1,
  encodeSyncUpdate,
  processSyncMessage,
} from './yjs-realtime-sync'
import { fetchBootstrapDocument } from './bootstrap-document'
import {
  addCommentReply,
  addPageComment,
  createEmptyDocument,
  createPage,
  deletePage,
  getPageBlocks,
  getPageComments,
  getRootPageId,
  listPages,
  movePage,
  setPageBlocks,
  setPageFullWidth,
  setPageParent,
  setPageCover,
  setPageIcon,
  setPageTitle,
  syncPageParentsFromBlocks,
  type CollabDocument,
  type PageComment,
  type PageMeta,
} from './document'
import { isJoinNotificationsEnabled } from '../composables/useJoinNotifications'
import {
  getPagesMap,
  hasYDocumentContent,
  migrateLegacyContentIfNeeded,
  readDocumentFromY,
  syncDocumentToY,
  syncPageBlocksToY,
  waitForYDocumentContent,
} from './y-doc-store'
import {
  isCollabSyncMode,
  readCachedCollabMode,
  writeCachedCollabMode,
  type CollabSyncMode,
} from './sync-mode'
import { maybeCompactMockXdcUpdates } from './webxdc-storage'

const REALTIME_ORIGIN = 'webxdc-realtime'
const LOCAL_ORIGIN = 'local'
/** Applied when hydrating the Y.Doc from IndexedDB (local mode). */
const LOCAL_IDB_ORIGIN = 'local-idb'
const INIT_WAIT_MS = 1500
const INIT_WAIT_EXTRA_MS = 2000
/** Chat is durable save only — batch rather than stream every edit. */
const CHAT_AUTOSAVE_MS = 5000
/** Debounce full-state writes to IndexedDB in local-only mode. */
const LOCAL_IDB_SAVE_MS = 400
const REALTIME_SYNC_RETRY_MS = 1200
/** Keep offering our state vector while peers may join late. */
const REALTIME_SYNC_HEARTBEAT_MS = 4000

const REMOTE_ORIGINS = new Set<unknown>([REALTIME_ORIGIN, CHAT_ORIGIN])

export interface CollabSession {
  ready: Promise<void>
  /** Chat-wide transport (first open + settings / remote updates). */
  readonly syncMode: CollabSyncMode
  readonly presence: PresenceHandle | null
  /**
   * Change sync transport. Publishes silently to peers (no notify) unless
   * `publish` is false (used when applying a peer's mode update).
   */
  setSyncMode: (mode: CollabSyncMode, options?: { publish?: boolean }) => void
  onSyncModeChange: (handler: (mode: CollabSyncMode) => void) => () => void
  getDocument: () => CollabDocument
  getRootPageId: () => string
  getBlocks: (pageId: string) => Block[]
  getPages: () => PageMeta[]
  /**
   * Publish page body blocks. Optional `onlyIds` limits JSON re-encode to those
   * blocks (plus any missing from Y) for large-document typing performance.
   */
  pushBlocks: (pageId: string, blocks: Block[], onlyIds?: ReadonlySet<string> | null) => void
  createPage: (title?: string, parentId?: string, insertAfterPageId?: string) => PageMeta
  /**
   * Create many pages + bodies in one Y transaction (bulk import).
   * Far cheaper than createPage+pushBlocks per file on large workspaces.
   * Optional `key` / `parentKey` rebuild folder trees in one pass.
   */
  importPagesBatch: (
    items: Array<{
      key?: string
      parentKey?: string
      title: string
      parentId?: string
      blocks: Block[]
      icon?: string
      cover?: string
      fullWidth?: boolean
    }>,
    options?: { defaultParentId?: string },
  ) => { created: PageMeta[]; idMap: Map<string, string> }
  deletePage: (pageId: string) => string | null
  setPageParent: (pageId: string, parentId: string) => void
  movePage: (pageId: string, parentId: string, insertBeforePageId?: string) => void
  setPageTitle: (pageId: string, title: string) => void
  setPageIcon: (pageId: string, icon: string | undefined) => void
  setPageCover: (pageId: string, cover: string | undefined) => void
  /** Default is container (`false`). */
  setPageFullWidth: (pageId: string, fullWidth: boolean) => void
  getComments: (pageId: string) => PageComment[]
  addComment: (
    pageId: string,
    payload: {
      blockId: string
      start: number
      end: number
      quote?: string
      text: string
    },
  ) => PageComment
  addCommentReply: (pageId: string, commentId: string, text: string) => void
  /** Notify peers about a comment (webxdc notify to others, not self). */
  notifyComment: (message: string) => void
  onDocumentChange: (handler: () => void) => void
  /** @deprecated use onDocumentChange */
  onBlocksChange: (handler: () => void) => void
  flush: () => void
  destroy: () => void
}

export type CreateCollabSessionOptions = {
  /**
   * Called only when no shared mode exists in chat history yet (first open).
   * Return the mode the user chose; it will be published silently.
   */
  requestSyncMode?: () => Promise<CollabSyncMode>
}

function ensureUsableDocument(doc: CollabDocument): CollabDocument {
  if (doc.pages && Object.keys(doc.pages).length > 0) {
    return doc
  }
  return createEmptyDocument()
}

/**
 * Ask peers who already have the app open what transport they use.
 * Used so a second client adopts "Realtime only" without a setup dialog and
 * without writing a chat/email status update.
 */
async function discoverCollabModeViaRealtime(timeoutMs = 1800): Promise<CollabSyncMode | null> {
  const webxdc = window.webxdc
  if (typeof webxdc?.joinRealtimeChannel !== 'function') return null

  let channel: RealtimeListener | null = null
  try {
    channel = webxdc.joinRealtimeChannel()
  } catch {
    return null
  }
  if (!channel) return null

  return new Promise((resolve) => {
    let settled = false
    const finish = (mode: CollabSyncMode | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        channel?.leave()
      } catch {
        // ignore
      }
      resolve(mode)
    }

    const timer = window.setTimeout(() => finish(null), timeoutMs)

    channel!.setListener((data: Uint8Array) => {
      if (!(data instanceof Uint8Array) || data.byteLength < 2 || data[0] !== 0x7b) return
      try {
        const msg = JSON.parse(new TextDecoder().decode(data)) as {
          t?: string
          m?: unknown
          a?: string
        }
        if (msg?.a && msg.a === webxdc.selfAddr) return
        if (msg?.t === 'mode' && isCollabSyncMode(msg.m)) {
          finish(msg.m)
          return
        }
        if (msg?.t === 'join' && isCollabSyncMode(msg.m)) {
          finish(msg.m)
        }
      } catch {
        // ignore non-JSON
      }
    })

    // Nudge open peers to re-announce mode (presence handles t:'mode?').
    try {
      const query = new TextEncoder().encode(
        JSON.stringify({ t: 'mode?', a: webxdc.selfAddr }),
      )
      channel!.send(query)
    } catch {
      // ignore
    }
  })
}

function commitResolvedMode(
  chatProvider: WebxdcProvider,
  mode: CollabSyncMode,
): CollabSyncMode {
  writeCachedCollabMode(mode)
  if (mode === 'chat') chatProvider.publishCollabMode(mode)
  else chatProvider.setCollabModeLocal(mode)
  return mode
}

async function resolveSyncMode(
  chatProvider: WebxdcProvider,
  requestSyncMode?: () => Promise<CollabSyncMode>,
): Promise<CollabSyncMode> {
  // Wait for status history so we can adopt a mode another peer already chose (chat path).
  await chatProvider.ready

  let mode = chatProvider.getCollabMode()
  if (isCollabSyncMode(mode)) {
    writeCachedCollabMode(mode)
    return mode
  }

  // Prefer device cache before UI (reopen same device).
  const cached = readCachedCollabMode()
  if (cached) {
    return commitResolvedMode(chatProvider, cached)
  }

  // Live peers already running (esp. Realtime only) — adopt their mode without dialog.
  const fromLive = await discoverCollabModeViaRealtime(1800)
  if (fromLive) {
    return commitResolvedMode(chatProvider, fromLive)
  }

  // Concurrent first open: another peer may publish chat mode while we show the dialog.
  const remoteModePromise = new Promise<CollabSyncMode>((resolve) => {
    chatProvider.on('mode', (next) => {
      if (isCollabSyncMode(next)) resolve(next)
    })
  })

  if (typeof requestSyncMode === 'function') {
    const userPick = Promise.resolve()
      .then(() => requestSyncMode())
      .then((picked) => {
        if (!isCollabSyncMode(picked)) {
          throw new Error('Invalid collab sync mode')
        }
        // Only publish if nobody else won the race first.
        if (!chatProvider.getCollabMode()) {
          commitResolvedMode(chatProvider, picked)
        }
        return chatProvider.getCollabMode() ?? picked
      })

    mode = await Promise.race([remoteModePromise, userPick])
  } else {
    mode = (await Promise.race([
      remoteModePromise,
      Promise.resolve('chat' as CollabSyncMode),
    ])) as CollabSyncMode
    if (!chatProvider.getCollabMode() && isCollabSyncMode(mode)) {
      commitResolvedMode(chatProvider, mode)
    }
  }

  if (!isCollabSyncMode(mode)) {
    mode = 'chat'
  }
  writeCachedCollabMode(mode)
  return mode
}

export async function createCollabSession(
  options: CreateCollabSessionOptions = {},
): Promise<CollabSession> {
  const doc = new Y.Doc()
  const yPages = getPagesMap(doc)
  const webxdc = window.webxdc
  const listeners = new Set<() => void>()
  let collabDoc: CollabDocument = { version: 2, pages: {} }
  let suppressObserveEmit = false

  const refreshFromY = () => {
    collabDoc = readDocumentFromY(doc)
  }

  const emit = () => {
    for (const handler of listeners) handler()
  }

  const applyMutation = (
    mutate: (current: CollabDocument) => CollabDocument | null,
    options?: { silent?: boolean; fromY?: boolean },
  ): void => {
    // Prefer in-memory collabDoc so create/import keeps unchanged page object
    // refs (syncDocumentToY can skip them). Full Y re-read only when requested
    // or when the cache is empty (after remote merges, observeDeep refreshes).
    const before =
      options?.fromY || Object.keys(collabDoc.pages).length === 0
        ? readDocumentFromY(doc)
        : collabDoc
    const after = mutate(before)
    if (!after || after === before) return
    suppressObserveEmit = true
    syncDocumentToY(doc, before, after, LOCAL_ORIGIN)
    // Keep the mutated tree — do NOT re-parse every page from Y (that was O(all
    // pages × all blocks) after every create/import and made large imports hang).
    collabDoc = after
    suppressObserveEmit = false
    // Local typing uses silent push so we don't re-merge the whole page into the UI.
    if (!options?.silent) emit()
  }

  let currentSyncMode: CollabSyncMode = 'chat'

  /** Deep-clone blocks so editor in-place mutations never alias collabDoc/Y. */
  const cloneBlocks = (nextBlocks: Block[]): Block[] =>
    nextBlocks.map((block) => JSON.parse(JSON.stringify(block)) as Block)

  /**
   * Live collab write (Vue parity): always re-read Y, write full page block
   * payloads (setIfChanged), keep memory in sync. Body edits go on the wire
   * every keystroke — not only after Enter / structure changes.
   */
  const pushBlocksLive = (pageId: string, nextBlocks: Block[]): void => {
    applyMutation(
      (current) => {
        if (!current.pages[pageId]) return current
        const snapshot = cloneBlocks(nextBlocks)
        let next = setPageBlocks(current, pageId, snapshot)
        next = syncPageParentsFromBlocks(next, pageId)
        return next
      },
      // fromY: concurrent peer blocks merge correctly; silent: don't clobber local editor UI.
      { silent: true, fromY: true },
    )
  }

  /**
   * Local-only hot path: one page write without full workspace re-read.
   */
  const pushBlocksFast = (pageId: string, nextBlocks: Block[]): boolean => {
    const current = collabDoc
    if (!current.pages[pageId]) return false

    const snapshot = cloneBlocks(nextBlocks)
    const prevBlocks = current.pages[pageId].blocks ?? []
    let after = setPageBlocks(current, pageId, snapshot)
    const pageRefsChanged =
      prevBlocks.some((b) => b.type === 'page')
      || snapshot.some((b) => b.type === 'page')
    if (pageRefsChanged) {
      after = syncPageParentsFromBlocks(after, pageId)
    }

    suppressObserveEmit = true
    const ok = syncPageBlocksToY(doc, pageId, snapshot, LOCAL_ORIGIN, null)
    if (!ok) {
      suppressObserveEmit = false
      applyMutation(() => after, { silent: true })
      return true
    }
    if (pageRefsChanged) {
      syncDocumentToY(doc, current, after, LOCAL_ORIGIN)
    }
    collabDoc = after
    suppressObserveEmit = false
    return true
  }

  let syncRetryTimer: ReturnType<typeof setTimeout> | number | undefined
  let syncHeartbeatTimer: ReturnType<typeof setInterval> | number | undefined
  let localIdbSaveTimer: ReturnType<typeof setTimeout> | number | undefined
  /** Queued only while the channel is not up yet; otherwise we send instantly. */
  let pendingRealtimeUpdates: Uint8Array[] = []
  let realtimeChannel: RealtimeListener | null = null
  let realtimeClosed = false
  let presence: PresenceManager | null = null
  let chatOutbound = false
  let realtimeOutbound = false
  const syncModeListeners = new Set<(mode: CollabSyncMode) => void>()
  const localIdbKey = localDocStoreKey(webxdc.selfAddr || 'default')

  /** Persist full Y state to IndexedDB (local-only mode). */
  const flushLocalIdbSave = () => {
    if (localIdbSaveTimer) {
      clearTimeout(localIdbSaveTimer)
      localIdbSaveTimer = undefined
    }
    if (currentSyncMode !== 'local') return
    try {
      const state = Y.encodeStateAsUpdateV2(doc)
      if (state.byteLength === 0) return
      void saveLocalYjsState(localIdbKey, state)
    } catch (error) {
      console.warn('[webxdc-yjs] local IndexedDB encode/save failed', error)
    }
  }

  const scheduleLocalIdbSave = () => {
    if (currentSyncMode !== 'local') return
    if (localIdbSaveTimer) clearTimeout(localIdbSaveTimer)
    localIdbSaveTimer = window.setTimeout(() => {
      localIdbSaveTimer = undefined
      flushLocalIdbSave()
    }, LOCAL_IDB_SAVE_MS)
  }

  // Dev mock: drop legacy localStorage mock payloads.
  maybeCompactMockXdcUpdates()

  // Inbound chat listener is always attached so we can discover collabMode.
  // Outbound chat starts disabled until mode resolves to "chat".
  // Chat is durable save only (batched autosave); live edits use realtime.
  const chatProvider = new WebxdcProvider({
    webxdc,
    ydoc: doc,
    autosaveInterval: CHAT_AUTOSAVE_MS,
    resendAllUpdates: false,
    chatOutboundEnabled: false,
    getEditInfo: () => ({
      document: 'XEditor',
      summary: `Edited by ${webxdc.selfName}`,
      // Join chat info is opt-in (Settings → Sync). Document updates still sync.
      startinfo: isJoinNotificationsEnabled() ? `${webxdc.selfName} joined` : '',
    }),
  })

  const flushRealtime = () => {
    if (!realtimeOutbound || !realtimeChannel || realtimeClosed || pendingRealtimeUpdates.length === 0) {
      return
    }
    for (const update of pendingRealtimeUpdates) {
      try {
        realtimeChannel.send(encodeSyncUpdate(update))
      } catch (error) {
        console.warn('[webxdc-yjs] realtime send failed', error)
      }
    }
    pendingRealtimeUpdates = []
  }

  /** Send one Yjs update on the wire immediately (no setTimeout batching). */
  const sendRealtimeUpdateNow = (update: Uint8Array) => {
    if (!realtimeOutbound) return
    if (!realtimeChannel || realtimeClosed) {
      pendingRealtimeUpdates.push(update)
      return
    }
    try {
      realtimeChannel.send(encodeSyncUpdate(update))
    } catch (error) {
      console.warn('[webxdc-yjs] realtime send failed', error)
      pendingRealtimeUpdates.push(update)
    }
  }

  const sendSyncStep1 = () => {
    if (!realtimeOutbound || !realtimeChannel || realtimeClosed) return
    try {
      realtimeChannel.send(encodeSyncStep1(doc))
    } catch (error) {
      console.warn('[webxdc-yjs] realtime step1 failed', error)
    }
  }

  /** When a peer appears on realtime, re-handshake so they get our live state. */
  const shareStateWithRealtimePeers = () => {
    sendSyncStep1()
    // Push any updates that landed before the channel was ready.
    flushRealtime()
  }

  const stopRealtime = () => {
    if (syncRetryTimer) {
      clearTimeout(syncRetryTimer)
      syncRetryTimer = undefined
    }
    if (syncHeartbeatTimer) {
      clearInterval(syncHeartbeatTimer)
      syncHeartbeatTimer = undefined
    }
    pendingRealtimeUpdates = []
    realtimeClosed = true
    presence?.destroy()
    presence = null
    try {
      realtimeChannel?.leave()
    } catch {
      // ignore leave errors from host
    }
    realtimeChannel = null
  }

  const startRealtime = () => {
    if (realtimeChannel || typeof webxdc.joinRealtimeChannel !== 'function') {
      // Already up, or host has no realtime API (older Delta Chat).
      if (!webxdc.joinRealtimeChannel) {
        console.warn(
          '[webxdc-yjs] joinRealtimeChannel is unavailable — realtime mode cannot live-sync. Use Chat + live.',
        )
      }
      return
    }
    const channel = webxdc.joinRealtimeChannel()
    if (!channel) {
      console.warn('[webxdc-yjs] joinRealtimeChannel() returned no channel')
      return
    }
    realtimeClosed = false
    realtimeChannel = channel
    presence = new PresenceManager(
      webxdc.selfAddr,
      webxdc.selfName,
      (data) => {
        if (!realtimeClosed) {
          try {
            channel.send(data)
          } catch (error) {
            console.warn('[webxdc-yjs] presence send failed', error)
          }
        }
      },
      {
        onPeerJoined: () => {
          // Late joiners: offer our state vector + pending live updates.
          shareStateWithRealtimePeers()
        },
        onMode: (mode) => {
          // Peer advertised mode over realtime (no chat). Adopt if we're still flexible.
          if (!isCollabSyncMode(mode)) return
          if (mode === currentSyncMode) return
          // Don't yank local-only users into shared modes automatically.
          if (currentSyncMode === 'local') return
          setSyncMode(mode, { publish: false })
        },
      },
    )
    // So join/mode? replies include our transport without chat traffic.
    presence.setCollabMode(currentSyncMode)
    channel.setListener((data: Uint8Array) => {
      if (!(data instanceof Uint8Array) || data.byteLength === 0) return
      if (presence?.handleMessage(data)) return
      try {
        const reply = processSyncMessage(doc, data, REALTIME_ORIGIN)
        if (reply && !realtimeClosed) {
          channel.send(reply)
        }
      } catch (error) {
        console.warn('[webxdc-yjs] failed to process realtime sync message', error)
      }
    })
    // Immediate handshake + short retries (covers peers still connecting).
    sendSyncStep1()
    flushRealtime()
    window.setTimeout(shareStateWithRealtimePeers, 80)
    syncRetryTimer = window.setTimeout(shareStateWithRealtimePeers, REALTIME_SYNC_RETRY_MS)
    if (syncHeartbeatTimer) clearInterval(syncHeartbeatTimer)
    syncHeartbeatTimer = window.setInterval(() => {
      if (!realtimeOutbound || realtimeClosed) return
      // Light step1 only — peers reply with missing updates if any.
      sendSyncStep1()
    }, REALTIME_SYNC_HEARTBEAT_MS)
  }

  const applyTransportForMode = (mode: CollabSyncMode) => {
    // Chat mode: durable batched chat saves + live realtime while peers are open.
    // Realtime mode: live channel only (nothing written to chat history).
    // Local mode: neither.
    chatOutbound = mode === 'chat'
    realtimeOutbound = mode === 'chat' || mode === 'realtime'
    chatProvider.setChatOutboundEnabled(chatOutbound)

    if (realtimeOutbound) {
      startRealtime()
    } else {
      stopRealtime()
    }
  }

  const setSyncMode = (mode: CollabSyncMode, opts?: { publish?: boolean }) => {
    if (!isCollabSyncMode(mode)) return
    const publish = opts?.publish !== false
    const changed = mode !== currentSyncMode
    const wasLocal = currentSyncMode === 'local'
    currentSyncMode = mode
    writeCachedCollabMode(mode)
    applyTransportForMode(mode)
    // Advertise over live channel (no email) whenever presence is up.
    presence?.setCollabMode(mode)
    if (publish) {
      // Only "Chat + live" may create a durable chat/email status update.
      // Realtime only / local stay on this device (+ live channel) — no sendUpdate.
      if (mode === 'chat') {
        chatProvider.publishCollabMode(mode)
      } else {
        chatProvider.setCollabModeLocal(mode)
      }
    }
    // Entering or staying in local mode: keep IndexedDB snapshot fresh.
    if (mode === 'local') {
      scheduleLocalIdbSave()
    } else if (wasLocal && localIdbSaveTimer) {
      // Leaving local — flush once so the last local state is kept as a backup.
      flushLocalIdbSave()
    }
    if (changed) {
      for (const handler of syncModeListeners) handler(mode)
    }
  }

  doc.on('updateV2', (update, origin) => {
    // Remote payloads are already on the wire for their respective channels.
    // Chat durable queue is owned by WebxdcProvider (batched autosave only).
    if (origin === REALTIME_ORIGIN || origin === CHAT_ORIGIN || origin === LOCAL_IDB_ORIGIN) {
      // Still persist after remote apply if user is in local-only mode.
      if (currentSyncMode === 'local' && origin !== LOCAL_IDB_ORIGIN) {
        scheduleLocalIdbSave()
      }
      return
    }
    // Local-only: durable save to IndexedDB (no chat / no live channel).
    if (currentSyncMode === 'local') {
      scheduleLocalIdbSave()
      return
    }
    if (!realtimeOutbound) return
    if (!(update instanceof Uint8Array) || update.byteLength === 0) return
    // Instant: every local Yjs change hits the realtime channel in this tick.
    sendRealtimeUpdateNow(update)
  })

  currentSyncMode = await resolveSyncMode(chatProvider, options.requestSyncMode)
  applyTransportForMode(currentSyncMode)

  // Peers can change mode later via silent status updates — adopt without re-publish.
  chatProvider.on('mode', (mode) => {
    if (!isCollabSyncMode(mode) || mode === currentSyncMode) return
    setSyncMode(mode, { publish: false })
  })

  // Apply any chat history we already received (always applied inbound).
  migrateLegacyContentIfNeeded(doc, LOCAL_ORIGIN)
  refreshFromY()

  // Local mode: hydrate from IndexedDB before seeding an empty workspace.
  if (currentSyncMode === 'local' && !hasYDocumentContent(doc)) {
    try {
      const saved = await loadLocalYjsState(localIdbKey)
      if (saved && saved.byteLength > 0) {
        suppressObserveEmit = true
        Y.applyUpdateV2(doc, saved, LOCAL_IDB_ORIGIN)
        migrateLegacyContentIfNeeded(doc, LOCAL_ORIGIN)
        refreshFromY()
        suppressObserveEmit = false
      }
    } catch (error) {
      console.warn('[webxdc-yjs] failed to load local IndexedDB snapshot', error)
      suppressObserveEmit = false
    }
  }

  // Wait for peer content when a transport can deliver it.
  if (chatOutbound || realtimeOutbound) {
    await waitForYDocumentContent(doc, INIT_WAIT_MS, REMOTE_ORIGINS)
    migrateLegacyContentIfNeeded(doc, LOCAL_ORIGIN)
    refreshFromY()
  }

  if (!hasYDocumentContent(doc)) {
    const canBootstrap =
      currentSyncMode === 'local' || webxdc.isAppSender || !chatOutbound
    if (canBootstrap) {
      // Prefer document-bootstrap.json when the package was exported with seed
      // data (Export WebXDC / share as .xdc). Applies in every mode — including
      // local — but only when Y is still empty (and local IDB had nothing).
      // Subsequent opens keep IDB / chat history and skip this path.
      const bootstrap = await fetchBootstrapDocument()
      const seed = ensureUsableDocument(bootstrap ?? createEmptyDocument())
      suppressObserveEmit = true
      syncDocumentToY(doc, { version: 2, pages: {} }, seed, LOCAL_ORIGIN)
      refreshFromY()
      suppressObserveEmit = false
      if (currentSyncMode === 'local') scheduleLocalIdbSave()
    } else {
      // Give the app sender a bit longer to publish the initial document.
      await waitForYDocumentContent(doc, INIT_WAIT_EXTRA_MS, REMOTE_ORIGINS)
      refreshFromY()
      if (!hasYDocumentContent(doc)) {
        // Offline non-sender edge case — try package seed, else empty workspace.
        const bootstrap = await fetchBootstrapDocument()
        const seed = ensureUsableDocument(bootstrap ?? createEmptyDocument())
        suppressObserveEmit = true
        syncDocumentToY(doc, { version: 2, pages: {} }, seed, LOCAL_ORIGIN)
        refreshFromY()
        suppressObserveEmit = false
      }
    }
  } else if (currentSyncMode === 'local') {
    // Loaded from IDB or residual state — keep snapshot warm.
    scheduleLocalIdbSave()
  }

  // If pages map is still empty (should not happen), keep an empty in-memory doc
  // rather than inventing conflicting random root IDs into Y.
  if (Object.keys(collabDoc.pages).length === 0 && hasYDocumentContent(doc)) {
    refreshFromY()
  }

  yPages.observeDeep(() => {
    // Local writes set suppressObserveEmit and already keep collabDoc in sync.
    // Re-parsing every page's blocks here was the main "large workspace is slow"
    // cost (O(all pages × all blocks) on every keystroke autosave).
    if (suppressObserveEmit) return
    refreshFromY()
    emit()
  })

  const ready = Promise.resolve()

  // Build the public session without object-literal getters/setters adjacent
  // to names like `setSyncMode` (some tooling mis-parses `set…` after `get`).
  const session: CollabSession = {
    ready,
    // placeholders replaced via defineProperty below
    syncMode: currentSyncMode,
    presence: null,
    setSyncMode: (mode, options) => {
      setSyncMode(mode, options)
    },
    onSyncModeChange: (handler) => {
      syncModeListeners.add(handler)
      return () => {
        syncModeListeners.delete(handler)
      }
    },
    getDocument: () => collabDoc,
    getRootPageId: () => getRootPageId(collabDoc),
    getBlocks: (pageId) => getPageBlocks(collabDoc, pageId),
    getPages: () => listPages(collabDoc),
    pushBlocks: (pageId, blocks, _onlyIds) => {
      // Realtime / chat+live: full live write so peers see body instantly.
      if (currentSyncMode === 'realtime' || currentSyncMode === 'chat') {
        pushBlocksLive(pageId, blocks)
        return
      }
      // Local-only: cheaper path.
      if (pushBlocksFast(pageId, blocks)) return
      applyMutation((current) => {
        if (!current.pages[pageId]) return current
        let next = setPageBlocks(current, pageId, cloneBlocks(blocks))
        next = syncPageParentsFromBlocks(next, pageId)
        return next
      }, { silent: true })
    },
    createPage: (title = '', parentId?: string, insertAfterPageId?: string) => {
      let created: PageMeta = { id: '', title: title.trim() || 'Untitled' }
      applyMutation((current) => {
        const base = Object.keys(current.pages).length > 0 ? current : createEmptyDocument()
        const result = createPage(base, title, parentId, insertAfterPageId)
        created = {
          id: result.page.id,
          title: result.page.title.trim() || 'Untitled',
          icon: result.page.icon,
          parentId: result.page.parentId,
        }
        return result.doc
      })
      return created
    },
    importPagesBatch: (items, options) => {
      const created: PageMeta[] = []
      const idMap = new Map<string, string>()
      if (!items.length) return { created, idMap }

      const defaultParent = options?.defaultParentId

      applyMutation((current) => {
        let next = Object.keys(current.pages).length > 0 ? current : createEmptyDocument()

        // Pass 1: create empty shells so parent keys resolve for nested imports.
        for (const item of items) {
          const parentId =
            (item.parentKey && idMap.get(item.parentKey))
            || item.parentId
            || defaultParent
          const result = createPage(next, item.title, parentId)
          next = result.doc
          if (item.key) idMap.set(item.key, result.page.id)
          created.push({
            id: result.page.id,
            title: result.page.title.trim() || 'Untitled',
            icon: result.page.icon,
            parentId: result.page.parentId,
          })
        }

        // Pass 2: bodies + meta (remap page links using idMap).
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!
          const pageId = created[i]?.id
          if (!pageId) continue
          let page = next.pages[pageId]
          if (!page) continue

          if (item.blocks?.length) {
            next = setPageBlocks(next, pageId, item.blocks)
            page = next.pages[pageId] ?? page
          }
          if (item.icon) {
            next = setPageIcon(next, pageId, item.icon)
            page = next.pages[pageId] ?? page
          }
          if (item.cover) {
            next = setPageCover(next, pageId, item.cover)
            page = next.pages[pageId] ?? page
          }
          if (item.fullWidth) {
            next = setPageFullWidth(next, pageId, true)
            page = next.pages[pageId] ?? page
          }
          created[i] = {
            id: page.id,
            title: page.title.trim() || 'Untitled',
            icon: page.icon,
            parentId: page.parentId,
          }
        }

        return next
      })

      return { created, idMap }
    },
    deletePage: (pageId) => {
      let fallback: string | null = null
      applyMutation((current) => {
        const result = deletePage(current, pageId)
        if (!result) return current
        fallback = result.fallbackPageId
        return result.doc
      })
      return fallback
    },
    setPageParent: (pageId, parentId) => {
      applyMutation((current) => setPageParent(current, pageId, parentId))
    },
    movePage: (pageId, parentId, insertBeforePageId) => {
      applyMutation((current) => movePage(current, pageId, parentId, insertBeforePageId))
    },
    setPageTitle: (pageId, title) => {
      applyMutation((current) => setPageTitle(current, pageId, title))
    },
    setPageIcon: (pageId, icon) => {
      applyMutation((current) => setPageIcon(current, pageId, icon))
    },
    setPageCover: (pageId, cover) => {
      applyMutation((current) => setPageCover(current, pageId, cover))
    },
    setPageFullWidth: (pageId, fullWidth) => {
      applyMutation((current) => setPageFullWidth(current, pageId, fullWidth))
    },
    getComments: (pageId) => getPageComments(collabDoc, pageId),
    addComment: (pageId, payload) => {
      let comment: PageComment = {
        id: '',
        blockId: payload.blockId,
        start: payload.start,
        end: payload.end,
        quote: payload.quote,
        messages: [],
        createdAt: Date.now(),
      }
      applyMutation((current) => {
        const result = addPageComment(current, pageId, {
          ...payload,
          author: webxdc.selfName,
        })
        comment = result.comment
        return result.doc
      })
      // Live peers get the Y update on the realtime channel immediately.
      // Chat durable flush is deferred to notifyComment (or autosave) so the
      // peer notification can ride on the same status update — avoids a second
      // full-document re-encode that used to thrash the UI ("reload hell").
      if (realtimeOutbound) flushRealtime()
      return comment
    },
    addCommentReply: (pageId, commentId, text) => {
      applyMutation((current) => addCommentReply(current, pageId, commentId, webxdc.selfName, text))
      if (realtimeOutbound) flushRealtime()
      // Same as addComment: durable chat flush happens in notifyComment / autosave.
    },
    notifyComment: (message) => {
      // Notify only works over chat status updates; skip in realtime/local.
      if (!chatOutbound) return
      // "*" notifies every peer whose addr is not listed — sender is not notified.
      chatProvider.queuePeerNotify(message)
      // Single flush: queued Yjs comment delta + notify in one status update.
      chatProvider.syncToChatPeers()
    },
    onDocumentChange: (handler) => {
      listeners.add(handler)
    },
    onBlocksChange: (handler) => {
      listeners.add(handler)
    },
    flush: () => {
      if (realtimeOutbound) {
        flushRealtime()
        sendSyncStep1()
      }
      if (chatOutbound) chatProvider.syncToChatPeers()
      if (currentSyncMode === 'local') flushLocalIdbSave()
    },
    destroy: () => {
      if (syncRetryTimer) clearTimeout(syncRetryTimer)
      if (syncHeartbeatTimer) clearInterval(syncHeartbeatTimer)
      if (localIdbSaveTimer) clearTimeout(localIdbSaveTimer)
      // Best-effort durable snapshot before teardown (local mode).
      if (currentSyncMode === 'local') flushLocalIdbSave()
      stopRealtime()
      chatProvider.destroy()
      syncModeListeners.clear()
      listeners.clear()
      doc.destroy()
    },
  }

  Object.defineProperty(session, 'syncMode', {
    enumerable: true,
    configurable: true,
    get: () => currentSyncMode,
  })
  Object.defineProperty(session, 'presence', {
    enumerable: true,
    configurable: true,
    get: () => presence,
  })

  return session
}
