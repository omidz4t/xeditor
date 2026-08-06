import { pickUserColor } from './user-colors'
import { isCollabSyncMode, type CollabSyncMode } from './sync-mode'

/** ~60fps pointer stream for solid desktop cursor motion. */
const POINTER_SEND_MS = 16
const STALE_MS = 12_000
/** Keep last cursor visible while peer is still in the session. */
const POINTER_STALE_MS = 30_000
const TOUCH_STALE_MS = 2_000
const STALE_CHECK_MS = 1_000
const EDIT_STALE_MS = 12_000

export type PointerButton = 'down' | 'up'
export type PointerMode = 'pointer' | 'caret'

export type PeerPointer = {
  x: number
  y: number
  button: PointerButton
  /** mouse arrow vs text caret */
  mode: PointerMode
  /** caret line height in px (mode === 'caret') */
  height?: number
  /**
   * Block this caret belongs to. When set with relative offsets, receivers can
   * re-anchor the caret after inserts/deletes above the block.
   */
  blockId?: string
  /** Caret x relative to the block’s top-left (page-local px). */
  relX?: number
  /** Caret y relative to the block’s top-left (page-local px). */
  relY?: number
}

export type PeerPresence = {
  addr: string
  name: string
  color: string
  colorLight: string
  pageId?: string
  /** Block the peer is currently editing (soft lock). */
  editingBlockId?: string
  editingUpdatedAt?: number
  pointer?: PeerPointer
  pointerUpdatedAt?: number
  lastSeen: number
}

export type PointerUpdateOptions = {
  immediate?: boolean
  mode?: PointerMode
  height?: number
  /** Block the caret is inside (for re-anchoring after layout shifts). */
  blockId?: string
  /** Caret offset from that block’s top-left. */
  relX?: number
  relY?: number
}

/** Ephemeral live reaction — never persisted, only realtime presence. */
export type LiveReaction = {
  id: string
  addr: string
  name: string
  color: string
  emoji: string
  /** Page-local coords (same space as peer cursors / editor anchor). */
  x: number
  y: number
  pageId: string
  at: number
}

/** One-shot “follow me” invite — ephemeral, not stored. */
export type FollowInvite = {
  id: string
  addr: string
  name: string
  color: string
  /** Inviter’s page when they sent the invite (optional navigation target). */
  pageId?: string
  at: number
}

export interface PresenceHandle {
  onPeersChanged: (handler: (peers: PeerPresence[]) => void) => () => void
  onReaction: (handler: (reaction: LiveReaction) => void) => () => void
  onFollowInvite: (handler: (invite: FollowInvite) => void) => () => void
  updatePointer: (
    x: number,
    y: number,
    button?: PointerButton,
    options?: PointerUpdateOptions,
  ) => void
  updatePage: (pageId: string) => void
  updateEditingBlock: (blockId: string | null) => void
  /**
   * Broadcast a one-shot reaction at page-local coords. Not saved anywhere —
   * peers only see it while connected via the realtime channel.
   */
  sendReaction: (emoji: string, x: number, y: number) => void
  /**
   * Ask peers to follow this user (viewport). Ephemeral realtime only.
   */
  sendFollowInvite: () => void
}

/** Realtime cursor message — `tl` selects mouse vs caret rendering. */
type PosMessage = {
  t: 'pos'
  a: string
  n: string
  c: string
  cl: string
  x: number
  y: number
  b: PointerButton
  tl: PointerMode
  /** caret height */
  h?: number
  /** Page the pointer belongs to (only render for peers on this page). */
  p?: string
  /** Block id the caret is anchored to (layout-stable). */
  bk?: string
  /** Caret x relative to that block. */
  rx?: number
  /** Caret y relative to that block. */
  ry?: number
}

type JoinMessage = {
  t: 'join'
  a: string
  n: string
  c: string
  cl: string
  /** Shared collab mode (ephemeral — not a chat status update). */
  m?: CollabSyncMode
}

/** Advertise collab transport over realtime (no chat/email). */
type ModeMessage = {
  t: 'mode'
  a: string
  m: CollabSyncMode
  n?: string
  c?: string
  cl?: string
}

/** Ask open peers to re-announce their collab mode. */
type ModeQueryMessage = {
  t: 'mode?'
  a: string
  n?: string
  c?: string
  cl?: string
}

type PageMessage = {
  t: 'page'
  a: string
  n: string
  c: string
  cl: string
  p: string
}

/** Soft lock: which block a peer is currently editing. */
type EditMessage = {
  t: 'edit'
  a: string
  n: string
  c: string
  cl: string
  /** Empty string clears the lock. */
  b: string
  p?: string
}

/**
 * One-shot live reaction (emoji burst). Ephemeral — not stored in Yjs/chat.
 * Short key names keep realtime payloads small.
 */
type ReactionMessage = {
  t: 'rx'
  a: string
  n: string
  c: string
  cl: string
  /** emoji */
  e: string
  x: number
  y: number
  /** page id */
  p: string
  /** optional client nonce for de-dupe */
  i?: string
}

/**
 * One-shot “please follow me” invite. Ephemeral — not stored in Yjs/chat.
 */
type FollowInviteMessage = {
  t: 'fi'
  a: string
  n: string
  c: string
  cl: string
  /** inviter page id (optional) */
  p?: string
  /** optional client nonce for de-dupe */
  i?: string
}

type PresenceMessage =
  | PosMessage
  | JoinMessage
  | PageMessage
  | EditMessage
  | ReactionMessage
  | FollowInviteMessage
  | ModeMessage
  | ModeQueryMessage

/** Legacy caret position message (pre-Excalidraw cursor format). */
type LegacyCaretMessage = {
  t: 'car'
  a: string
  n?: string
  c?: string
  cl?: string
  x: number
  y: number
  h?: number
}

const encoder = new TextEncoder()

export class PresenceManager {
  private peers = new Map<string, PeerPresence>()
  private listeners = new Set<(peers: PeerPresence[]) => void>()
  private reactionListeners = new Set<(reaction: LiveReaction) => void>()
  private followInviteListeners = new Set<(invite: FollowInvite) => void>()
  private pendingPos: Omit<PosMessage, 't'> | null = null
  private lastSentPosKey = ''
  private currentPageId: string | null = null
  private currentEditingBlockId: string | null = null
  private pointerTimer: ReturnType<typeof setInterval> | null = null
  private staleTimer: ReturnType<typeof setInterval> | null = null
  private reactionSeq = 0
  private followInviteSeq = 0
  private readonly selfColors: ReturnType<typeof pickUserColor>

  /** Local collab transport — advertised on join so late peers skip setup UI. */
  private collabMode: CollabSyncMode | null = null

  constructor(
    private readonly selfAddr: string,
    private readonly selfName: string,
    private readonly send: (data: Uint8Array) => void,
    private readonly options?: {
      /** Fired when a peer announces join on the realtime channel. */
      onPeerJoined?: (addr: string) => void
      /** Fired when a peer advertises collab mode over realtime (no chat). */
      onMode?: (mode: CollabSyncMode) => void
    },
  ) {
    this.selfColors = pickUserColor(this.selfAddr)
    this.pointerTimer = setInterval(() => this.flushPointer(), POINTER_SEND_MS)
    this.staleTimer = setInterval(() => {
      this.clearStalePointers()
      this.clearStaleEdits()
      this.removeStalePeers()
    }, STALE_CHECK_MS)
    this.announceJoin()
  }

  /** Keep mode in join/mode broadcasts (realtime-only peers never use chat for this). */
  setCollabMode(mode: CollabSyncMode | null) {
    this.collabMode = mode && isCollabSyncMode(mode) ? mode : null
    this.announceMode()
  }

  getPeers(): PeerPresence[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  onPeersChanged(handler: (peers: PeerPresence[]) => void) {
    this.listeners.add(handler)
    handler(this.getPeers())
    return () => this.listeners.delete(handler)
  }

  onReaction(handler: (reaction: LiveReaction) => void) {
    this.reactionListeners.add(handler)
    return () => this.reactionListeners.delete(handler)
  }

  onFollowInvite(handler: (invite: FollowInvite) => void) {
    this.followInviteListeners.add(handler)
    return () => this.followInviteListeners.delete(handler)
  }

  /**
   * Fire-and-forget reaction. Broadcast on the realtime channel only —
   * nothing is written to Yjs or durable storage.
   */
  sendReaction(emoji: string, x: number, y: number) {
    const e = (emoji || '').trim()
    if (!e || !this.currentPageId) return
    if (!Number.isFinite(x) || !Number.isFinite(y)) return

    this.reactionSeq += 1
    const id = `${this.selfAddr}-${Date.now()}-${this.reactionSeq}`
    const msg: ReactionMessage = {
      t: 'rx',
      a: this.selfAddr,
      n: this.selfName,
      c: this.selfColors.color,
      cl: this.selfColors.light,
      e: e.slice(0, 16),
      x,
      y,
      p: this.currentPageId,
      i: id,
    }
    this.sendJson(msg)
    // Echo locally so the sender sees their own burst immediately.
    this.emitReaction({
      id,
      addr: this.selfAddr,
      name: this.selfName,
      color: this.selfColors.color,
      emoji: msg.e,
      x,
      y,
      pageId: this.currentPageId,
      at: Date.now(),
    })
  }

  /**
   * Broadcast a “please follow me” invite on the realtime channel only.
   * Not echoed locally — the sender already knows they invited others.
   */
  sendFollowInvite() {
    this.followInviteSeq += 1
    const id = `${this.selfAddr}-fi-${Date.now()}-${this.followInviteSeq}`
    const msg: FollowInviteMessage = {
      t: 'fi',
      a: this.selfAddr,
      n: this.selfName,
      c: this.selfColors.color,
      cl: this.selfColors.light,
      p: this.currentPageId ?? undefined,
      i: id,
    }
    this.sendJson(msg)
  }

  updatePointer(
    x: number,
    y: number,
    button: PointerButton = 'up',
    options?: PointerUpdateOptions,
  ) {
    // Never broadcast a cursor without knowing which page it belongs to —
    // receivers must filter by page so remote cursors stay page-local.
    if (!this.currentPageId) {
      return
    }

    const mode: PointerMode = options?.mode === 'caret' ? 'caret' : 'pointer'
    const blockId = options?.blockId || this.currentEditingBlockId || undefined
    const hasRel =
      typeof options?.relX === 'number'
      && Number.isFinite(options.relX)
      && typeof options?.relY === 'number'
      && Number.isFinite(options.relY)
    this.pendingPos = {
      a: this.selfAddr,
      n: this.selfName,
      c: this.selfColors.color,
      cl: this.selfColors.light,
      x,
      y,
      b: button,
      tl: mode,
      h: mode === 'caret' ? (options?.height ?? 18) : undefined,
      p: this.currentPageId,
      bk: mode === 'caret' && blockId ? blockId : undefined,
      rx: mode === 'caret' && blockId && hasRel ? options!.relX : undefined,
      ry: mode === 'caret' && blockId && hasRel ? options!.relY : undefined,
    }
    if (options?.immediate) this.flushPointer(true)
  }

  updatePage(pageId: string) {
    if (!pageId) {
      return
    }

    if (pageId === this.currentPageId) {
      return
    }

    this.currentPageId = pageId
    // Changing pages clears the block lock and any queued pointer from the
    // previous page (coords are page-local and must not leak across pages).
    this.currentEditingBlockId = null
    this.pendingPos = null
    this.lastSentPosKey = ''
    this.sendJson({
      t: 'page',
      a: this.selfAddr,
      n: this.selfName,
      c: this.selfColors.color,
      cl: this.selfColors.light,
      p: pageId,
    })
    this.announceEditingBlock()
  }

  updateEditingBlock(blockId: string | null) {
    const next = blockId || null
    if (next === this.currentEditingBlockId) {
      return
    }

    this.currentEditingBlockId = next
    this.announceEditingBlock()
  }

  handleMessage(data: Uint8Array): boolean {
    if (data[0] !== 0x7b) return false

    let msg: (PresenceMessage | LegacyCaretMessage) & { t?: string; h?: number }
    try {
      msg = JSON.parse(new TextDecoder().decode(data))
    } catch {
      return true
    }

    if (!msg?.t || !('a' in msg) || !msg.a || msg.a === this.selfAddr) {
      return true
    }

    const colors = pickUserColor(msg.a)
    const anyMsg = msg as { n?: string; c?: string; cl?: string; a: string }
    const peer: PeerPresence = this.peers.get(msg.a) ?? {
      addr: msg.a,
      name: anyMsg.n || msg.a,
      color: anyMsg.c || colors.color,
      colorLight: anyMsg.cl || colors.light,
      lastSeen: Date.now(),
    }

    peer.name = anyMsg.n || peer.name
    peer.color = anyMsg.c || peer.color
    peer.colorLight = anyMsg.cl || peer.colorLight
    peer.lastSeen = Date.now()

    if (msg.t === 'pos') {
      const mode: PointerMode = msg.tl === 'caret' ? 'caret' : 'pointer'
      // Prefer page stamped on the pointer message so mid-flight moves after a
      // page change never paint on the wrong page.
      if (typeof msg.p === 'string' && msg.p) {
        peer.pageId = msg.p
      }
      const blockId = typeof msg.bk === 'string' && msg.bk ? msg.bk : undefined
      const relX = typeof msg.rx === 'number' && Number.isFinite(msg.rx) ? msg.rx : undefined
      const relY = typeof msg.ry === 'number' && Number.isFinite(msg.ry) ? msg.ry : undefined
      peer.pointer = {
        x: msg.x,
        y: msg.y,
        button: msg.b === 'down' ? 'down' : 'up',
        mode,
        height: typeof msg.h === 'number' && msg.h > 0 ? msg.h : mode === 'caret' ? 18 : undefined,
        blockId,
        relX,
        relY,
      }
      // Keep soft-lock in sync with caret block when present (handles missed edit msgs).
      if (mode === 'caret' && blockId) {
        peer.editingBlockId = blockId
        peer.editingUpdatedAt = Date.now()
      }
      peer.pointerUpdatedAt = Date.now()
      this.peers.set(msg.a, peer)
      this.emit()
      return true
    }

    // Legacy caret messages — text caret. Ignore unless we already know their page.
    if (msg.t === 'car' && typeof msg.x === 'number' && typeof msg.y === 'number') {
      if (!peer.pageId) {
        peer.lastSeen = Date.now()
        this.peers.set(msg.a, peer)
        this.emit()
        return true
      }
      peer.pointer = {
        x: msg.x,
        y: msg.y,
        button: 'up',
        mode: 'caret',
        height: typeof msg.h === 'number' && msg.h > 0 ? msg.h : 18,
      }
      peer.pointerUpdatedAt = Date.now()
      this.peers.set(msg.a, peer)
      this.emit()
      return true
    }

    if (msg.t === 'page' && typeof msg.p === 'string' && msg.p) {
      const pageChanged = peer.pageId !== msg.p
      peer.pageId = msg.p
      // Page change from peer invalidates their previous block lock on this client.
      peer.editingBlockId = undefined
      peer.editingUpdatedAt = undefined
      // Hide cursor until they move on the new page (coords are page-local).
      if (pageChanged) {
        peer.pointer = undefined
        peer.pointerUpdatedAt = undefined
      }
      this.peers.set(msg.a, peer)
      this.emit()
      return true
    }

    if (msg.t === 'edit') {
      const blockId = typeof msg.b === 'string' ? msg.b : ''
      if (typeof msg.p === 'string' && msg.p) {
        peer.pageId = msg.p
      }
      if (blockId) {
        peer.editingBlockId = blockId
        peer.editingUpdatedAt = Date.now()
      } else {
        peer.editingBlockId = undefined
        peer.editingUpdatedAt = undefined
      }
      this.peers.set(msg.a, peer)
      this.emit()
      return true
    }

    if (msg.t === 'join') {
      const wasKnown = this.peers.has(msg.a)
      this.peers.set(msg.a, peer)
      this.emit()
      this.announceJoin()
      this.announcePage()
      this.announceEditingBlock()
      this.announceMode()
      // Let collab re-share Yjs state when someone joins the live channel.
      if (!wasKnown) {
        this.options?.onPeerJoined?.(msg.a)
      }
      // Adopt peer's advertised mode (realtime path — no chat history).
      if (isCollabSyncMode((msg as JoinMessage).m)) {
        this.options?.onMode?.((msg as JoinMessage).m!)
      }
      return true
    }

    if (msg.t === 'mode') {
      const mode = (msg as ModeMessage).m
      if (isCollabSyncMode(mode)) {
        this.options?.onMode?.(mode)
      }
      return true
    }

    if (msg.t === 'mode?') {
      // Someone is resolving setup — tell them our mode without chat traffic.
      this.announceMode()
      this.announceJoin()
      return true
    }

    // Ephemeral reaction burst — never stored on the peer record.
    if (msg.t === 'rx') {
      const emoji = typeof msg.e === 'string' ? msg.e.trim() : ''
      const pageId = typeof msg.p === 'string' ? msg.p : ''
      if (!emoji || !pageId) return true
      if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return true
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return true

      // Keep peer alive / named without attaching the reaction to durable state.
      if (typeof msg.p === 'string' && msg.p) peer.pageId = msg.p
      this.peers.set(msg.a, peer)
      this.emit()

      this.emitReaction({
        id: typeof msg.i === 'string' && msg.i
          ? msg.i
          : `${msg.a}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        addr: msg.a,
        name: peer.name,
        color: peer.color,
        emoji: emoji.slice(0, 16),
        x: msg.x,
        y: msg.y,
        pageId,
        at: Date.now(),
      })
      return true
    }

    // Ephemeral follow invite — never stored on the peer record.
    if (msg.t === 'fi') {
      if (typeof msg.p === 'string' && msg.p) peer.pageId = msg.p
      this.peers.set(msg.a, peer)
      this.emit()

      this.emitFollowInvite({
        id: typeof msg.i === 'string' && msg.i
          ? msg.i
          : `${msg.a}-fi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        addr: msg.a,
        name: peer.name,
        color: peer.color,
        pageId: typeof msg.p === 'string' && msg.p ? msg.p : peer.pageId,
        at: Date.now(),
      })
      return true
    }

    return true
  }

  destroy() {
    if (this.pointerTimer) clearInterval(this.pointerTimer)
    if (this.staleTimer) clearInterval(this.staleTimer)
    this.currentEditingBlockId = null
    this.announceEditingBlock()
    this.flushPointer(true)
    this.peers.clear()
    this.listeners.clear()
    this.reactionListeners.clear()
    this.followInviteListeners.clear()
  }

  private announceJoin() {
    const msg: JoinMessage = {
      t: 'join',
      a: this.selfAddr,
      n: this.selfName,
      c: this.selfColors.color,
      cl: this.selfColors.light,
    }
    if (this.collabMode) msg.m = this.collabMode
    this.sendJson(msg)
  }

  private announceMode() {
    if (!this.collabMode) return
    const msg: ModeMessage = {
      t: 'mode',
      a: this.selfAddr,
      m: this.collabMode,
    }
    this.sendJson(msg)
  }

  private announcePage() {
    if (!this.currentPageId) {
      return
    }

    this.sendJson({
      t: 'page',
      a: this.selfAddr,
      n: this.selfName,
      c: this.selfColors.color,
      cl: this.selfColors.light,
      p: this.currentPageId,
    })
  }

  private announceEditingBlock() {
    this.sendJson({
      t: 'edit',
      a: this.selfAddr,
      n: this.selfName,
      c: this.selfColors.color,
      cl: this.selfColors.light,
      b: this.currentEditingBlockId ?? '',
      p: this.currentPageId ?? undefined,
    })
  }

  private flushPointer(force = false) {
    if (!this.pendingPos) return

    // Skip identical keep-alives unless forced (still heartbeats every ~250ms).
    const key = `${this.pendingPos.tl}|${this.pendingPos.x.toFixed(1)}|${this.pendingPos.y.toFixed(1)}|${this.pendingPos.b}|${this.pendingPos.h ?? ''}|${this.pendingPos.bk ?? ''}|${this.pendingPos.rx?.toFixed(1) ?? ''}|${this.pendingPos.ry?.toFixed(1) ?? ''}`
    const now = performance.now()
    if (!force && key === this.lastSentPosKey && now - this.lastKeepaliveAt < 250) {
      return
    }

    this.sendJson({ t: 'pos', ...this.pendingPos })
    this.lastSentPosKey = key
    this.lastKeepaliveAt = now
  }

  private lastKeepaliveAt = 0

  private clearStalePointers() {
    const now = Date.now()
    const pointerCutoff = now - POINTER_STALE_MS
    const touchCutoff = now - TOUCH_STALE_MS
    let changed = false

    for (const peer of this.peers.values()) {
      if (!peer.pointer || peer.pointerUpdatedAt == null) continue

      // Only drop the cursor if the peer stopped presence entirely long enough.
      if (peer.pointerUpdatedAt < pointerCutoff && peer.lastSeen < pointerCutoff) {
        peer.pointer = undefined
        peer.pointerUpdatedAt = undefined
        changed = true
        continue
      }

      if (peer.pointer.button === 'down' && peer.pointerUpdatedAt < touchCutoff) {
        peer.pointer = { ...peer.pointer, button: 'up' }
        changed = true
      }
    }

    if (changed) this.emit()
  }

  private clearStaleEdits() {
    const cutoff = Date.now() - EDIT_STALE_MS
    let changed = false

    for (const peer of this.peers.values()) {
      if (!peer.editingBlockId) continue
      if (peer.editingUpdatedAt != null && peer.editingUpdatedAt < cutoff) {
        peer.editingBlockId = undefined
        peer.editingUpdatedAt = undefined
        changed = true
      }
    }

    if (changed) this.emit()
  }

  private removeStalePeers() {
    const cutoff = Date.now() - STALE_MS
    let changed = false
    for (const [addr, peer] of this.peers) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(addr)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  private sendJson(msg: PresenceMessage) {
    this.send(encoder.encode(JSON.stringify(msg)))
  }

  private emit() {
    const peers = this.getPeers()
    for (const handler of this.listeners) {
      handler(peers)
    }
  }

  private emitReaction(reaction: LiveReaction) {
    for (const handler of this.reactionListeners) {
      try {
        handler(reaction)
      } catch {
        // ignore listener errors
      }
    }
  }

  private emitFollowInvite(invite: FollowInvite) {
    for (const handler of this.followInviteListeners) {
      try {
        handler(invite)
      } catch {
        // ignore listener errors
      }
    }
  }
}
