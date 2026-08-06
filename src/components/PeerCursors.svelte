<script lang="ts">
import { getCaretClientRect } from '@xproeditor/core'
import ExcalidrawCursor from './ExcalidrawCursor.svelte'
import type { PeerPresence, PresenceHandle, PointerMode } from '../collab/presence'

let {
  presence,
  anchor,
  currentPageId,
}: {
  presence: PresenceHandle | null
  anchor: HTMLElement | null
  currentPageId?: string
} = $props()



let peers = $state<PeerPresence[]>([])
/** Bumped on scroll/resize so off-screen indicators recompute. */
let layoutVersion = $state(0)

let resizeObserver: ResizeObserver | null = null
let stopPeers: (() => void) | undefined
let caretThrottle = 0
let rafId = 0
let layoutRaf = 0
let pointerDown = false
let lastLocalPointer: { x: number; y: number } | null = null
let sendRaf = 0
let pendingSend: {
  x: number
  y: number
  button: 'down' | 'up'
  mode: PointerMode
  height?: number
  immediate?: boolean
  blockId?: string
  relX?: number
  relY?: number
} | null = null
let mutationObserver: MutationObserver | null = null

const CURSOR_WIDTH = 11
const CURSOR_HEIGHT = 14

type PeerView =
  | {
      peer: PeerPresence
      kind: 'cursor'
      x: number
      y: number
      mode: PointerMode
      height: number
    }
  | {
      peer: PeerPresence
      kind: 'edge'
      edge: 'up' | 'down'
      /** X in anchor coords */
      x: number
      /** Y pinned to the visible edge in anchor coords */
      y: number
    }

/**
 * Only peers on the same page as us. Missing pageId means we don't know where
 * they are yet — never paint their cursor on this page.
 *
 * Also show a block-anchored caret when a peer soft-locks a block even if their
 * last absolute pointer is slightly stale (inserts/deletes above shift layout).
 */
const visiblePeers = $derived.by(() => {
  const pageId = currentPageId
  if (!pageId) return []

  return peers.filter(
    (peer) => peer.pageId === pageId && (!!peer.pointer || !!peer.editingBlockId),
  )
})

function anchorRect() {
  return anchor?.getBoundingClientRect() ?? null
}

/** Block box in anchor-local coordinates (for caret re-anchoring). */
function blockLocalRect(blockId: string): {
  left: number
  top: number
  width: number
  height: number
} | null {
  if (!anchor || !blockId) return null
  const el = anchor.querySelector(
    `[data-block-id="${CSS.escape(blockId)}"]`,
  ) as HTMLElement | null
  if (!el) return null
  const ar = anchor.getBoundingClientRect()
  const br = el.getBoundingClientRect()
  return {
    left: br.left - ar.left,
    top: br.top - ar.top,
    width: br.width,
    height: br.height,
  }
}

/**
 * Resolve where a peer caret/cursor should paint. Prefer block-relative offsets
 * so inserts/deletes above the line move the indicator with the block.
 */
function resolvePeerPointer(peer: PeerPresence): {
  x: number
  y: number
  mode: PointerMode
  height: number
} | null {
  const pointer = peer.pointer
  const blockId = pointer?.blockId || peer.editingBlockId

  if (blockId && (pointer?.mode === 'caret' || !pointer || peer.editingBlockId === blockId)) {
    const rect = blockLocalRect(blockId)
    if (rect) {
      const height = pointer?.height ?? 18
      const hasRel =
        typeof pointer?.relX === 'number'
        && Number.isFinite(pointer.relX)
        && typeof pointer?.relY === 'number'
        && Number.isFinite(pointer.relY)

      if (hasRel && pointer) {
        return {
          x: rect.left + pointer.relX!,
          y: rect.top + pointer.relY!,
          mode: 'caret',
          height,
        }
      }

      // Soft-lock / legacy caret: pin to the block so layout shifts stay correct.
      if (pointer?.mode === 'caret' || peer.editingBlockId) {
        const x = pointer
          ? Math.min(Math.max(pointer.x, rect.left + 4), rect.left + Math.max(8, rect.width - 8))
          : rect.left + 24
        // Keep a small inset so the caret sits on the first text line, not the grip.
        const y = rect.top + Math.min(8, Math.max(2, rect.height * 0.15))
        return { x, y, mode: 'caret', height }
      }
    }
  }

  if (!pointer) return null
  return {
    x: pointer.x,
    y: pointer.y,
    mode: pointer.mode ?? 'pointer',
    height: pointer.height ?? 18,
  }
}

/**
 * Visible slice of the anchor in anchor-local coordinates
 * (accounts for window scroll when the tall editor extends off-screen).
 */
function visibleBand() {
  void layoutVersion
  const rect = anchorRect()
  if (!anchor || !rect) return null

  const top = Math.max(0, -rect.top)
  const bottom = Math.min(anchor.clientHeight, window.innerHeight - rect.top)
  return {
    top,
    bottom,
    height: Math.max(0, bottom - top),
    width: anchor.clientWidth,
  }
}

function toLocalCoords(clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = anchorRect()
  if (!rect) return null
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

function clampX(x: number, width: number) {
  const maxX = Math.max(12, width - 48)
  return Math.min(Math.max(x, 12), maxX)
}

/**
 * Decide whether a peer cursor is on-screen, above, or below the local viewport.
 * Must use $derived.by — $derived(() => ...) stores a *function*, so {#each} never paints peers.
 */
const peerViews = $derived.by((): PeerView[] => {
  void layoutVersion
  const band = visibleBand()
  if (!band || band.height < 8) return []

  const views: PeerView[] = []

  for (const peer of visiblePeers) {
    const resolved = resolvePeerPointer(peer)
    if (!resolved) continue

    const { x, y, mode, height } = resolved
    const margin = mode === 'caret' ? height + 8 : CURSOR_HEIGHT + 8

    if (y + margin < band.top) {
      views.push({
        peer,
        kind: 'edge',
        edge: 'up',
        x: clampX(x, band.width),
        y: band.top + 10,
      })
      continue
    }

    if (y > band.bottom - 4) {
      views.push({
        peer,
        kind: 'edge',
        edge: 'down',
        x: clampX(x, band.width),
        y: Math.max(band.top + 10, band.bottom - 36),
      })
      continue
    }

    const maxX = Math.max(0, band.width - CURSOR_WIDTH)
    views.push({
      peer,
      kind: 'cursor',
      x: Math.min(Math.max(x, 0), maxX),
      y,
      mode,
      height,
    })
  }

  return views
})

function pointerInAnchor(clientX: number, clientY: number) {
  const rect = anchorRect()
  if (!rect) return false

  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}

/** True when the local user is typing in an input / contenteditable inside the editor. */
function isTextEditingInAnchor(): boolean {
  if (!anchor) return false

  const active = document.activeElement
  if (!active || !anchor.contains(active)) return false

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return true
  }

  if ((active as HTMLElement).isContentEditable) return true
  if (active.closest?.('[contenteditable="true"]')) return true

  return false
}

/** Nearest editor block under the caret / active element. */
function blockIdNearCaret(caretClientRect: DOMRect | null): string | null {
  if (!anchor) return null

  const active = document.activeElement
  if (active instanceof Element && anchor.contains(active)) {
    const fromActive = active.closest?.('[data-block-id]') as HTMLElement | null
    const id = fromActive?.getAttribute('data-block-id')
    if (id) return id
  }

  if (!caretClientRect) return null
  const cx = caretClientRect.left + Math.min(2, caretClientRect.width / 2)
  const cy = caretClientRect.top + Math.min(4, caretClientRect.height / 2)
  const hit = document.elementFromPoint(cx, cy)
  if (!(hit instanceof Element) || !anchor.contains(hit)) return null
  return hit.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null
}

function publishCaretPointer(immediate = false) {
  if (!isTextEditingInAnchor()) return

  const rect = getCaretClientRect()
  const rectAnchor = anchorRect()
  if (!rect || !rectAnchor) return

  const x = rect.left - rectAnchor.left
  const y = rect.top - rectAnchor.top
  const height = Math.max(14, rect.height || 18)
  const blockId = blockIdNearCaret(rect)

  let relX: number | undefined
  let relY: number | undefined
  if (blockId) {
    const blockRect = blockLocalRect(blockId)
    if (blockRect) {
      relX = x - blockRect.left
      relY = y - blockRect.top
    }
  }

  queuePointer(x, y, 'up', {
    mode: 'caret',
    height,
    immediate,
    blockId: blockId ?? undefined,
    relX,
    relY,
  })
}

function queuePointer(
  x: number,
  y: number,
  button: 'down' | 'up',
  options?: {
    mode?: PointerMode
    height?: number
    immediate?: boolean
    blockId?: string
    relX?: number
    relY?: number
  },
) {
  lastLocalPointer = { x, y }
  pendingSend = {
    x,
    y,
    button,
    mode: options?.mode ?? 'pointer',
    height: options?.height,
    immediate: options?.immediate,
    blockId: options?.blockId,
    relX: options?.relX,
    relY: options?.relY,
  }

  if (options?.immediate) {
    flushQueuedPointer()
    return
  }

  if (sendRaf) return
  sendRaf = requestAnimationFrame(() => {
    sendRaf = 0
    flushQueuedPointer()
  })
}

function flushQueuedPointer() {
  if (!pendingSend) return
  const next = pendingSend
  pendingSend = null
  presence?.updatePointer(next.x, next.y, next.button, {
    immediate: next.immediate,
    mode: next.mode,
    height: next.height,
    blockId: next.blockId,
    relX: next.relX,
    relY: next.relY,
  })
}

function publishPointer(event: PointerEvent) {
  // While typing, never broadcast a mouse cursor — only the text caret.
  if (isTextEditingInAnchor()) {
    publishCaretPointer(true)
    return
  }

  if (!pointerInAnchor(event.clientX, event.clientY)) return

  const local = toLocalCoords(event.clientX, event.clientY)
  if (!local) return

  const button = pointerDown || event.buttons > 0 ? 'down' : 'up'
  queuePointer(local.x, local.y, button, {
    mode: 'pointer',
    immediate: button === 'down',
  })
}

function publishPointerUp() {
  if (!lastLocalPointer) return
  if (isTextEditingInAnchor()) {
    publishCaretPointer(true)
    return
  }
  queuePointer(lastLocalPointer.x, lastLocalPointer.y, 'up', {
    mode: 'pointer',
    immediate: true,
  })
}

function onPointerMove(event: PointerEvent) {
  publishPointer(event)
}

function onPointerDown(event: PointerEvent) {
  pointerDown = true
  publishPointer(event)
}

function onPointerUp(event: PointerEvent) {
  pointerDown = false
  if (pointerInAnchor(event.clientX, event.clientY) || isTextEditingInAnchor()) {
    publishPointer(event)
    return
  }
  publishPointerUp()
}

function onTouchEnd() {
  pointerDown = false
  publishPointerUp()
}

function onSelectionChange() {
  if (!isTextEditingInAnchor()) return
  const now = Date.now()
  if (now - caretThrottle < 24) return
  caretThrottle = now
  publishCaretPointer()
}

function onFocusIn(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof Node) || !anchor?.contains(target)) return
  requestAnimationFrame(() => publishCaretPointer(true))
}

function onFocusOut(event: FocusEvent) {
  const related = event.relatedTarget
  if (related instanceof Node && anchor?.contains(related)) return
}

function onInput() {
  if (isTextEditingInAnchor()) {
    publishCaretPointer()
  }
}

function scheduleLayoutRefresh() {
  if (layoutRaf) return
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0
    layoutVersion++
    if (isTextEditingInAnchor()) publishCaretPointer()
  })
}

function scheduleCaretRefresh() {
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    if (isTextEditingInAnchor()) publishCaretPointer()
    layoutVersion++
  })
}

function bindPresence(handle: PresenceHandle | null) {
  stopPeers?.()
  stopPeers = undefined

  if (!handle) {
    peers = []
    return
  }

  // onPeersChanged immediately invokes with the current list — no need to clear
  // first (that caused an extra peers write every rebind).
  stopPeers = handle.onPeersChanged((next) => {
    // New array so Svelte 5 always re-renders carets/cursors on presence ticks.
    peers = next.slice()
    // Do NOT bump layoutVersion here — that re-renders peer DOM inside the
    // observed anchor and MutationObserver loops into effect_update_depth_exceeded.
  })
}

$effect(() => {
  const handle = presence
  bindPresence(handle)
  return () => {
    stopPeers?.()
    stopPeers = undefined
  }
})

function bindAnchor(el: HTMLElement | null) {
  resizeObserver?.disconnect()
  resizeObserver = null
  mutationObserver?.disconnect()
  mutationObserver = null

  if (!el) return

  resizeObserver = new ResizeObserver(() => {
    layoutVersion++
    if (isTextEditingInAnchor()) publishCaretPointer()
  })
  resizeObserver.observe(el)

  // Block inserts/deletes shift layout without always resizing the anchor box;
  // re-resolve block-anchored carets when the tree changes.
  mutationObserver = new MutationObserver((records) => {
    // Ignore our own overlay (carets/cursors) — mutating it re-entered this
    // observer and blew the Svelte effect depth limit.
    for (const rec of records) {
      const t = rec.target
      if (t instanceof Element && t.closest('.peer-layer, .reaction-layer')) continue
      if (rec.addedNodes) {
        let skip = true
        rec.addedNodes.forEach((n) => {
          if (!(n instanceof Element) || !n.closest?.('.peer-layer, .reaction-layer')) {
            skip = false
          }
        })
        if (skip && rec.addedNodes.length) continue
      }
      scheduleLayoutRefresh()
      return
    }
  })
  mutationObserver.observe(el, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: false,
  })
}

$effect(() => {
  const el = anchor
  bindAnchor(el)
  // Don't call publishCaretPointer here — it can write presence state that
  // re-enters effects. Caret is published via selection/input/focus listeners.
  return () => {
    resizeObserver?.disconnect()
    resizeObserver = null
    mutationObserver?.disconnect()
    mutationObserver = null
  }
})

$effect(() => {
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerdown', onPointerDown, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  window.addEventListener('touchcancel', onTouchEnd, { passive: true })
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('input', onInput, true)
  window.addEventListener('scroll', scheduleLayoutRefresh, { passive: true, capture: true })
  window.addEventListener('resize', scheduleCaretRefresh, { passive: true })

  return () => {
    stopPeers?.()
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    cancelAnimationFrame(rafId)
    if (sendRaf) cancelAnimationFrame(sendRaf)
    if (layoutRaf) cancelAnimationFrame(layoutRaf)
    flushQueuedPointer()
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchEnd)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
    document.removeEventListener('input', onInput, true)
    window.removeEventListener('scroll', scheduleLayoutRefresh, true)
    window.removeEventListener('resize', scheduleCaretRefresh)
  }
})
</script>


{#if anchor}
  <div class="peer-layer">
    {#each peerViews as view (view.peer.addr)}
      {#if view.kind === 'edge'}
        <div
          class="peer-edge"
          class:peer-edge--up={view.edge === 'up'}
          class:peer-edge--down={view.edge === 'down'}
          style="transform: translate(calc({view.x}px - 50%), {view.y}px); --cursor-color: {view.peer.color}"
          title="{view.peer.name} is {view.edge === 'up' ? 'above' : 'below'}"
        >
          <span class="peer-edge__arrow" aria-hidden="true">{view.edge === 'up' ? '↑' : '↓'}</span>
          <span class="peer-edge__dot" aria-hidden="true"></span>
          <span class="peer-edge__name">{view.peer.name}</span>
        </div>
      {:else if view.mode === 'caret'}
        <div
          class="peer-caret"
          style="transform: translate({view.x}px, {view.y}px); --cursor-color: {view.peer.color}; --caret-height: {view.height}px"
        >
          <span class="peer-caret__bar" aria-hidden="true"></span>
          <span class="peer-caret__name">{view.peer.name}</span>
        </div>
      {:else}
        <ExcalidrawCursor peer={view.peer} x={view.x} y={view.y} />
      {/if}
    {/each}
  </div>
{/if}


<style>

.peer-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* Above editor content so carets / Excalidraw cursors stay visible. */
  z-index: 40;
  overflow: visible;
}

.peer-caret {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  pointer-events: none;
  z-index: 31;
}

.peer-caret__bar {
  display: block;
  width: 2px;
  height: var(--caret-height, 18px);
  border-radius: 1px;
  background: var(--cursor-color);
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.85);
  animation: peer-caret-blink 1.05s step-end infinite;
}

.peer-caret__name {
  position: absolute;
  top: -18px;
  left: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--cursor-color);
  border: 1px solid #fff;
  color: #1e1e1e;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
}

.peer-edge {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 32;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: min(180px, 50vw);
  padding: 4px 8px 4px 6px;
  border-radius: 999px;
  background: var(--cursor-color);
  border: 1px solid #fff;
  box-shadow: 0 4px 14px rgb(15 15 15 / 0.18);
  color: #1e1e1e;
  will-change: transform;
  pointer-events: none;
}

.peer-edge__arrow {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  opacity: 0.9;
}

.peer-edge__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #fff;
  box-shadow: inset 0 0 0 1.5px rgb(0 0 0 / 0.12);
  flex-shrink: 0;
}

.peer-edge__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

@keyframes peer-caret-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

</style>
