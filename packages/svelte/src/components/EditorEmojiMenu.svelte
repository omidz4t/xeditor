<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { searchEmojis, type EmojiEntry } from '../ui/emojiCatalog'

  let {
    query,
    position,
    onselect,
    onclose: _onclose,
  }: {
    query: string
    position: { x: number; y: number }
    onselect?: (item: EmojiEntry) => void
    onclose?: () => void
  } = $props()

  let activeIndex = $state(0)
  let listEl = $state<HTMLElement | null>(null)
  let rootEl = $state<HTMLElement | null>(null)
  let placeStyle = $state('')

  let filtered = $derived(searchEmojis(query, 48))

  $effect(() => {
    void query
    activeIndex = 0
  })

  $effect(() => {
    const items = filtered
    if (activeIndex >= items.length) {
      activeIndex = Math.max(0, items.length - 1)
    }
  })

  function clampToViewport() {
    const el = rootEl
    if (!el) return
    const edge = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(el.offsetWidth || 288, vw - edge * 2)
    const height = Math.min(el.offsetHeight || 320, vh - edge * 2)

    let left = position.x
    let top = position.y
    left = Math.min(Math.max(edge, left), Math.max(edge, vw - width - edge))
    top = Math.min(Math.max(edge, top), Math.max(edge, vh - height - edge))

    const maxH = Math.min(320, vh - edge * 2)
    placeStyle = `left:${left}px;top:${top}px;width:${width}px;max-height:${maxH}px`
  }

  $effect(() => {
    void position.x
    void position.y
    void filtered.length
    void tick().then(() => {
      clampToViewport()
      requestAnimationFrame(() => clampToViewport())
    })
  })

  onMount(() => {
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
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
    const item = filtered[activeIndex] ?? filtered[0]
    if (item) onselect?.(item)
  }

  function pick(item: EmojiEntry) {
    onselect?.(item)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={rootEl}
  class="emoji-menu"
  style={placeStyle || `left:${position.x}px;top:${position.y}px`}
  onmousedown={(e) => e.preventDefault()}
  onpointerdown={(e) => e.preventDefault()}
>
  <p class="emoji-menu-heading">Emoji</p>
  {#if filtered.length === 0}
    <div class="emoji-menu-empty">
      No matches for “{query}”
    </div>
  {:else}
    <div bind:this={listEl} class="emoji-menu-list">
      {#each filtered as item, idx (`${item.name}-${item.emoji}`)}
        <button
          type="button"
          class="emoji-menu-item"
          class:emoji-menu-item--active={idx === activeIndex}
          data-active={idx === activeIndex}
          onmouseenter={() => {
            activeIndex = idx
          }}
          onpointerdown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            pick(item)
          }}
          onclick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            pick(item)
          }}
        >
          <span class="emoji-menu-glyph" aria-hidden="true">{item.emoji}</span>
          <span class="emoji-menu-copy">
            <span class="emoji-menu-name">:{item.name}:</span>
            {#if item.aliases?.length}
              <span class="emoji-menu-alias">
                {item.aliases.slice(0, 2).join(', ')}
              </span>
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
  <p class="emoji-menu-footer">↑↓ navigate · Enter insert · Esc close</p>
</div>

<style>
  .emoji-menu {
    position: fixed;
    z-index: 80;
    box-sizing: border-box;
    width: min(18rem, calc(100vw - 16px));
    max-width: calc(100vw - 16px);
    max-height: min(20rem, calc(100vh - 16px));
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    padding: 6px 0 0;
    border-radius: 12px;
    background: var(--xpe-popover-bg, #fff);
    border: 1px solid var(--xpe-popover-border, #f3f4f6);
    box-shadow: 0 16px 40px rgb(15 15 15 / 0.12);
  }

  .emoji-menu-heading {
    flex-shrink: 0;
    margin: 0;
    padding: 4px 12px 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--xpe-muted-foreground, #9b9a97);
  }

  .emoji-menu-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: 4px;
  }

  .emoji-menu-empty {
    flex-shrink: 0;
    padding: 16px 12px;
    font-size: 13px;
    color: var(--xpe-muted-foreground, #9b9a97);
    text-align: center;
    overflow-wrap: anywhere;
  }

  .emoji-menu-item {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 6px 12px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s;
  }

  .emoji-menu-item:hover,
  .emoji-menu-item--active {
    background: var(--xpe-hover, #f1f1ef);
  }

  .emoji-menu-glyph {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 8px;
    background: var(--xpe-muted, #f7f6f3);
    font-size: 18px;
    line-height: 1;
    overflow: hidden;
  }

  .emoji-menu-copy {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }

  .emoji-menu-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--xpe-foreground, #37352f);
    font-family: var(--xpe-font-mono, ui-monospace, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .emoji-menu-alias {
    font-size: 11px;
    color: var(--xpe-muted-foreground, #9b9a97);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .emoji-menu-footer {
    flex-shrink: 0;
    margin: 0;
    padding: 6px 12px;
    border-top: 1px solid var(--xpe-border, #e9e9e7);
    font-size: 10px;
    color: var(--xpe-muted-foreground, #9b9a97);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
