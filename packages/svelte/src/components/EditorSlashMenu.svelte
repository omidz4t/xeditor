<script lang="ts">
  import { tick } from 'svelte'
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
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Quote from '@lucide/svelte/icons/quote'
  import Lightbulb from '@lucide/svelte/icons/lightbulb'
  import Code2 from '@lucide/svelte/icons/code-2'
  import Minus from '@lucide/svelte/icons/minus'
  import ImageIcon from '@lucide/svelte/icons/image'
  import Table2 from '@lucide/svelte/icons/table-2'
  import Smile from '@lucide/svelte/icons/smile'
  import Blocks from '@lucide/svelte/icons/blocks'
  import FileText from '@lucide/svelte/icons/file-text'
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3'
  import type { BlockType } from '@xproeditor/core'
  import type { Component } from 'svelte'

  export interface SlashItem {
    id: string
    type: BlockType
    label: string
    description: string
    keywords: string[]
    icon: Component
    /** After applying the block, open the icon picker on this tab. */
    pickIcon?: 'emoji' | 'icon'
  }

  const ITEMS: SlashItem[] = [
    { id: 'paragraph', type: 'paragraph', label: 'Text', description: 'Plain paragraph', keywords: ['text', 'paragraph', 'p'], icon: Type },
    { id: 'heading_1', type: 'heading_1', label: 'Heading 1', description: 'Large section heading', keywords: ['h1', 'heading', 'title'], icon: Heading1 },
    { id: 'heading_2', type: 'heading_2', label: 'Heading 2', description: 'Medium section heading', keywords: ['h2', 'heading', 'subtitle'], icon: Heading2 },
    { id: 'heading_3', type: 'heading_3', label: 'Heading 3', description: 'Small section heading', keywords: ['h3', 'heading'], icon: Heading3 },
    { id: 'heading_4', type: 'heading_4', label: 'Heading 4', description: 'Smaller subsection heading', keywords: ['h4', 'heading'], icon: Heading4 },
    { id: 'heading_5', type: 'heading_5', label: 'Heading 5', description: 'Fine subsection heading', keywords: ['h5', 'heading'], icon: Heading5 },
    { id: 'heading_6', type: 'heading_6', label: 'Heading 6', description: 'Finest subsection heading', keywords: ['h6', 'heading'], icon: Heading6 },
    { id: 'bulleted_list_item', type: 'bulleted_list_item', label: 'Bulleted list', description: 'Simple bullet list', keywords: ['bullet', 'list', 'ul'], icon: List },
    { id: 'numbered_list_item', type: 'numbered_list_item', label: 'Numbered list', description: 'Ordered list', keywords: ['number', 'ordered', 'ol'], icon: ListOrdered },
    { id: 'to_do', type: 'to_do', label: 'To-do', description: 'Checkbox task', keywords: ['todo', 'check', 'task'], icon: CheckSquare },
    { id: 'toggle', type: 'toggle', label: 'Toggle', description: 'Collapsible content', keywords: ['toggle', 'collapse', 'accordion', '>'], icon: ChevronRight },
    { id: 'quote', type: 'quote', label: 'Quote', description: 'Capture a quote', keywords: ['quote', 'blockquote'], icon: Quote },
    { id: 'callout', type: 'callout', label: 'Callout', description: 'Highlighted note', keywords: ['callout', 'note', 'info', 'warning'], icon: Lightbulb },
    { id: 'emoji', type: 'callout', label: 'Emoji', description: 'Callout with emoji icon', keywords: ['emoji', 'emoticon', 'smile'], icon: Smile, pickIcon: 'emoji' },
    { id: 'icon', type: 'callout', label: 'Icon', description: 'Callout with vector icon', keywords: ['icon', 'symbol', 'lucide'], icon: Blocks, pickIcon: 'icon' },
    { id: 'code', type: 'code', label: 'Code', description: 'Code block with syntax', keywords: ['code', 'snippet', 'pre'], icon: Code2 },
    { id: 'divider', type: 'divider', label: 'Divider', description: 'Horizontal line', keywords: ['divider', 'hr', 'separator', 'line'], icon: Minus },
    { id: 'page', type: 'page', label: 'Page', description: 'Link to a sub-page', keywords: ['page', 'subpage', 'link', 'reference', 'mention'], icon: FileText },
    { id: 'image', type: 'image', label: 'Image', description: 'Upload an image', keywords: ['image', 'photo', 'picture', 'upload', 'embed'], icon: ImageIcon },
    { id: 'table', type: 'table', label: 'Table', description: 'Simple table', keywords: ['table', 'grid'], icon: Table2 },
    { id: 'poll', type: 'poll', label: 'Poll', description: 'Vote on options', keywords: ['poll', 'pool', 'vote', 'voting', 'survey', 'ballot'], icon: BarChart3 },
  ]

  let {
    query,
    position,
    onselect,
    onclose,
  }: {
    query: string
    position: { x: number; y: number }
    onselect?: (item: SlashItem) => void
    onclose?: () => void
  } = $props()

  let activeIndex = $state(0)
  let listEl = $state<HTMLElement | null>(null)

  let filtered = $derived.by(() => {
    const q = query.toLowerCase().trim()
    if (!q) return ITEMS
    return ITEMS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.startsWith(q)),
    )
  })

  $effect(() => {
    void query
    activeIndex = 0
  })

  $effect(() => {
    if (filtered.length === 0) {
      onclose?.()
    }
  })

  function scrollActiveIntoView() {
    tick().then(() => {
      listEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
    })
  }

  export function move(dir: 1 | -1) {
    const len = filtered.length
    if (len === 0) return
    activeIndex = (activeIndex + dir + len) % len
    scrollActiveIntoView()
  }

  export function confirm() {
    const item = filtered[activeIndex]
    if (item) onselect?.(item)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="slash-menu"
  style:left="{position.x}px"
  style:top="{position.y}px"
  onmousedown={(e) => e.preventDefault()}
>
  <p class="slash-menu-heading">Blocks</p>
  <div bind:this={listEl}>
    {#each filtered as item, idx (item.id)}
      <button
        type="button"
        class="slash-menu-item"
        class:slash-menu-item--active={idx === activeIndex}
        data-active={idx === activeIndex}
        onmouseenter={() => {
          activeIndex = idx
        }}
        onclick={() => onselect?.(item)}
      >
        <span class="slash-menu-icon" class:slash-menu-icon--active={idx === activeIndex}>
          <item.icon class="w-4 h-4" />
        </span>
        <span class="slash-menu-copy">
          <span class="slash-menu-label">{item.label}</span>
          <span class="slash-menu-desc">{item.description}</span>
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .slash-menu {
    position: fixed;
    z-index: 80;
    width: 18rem;
    max-height: 20rem;
    overflow-y: auto;
    padding: 6px 0;
    border-radius: 12px;
    background: var(--xpe-popover-bg, #fff);
    border: 1px solid var(--xpe-popover-border, #f3f4f6);
    box-shadow: 0 16px 40px rgb(15 15 15 / 0.12);
  }

  .slash-menu-heading {
    margin: 0;
    padding: 4px 12px 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--xpe-muted-foreground, #9b9a97);
  }

  .slash-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s;
  }

  .slash-menu-item:hover,
  .slash-menu-item--active {
    background: var(--xpe-hover, #f1f1ef);
  }

  .slash-menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 8px;
    border: 1px solid var(--xpe-border, #e9e9e7);
    background: var(--xpe-muted, #f7f6f3);
    color: var(--xpe-muted-foreground, #9b9a97);
  }

  .slash-menu-icon--active {
    border-color: var(--xpe-primary, #2383e2);
    background: var(--xpe-popover-bg, #fff);
    color: var(--xpe-primary, #2383e2);
  }

  .slash-menu-copy {
    min-width: 0;
  }

  .slash-menu-label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--xpe-foreground, #37352f);
  }

  .slash-menu-desc {
    display: block;
    font-size: 11px;
    color: var(--xpe-muted-foreground, #9b9a97);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
