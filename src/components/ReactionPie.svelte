<script lang="ts">
import type { LiveReaction, PresenceHandle } from '../collab/presence'
import { REACTIONS } from '../reactions/reactionCatalog'
import ReactionEmoji from './ReactionEmoji.svelte'
import { portal } from '../lib/portal'

let {
  presence,
  anchor,
  currentPageId,
}: {
  presence: PresenceHandle | null
  anchor: HTMLElement | null
  currentPageId?: string
} = $props()

const PIE_RADIUS = 78
const WEDGE_RADIUS = 34
/** Small move while Alt is held before the pie opens (avoids accidental opens). */
const MOVE_THRESHOLD_PX = 8
const OPEN_DELAY_MS = 60
const BURST_MS = 2200

let pieOpen = $state(false)
let pieClient = $state({ x: 0, y: 0 })
let bursts = $state<Array<LiveReaction & { localId: string }>>([])

let lastPointerClient = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
let openTimer: ReturnType<typeof setTimeout> | null = null
/** Alt is held and may arm the reaction pie on mouse move. */
let altHeld = false
/** Cursor position when Alt was pressed (for move threshold). */
let altArmOrigin: { x: number; y: number } | null = null
/** True once Alt was combined with another key this press (not a pure Alt+move). */
let chordUsed = false
let stopReaction: (() => void) | undefined
let burstSeq = 0
const burstTimers = new Map<string, ReturnType<typeof setTimeout>>()

const pieItems = $derived.by(() => {
  const n = REACTIONS.length
  return REACTIONS.map((emoji, i) => {
    // Start at top (-90°) and go clockwise.
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / n
    return {
      emoji,
      x: Math.cos(angle) * PIE_RADIUS,
      y: Math.sin(angle) * PIE_RADIUS,
    }
  })
})

const visibleBursts = $derived.by(() => {
  const pageId = currentPageId
  if (!pageId) return []
  return bursts.filter((b) => b.pageId === pageId)
})

let followInvitePending = $state(false)
let followInviteResetTimer: ReturnType<typeof setTimeout> | null = null

function clearOpenTimer() {
  if (openTimer) {
    clearTimeout(openTimer)
    openTimer = null
  }
}

function isAltKey(e: KeyboardEvent) {
  return e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight'
}

function toAnchorCoords(clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = anchor?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

/** Keep the full pie (wedges + follow chip) inside the viewport. */
function clampPieClient(x: number, y: number) {
  const pad = 16
  const half = PIE_RADIUS + WEDGE_RADIUS + 8
  // Extra space below for the follow chip (~44px tall under the ring).
  const below = half + 52
  const maxX = Math.max(pad + half, window.innerWidth - pad - half)
  const maxY = Math.max(pad + half, window.innerHeight - pad - below)
  return {
    x: Math.min(Math.max(x, pad + half), maxX),
    y: Math.min(Math.max(y, pad + half), maxY),
  }
}

function openPieAtCursor() {
  clearOpenTimer()
  pieClient = clampPieClient(lastPointerClient.x, lastPointerClient.y)
  pieOpen = true
}

function closePie() {
  clearOpenTimer()
  pieOpen = false
}

function scheduleOpenPie() {
  if (pieOpen || openTimer || chordUsed || !altHeld) return
  openTimer = setTimeout(() => {
    openTimer = null
    if (altHeld && !chordUsed) openPieAtCursor()
  }, OPEN_DELAY_MS)
}

/** Cancel arming/opening — Alt was used as a shortcut modifier, not a reaction. */
function cancelForChord() {
  chordUsed = true
  altHeld = false
  altArmOrigin = null
  closePie()
}

function pushBurst(reaction: LiveReaction) {
  burstSeq += 1
  const localId = `${reaction.id}-${burstSeq}`
  bursts = [...bursts, { ...reaction, localId }]
  const timer = setTimeout(() => {
    bursts = bursts.filter((b) => b.localId !== localId)
    burstTimers.delete(localId)
  }, BURST_MS)
  burstTimers.set(localId, timer)
}

function pickReaction(emoji: string) {
  const coords = toAnchorCoords(pieClient.x, pieClient.y)
    ?? toAnchorCoords(lastPointerClient.x, lastPointerClient.y)
  closePie()
  if (!coords) return

  if (presence && currentPageId) {
    presence.sendReaction(emoji, coords.x, coords.y)
    return
  }

  // Offline / no realtime: still show a local-only burst (not shared).
  pushBurst({
    id: `local-${Date.now()}`,
    addr: 'local',
    name: 'You',
    color: '#2383e2',
    emoji,
    x: coords.x,
    y: coords.y,
    pageId: currentPageId || '',
    at: Date.now(),
  })
}

function inviteFollowFromPie() {
  // Realtime-only: no Yjs/history — peers currently connected via presence.
  if (!presence) {
    closePie()
    return
  }

  presence.sendFollowInvite()
  followInvitePending = true
  if (followInviteResetTimer) clearTimeout(followInviteResetTimer)
  followInviteResetTimer = setTimeout(() => {
    followInvitePending = false
    followInviteResetTimer = null
  }, 1800)
  closePie()
}

function distanceFromArmOrigin(x: number, y: number): number {
  if (!altArmOrigin) return 0
  const dx = x - altArmOrigin.x
  const dy = y - altArmOrigin.y
  return Math.hypot(dx, dy)
}

function onPointerMove(e: PointerEvent) {
  lastPointerClient = { x: e.clientX, y: e.clientY }

  // Alt + mouse move → arm reaction pie at the cursor.
  if (!altHeld || chordUsed || pieOpen) return
  // Ignore moves while a mouse button is held (marquee / drag / selection).
  if (e.buttons !== 0) return
  if (distanceFromArmOrigin(e.clientX, e.clientY) < MOVE_THRESHOLD_PX) return

  scheduleOpenPie()
}

function onKeyDown(e: KeyboardEvent) {
  // Pure Alt press → wait for mouse move to open the pie.
  if (isAltKey(e) && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat) {
    altHeld = true
    chordUsed = false
    altArmOrigin = { ...lastPointerClient }
    return
  }

  // Any other key while Alt is involved cancels the pie (allow shortcuts / typing).
  if ((e.altKey || altHeld) && !isAltKey(e)) {
    cancelForChord()
    return
  }

  if (e.key === 'Escape' && pieOpen) {
    e.preventDefault()
    e.stopPropagation()
    closePie()
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (isAltKey(e)) {
    altHeld = false
    altArmOrigin = null
    // Keep pie open after releasing Alt so the user can click a wedge.
    if (chordUsed) closePie()
    else clearOpenTimer()
    return
  }

  // Other key released while Alt-chord may have been blocked on keydown — stay closed.
  if (e.altKey || altHeld || openTimer != null) {
    cancelForChord()
  }
}

function onPointerDown(e: PointerEvent) {
  if (!pieOpen) return
  const target = e.target
  if (target instanceof Element && target.closest('.reaction-pie')) return
  closePie()
}

function bindPresence(presence: PresenceHandle | null) {
  stopReaction?.()
  stopReaction = undefined
  if (!presence) return
  stopReaction = presence.onReaction((reaction) => {
    pushBurst(reaction)
  })
}

$effect(() => {
  bindPresence(presence)
  return () => {
    stopReaction?.()
    stopReaction = undefined
  }
})

$effect(() => {
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    clearOpenTimer()
    if (followInviteResetTimer) clearTimeout(followInviteResetTimer)
    for (const t of burstTimers.values()) clearTimeout(t)
    burstTimers.clear()
    stopReaction?.()
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('pointerdown', onPointerDown, true)
  }
})
</script>


{#if anchor}
  <div use:portal class="reaction-bursts" aria-hidden="true">
    {#each visibleBursts as burst (burst.localId)}
      <div
        class="reaction-burst"
        style="transform: translate({burst.x}px, {burst.y}px); --rx-color: {burst.color}"
      >
        <ReactionEmoji
          class="reaction-burst__emoji"
          emoji={burst.emoji}
          size={36}
          decorative
        />
        <span class="reaction-burst__name">{burst.name}</span>
      </div>
    {/each}
  </div>
{/if}

{#if pieOpen}
  <div
    use:portal
    class="reaction-pie"
    style="left: {pieClient.x}px; top: {pieClient.y}px"
    role="menu"
    aria-label="Reactions and follow invite"
  >
    <div class="reaction-pie__hub" aria-hidden="true"></div>

    {#each pieItems as item (item.emoji)}
      <button
        type="button"
        class="reaction-pie__wedge"
        role="menuitem"
        style="transform: translate(calc(-50% + {item.x}px), calc(-50% + {item.y}px)); width: {WEDGE_RADIUS * 2}px; height: {WEDGE_RADIUS * 2}px"
        title={item.emoji}
        onclick={(e) => { e.preventDefault(); e.stopPropagation(); pickReaction(item.emoji) }}
        onpointerdown={(e) => e.stopPropagation()}
      >
        <ReactionEmoji class="reaction-pie__emoji" emoji={item.emoji} size={28} decorative />
      </button>
    {/each}

    <button
      type="button"
      class="reaction-pie__follow"
      class:reaction-pie__follow--sent={followInvitePending}
      role="menuitem"
      disabled={followInvitePending}
      onclick={(e) => { e.preventDefault(); e.stopPropagation(); inviteFollowFromPie() }}
      onpointerdown={(e) => e.stopPropagation()}
    >
      {followInvitePending ? 'Invite sent' : 'Follow me'}
    </button>
  </div>
{/if}


<style>

.reaction-bursts {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 40;
  overflow: visible;
}

.reaction-burst {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  will-change: transform, opacity;
  animation: reaction-burst-float 2.2s ease-out forwards;
  pointer-events: none;
  filter: drop-shadow(0 6px 14px rgb(15 15 15 / 0.18));
}

.reaction-burst__emoji {
  transform-origin: center bottom;
  animation: reaction-burst-pop 0.45s cubic-bezier(0.22, 1.4, 0.36, 1) both;
}

.reaction-burst__name {
  max-width: 120px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--rx-color, #2383e2);
  color: #1e1e1e;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 1px solid #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
}

.reaction-pie {
  position: fixed;
  z-index: 12000;
  width: 0;
  height: 0;
  pointer-events: none;
  animation: reaction-pie-in 0.16s cubic-bezier(0.22, 1.2, 0.36, 1) both;
}

.reaction-pie__hub {
  position: absolute;
  top: 0;
  left: 0;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: color-mix(in srgb, var(--page-bg, #fff) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--page-text, #37352f) 12%, transparent);
  box-shadow:
    0 10px 28px rgb(15 15 15 / 0.16),
    inset 0 0 0 1px rgb(255 255 255 / 0.4);
  backdrop-filter: blur(10px);
  pointer-events: none;
}

.reaction-pie__wedge {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--page-text, #37352f) 10%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--page-bg, #fff) 94%, transparent);
  box-shadow: 0 8px 22px rgb(15 15 15 / 0.14);
  cursor: pointer;
  pointer-events: auto;
  padding: 0;
  transition:
    transform 0.12s ease,
    background 0.12s ease,
    box-shadow 0.12s ease;
  backdrop-filter: blur(10px);
}

.reaction-pie__wedge:hover,
.reaction-pie__wedge:focus-visible {
  background: color-mix(in srgb, var(--page-bg, #fff) 100%, #2383e2 8%);
  box-shadow: 0 10px 26px rgb(35 131 226 / 0.28);
  outline: none;
  z-index: 1;
}

.reaction-pie__wedge:hover .reaction-pie__emoji,
.reaction-pie__wedge:focus-visible .reaction-pie__emoji {
  transform: scale(1.18);
}

.reaction-pie__emoji {
  transition: transform 0.12s ease;
}

.reaction-pie__cancel {
  position: absolute;
  top: 0;
  left: 0;
  width: 32px;
  height: 32px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--page-text, #37352f) 12%, transparent);
  background: color-mix(in srgb, var(--page-bg, #fff) 92%, transparent);
  color: color-mix(in srgb, var(--page-text, #37352f) 70%, transparent);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgb(15 15 15 / 0.12);
  padding: 0;
  z-index: 3;
}

.reaction-pie__cancel:hover {
  background: #fff;
  color: #37352f;
}

/* Ask others to follow — chip under the pie (always visible, not hover-only). */
.reaction-pie__follow {
  position: absolute;
  top: 0;
  left: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transform: translate(-50%, calc(50% + 124px));
  max-width: min(300px, 86vw);
  height: 40px;
  padding: 0 14px 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, #2383e2 35%, transparent);
  background: color-mix(in srgb, var(--page-bg, #fff) 96%, #2383e2 6%);
  color: var(--page-text, #37352f);
  box-shadow: 0 10px 24px rgb(15 15 15 / 0.16);
  backdrop-filter: blur(10px);
  cursor: pointer;
  pointer-events: auto;
  font: 600 12px/1.2 ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap;
  z-index: 3;
}

.reaction-pie__follow:hover:not(:disabled) {
  background: color-mix(in srgb, var(--page-bg, #fff) 100%, #2383e2 8%);
  box-shadow: 0 12px 28px rgb(35 131 226 / 0.22);
}

.reaction-pie__follow:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.reaction-pie__follow--sent {
  border-color: color-mix(in srgb, #2383e2 40%, transparent);
  background: color-mix(in srgb, #2383e2 12%, var(--page-bg, #fff));
}

.reaction-pie__follow-tag {
  display: inline-grid;
  place-items: center;
  min-width: 52px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(35 131 226 / 0.16);
  color: #2383e2;
  font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.04em;
}

.reaction-pie__follow--sent .reaction-pie__follow-tag {
  background: rgb(35 131 226 / 0.22);
}

.reaction-pie__follow-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes reaction-pie-in {
  from {
    opacity: 0;
    transform: scale(0.72);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes reaction-burst-pop {
  0% {
    transform: scale(0.2);
    opacity: 0;
  }
  55% {
    transform: scale(1.15);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes reaction-burst-float {
  0% {
    opacity: 0;
    margin-top: 8px;
  }
  12% {
    opacity: 1;
    margin-top: 0;
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    margin-top: -36px;
  }
}

</style>
