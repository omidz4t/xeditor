<script lang="ts">
import ChevronRight from '@lucide/svelte/icons/chevron-right'
import Crosshair from '@lucide/svelte/icons/crosshair'
import FileDown from '@lucide/svelte/icons/file-down'
import FileUp from '@lucide/svelte/icons/file-up'
import MessageCircle from '@lucide/svelte/icons/message-circle'
import MoreHorizontal from '@lucide/svelte/icons/ellipsis'
import PanelLeft from '@lucide/svelte/icons/panel-left'
import Search from '@lucide/svelte/icons/search'
import Settings from '@lucide/svelte/icons/settings'
import UserRound from '@lucide/svelte/icons/user-round'
import X from '@lucide/svelte/icons/x'
import { tick } from 'svelte'
import { hoverTooltip } from '@xproeditor/svelte'
import type { PageMeta } from '../collab/document'
import type { PeerPresence } from '../collab/presence'
import { portal } from '../lib/portal'
import { bindUiLayer } from '../composables/useUiLayers'

let {
  title = '',
  pages = [] as PageMeta[],
  peers = [] as PeerPresence[],
  currentPageId = '',
  rootPageId = '',
  sidebarOpen = false,
  commentsOpen = false,
  commentCount = 0,
  followedPeerAddr = null as string | null,
  writing = false,
  ontoggleSidebar,
  onnavigateHome,
  onopenShare,
  onopenSettings,
  onopenComments,
  onnavigatePage,
  onfindPeer,
  onfollowPeer,
  onstopFollow,
  onexportMarkdown,
  onimportMarkdown,
}: {
  title?: string
  pages?: PageMeta[]
  peers?: PeerPresence[]
  currentPageId?: string
  rootPageId?: string
  sidebarOpen?: boolean
  commentsOpen?: boolean
  commentCount?: number
  followedPeerAddr?: string | null
  writing?: boolean
  ontoggleSidebar?: () => void
  onnavigateHome?: () => void
  onopenShare?: () => void
  onopenSettings?: () => void
  onopenComments?: () => void
  onnavigatePage?: (pageId: string) => void
  onfindPeer?: (peer: PeerPresence) => void
  onfollowPeer?: (peer: PeerPresence) => void
  onstopFollow?: () => void
  onexportMarkdown?: () => void
  onimportMarkdown?: () => void
} = $props()

/**
 * Hysteresis so expand/collapse does not thrash near the top
 * (single threshold caused glitchy flip-flops while scrolling).
 */
const SCROLL_COMPACT_ENTER_PX = 48
const SCROLL_COMPACT_EXIT_PX = 10

/** Larger at top; compact glass islands while scrolled. */
let chromeCompact = $state(false)
/** App scroll root (`#app`); window does not scroll (html/body overflow hidden). */
let scrollRoot: HTMLElement | Window | null = null
let chromeScrollRaf = 0
/** Ignore ResizeObserver height churn while the size transition is running. */
let chromeHeightLockUntil = 0
let chromeHeightTimer: ReturnType<typeof setTimeout> | undefined
const CHROME_SIZE_MS = 320

function resolveScrollRoot(): HTMLElement | Window {
  const app = document.getElementById('app')
  if (app) return app
  return window
}

function getScrollY() {
  if (scrollRoot && scrollRoot !== window) {
    return (scrollRoot as HTMLElement).scrollTop
  }
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

function publishStableChromeHeight(px: number) {
  headerOffsetPx = px
  document.documentElement.style.setProperty('--page-chrome-height', `${px}px`)
}

function setChromeCompact(next: boolean) {
  if (chromeCompact === next) return
  chromeCompact = next
  // Lock cover-offset updates for the animation so cover/layout don't jump mid-tween.
  chromeHeightLockUntil = performance.now() + CHROME_SIZE_MS + 40
  // Publish a stable height for each mode (ResizeObserver is noisy during transition).
  publishStableChromeHeight(next ? 32 : 40)
  if (chromeHeightTimer) clearTimeout(chromeHeightTimer)
  chromeHeightTimer = setTimeout(() => {
    chromeHeightTimer = undefined
    if (!topbarRef) return
    const h = Math.ceil(topbarRef.getBoundingClientRect().height)
    if (h > 0) publishStableChromeHeight(h)
  }, CHROME_SIZE_MS + 50)
}

function syncChromeSize() {
  const y = getScrollY()
  if (chromeCompact) {
    // Expand only when fully back near the top.
    if (y <= SCROLL_COMPACT_EXIT_PX) setChromeCompact(false)
  } else {
    // Compact only after a clear scroll down (hysteresis band).
    if (y >= SCROLL_COMPACT_ENTER_PX) setChromeCompact(true)
  }
}

function onScrollChrome() {
  if (chromeScrollRaf) return
  chromeScrollRaf = requestAnimationFrame(() => {
    chromeScrollRaf = 0
    syncChromeSize()
  })
}


let activePeerAddr = $state<string | null>(null)
let moreOpen = $state(false)
let morePos = $state({ x: 0, y: 0 })
let moreRef = $state<HTMLElement | null>(null)
let moreBtnRef = $state<HTMLElement | null>(null)
let topbarRef = $state<HTMLElement | null>(null)
/** Tracks real header height (zoom / font / wrap) for the fixed-mode spacer. */
let headerOffsetPx = $state(40)
let headerResizeObserver: ResizeObserver | null = null
let peopleOpen = $state(false)
let peopleQuery = $state('')
let popoverPos = $state({ x: 0, y: 0 })
let peoplePos = $state({ x: 0, y: 0 })
let popoverRef = $state<HTMLElement | null>(null)
let peopleRef = $state<HTMLElement | null>(null)
let peopleBtnRef = $state<HTMLElement | null>(null)

const breadcrumbAncestors = $derived.by(() => {
  const pageList = pages ?? []
  const byId = new Map(pageList.map((page) => [page.id, page]))
  const ancestors: PageMeta[] = []
  let parentId = currentPageId ? byId.get(currentPageId)?.parentId : undefined

  while (parentId) {
    if (rootPageId && parentId === rootPageId) break

    const page = byId.get(parentId)
    if (!page) break

    ancestors.unshift(page)
    parentId = page.parentId
    if (parentId === page.id) break
  }

  return ancestors
})

/**
 * Compact trail for the top island: full path when short, otherwise
 * first + … + last two so long titles don't blow the glass bar.
 */
const breadcrumbItems = $derived.by(() => {
  const all = breadcrumbAncestors
  if (all.length <= 3) {
    return all.map((page) => ({ type: 'page' as const, page }))
  }
  return [
    { type: 'page' as const, page: all[0]! },
    { type: 'ellipsis' as const },
    ...all.slice(-2).map((page) => ({ type: 'page' as const, page })),
  ]
})

const currentBreadcrumbLabel = $derived.by(() => {
  const value = title?.trim()
  return value || 'Untitled'
})

function pageTitleFor(pageId?: string) {
  if (!pageId) return 'Unknown page'
  const page = pages?.find((entry) => entry.id === pageId)
  return page?.title || 'Untitled'
}

function peerOnCurrentPage(peer: PeerPresence) {
  return !peer.pageId || peer.pageId === currentPageId
}

function peerPageLabel(peer: PeerPresence) {
  return peerOnCurrentPage(peer) ? 'On this page' : pageTitleFor(peer.pageId)
}

const peersHere = $derived(peers.filter((peer) => peerOnCurrentPage(peer)))

const activePeer = $derived(
  activePeerAddr
    ? peers.find((peer) => peer.addr === activePeerAddr) ?? null
    : null,
)

const filteredPeers = $derived.by(() => {
  const q = peopleQuery.trim().toLowerCase()
  if (!q) return peers
  return peers.filter((peer) => {
    const page = peerPageLabel(peer).toLowerCase()
    return peer.name.toLowerCase().includes(q) || page.includes(q)
  })
})

function closePeerPopover() {
  activePeerAddr = null
}

function closePeoplePanel() {
  peopleOpen = false
  peopleQuery = ''
}

function closeMoreMenu() {
  moreOpen = false
}

function closeAllPeopleUi() {
  closePeerPopover()
  closePeoplePanel()
  closeMoreMenu()
}

function openMoreMenu(event?: MouseEvent) {
  closePeerPopover()
  closePeoplePanel()

  if (moreOpen) {
    closeMoreMenu()
    return
  }

  const target = (event?.currentTarget as HTMLElement | null) ?? moreBtnRef
  const rect = target?.getBoundingClientRect()
  moreOpen = true
  if (rect) {
    morePos = { x: rect.right - 200, y: rect.bottom + 8 }
    void tick().then(() => {
      if (!moreRef || !rect) return
      const panel = moreRef.getBoundingClientRect()
      let x = rect.right - panel.width
      let y = rect.bottom + 8
      const pad = 8
      if (x < pad) x = pad
      if (x + panel.width > window.innerWidth - pad) {
        x = window.innerWidth - panel.width - pad
      }
      if (y + panel.height > window.innerHeight - pad) {
        y = Math.max(pad, rect.top - panel.height - 8)
      }
      morePos = { x, y }
    })
  }
}

function onExportMarkdown() {
  closeMoreMenu()
  onexportMarkdown?.()
}

function onImportMarkdown() {
  closeMoreMenu()
  onimportMarkdown?.()
}

function onOpenSettingsFromMore() {
  closeMoreMenu()
  onopenSettings?.()
}

function clampPopoverPosition(x: number, y: number, panelEl?: HTMLElement | null) {
  const panel = panelEl ?? popoverRef
  if (!panel) return { x, y }

  const padding = 8
  const rect = panel.getBoundingClientRect()
  let nextX = x
  let nextY = y

  if (nextX + rect.width > window.innerWidth - padding) {
    nextX = window.innerWidth - rect.width - padding
  }
  if (nextY + rect.height > window.innerHeight - padding) {
    nextY = window.innerHeight - rect.height - padding
  }

  return {
    x: Math.max(padding, nextX),
    y: Math.max(padding, nextY),
  }
}

async function openPeerPopover(peer: PeerPresence, event: MouseEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return

  closePeoplePanel()

  if (activePeerAddr === peer.addr) {
    closePeerPopover()
    return
  }

  const rect = target.getBoundingClientRect()
  // Position first so the panel never flashes at (0,0) after portal.
  const rough = {
    x: Math.max(8, rect.right - 220),
    y: Math.max(8, rect.bottom + 8),
  }
  popoverPos = rough
  activePeerAddr = peer.addr
  await tick()
  popoverPos = clampPopoverPosition(rough.x, rough.y, popoverRef)
  requestAnimationFrame(() => {
    popoverPos = clampPopoverPosition(rough.x, rough.y, popoverRef)
  })
}

async function openPeoplePanel(event?: MouseEvent) {
  closePeerPopover()

  if (peopleOpen) {
    closePeoplePanel()
    return
  }

  const target = (event?.currentTarget as HTMLElement | null) ?? peopleBtnRef
  const rect = target?.getBoundingClientRect()
  peopleQuery = ''

  if (!rect) return

  const rough = {
    x: Math.max(8, rect.right - 280),
    y: Math.max(8, rect.bottom + 8),
  }
  peoplePos = rough
  peopleOpen = true
  await tick()
  peoplePos = clampPopoverPosition(rough.x, rough.y, peopleRef)
  requestAnimationFrame(() => {
    peoplePos = clampPopoverPosition(rough.x, rough.y, peopleRef)
  })
}

function isFollowing(peer: PeerPresence) {
  return !!followedPeerAddr && followedPeerAddr === peer.addr
}

function onFindPeer(peer: PeerPresence) {
  onfindPeer?.(peer)
  closeAllPeopleUi()
}

function onFollowPeer(peer: PeerPresence) {
  if (isFollowing(peer)) {
    onstopFollow?.()
  } else {
    onfollowPeer?.(peer)
  }
  closeAllPeopleUi()
}

function onDocumentPointerDown(event: MouseEvent) {
  const target = event.target as Node
  const el = target as HTMLElement

  if (activePeerAddr) {
    if (popoverRef?.contains(target)) return
    if (el.closest?.('.notion-presence__avatar')) return
    closePeerPopover()
  }

  if (peopleOpen) {
    if (peopleRef?.contains(target)) return
    if (el.closest?.('.notion-presence__people-btn')) return
    closePeoplePanel()
  }

  if (moreOpen) {
    if (moreRef?.contains(target)) return
    if (el.closest?.('.notion-more-btn')) return
    closeMoreMenu()
  }
}

// Register header popovers so Escape closes them before the left sidebar.
$effect(() => {
  bindUiLayer('people-popover', peopleOpen || !!activePeerAddr, () => {
    closeAllPeopleUi()
  })
})
$effect(() => {
  bindUiLayer('more-menu', moreOpen, () => {
    closeMoreMenu()
  })
})

$effect(() => {
  const addrs = peers.map((peer) => peer.addr).join('|')
  void addrs
  if (activePeerAddr && !peers.some((peer) => peer.addr === activePeerAddr)) {
    closePeerPopover()
  }
})






$effect(() => {
  // Pointer outside closes people/more popovers. Escape is handled by useUiLayers.
  document.addEventListener('mousedown', onDocumentPointerDown)
  scrollRoot = resolveScrollRoot()
  scrollRoot.addEventListener('scroll', onScrollChrome, { passive: true })
  syncChromeSize()

  const publishChromeHeight = (h: number) => {
    if (performance.now() < chromeHeightLockUntil) return
    const px = Math.max(32, Math.ceil(h) || 44)
    if (Math.abs(px - headerOffsetPx) < 2) return
    headerOffsetPx = px
    document.documentElement.style.setProperty('--page-chrome-height', `${px}px`)
  }
  if (typeof ResizeObserver !== 'undefined' && topbarRef) {
    headerResizeObserver = new ResizeObserver((entries) => {
      const h = entries[0]?.borderBoxSize?.[0]?.blockSize
        ?? entries[0]?.contentRect?.height
      if (typeof h === 'number' && h > 0) {
        publishChromeHeight(h)
      }
    })
    headerResizeObserver.observe(topbarRef)
    publishChromeHeight(topbarRef.getBoundingClientRect().height || 44)
  } else {
    publishChromeHeight(44)
  }
  return () => {
    if (chromeScrollRaf) {
      cancelAnimationFrame(chromeScrollRaf)
      chromeScrollRaf = 0
    }
    if (chromeHeightTimer) {
      clearTimeout(chromeHeightTimer)
      chromeHeightTimer = undefined
    }
    document.removeEventListener('mousedown', onDocumentPointerDown)
    scrollRoot?.removeEventListener('scroll', onScrollChrome)
    scrollRoot = null
    headerResizeObserver?.disconnect()
    headerResizeObserver = null
  }
})
</script>


  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header
    bind:this={topbarRef}
    class="notion-topbar"
    class:notion-topbar--compact={chromeCompact}
    style="--page-chrome-height: {headerOffsetPx}px"
  >
    <div class="notion-topbar__row">
      <!-- Left glass island: nav (pinned; shrinks when scrolled) -->
      <div
        class="notion-topbar__island notion-topbar__island--left"
        class:notion-topbar__island--left-solo={breadcrumbAncestors.length === 0}
        role="toolbar"
        aria-label="Navigation"
      >
        <button
          class="notion-icon-btn"
          type="button"
          aria-label="Toggle sidebar"
          aria-pressed={sidebarOpen}
          onclick={() => ontoggleSidebar?.()}
        >
          <PanelLeft size={18} strokeWidth={1.75} />
        </button>

        {#if breadcrumbAncestors.length > 0}
          <nav
            class="notion-breadcrumb"
            class:notion-breadcrumb--collapsed={chromeCompact}
            aria-label="Breadcrumb"
            aria-hidden={chromeCompact}
          >
            {#each breadcrumbItems as item, index (item.type === 'page' ? item.page.id : `ellipsis-${index}`)}
              {#if index > 0}
                <ChevronRight class="notion-breadcrumb__chevron" size={12} strokeWidth={2} />
              {/if}
              {#if item.type === 'ellipsis'}
                <span class="notion-breadcrumb__ellipsis" title="More parent pages" aria-hidden="true">…</span>
              {:else}
                <button
                  class="notion-breadcrumb__segment"
                  type="button"
                  title={item.page.title || 'Untitled'}
                  tabindex={chromeCompact ? -1 : 0}
                  onclick={() => onnavigatePage?.(item.page.id)}
                >
                  <span class="notion-breadcrumb__label">{item.page.title || 'Untitled'}</span>
                </button>
              {/if}
            {/each}
          </nav>
        {/if}
      </div>

      <!-- Right glass island: actions (pinned while scrolling) -->
      <div class="notion-topbar__island notion-topbar__island--right" role="toolbar" aria-label="Page actions">
      <div class="notion-presence">
        <button
          bind:this={peopleBtnRef}
          type="button"
          class="notion-icon-btn notion-presence__people-btn"
          class:notion-icon-btn--active={peopleOpen || !!followedPeerAddr}
          title={peers.length ? 'Find or follow people' : 'No collaborators online'}
          aria-label="Find or follow people"
          aria-expanded={peopleOpen}
          onclick={(e) => openPeoplePanel(e)}
        >
          <UserRound size={18} strokeWidth={1.75} />
          <span hidden={!( peers.length )} class="notion-presence__count">{peers.length}</span>
        </button>

        {#if peers.length}
          {#each peers.slice(0, 5) as peer (peer.addr)}
            <button
              type="button"
              class="notion-presence__avatar"
              class:notion-presence__avatar--away={peer.pageId && peer.pageId !== currentPageId}
              class:notion-presence__avatar--active={activePeerAddr === peer.addr || followedPeerAddr === peer.addr}
              style="background: {peer.color}"
              title={`${peer.name} — ${peerPageLabel(peer)}${followedPeerAddr === peer.addr ? ' (following)' : ''}`}
              aria-label={`${peer.name}, ${peerPageLabel(peer)}`}
              aria-expanded={activePeerAddr === peer.addr}
              onclick={(e) => openPeerPopover(peer, e)}
            >
              {peer.name.charAt(0).toUpperCase()}
            </button>
          {/each}
          {#if peers.length > 5}
            <button
              type="button"
              class="notion-presence__avatar notion-presence__more notion-presence__people-btn"
              title={`${peers.length - 5} more collaborators`}
              aria-label="More collaborators"
              onclick={(e) => openPeoplePanel(e)}
            >
              +{peers.length - 5}
            </button>
          {/if}
          <span hidden={!( peersHere.length && peersHere.length < peers.length )} class="notion-presence__hint">
            {peersHere.length} here
          </span>
        {/if}
      </div>

      {#if activePeer}
        <div
          use:portal
          bind:this={popoverRef}
          class="notion-peer-popover"
          style="left: {popoverPos.x}px; top: {popoverPos.y}px"
          role="dialog" tabindex="-1"
          aria-label={`${activePeer.name} presence`}
          onmousedown={(e) => e.stopPropagation()}
        >
          <div class="notion-peer-popover__header">
            <span class="notion-peer-popover__avatar" style="background: {activePeer.color}">
              {activePeer.name.charAt(0).toUpperCase()}
            </span>
            <div class="notion-peer-popover__copy">
              <span class="notion-peer-popover__name">{activePeer.name}</span>
              <span class="notion-peer-popover__page">{peerPageLabel(activePeer)}</span>
            </div>
          </div>
          <div class="notion-peer-popover__actions">
            <button
              type="button"
              class="notion-peer-popover__action"
              onclick={() => activePeer && onFindPeer(activePeer)}
            >
              <Search size={14} strokeWidth={2} />
              Find
              <span class="notion-peer-popover__action-hint">
                {peerOnCurrentPage(activePeer) ? 'Jump to location' : `Go to ${pageTitleFor(activePeer.pageId)}`}
              </span>
            </button>
            <button
              type="button"
              class="notion-peer-popover__action"
              class:notion-peer-popover__action--active={isFollowing(activePeer)}
              onclick={() => activePeer && onFollowPeer(activePeer)}
            >
              <Crosshair size={14} strokeWidth={2} />
              {isFollowing(activePeer) ? 'Stop following' : 'Follow'}
              <span class="notion-peer-popover__action-hint">
                {isFollowing(activePeer) ? 'Return to free browsing' : 'Keep view locked to them'}
              </span>
            </button>
          </div>
        </div>
      {/if}

      {#if peopleOpen}
        <div
          use:portal
          bind:this={peopleRef}
          class="notion-people-panel"
          style="left: {peoplePos.x}px; top: {peoplePos.y}px"
          role="dialog" tabindex="-1"
          aria-label="Find people"
          onmousedown={(e) => e.stopPropagation()}
        >
          <div class="notion-people-panel__header">
            <span class="notion-people-panel__title">People</span>
            <button
              type="button"
              class="notion-people-panel__close"
              aria-label="Close"
              onclick={closePeoplePanel}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          <label class="notion-people-panel__search">
            <Search size={14} strokeWidth={2} class="notion-people-panel__search-icon" />
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:value={peopleQuery}
              type="search"
              class="notion-people-panel__input"
              placeholder="Find a person…"
              autocomplete="off"
              autofocus
            />
          </label>

          {#if !peers.length}
            <p class="notion-people-panel__empty">
              No one else is online right now.
            </p>
          {:else if !filteredPeers.length}
            <p class="notion-people-panel__empty">
              No matches for “{peopleQuery.trim()}”.
            </p>
          {:else}
            <ul class="notion-people-panel__list">
              {#each filteredPeers as peer (peer.addr)}
                <li class="notion-people-panel__row">
                  <span class="notion-people-panel__avatar" style="background: {peer.color}">
                    {peer.name.charAt(0).toUpperCase()}
                  </span>
                  <div class="notion-people-panel__copy">
                    <span class="notion-people-panel__name">
                      {peer.name}
                      {#if isFollowing(peer)}
                        <span class="notion-people-panel__badge">Following</span>
                      {/if}
                    </span>
                    <span class="notion-people-panel__page">{peerPageLabel(peer)}</span>
                  </div>
                  <div class="notion-people-panel__btns">
                    <button
                      type="button"
                      class="notion-people-panel__btn"
                      aria-label="Find"
                      use:hoverTooltip={"Jump to where this person is on the page"}
                      onclick={() => onFindPeer(peer)}
                    >
                      Find
                    </button>
                    <button
                      type="button"
                      class="notion-people-panel__btn"
                      class:notion-people-panel__btn--active={isFollowing(peer)}
                      aria-label={isFollowing(peer) ? 'Stop following' : 'Follow'}
                      use:hoverTooltip={isFollowing(peer) ? 'Stop following their viewport' : 'Follow their viewport as they move'}
                      onclick={() => onFollowPeer(peer)}
                    >
                      {isFollowing(peer) ? 'Stop' : 'Follow'}
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <button
        class="notion-share-btn"
        type="button"
        aria-label="Share"
        use:hoverTooltip={"Share this document to another chat"}
        onclick={() => onopenShare?.()}
      >
        <svg
          class="notion-share-btn__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
          <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
        </svg>
        <span class="notion-share-btn__label">Share</span>
      </button>

      <button
        class="notion-icon-btn notion-icon-btn--comments"
         class:notion-icon-btn--active-comments={commentsOpen}
        type="button"
        aria-label="Comments"
         aria-pressed={commentsOpen}
         title={commentCount ? `Comments (${commentCount})` : 'Comments'}
        onclick={() => onopenComments?.()}
      >
        <MessageCircle size={18} strokeWidth={1.75} />
        <span hidden={!( commentCount )} class="notion-comments-badge">{commentCount > 99 ? '99+' : commentCount}</span>
      </button>

      <button
        bind:this={moreBtnRef}
        class="notion-icon-btn notion-more-btn"
        type="button"
        aria-label="More actions"
        aria-expanded={moreOpen}
        use:hoverTooltip={'More actions — export, import, settings'}
        onclick={(e) => openMoreMenu(e)}
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </button>
      </div>
    </div>

    {#if moreOpen}
      <div
        use:portal
        bind:this={moreRef}
        class="notion-more-menu"
        style="left: {morePos.x}px; top: {morePos.y}px"
        role="menu" tabindex="-1"
        aria-label="More actions"
        onmousedown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="notion-more-menu__item"
          role="menuitem"
          onclick={onImportMarkdown}
        >
          <FileUp size={16} strokeWidth={2} />
          <span class="notion-more-menu__label">Import…</span>
        </button>
        <button
          type="button"
          class="notion-more-menu__item"
          role="menuitem"
          onclick={onExportMarkdown}
        >
          <FileDown size={16} strokeWidth={2} />
          <span class="notion-more-menu__label">Export as Markdown</span>
        </button>
        <button
          type="button"
          class="notion-more-menu__item"
          role="menuitem"
          onclick={onOpenSettingsFromMore}
        >
          <Settings size={16} strokeWidth={2} />
          <span class="notion-more-menu__label">Settings</span>
        </button>
      </div>
    {/if}
  </header>


<style>

/*
 * Pinned chrome: sticky within #app.
 * Expanded at scroll top; compact while scrolled (smaller islands).
 */
.notion-topbar {
  /* Default (at top): compact glass, still a bit larger than scrolled state */
  --chrome-pad-y: 5px;
  --chrome-pad-x: 10px;
  --island-min-h: 32px;
  --island-pad: 2px;
  --icon-size: 28px;
  --share-h: 26px;
  --share-pad-x: 9px;
  --share-font: 11.5px;
  --crumb-font: 11.5px;
  --crumb-pad-y: 3px;
  --crumb-pad-x: 7px;
  --avatar-size: 20px;

  position: sticky;
  top: 0;
  left: 0;
  z-index: 40;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: stretch;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-height: 0;
  height: auto;
  margin: 0;
  padding: var(--chrome-pad-y) var(--chrome-pad-x) calc(var(--chrome-pad-y) - 2px);
  padding-left: max(var(--chrome-pad-x), env(safe-area-inset-left, 0px));
  padding-right: max(var(--chrome-pad-x), env(safe-area-inset-right, 0px));
  padding-top: max(var(--chrome-pad-y), env(safe-area-inset-top, 0px));
  background: transparent;
  border: none;
  overflow: visible;
  pointer-events: none;
  flex-shrink: 0;
  /* Longer ease-out so expand/collapse feels continuous, not snappy. */
  transition: padding 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: padding;
}

/* Scrolled: slightly tighter than the already-small default */
.notion-topbar--compact {
  --chrome-pad-y: 3px;
  --chrome-pad-x: 8px;
  --island-min-h: 28px;
  --island-pad: 1px;
  --icon-size: 26px;
  --share-h: 24px;
  --share-pad-x: 7px;
  --share-font: 11px;
  --crumb-font: 11px;
  --crumb-pad-y: 2px;
  --crumb-pad-x: 5px;
  --avatar-size: 18px;
}

@media (prefers-reduced-motion: reduce) {
  .notion-topbar,
  .notion-topbar__island,
  .notion-icon-btn,
  .notion-share-btn,
  .notion-presence__avatar,
  .notion-breadcrumb {
    transition-duration: 0.01ms !important;
  }
}

.notion-topbar__row {
  pointer-events: none;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  /* Full main-pane width so left island hugs the start edge and right hugs the end. */
  width: 100%;
  max-width: 100%;
  margin: 0;
}

/* Liquid glass islands — size driven by --island-* / --icon-size tokens */
.notion-topbar__island {
  pointer-events: auto;
  position: relative;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 1px;
  box-sizing: border-box;
  min-width: 0;
  min-height: var(--island-min-h);
  height: auto;
  padding: var(--island-pad);
  border-radius: 9999px;
  background:
    linear-gradient(
      180deg,
      var(--header-glass-highlight) 0%,
      transparent 46%
    ),
    var(--header-glass-bg);
  backdrop-filter: blur(22px) saturate(170%);
  -webkit-backdrop-filter: blur(22px) saturate(170%);
  border: 1px solid var(--header-glass-border);
  box-shadow: var(--header-glass-shadow);
  overflow: visible;
  isolation: isolate;
  transition:
    min-height 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    padding 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    max-width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.32s ease;
}

.notion-topbar--compact .notion-topbar__island {
  box-shadow:
    0 1px 0 var(--header-glass-inset),
    0 4px 14px rgb(15 15 15 / 0.08);
}

.notion-topbar__island--left {
  flex: 0 1 auto;
  justify-content: flex-start;
  max-width: min(55%, 480px);
  /* Clip long crumbs; individual labels use ellipsis. */
  overflow: hidden;
  /* Extra end pad only when breadcrumb segments are present. */
  padding-inline: 2px 6px;
  margin-inline-end: auto;
}

/* Sidebar toggle alone — no empty end padding. */
.notion-topbar__island--left-solo {
  padding-inline: 2px;
}

.notion-topbar--compact .notion-topbar__island--left {
  padding-inline: 1px;
}

.notion-topbar--compact .notion-topbar__island--left-solo {
  padding-inline: 1px;
}

.notion-topbar__island--right {
  flex: 0 0 auto;
  justify-content: flex-end;
  max-width: min(55%, 480px);
  overflow: visible;
  padding-inline: 4px 2px;
  margin-inline-start: auto;
}

.notion-topbar--compact .notion-topbar__island--right {
  padding-inline: 2px 1px;
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .notion-topbar__island {
    background: var(--header-bg);
  }
}

.notion-topbar__island::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 1px 0 var(--header-glass-inset);
  z-index: 0;
}

.notion-topbar__island > * {
  position: relative;
  z-index: 1;
}

@media (max-width: 768px), (hover: none) and (pointer: coarse) {
  .notion-topbar {
    --chrome-pad-x: 8px;
  }

  .notion-topbar__row {
    gap: 6px;
  }
}

.notion-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--icon-size);
  height: var(--icon-size);
  padding: 0;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: var(--header-icon);
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    height 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.16s cubic-bezier(0.34, 1.2, 0.64, 1);
  overflow: visible;
  line-height: 0;
}

.notion-icon-btn:hover {
  background: var(--header-hover);
  color: var(--header-icon-hover);
}

.notion-icon-btn:active {
  transform: scale(0.92);
}

.notion-icon-btn--active {
  color: var(--header-star);
  background: var(--header-hover);
}

.notion-icon-btn--comments {
  position: relative;
  overflow: visible;
}

.notion-icon-btn--active-comments {
  background: color-mix(in srgb, var(--comment-accent, #2383e2) 16%, transparent);
  color: var(--comment-accent, #2383e2);
}

.notion-comments-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  z-index: 1;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--comment-accent, #2383e2);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
  pointer-events: none;
  box-shadow: 0 0 0 1.5px var(--header-glass-ring, rgb(255 255 255 / 0.75));
}

.notion-breadcrumb {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
  max-width: min(42vw, 280px);
  margin-left: 1px;
  overflow: hidden;
  opacity: 1;
  transform: translateX(0);
  /* Stay mounted — animate collapse instead of {#if} remount (was glitchy). */
  transition:
    max-width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.24s ease,
    margin 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.notion-breadcrumb--collapsed {
  max-width: 0;
  margin-left: 0;
  opacity: 0;
  transform: translateX(-6px);
  pointer-events: none;
}

.notion-breadcrumb::-webkit-scrollbar {
  display: none;
}

.notion-breadcrumb__segment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--crumb-pad-y) var(--crumb-pad-x);
  border: none;
  border-radius: 9999px;
  background: transparent;
  font: inherit;
  font-size: var(--crumb-font);
  font-weight: 500;
  line-height: 1.2;
  color: var(--header-breadcrumb);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
  flex: 0 1 auto;
  min-width: 0;
  /* Hard cap so long page names become "Technical Des…" */
  max-width: min(9.5rem, 22vw);
  overflow: hidden;
}

.notion-breadcrumb__label {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notion-breadcrumb__ellipsis {
  flex: 0 0 auto;
  padding: 0 2px;
  font-size: var(--crumb-font);
  font-weight: 600;
  line-height: 1.2;
  color: var(--header-breadcrumb-sep);
  user-select: none;
}

.notion-breadcrumb__segment:hover {
  background: var(--header-hover);
  color: var(--header-breadcrumb-hover);
}

.notion-breadcrumb__chevron {
  flex-shrink: 0;
  color: var(--header-breadcrumb-sep);
}

.notion-breadcrumb__current {
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--header-breadcrumb-current);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 3ch;
  max-width: min(220px, 40vw);
}

.notion-presence {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  margin-right: 2px;
  min-width: 0;
  max-width: min(40vw, 220px);
  overflow: hidden;
}

.notion-presence__people-btn {
  position: relative;
}

.notion-presence__count {
  position: absolute;
  top: 2px;
  inset-inline-end: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--xpe-primary, #2383e2);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}

.notion-presence__avatar {
  display: grid;
  place-items: center;
  width: var(--avatar-size);
  height: var(--avatar-size);
  margin-left: -8px;
  padding: 0;
  border: 2px solid var(--avatar-border);
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    height 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.12s ease,
    opacity 0.12s ease,
    box-shadow 0.12s ease;
}

.notion-presence__avatar:hover,
.notion-presence__avatar--active {
  transform: translateY(-1px);
  box-shadow: 0 0 0 2px var(--xpe-primary, #2383e2);
  z-index: 1;
}

.notion-presence__avatar:first-of-type {
  margin-left: 2px;
}

.notion-presence__more {
  background: var(--avatar-more-bg);
  color: var(--header-muted);
  font-size: 9px;
  font-weight: 700;
}

.notion-presence__avatar--away {
  opacity: 0.45;
}

.notion-presence__hint {
  margin-left: 6px;
  font-size: 11px;
  color: var(--header-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 6rem;
}

.notion-peer-popover {
  position: fixed;
  z-index: 100;
  width: min(260px, calc(100vw - 16px));
  padding: 10px;
  border: 1px solid var(--settings-panel-border, #e9e9e7);
  border-radius: 12px;
  background: var(--settings-panel-bg, #fff);
  box-shadow: var(--settings-panel-shadow, 0 16px 40px rgb(15 15 15 / 0.12));
}

.notion-peer-popover__header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.notion-peer-popover__avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.notion-peer-popover__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.notion-peer-popover__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--settings-text, #37352f);
}

.notion-peer-popover__page {
  font-size: 12px;
  color: var(--settings-muted, #9b9a97);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notion-peer-popover__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.notion-peer-popover__action {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: var(--settings-hover, #f1f1ef);
  color: var(--settings-text, #37352f);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.notion-peer-popover__action:hover {
  background: var(--header-hover, #e9e9e7);
}

.notion-peer-popover__action--active {
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 14%, transparent);
  color: var(--xpe-primary, #2383e2);
}

.notion-peer-popover__action-hint {
  flex: 1 1 100%;
  margin-inline-start: 22px;
  font-size: 11px;
  font-weight: 400;
  color: var(--settings-muted, #9b9a97);
}

.notion-people-panel {
  position: fixed;
  z-index: 100;
  width: min(320px, calc(100vw - 16px));
  max-height: min(420px, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  padding: 10px;
  border: 1px solid var(--settings-panel-border, #e9e9e7);
  border-radius: 12px;
  background: var(--settings-panel-bg, #fff);
  box-shadow: var(--settings-panel-shadow, 0 16px 40px rgb(15 15 15 / 0.12));
}

.notion-people-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.notion-people-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--settings-text, #37352f);
}

.notion-people-panel__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--settings-muted, #9b9a97);
  cursor: pointer;
}

.notion-people-panel__close:hover {
  background: var(--settings-hover, #f1f1ef);
  color: var(--settings-text, #37352f);
}

.notion-people-panel__search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin-bottom: 8px;
  padding: 0 10px;
  border: 1px solid var(--settings-panel-border, #e9e9e7);
  border-radius: 8px;
  background: var(--settings-hover, #f1f1ef);
}

.notion-people-panel__search-icon {
  flex-shrink: 0;
  color: var(--settings-muted, #9b9a97);
}

.notion-people-panel__input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--settings-text, #37352f);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.notion-people-panel__input::placeholder {
  color: var(--settings-muted, #9b9a97);
}

.notion-people-panel__empty {
  margin: 12px 4px;
  font-size: 13px;
  color: var(--settings-muted, #9b9a97);
  text-align: center;
}

.notion-people-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.notion-people-panel__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
}

.notion-people-panel__row:hover {
  background: var(--settings-hover, #f1f1ef);
}

.notion-people-panel__avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.notion-people-panel__copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.notion-people-panel__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--settings-text, #37352f);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notion-people-panel__badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 14%, transparent);
  color: var(--xpe-primary, #2383e2);
  font-size: 10px;
  font-weight: 600;
}

.notion-people-panel__page {
  font-size: 11px;
  color: var(--settings-muted, #9b9a97);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notion-people-panel__btns {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.notion-people-panel__btn {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--settings-panel-border, #e9e9e7);
  border-radius: 6px;
  background: var(--settings-panel-bg, #fff);
  color: var(--settings-text, #37352f);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.notion-people-panel__btn:hover {
  background: var(--settings-hover, #f1f1ef);
}

.notion-people-panel__btn--active {
  border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 40%, transparent);
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 12%, transparent);
  color: var(--xpe-primary, #2383e2);
}

.notion-more-menu {
  position: fixed;
  z-index: 110;
  width: min(240px, calc(100vw - 16px));
  padding: 6px;
  border: 1px solid var(--settings-panel-border, #e9e9e7);
  border-radius: 12px;
  background: var(--settings-panel-bg, #fff);
  box-shadow: var(--settings-panel-shadow, 0 16px 40px rgb(15 15 15 / 0.12));
}

.notion-more-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--settings-text, #37352f);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.notion-more-menu__item :deep(svg) {
  flex-shrink: 0;
}

.notion-more-menu__item:hover {
  background: var(--settings-hover, #f1f1ef);
}

.notion-more-menu__label {
  font-size: 13px;
  font-weight: 600;
}

.notion-share-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--share-h);
  margin: 0 1px;
  padding: 0 var(--share-pad-x);
  border: 1px solid var(--header-glass-border);
  border-radius: 9999px;
  background: var(--header-share-bg);
  font: inherit;
  font-size: var(--share-font);
  font-weight: 600;
  line-height: 1;
  color: var(--header-share-text);
  cursor: pointer;
  transition:
    background 0.16s ease,
    height 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    padding 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    font-size 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.16s cubic-bezier(0.34, 1.2, 0.64, 1),
    box-shadow 0.16s ease;
  box-shadow: 0 1px 0 var(--header-glass-inset);
}

.notion-share-btn__icon {
  flex-shrink: 0;
}

/* Optical center: font metrics sit slightly high next to the icon. */
.notion-share-btn__label {
  padding-top: 3px;
  line-height: 1;
}

.notion-share-btn:hover {
  background: var(--header-share-bg-hover);
}

.notion-share-btn:active {
  transform: scale(0.96);
}

@media (max-width: 640px) {
  .notion-breadcrumb {
    max-width: min(48vw, 160px);
  }

  .notion-breadcrumb__segment,
  .notion-breadcrumb__current {
    max-width: min(5.5rem, 28vw);
  }

  .notion-share-btn {
    width: var(--icon-size);
    height: var(--icon-size);
    padding: 0;
    justify-content: center;
  }

  .notion-share-btn__label {
    display: none;
  }
}

</style>
