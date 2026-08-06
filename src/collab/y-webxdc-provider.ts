import type { ReceivedStatusUpdate, SendingStatusUpdate, Webxdc } from '@webxdc/types'
import { fromUint8Array, toUint8Array } from 'js-base64'
import { applyUpdateV2, encodeStateAsUpdateV2, mergeUpdatesV2, type Doc } from 'yjs'
import {
  COLLAB_MODE_PAYLOAD_KEY,
  extractCollabModeFromPayload,
  isCollabSyncMode,
  type CollabSyncMode,
} from './sync-mode'
import { clearMockXdcUpdates, maybeCompactMockXdcUpdates } from './webxdc-storage'

export const CHAT_ORIGIN = 'webxdc-chat'

export type YjsPayload = {
  serializedYjsUpdate?: string
  collabMode?: CollabSyncMode
}

type WebxdcBridge = Pick<Webxdc<YjsPayload>, 'setUpdateListener' | 'sendUpdate'> & {
  selfAddr?: string
}

type WebxdcProviderOptions = {
  webxdc: WebxdcBridge
  ydoc: Doc
  getEditInfo: () => { document: string; summary: string; startinfo: string }
  autosaveInterval: number
  resendAllUpdates?: boolean
  /**
   * When false, do not queue/send Yjs updates over chat (still apply inbound
   * and track collabMode). Default true until session settles on a mode.
   */
  chatOutboundEnabled?: boolean
}

/** Yjs chat sync — uses sendUpdate without the deprecated description text. */
export default class WebxdcProvider {
  webxdc: WebxdcBridge
  ydoc: Doc
  getEditInfo: () => { document: string; summary: string; startinfo: string }
  resendAllUpdates: boolean
  queuedYjsUpdates: Uint8Array[] = []
  everNotifiedPeersAboutEdits = false
  autosaveLoop: ReturnType<typeof setInterval>
  /** Resolves after historical chat updates have been applied. */
  readonly ready: Promise<void>
  private eventHandlers: {
    sync: Array<(event: { hasQueued: boolean }) => void>
    mode: Array<(mode: CollabSyncMode) => void>
  }
  private destroyed = false
  /** Optional one-shot peer notification (webxdc `notify`) for the next flush. */
  private pendingNotify: Record<string, string> | null = null
  private pendingInfo: string | null = null
  /** Chat-wide sync mode from status history (last write wins). */
  private collabMode: CollabSyncMode | null = null
  private chatOutboundEnabled: boolean
  private modePublished = false
  /** True while sendUpdate runs (mock echoes listener synchronously). */
  private sendingOutbound = false

  constructor({
    webxdc,
    ydoc,
    getEditInfo,
    autosaveInterval,
    resendAllUpdates,
    chatOutboundEnabled,
  }: WebxdcProviderOptions) {
    this.webxdc = webxdc
    this.ydoc = ydoc
    this.getEditInfo = getEditInfo
    this.resendAllUpdates = resendAllUpdates ?? false
    this.chatOutboundEnabled = chatOutboundEnabled ?? true
    this.eventHandlers = { sync: [], mode: [] }

    this.ready = Promise.resolve(
      webxdc.setUpdateListener((update) => this.receiveWebxdcUpdateFromChatPeers(update)),
    ).then(() => undefined)

    ydoc.on('updateV2', (yjsupdate, origin) => this.receiveYjsUpdate(yjsupdate, origin))
    registerExitHandlerForWebxdcWindow(() => this.syncToChatPeers())
    this.autosaveLoop = setInterval(() => this.syncToChatPeers(), autosaveInterval)
  }

  getCollabMode(): CollabSyncMode | null {
    return this.collabMode
  }

  /**
   * Remember mode locally without a chat status update.
   * Use for realtime/local — those must not create email/chat traffic.
   */
  setCollabModeLocal(mode: CollabSyncMode): void {
    if (!isCollabSyncMode(mode) || this.destroyed) return
    this.collabMode = mode
    // Not published to chat history.
    this.modePublished = false
  }

  setChatOutboundEnabled(enabled: boolean): void {
    this.chatOutboundEnabled = enabled
    if (!enabled) {
      this.queuedYjsUpdates.length = 0
    }
  }

  on(name: 'sync', handler: (event: { hasQueued: boolean }) => void): void
  on(name: 'mode', handler: (mode: CollabSyncMode) => void): void
  on(
    name: 'sync' | 'mode',
    handler: ((event: { hasQueued: boolean }) => void) | ((mode: CollabSyncMode) => void),
  ): void {
    if (name === 'sync') {
      this.eventHandlers.sync.push(handler as (event: { hasQueued: boolean }) => void)
      return
    }
    this.eventHandlers.mode.push(handler as (mode: CollabSyncMode) => void)
  }

  /**
   * Queue a user-visible notification for peers on the next sendUpdate.
   * Use `notify: { "*": "text" }` so every peer except addresses listed by key
   * receives it — the sender does not get a self-notification.
   */
  queuePeerNotify(message: string): void {
    const text = message.trim()
    if (!text) return
    this.pendingNotify = { '*': text }
  }

  /** Optional chat info line for the next flush (use sparingly). */
  queueInfo(message: string): void {
    const text = message.trim()
    if (!text) return
    this.pendingInfo = text
  }

  /**
   * Publish mode via durable chat status (only for **chat** transport).
   * Realtime/local must use `setCollabModeLocal` — never call this for those,
   * or Delta Chat will show an email/status update to other clients.
   */
  publishCollabMode(mode: CollabSyncMode): void {
    if (!isCollabSyncMode(mode) || this.destroyed) return
    // Safety: never write realtime/local into chat history as a status update.
    if (mode !== 'chat') {
      this.setCollabModeLocal(mode)
      return
    }
    this.collabMode = mode
    this.modePublished = true
    const payload: YjsPayload = { [COLLAB_MODE_PAYLOAD_KEY]: mode }
    const update: SendingStatusUpdate<YjsPayload> = {
      payload,
      // Keep document label consistent; no summary/info/notify spam.
      document: 'XEditor',
      summary: 'XEditor',
    }
    this.sendStatusUpdateSafe(update, { allowFullSnapshotRetry: false })
    for (const handler of this.eventHandlers.mode) handler(mode)
  }

  syncToChatPeers(): void {
    if (this.destroyed || !this.chatOutboundEnabled) return
    if (this.queuedYjsUpdates.length <= 0 && !this.pendingNotify && !this.pendingInfo) return

    const { document, summary, startinfo } = this.getEditInfo()
    const hasQueuedYjs = this.queuedYjsUpdates.length > 0

    // Only attach a Yjs payload when we actually have local edits queued.
    // Previously, notify/info-only flushes re-encoded the *entire* document
    // (`encodeStateAsUpdateV2`), which peers (and the mock host) re-applied —
    // that felt like "reload hell" every time a comment was sent.
    const payload: YjsPayload = {}
    if (hasQueuedYjs) {
      const mergedYjsUpdate = this.resendAllUpdates
        ? encodeStateAsUpdateV2(this.ydoc)
        : mergeUpdatesV2(this.queuedYjsUpdates)
      payload.serializedYjsUpdate = fromUint8Array(mergedYjsUpdate)
    }

    // Re-assert mode on durable flushes so late joiners always see it.
    if (this.collabMode) {
      payload[COLLAB_MODE_PAYLOAD_KEY] = this.collabMode
    }

    const update: SendingStatusUpdate<YjsPayload> = { payload, document, summary }

    // Snapshot notify/info so a failed send can retry without losing them.
    const pendingInfo = this.pendingInfo
    const pendingNotify = this.pendingNotify

    if (pendingInfo) {
      update.info = pendingInfo
    } else if (
      hasQueuedYjs
      && !this.everNotifiedPeersAboutEdits
      && (this.collabMode || this.modePublished)
    ) {
      // Optional join/info line only when settings provide startinfo.
      // Always mark handled so we don't spam later if the setting is toggled on.
      // Document payload still syncs either way.
      if (startinfo) {
        update.info = startinfo
      }
    }

    if (pendingNotify) {
      update.notify = pendingNotify
    }

    // description param is deprecated — pass empty string per webxdc spec
    if (!this.sendStatusUpdateSafe(update, { allowFullSnapshotRetry: hasQueuedYjs })) {
      // Keep queue for a later attempt if nothing could be written.
      return
    }

    // Commit side effects only after a successful send.
    if (pendingInfo) this.pendingInfo = null
    if (pendingNotify) this.pendingNotify = null
    if (
      hasQueuedYjs
      && !this.everNotifiedPeersAboutEdits
      && (this.collabMode || this.modePublished)
    ) {
      this.everNotifiedPeersAboutEdits = true
    }
    this.queuedYjsUpdates.length = 0
    this.eventHandlers.sync.forEach((func) => func({ hasQueued: false }))
  }

  /**
   * sendUpdate with recovery for storage failures.
   * Dev mock persists history in IndexedDB (not localStorage). On failure we
   * clear mock history and optionally retry a full Yjs snapshot once.
   */
  private sendStatusUpdateSafe(
    update: SendingStatusUpdate<YjsPayload>,
    options: { allowFullSnapshotRetry: boolean },
  ): boolean {
    maybeCompactMockXdcUpdates()

    const trySend = (u: SendingStatusUpdate<YjsPayload>): boolean => {
      this.sendingOutbound = true
      try {
        this.webxdc.sendUpdate(u, '')
        return true
      } catch (error) {
        console.warn('[webxdc-yjs] sendUpdate failed', error)
        return false
      } finally {
        // Keep the flag through the synchronous mock listener; clear after.
        queueMicrotask(() => {
          this.sendingOutbound = false
        })
      }
    }

    if (trySend(update)) return true

    // Storage failure: clear mock IndexedDB history and retry.
    void clearMockXdcUpdates()
    if (trySend(update)) return true

    if (options.allowFullSnapshotRetry) {
      const snapshot: SendingStatusUpdate<YjsPayload> = {
        payload: {
          serializedYjsUpdate: fromUint8Array(encodeStateAsUpdateV2(this.ydoc)),
          ...(this.collabMode ? { [COLLAB_MODE_PAYLOAD_KEY]: this.collabMode } : {}),
        },
        document: update.document,
        summary: update.summary,
      }
      void clearMockXdcUpdates()
      if (trySend(snapshot)) {
        console.warn(
          '[webxdc-yjs] storage error; cleared mock history and sent a full snapshot.',
        )
        return true
      }
    }

    if (update.notify || update.info) {
      const light: SendingStatusUpdate<YjsPayload> = {
        payload: this.collabMode ? { [COLLAB_MODE_PAYLOAD_KEY]: this.collabMode } : {},
        document: update.document,
        summary: update.summary,
        info: update.info,
        notify: update.notify,
      }
      if (trySend(light)) {
        console.warn('[webxdc-yjs] document update failed; sent notify/info only.')
        this.queuedYjsUpdates.length = 0
        return true
      }
    }

    console.error(
      '[webxdc-yjs] could not store chat update. In dev, try: await window.webxdc.__clearMockUpdates()',
    )
    this.queuedYjsUpdates.length = 0
    this.eventHandlers.sync.forEach((func) => func({ hasQueued: false }))
    return false
  }

  receiveWebxdcUpdateFromChatPeers(
    update: ReceivedStatusUpdate<YjsPayload> & { _sender?: string },
  ): void {
    const payload = update.payload
    const mode = extractCollabModeFromPayload(payload)
    if (mode && mode !== this.collabMode) {
      this.collabMode = mode
      for (const handler of this.eventHandlers.mode) handler(mode)
    }

    // Own sendUpdate is echoed back by the host. Re-applying that Yjs payload
    // re-walks the whole document and was a major lag source on large workspaces.
    const selfAddr = this.webxdc.selfAddr
    const sender =
      typeof update._sender === 'string'
        ? update._sender
        : (update as { from?: string }).from
    if (this.sendingOutbound || (selfAddr && sender && sender === selfAddr)) {
      return
    }

    const serialized = payload?.serializedYjsUpdate
    if (!serialized) return
    try {
      applyUpdateV2(this.ydoc, toUint8Array(serialized), CHAT_ORIGIN)
    } catch (error) {
      console.warn('[webxdc-yjs] failed to apply chat update', error)
    }
  }

  receiveYjsUpdate(yjsUpdate: Uint8Array, origin: unknown): void {
    // Remote updates are already on the wire / durable — only queue local edits.
    // Chat is a batched save channel, not a live fan-out for realtime traffic.
    if (origin === CHAT_ORIGIN || origin === 'webxdc-realtime') return
    if (!this.chatOutboundEnabled) return
    this.queuedYjsUpdates.push(yjsUpdate)
    this.eventHandlers.sync.forEach((func) => func({ hasQueued: true }))
  }

  destroy(): void {
    this.destroyed = true
    clearInterval(this.autosaveLoop)
    this.queuedYjsUpdates.length = 0
    this.pendingNotify = null
    this.pendingInfo = null
    this.eventHandlers.sync.length = 0
    this.eventHandlers.mode.length = 0
  }
}

function registerExitHandlerForWebxdcWindow(finalize: () => void): void {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    finalize()
  })

  window.addEventListener('beforeunload', sendUpdatesBeforeUnload)

  function sendUpdatesBeforeUnload(beforeUnloadEvent: BeforeUnloadEvent): string | void {
    window.removeEventListener('beforeunload', sendUpdatesBeforeUnload)
    finalize()
    setTimeout(() => {
      try {
        window.parent.close()
      } catch {
        window.close()
      }
    }, 100)

    beforeUnloadEvent.preventDefault()
    beforeUnloadEvent.returnValue = ''
    return ''
  }
}
