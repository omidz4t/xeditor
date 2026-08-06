<script lang="ts">
  import type { Component, Snippet } from 'svelte'
  import MessageCircle from '@lucide/svelte/icons/message-circle'
  import { getRangeClientRects } from '@xproeditor/core'
  import type { PageComment } from '../collab/document'
  import CommentThread from './CommentThread.svelte'
  import { tick } from 'svelte'

  let {
    comments,
    anchor,
    activeId,
    /** Optional Lucide (or other) icon component. Defaults to MessageCircle. */
    icon: Icon = MessageCircle,
    /** Optional full custom icon content (wins over `icon` when provided). */
    iconSnippet,
    onselect,
    onreply,
  }: {
    comments: PageComment[]
    anchor: HTMLElement | null
    activeId: string | null
    icon?: Component
    iconSnippet?: Snippet
    onselect?: (commentId: string | null) => void
    onreply?: (commentId: string, text: string) => void
  } = $props()

  type Marker = {
    id: string
    top: number
    active: boolean
  }

  type HighlightRect = {
    commentId: string
    top: number
    left: number
    width: number
    height: number
    active: boolean
  }

  let gutterEl: HTMLElement | null = $state(null)
  let markers = $state<Marker[]>([])
  let highlightRects = $state<HighlightRect[]>([])
  let panelPosition = $state({ x: 0, y: 0 })

  const visibleComments = $derived(comments.filter((comment) => !comment.resolved))

  const activeComment = $derived(
    activeId ? comments.find((comment) => comment.id === activeId) ?? null : null,
  )

  function getTextEl(blockId: string): HTMLElement | null {
    if (!anchor) return null
    const blockEl = anchor.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
    return blockEl?.querySelector('[contenteditable="true"]') as HTMLElement | null
  }

  function updateLayout() {
    if (!anchor) {
      markers = []
      highlightRects = []
      return
    }

    const box = anchor.getBoundingClientRect()
    const nextMarkers: Marker[] = []
    const nextRects: HighlightRect[] = []

    for (const comment of visibleComments) {
      const textEl = getTextEl(comment.blockId)
      if (!textEl) continue

      const clientRects = getRangeClientRects(textEl, comment.start, comment.end)
      if (clientRects.length === 0) continue

      const first = clientRects[0]
      const last = clientRects[clientRects.length - 1]
      const centerY = first.top + (last.bottom - first.top) / 2
      const active = comment.id === activeId

      nextMarkers.push({
        id: comment.id,
        top: centerY - box.top,
        active,
      })

      for (const rect of clientRects) {
        nextRects.push({
          commentId: comment.id,
          top: rect.top - box.top,
          left: rect.left - box.left,
          width: rect.width,
          height: rect.height,
          active,
        })
      }
    }

    markers = nextMarkers
    highlightRects = nextRects
  }

  function setPanelPosition(markerTop: number) {
    if (!anchor) return
    const box = anchor.getBoundingClientRect()
    panelPosition = {
      x: box.right + 12,
      y: box.top + markerTop - 24,
    }
  }

  function openThread(commentId: string, markerTop: number) {
    setPanelPosition(markerTop)
    onselect?.(commentId)
  }

  function onHighlightClick(commentId: string) {
    const marker = markers.find((item) => item.id === commentId)
    openThread(commentId, marker?.top ?? 0)
  }

  let ro: ResizeObserver | null = null

  function bindObservers() {
    ro?.disconnect()
    ro = null
    if (!anchor) return
    ro = new ResizeObserver(() => updateLayout())
    ro.observe(anchor)
    for (const comment of visibleComments) {
      const textEl = getTextEl(comment.blockId)
      if (textEl) ro.observe(textEl)
    }
  }

  $effect(() => {
    // track deps
    void comments
    void anchor
    void activeId
    void tick().then(() => {
      updateLayout()
      bindObservers()
      if (activeId) {
        const marker = markers.find((item) => item.id === activeId)
        if (marker) setPanelPosition(marker.top)
      }
    })
    return () => ro?.disconnect()
  })

  $effect(() => {
    window.addEventListener('scroll', updateLayout, true)
    window.addEventListener('resize', updateLayout)
    return () => {
      window.removeEventListener('scroll', updateLayout, true)
      window.removeEventListener('resize', updateLayout)
      ro?.disconnect()
    }
  })
</script>

<div bind:this={gutterEl} class="comment-gutter">
  <div class="comment-highlights absolute inset-0 overflow-visible">
    {#each highlightRects as rect, index (`${rect.commentId}-${index}`)}
      <button
        type="button"
        class="comment-highlight absolute"
        class:comment-highlight--active={rect.active}
        style="top: {rect.top}px; left: {rect.left}px; width: {rect.width}px; height: {rect.height}px"
        title={rect.active ? 'View comment' : 'Open comment'}
        onclick={() => onHighlightClick(rect.commentId)}
      ></button>
    {/each}
  </div>

  {#each markers as marker (marker.id)}
    <button
      type="button"
      class="comment-marker"
      class:comment-marker--active={marker.active}
      style="top: {marker.top}px"
      title="View comment"
      aria-label="View comment"
      onclick={() => openThread(marker.id, marker.top)}
    >
      <span class="comment-marker__icon" aria-hidden="true">
        {#if iconSnippet}
          {@render iconSnippet()}
        {:else}
          <Icon size={14} strokeWidth={2} />
        {/if}
      </span>
    </button>
  {/each}

  {#if activeComment}
    <CommentThread
      comment={activeComment}
      position={panelPosition}
      onclose={() => onselect?.(null)}
      onreply={(text) => onreply?.(activeComment.id, text)}
    />
  {/if}
</div>

<style>
.comment-gutter {
  position: absolute;
  inset: 0;
  z-index: 25;
  pointer-events: none;
}

.comment-highlight {
  border: none;
  padding: 0;
  background: rgb(255 212 0 / 0.22);
  border-bottom: 2px solid rgb(255 196 0 / 0.55);
  border-radius: 2px;
  cursor: pointer;
  pointer-events: auto;
}

.comment-highlight:hover {
  background: rgb(255 212 0 / 0.3);
}

.comment-highlight--active {
  background: rgb(255 212 0 / 0.32);
  border-bottom-color: rgb(255 170 0 / 0.85);
}

/* Circular gutter chip — sits in the page-content end inset, outside the text column. */
.comment-marker {
  position: absolute;
  right: calc(-1 * var(--page-content-inset-end, 44px) + 8px);
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  margin: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--comment-accent, #2383e2) 22%, transparent);
  border-radius: 50%;
  background: var(--comment-marker-bg, #fff8d6);
  color: var(--comment-accent, #2383e2);
  box-shadow: 0 1px 4px rgb(15 15 15 / 0.12);
  transform: translateY(-50%);
  cursor: pointer;
  pointer-events: auto;
  line-height: 0;
  overflow: hidden;
  transition: background 0.12s, transform 0.12s, border-color 0.12s, box-shadow 0.12s;
}

.comment-marker__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  line-height: 0;
  pointer-events: none;
}

/* Force any passed SVG/icon to fill the centered icon box. */
.comment-marker__icon :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.comment-marker:hover,
.comment-marker--active {
  background: var(--comment-marker-active-bg, #ffe89a);
  border-color: color-mix(in srgb, var(--comment-accent, #2383e2) 40%, transparent);
  box-shadow: 0 2px 8px rgb(15 15 15 / 0.14);
  transform: translateY(-50%) scale(1.06);
}

.comment-marker:focus-visible {
  outline: 2px solid var(--comment-accent, #2383e2);
  outline-offset: 2px;
}

@media (max-width: 768px) {
  .comment-marker {
    right: calc(-1 * var(--page-content-inset-end, 28px) + 4px);
    width: 26px;
    height: 26px;
    min-width: 26px;
    min-height: 26px;
  }
}
</style>
