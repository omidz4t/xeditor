<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import type { Component } from 'svelte'
  import Bold from '@lucide/svelte/icons/bold'
  import Check from '@lucide/svelte/icons/check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Code from '@lucide/svelte/icons/code'
  import Italic from '@lucide/svelte/icons/italic'
  import Link2 from '@lucide/svelte/icons/link-2'
  import MessageSquare from '@lucide/svelte/icons/message-square'
  import Paintbrush from '@lucide/svelte/icons/paintbrush'
  import Strikethrough from '@lucide/svelte/icons/strikethrough'
  import Underline from '@lucide/svelte/icons/underline'
  import Type from '@lucide/svelte/icons/type'
  import Heading1 from '@lucide/svelte/icons/heading-1'
  import Heading2 from '@lucide/svelte/icons/heading-2'
  import Heading3 from '@lucide/svelte/icons/heading-3'
  import Heading4 from '@lucide/svelte/icons/heading-4'
  import Heading5 from '@lucide/svelte/icons/heading-5'
  import Heading6 from '@lucide/svelte/icons/heading-6'
  import List from '@lucide/svelte/icons/list'
  import ListOrdered from '@lucide/svelte/icons/list-ordered'
  import CheckSquare from '@lucide/svelte/icons/check-square'
  import Quote from '@lucide/svelte/icons/quote'
  import Lightbulb from '@lucide/svelte/icons/lightbulb'
  import type { BlockType, MarkName } from '@xproeditor/core'
  import { pageLinkMark } from '@xproeditor/core'
  import Button from '../ui/Button.svelte'
  import Input from '../ui/Input.svelte'
  import { hoverTooltip } from '../ui/hoverTooltip'
  import EditorToolbarColorPanel from './toolbar/EditorToolbarColorPanel.svelte'

  let {
    position,
    blockType,
    activeMarks = {},
    currentLink = null,
    currentColor = null,
    currentHighlight = null,
    pages = [],
    currentPageId = null,
    onmark,
    onturninto,
    oncomment,
  }: {
    position: { x: number; y: number; top?: number; bottom?: number }
    blockType: BlockType
    activeMarks?: Partial<Record<MarkName, boolean>>
    currentLink?: string | null
    currentColor?: string | null
    currentHighlight?: string | null
    pages?: Array<{ id: string; title: string; icon?: string }>
    currentPageId?: string | null
    onmark?: (mark: MarkName, value: boolean | string | null) => void
    onturninto?: (type: BlockType) => void
    oncomment?: (text: string) => void
  } = $props()

  type Panel = 'none' | 'link' | 'color' | 'comment' | 'turninto'
  let panel = $state<Panel>('none')
  let linkInput = $state('')
  let commentInput = $state('')
  let rootRef = $state<HTMLElement | null>(null)
  let commentInputRef = $state<HTMLTextAreaElement | null>(null)
  let placementStyle = $state<string>('left: 0; top: 0; transform: translateX(-50%)')

  const TURN_INTO: Array<{ type: BlockType; label: string; icon: Component }> = [
    { type: 'paragraph', label: 'Text', icon: Type },
    { type: 'heading_1', label: 'Heading 1', icon: Heading1 },
    { type: 'heading_2', label: 'Heading 2', icon: Heading2 },
    { type: 'heading_3', label: 'Heading 3', icon: Heading3 },
    { type: 'heading_4', label: 'Heading 4', icon: Heading4 },
    { type: 'heading_5', label: 'Heading 5', icon: Heading5 },
    { type: 'heading_6', label: 'Heading 6', icon: Heading6 },
    { type: 'bulleted_list_item', label: 'Bulleted list', icon: List },
    { type: 'numbered_list_item', label: 'Numbered list', icon: ListOrdered },
    { type: 'to_do', label: 'To-do', icon: CheckSquare },
    { type: 'quote', label: 'Quote', icon: Quote },
    { type: 'callout', label: 'Callout', icon: Lightbulb },
  ]

  let filteredPages = $derived.by(() => {
    const q = linkInput.trim().toLowerCase()
    if (!q) return pages.slice(0, 8)
    return pages.filter((p) => (p.title || '').toLowerCase().includes(q)).slice(0, 8)
  })

  function clampBubble() {
    if (!rootRef || typeof window === 'undefined') return
    const EDGE = 8
    /**
     * Gap between selection and toolbar.
     * Keep a bit more room so the bar (and open link/color panels) never sits on the text.
     */
    const GAP = 14
    const box = rootRef.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = box.width || 280
    const height = box.height || 44

    const selTop = position.top ?? position.y
    const selBottom = position.bottom ?? position.y + 20

    // Prefer above the selection so editing chrome never covers the line.
    let top = selTop - height - GAP
    let placedAbove = true
    if (top < EDGE) {
      // Not enough room above — place below the line instead.
      top = selBottom + GAP
      placedAbove = false
    }
    // Tall panels (link editor) near the bottom: pin inside the viewport without
    // sliding back on top of the selection when we were already above.
    if (top + height > vh - EDGE) {
      if (placedAbove) {
        // Shrink toward the top edge while staying above the selection if possible.
        top = Math.max(EDGE, Math.min(top, selTop - GAP - Math.min(height, selTop - EDGE - GAP)))
        // If we still can't fit above cleanly, allow a viewport clamp.
        if (top + height > vh - EDGE) {
          top = Math.max(EDGE, vh - height - EDGE)
        }
      } else {
        top = Math.max(EDGE, vh - height - EDGE)
      }
    }
    top = Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - height - EDGE))

    // Horizontal: center on selection midpoint, keep fully on-screen.
    let left = position.x
    left = Math.min(Math.max(left, EDGE + width / 2), vw - EDGE - width / 2)

    placementStyle =
      `left: ${left}px; top: ${top}px; transform: translateX(-50%); ` +
      `max-width: min(360px, calc(100vw - ${EDGE * 2}px)); max-height: ${Math.max(120, vh - EDGE * 2)}px`
  }

  async function scheduleClamp() {
    await tick()
    requestAnimationFrame(() => requestAnimationFrame(() => clampBubble()))
  }

  let lastPos = ''
  $effect(() => {
    const key = `${position.x},${position.y},${position.top ?? ''},${position.bottom ?? ''}`
    if (lastPos && key !== lastPos) panel = 'none'
    lastPos = key
    void scheduleClamp()
  })
  $effect(() => {
    void panel
    void scheduleClamp()
  })

  function onWindowResize() {
    void scheduleClamp()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize)
    window.addEventListener('scroll', onWindowResize, true)
  }
  onDestroy(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('resize', onWindowResize)
    window.removeEventListener('scroll', onWindowResize, true)
  })

  function openLinkPanel() {
    linkInput = currentLink ?? ''
    panel = panel === 'link' ? 'none' : 'link'
  }

  /** Force-open the link editor panel (context menu → Edit link). */
  export function openLinkEditor(seed?: string | null) {
    linkInput = (seed ?? currentLink ?? '').trim()
    panel = 'link'
    tick().then(() => {
      const input = rootRef?.querySelector('input') as HTMLInputElement | null
      input?.focus()
      input?.select()
    })
  }
  function openColorPanel() {
    panel = panel === 'color' ? 'none' : 'color'
  }
  export function openCommentPanel() {
    commentInput = ''
    panel = 'comment'
    tick().then(() => commentInputRef?.focus())
  }
  function applyComment() {
    const text = commentInput.trim()
    if (!text) return
    oncomment?.(text)
    commentInput = ''
    panel = 'none'
  }
  function applyLink() {
    const url = linkInput.trim()
    onmark?.('link', url || null)
    panel = 'none'
  }
  function applyPageLink(pageId: string) {
    onmark?.('link', pageLinkMark(pageId))
    panel = 'none'
  }
  function turnIntoLabel(): string {
    return TURN_INTO.find((t) => t.type === blockType)?.label ?? 'Text'
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={rootRef}
  class="editor-bubble-toolbar fixed z-[70] flex flex-col items-stretch"
  style={placementStyle}
  onmousedown={(e) => e.preventDefault()}
>
  <div class="bubble-panel bubble-panel--toolbar">
    <button type="button" class="ebt-btn ebt-btn--label" onclick={() => (panel = panel === 'turninto' ? 'none' : 'turninto')}>
      {turnIntoLabel()}
      <ChevronDown class="size-3" />
    </button>
    <div class="bubble-divider"></div>

    <button type="button" class="ebt-btn" class:ebt-active={!!activeMarks.bold} aria-label="Bold" use:hoverTooltip={'Bold (Ctrl+B) — make text strong'} onclick={() => onmark?.('bold', !activeMarks.bold)}><Bold class="size-3.5" /></button>
    <button type="button" class="ebt-btn" class:ebt-active={!!activeMarks.italic} aria-label="Italic" use:hoverTooltip={'Italic (Ctrl+I) — slant text'} onclick={() => onmark?.('italic', !activeMarks.italic)}><Italic class="size-3.5" /></button>
    <button type="button" class="ebt-btn" class:ebt-active={!!activeMarks.underline} aria-label="Underline" use:hoverTooltip={'Underline (Ctrl+U)'} onclick={() => onmark?.('underline', !activeMarks.underline)}><Underline class="size-3.5" /></button>
    <button type="button" class="ebt-btn" class:ebt-active={!!activeMarks.strikethrough} aria-label="Strikethrough" use:hoverTooltip={'Strikethrough — mark text as removed'} onclick={() => onmark?.('strikethrough', !activeMarks.strikethrough)}><Strikethrough class="size-3.5" /></button>
    <button type="button" class="ebt-btn" class:ebt-active={!!activeMarks.code} aria-label="Inline code" use:hoverTooltip={'Inline code (Ctrl+M)'} onclick={() => onmark?.('code', !activeMarks.code)}><Code class="size-3.5" /></button>

    <div class="bubble-divider"></div>
    <button type="button" class="ebt-btn" class:ebt-active={panel === 'link' || !!currentLink} aria-label="Link" use:hoverTooltip={'Link — attach a URL or page link'} onclick={openLinkPanel}><Link2 class="size-3.5" /></button>
    <button type="button" class="ebt-btn" class:ebt-active={panel === 'color' || !!currentColor || !!currentHighlight} aria-label="Color" use:hoverTooltip={'Color — text color and highlight'} onclick={openColorPanel}><Paintbrush class="size-3.5" /></button>
    <div class="bubble-divider"></div>
    <button type="button" class="ebt-btn" class:ebt-active={panel === 'comment'} aria-label="Comment" use:hoverTooltip={'Comment — discuss this selection'} onmousedown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); openCommentPanel() }}><MessageSquare class="size-3.5" /></button>
  </div>

  {#if panel === 'link'}
<!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bubble-panel bubble-panel--link" onmousedown={(e) => e.stopPropagation()}>
      <div class="bubble-link-row">
        <Input
          bind:value={linkInput}
          class="h-8 w-52 text-xs"
          placeholder="URL or search pages…"
          onkeydown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyLink() }
            if (e.key === 'Escape') panel = 'none'
          }}
        />
        <Button type="button" size="sm" class="h-8 px-3 text-xs" onclick={applyLink}>Set</Button>
        {#if currentLink}
          <Button type="button" variant="ghost" size="sm" class="h-8 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600" onclick={() => { onmark?.('link', null); panel = 'none' }}>Remove</Button>
        {/if}
      </div>
      {#if filteredPages.length}
        <div class="bubble-page-list">
          {#each filteredPages as page (page.id)}
            <button type="button" class="bubble-page-item" onclick={() => applyPageLink(page.id)}>
              <span class="bubble-page-icon">{page.icon || '📄'}</span>
              <span class="bubble-page-title">{page.title || 'Untitled'}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if panel === 'comment'}
<!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bubble-panel bubble-panel--sub bubble-panel--comment" onmousedown={(e) => e.stopPropagation()}>
      <textarea
        bind:this={commentInputRef}
        bind:value={commentInput}
        class="ebt-comment-input"
        rows="3"
        placeholder="Add a comment…"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyComment() }
          if (e.key === 'Escape') panel = 'none'
        }}
      ></textarea>
      <Button type="button" size="sm" class="h-8 px-3 text-xs shrink-0" onclick={applyComment}>Comment</Button>
    </div>
  {/if}

  {#if panel === 'color'}
<!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bubble-panel bubble-panel--sub" onmousedown={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <EditorToolbarColorPanel open={panel === 'color'} currentColor={currentColor} currentHighlight={currentHighlight} onmark={(mark, value) => onmark?.(mark, value)} />
    </div>
  {/if}

  {#if panel === 'turninto'}
    <div class="bubble-panel bubble-panel--menu">
      {#each TURN_INTO as t (t.type)}
        <button type="button" class="bubble-menu-item" class:bubble-menu-item--active={t.type === blockType} onclick={() => { onturninto?.(t.type); panel = 'none' }}>
          <t.icon class="size-3.5 shrink-0 bubble-menu-icon" />
          <span class="flex-1">{t.label}</span>
          {#if t.type === blockType}<Check class="size-3.5 shrink-0 bubble-menu-check" />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>

.bubble-panel {
  border-radius: 12px;
  border: 1px solid var(--xpe-popover-border, #f3f4f6);
  background: var(--xpe-popover-bg, #fff);
  box-shadow: 0 16px 40px rgb(15 15 15 / 0.12);
}

.bubble-panel--toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
}

.editor-bubble-toolbar {
  max-width: min(360px, calc(100vw - 16px));
  overflow-x: hidden;
  overflow-y: auto;
}

.bubble-panel--sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 8px;
  max-width: 100%;
  overflow: auto;
}

.bubble-panel--link {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 8px;
  min-width: 15rem;
}

.bubble-link-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bubble-page-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}

.bubble-page-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.bubble-page-item:hover {
  background: var(--xpe-hover, #f3f4f6);
}

.bubble-page-icon {
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.bubble-page-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--xpe-foreground, #111827);
}

.bubble-panel--comment {
  align-items: flex-end;
}

.ebt-comment-input {
  width: 220px;
  resize: vertical;
  min-height: 64px;
  max-height: 140px;
  padding: 8px 10px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 8px;
  background: var(--xpe-background, #fff);
  color: var(--xpe-foreground, #111827);
  font-size: 13px;
  line-height: 1.4;
  font-family: inherit;
}

.ebt-comment-input:focus {
  outline: none;
  border-color: var(--xpe-primary, #4f46e5);
  box-shadow: 0 0 0 2px rgb(79 70 229 / 0.12);
}

.bubble-panel--menu {
  width: 12rem;
  margin-top: 6px;
  padding: 4px 0;
}

.bubble-divider {
  width: 1px;
  height: 20px;
  margin: 0 2px;
  background: var(--xpe-border, #e9e9e7);
}

.bubble-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13px;
  color: var(--xpe-foreground, #374151);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.bubble-menu-item:hover {
  background: var(--xpe-hover, #f9fafb);
}

.bubble-menu-item--active {
  background: var(--xpe-active, rgb(99 102 241 / 0.06));
  color: var(--xpe-primary, #4f46e5);
}

.bubble-menu-icon {
  color: var(--xpe-muted-foreground, #9ca3af);
}

.bubble-menu-check {
  color: var(--xpe-primary, #4f46e5);
}

.ebt-btn--label {
  width: auto !important;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--xpe-muted-foreground, #6b7280);
}

.ebt-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--xpe-muted-foreground, #6b7280);
    cursor: pointer;
    transition:
        background 0.1s,
        color 0.1s;
}
.ebt-btn:hover {
    background: var(--xpe-hover, #f3f4f6);
    color: var(--xpe-foreground, #111827);
}
.ebt-active {
    background: var(--xpe-active, #eef2ff);
    color: var(--xpe-primary, #4f46e5);
}

.ebt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--xpe-muted-foreground, #6b7280);
  cursor: pointer;
}
.ebt-btn:hover { background: var(--xpe-hover, #f3f4f6); color: var(--xpe-foreground, #111827); }
.ebt-btn--label { width: auto; gap: 4px; padding: 0 8px; font-size: 12px; font-weight: 500; }
.ebt-active { background: var(--xpe-active, #eef2ff); color: var(--xpe-primary, #4f46e5); }
.bubble-divider { width: 1px; height: 18px; background: var(--xpe-border, #e5e7eb); margin: 0 2px; }
</style>
