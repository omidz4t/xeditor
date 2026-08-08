<script lang="ts">
  import type { Snippet } from 'svelte'
  import { onDestroy, tick } from 'svelte'
  import { EMOJI_PRESETS } from './emojiPresets'

  // No fallback on $bindable — parent may bind undefined (page icon unset).
  let {
    value = $bindable() as string | null | undefined,
    disabled = false,
    align = 'start',
    side = 'bottom',
    allowRemove = false,
    onchange,
    trigger,
    children,
  }: {
    value?: string | null | undefined
    disabled?: boolean
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'bottom' | 'left' | 'right'
    allowRemove?: boolean
    onchange?: (value: string | null | undefined) => void
    trigger?: Snippet<[{ selected: string | null | undefined; isIconify: boolean; open: boolean }]>
    children?: Snippet
  } = $props()

  let open = $state(false)
  let customValue = $state('')
  let rootEl: HTMLElement | null = $state(null)
  let panelEl: HTMLElement | null = $state(null)
  /** Optional external anchor (e.g. "Add icon" / "Change icon" control button). */
  let externalAnchor: HTMLElement | null = $state(null)
  let panelStyle = $state('position:fixed;top:0;left:0;z-index:10060')

  const PANEL_WIDTH = 280
  const EDGE = 8

  $effect(() => {
    if (!open) {
      customValue = ''
      externalAnchor = null
    }
  })

  function pick(icon: string): void {
    value = icon
    onchange?.(icon)
    open = false
  }

  function removeIcon(): void {
    value = null
    onchange?.(null)
    open = false
  }

  function applyCustom(): void {
    const v = customValue.trim()
    if (!v) return
    value = v
    onchange?.(v)
    customValue = ''
    open = false
  }

  function readDir(el: HTMLElement | null): 'ltr' | 'rtl' {
    if (!el) {
      const d = document.documentElement.getAttribute('dir') || document.documentElement.dir
      return d === 'rtl' ? 'rtl' : 'ltr'
    }
    const d = getComputedStyle(el).direction
    return d === 'rtl' ? 'rtl' : 'ltr'
  }

  function reposition(): void {
    const anchor = externalAnchor ?? rootEl
    const panel = panelEl
    if (!anchor || !panel) return

    const rect = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(PANEL_WIDTH, vw - EDGE * 2)
    const dir = readDir(anchor)

    // Cap height so the panel never spills past the viewport; grid scrolls inside.
    const maxPanelH = Math.min(360, vh - EDGE * 2)
    panel.style.maxHeight = `${maxPanelH}px`
    panel.style.width = `${width}px`

    const pr = panel.getBoundingClientRect()
    const height = Math.min(pr.height || 240, maxPanelH)

    let top = side === 'top' ? rect.top - height - 6 : rect.bottom + 6

    // Map logical align (start/end) to physical left using the anchor's direction.
    let physical: 'start' | 'center' | 'end' = align
    if (dir === 'rtl') {
      if (align === 'start') physical = 'end'
      else if (align === 'end') physical = 'start'
    }

    let left = rect.left
    if (physical === 'center') left = rect.left + rect.width / 2 - width / 2
    if (physical === 'end') left = rect.right - width

    // Empty / zero-size trigger (page title invisible anchor) — bias to reading start.
    if (rect.width < 2 && rect.height < 2) {
      left =
        dir === 'rtl'
          ? Math.min(Math.max(EDGE, vw - width - 48), vw - width - EDGE)
          : Math.min(Math.max(EDGE, 48), vw - width - EDGE)
      top = Math.min(Math.max(EDGE, rect.top || 120), vh - height - EDGE)
    }

    // Flip vertically if it would overflow the viewport edge.
    if (side !== 'top' && top + height > vh - EDGE) {
      const above = rect.top - height - 6
      if (above >= EDGE) top = above
    } else if (side === 'top' && top < EDGE) {
      const below = rect.bottom + 6
      if (below + height <= vh - EDGE) top = below
    }

    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - width - EDGE))
    top = Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - height - EDGE))

    panelStyle = `position:fixed;top:${top}px;left:${left}px;z-index:10060;width:${width}px;max-height:${maxPanelH}px`
  }

  function onOutsideDown(event: MouseEvent): void {
    const t = event.target as Node
    if (panelEl?.contains(t)) return
    if (rootEl?.contains(t)) return
    // Page title "Add icon" / "Change icon" live outside the trigger span
    if ((t as HTMLElement).closest?.('.xeditor-page-control')) return
    open = false
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') open = false
  }

  $effect(() => {
    if (!open) return

    let removeOutside: (() => void) | undefined
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', onOutsideDown, true)
      removeOutside = () => window.removeEventListener('mousedown', onOutsideDown, true)
    }, 0)

    void tick().then(() => {
      reposition()
      requestAnimationFrame(() => reposition())
    })
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('keydown', onKeydown)

    return () => {
      window.clearTimeout(timer)
      removeOutside?.()
      window.removeEventListener('mousedown', onOutsideDown, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  onDestroy(() => {
    window.removeEventListener('mousedown', onOutsideDown, true)
    window.removeEventListener('resize', reposition)
    window.removeEventListener('scroll', reposition, true)
    window.removeEventListener('keydown', onKeydown)
  })

  export function openPicker(_tab?: 'emoji' | 'icon', anchor?: HTMLElement | null) {
    if (disabled) return
    externalAnchor = anchor ?? null
    open = true
  }

  export function close() {
    open = false
    externalAnchor = null
  }

  export function toggle(anchor?: HTMLElement | null) {
    if (disabled) return
    if (open) {
      open = false
      externalAnchor = null
      return
    }
    externalAnchor = anchor ?? null
    open = true
  }

  function onTriggerClick(e: MouseEvent) {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    // Clicking the built-in trigger always anchors to the root, not an external control.
    externalAnchor = null
    open = !open
  }

  function portalToBody(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node)
      },
    }
  }
</script>

<span
  bind:this={rootEl}
  class="xpe-icon-picker-root"
  class:xpe-icon-picker-root--disabled={disabled}
>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <span
    class="xpe-icon-picker-trigger"
    onclick={onTriggerClick}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onTriggerClick(e as unknown as MouseEvent)
      }
    }}
    role="button"
    tabindex={disabled ? -1 : 0}
  >
    {#if trigger}
      {@render trigger({ selected: value, isIconify: false, open })}
    {:else if children}
      {@render children()}
    {:else}
      <button type="button" class="xpe-icon-trigger" {disabled}>
        {value || '💡'}
      </button>
    {/if}
  </span>
</span>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={panelEl}
    class="xpe-icon-popover"
    style={panelStyle}
    use:portalToBody
    onmousedown={(e) => e.stopPropagation()}
    role="dialog"
    tabindex="-1"
    aria-label="Choose icon"
  >
    <p class="xpe-icon-popover__label">Emoji</p>
    <div class="xpe-icon-grid" role="listbox" aria-label="Emoji presets">
      {#each EMOJI_PRESETS as emoji (emoji)}
        <button
          type="button"
          class="xpe-icon-cell"
          class:xpe-icon-cell--active={emoji === value}
          role="option"
          aria-selected={emoji === value}
          title={emoji}
          onclick={() => pick(emoji)}
        >
          <span class="xpe-icon-cell__glyph">{emoji}</span>
        </button>
      {/each}
    </div>
    <div class="xpe-icon-custom">
      <input
        bind:value={customValue}
        type="text"
        maxlength="8"
        placeholder="Custom emoji"
        class="xpe-icon-custom-input"
        aria-label="Custom emoji"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            applyCustom()
          }
        }}
      />
      <button type="button" class="xpe-icon-custom-apply" onclick={applyCustom}>Set</button>
    </div>
    {#if allowRemove && value}
      <button type="button" class="xpe-icon-remove" onclick={removeIcon}>Remove icon</button>
    {/if}
  </div>
{/if}

<style>
  .xpe-icon-picker-root {
    display: inline-flex;
    max-width: 100%;
  }
  .xpe-icon-picker-root--disabled {
    pointer-events: none;
    opacity: 0.55;
  }
  .xpe-icon-picker-trigger {
    display: inline-flex;
    max-width: 100%;
  }
  .xpe-icon-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    color: var(--xpe-foreground, #1f2937);
  }

  /* Portaled panel — styles must be :global (host is under body). */
  :global(.xpe-icon-popover) {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    max-width: calc(100vw - 16px);
    max-height: min(360px, calc(100vh - 16px));
    padding: 10px 10px 8px;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid var(--xpe-popover-border, var(--xpe-border, #e9e9e7));
    background: var(--xpe-popover-bg, var(--xpe-background, #ffffff));
    color: var(--xpe-foreground, #1f2937);
    box-shadow:
      0 10px 24px rgb(15 15 15 / 0.12),
      0 2px 6px rgb(15 15 15 / 0.06);
    isolation: isolate;
  }

  :global(.xpe-icon-popover .xpe-icon-popover__label) {
    flex-shrink: 0;
    margin: 0 2px 8px;
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--xpe-muted-foreground, #9b9a97);
  }

  :global(.xpe-icon-popover .xpe-icon-grid) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 4px;
    padding: 2px;
    margin: 0 -2px;
  }

  :global(.xpe-icon-popover .xpe-icon-cell) {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: auto;
    padding: 0;
    border-radius: 8px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: inherit;
    line-height: 1;
    overflow: visible;
  }

  :global(.xpe-icon-popover .xpe-icon-cell__glyph) {
    display: block;
    font-size: clamp(15px, 4.2vw, 18px);
    line-height: 1;
    max-width: none;
    overflow: visible;
    text-align: center;
    transform: scale(1);
    transform-origin: center center;
    transition: transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform;
  }

  :global(.xpe-icon-popover .xpe-icon-cell:hover) {
    background: var(--xpe-hover, #f3f4f6);
  }

  :global(.xpe-icon-popover .xpe-icon-cell:hover .xpe-icon-cell__glyph) {
    transform: scale(1.18);
  }

  :global(.xpe-icon-popover .xpe-icon-cell:active .xpe-icon-cell__glyph) {
    transform: scale(1.08);
  }

  :global(.xpe-icon-popover .xpe-icon-cell--active) {
    background: var(--xpe-active, #eef2ff);
    box-shadow: inset 0 0 0 1.5px var(--xpe-primary, #4f46e5);
  }

  :global(.xpe-icon-popover .xpe-icon-custom) {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--xpe-border, #f3f4f6);
  }

  :global(.xpe-icon-popover .xpe-icon-custom-input) {
    box-sizing: border-box;
    flex: 1 1 auto;
    min-width: 0;
    width: 0;
    height: 30px;
    border: 1px solid var(--xpe-border, #e5e7eb);
    border-radius: 8px;
    padding: 0 8px;
    font-size: 13px;
    outline: none;
    background: var(--xpe-background, #fff);
    color: var(--xpe-foreground, #1f2937);
  }

  :global(.xpe-icon-popover .xpe-icon-custom-input:focus) {
    border-color: color-mix(in srgb, var(--xpe-primary, #4f46e5) 55%, var(--xpe-border, #e5e7eb));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--xpe-primary, #4f46e5) 18%, transparent);
  }

  :global(.xpe-icon-popover .xpe-icon-custom-apply) {
    flex: 0 0 auto;
    height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    border: none;
    background: var(--xpe-primary, #4f46e5);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  :global(.xpe-icon-popover .xpe-icon-remove) {
    flex-shrink: 0;
    width: 100%;
    margin-top: 6px;
    padding: 7px 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--xpe-muted-foreground, #6b7280);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
  }

  :global(.xpe-icon-popover .xpe-icon-remove:hover) {
    background: var(--xpe-hover, #f3f4f6);
    color: var(--xpe-foreground, #1f2937);
  }

  @media (max-width: 360px) {
    :global(.xpe-icon-popover .xpe-icon-grid) {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
  }
</style>
