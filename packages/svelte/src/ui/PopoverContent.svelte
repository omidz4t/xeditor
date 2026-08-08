<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getContext, onDestroy, tick } from 'svelte'
  import { popoverContextKey, type PopoverContext } from './popoverContext'

  let {
    align = 'start',
    side = 'bottom',
    sideOffset = 6,
    class: className = '',
    children,
    onmousedown,
  }: {
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'bottom' | 'left' | 'right'
    sideOffset?: number
    class?: string
    children?: Snippet
    onmousedown?: (e: MouseEvent) => void
  } = $props()

  const ctx = getContext<PopoverContext>(popoverContextKey)
  if (!ctx) {
    throw new Error('<PopoverContent> must be used inside <Popover>')
  }

  let contentEl: HTMLElement | null = $state(null)
  let style = $state<Record<string, string>>({ position: 'fixed', top: '0px', left: '0px' })

  function portalToBody(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node)
      },
    }
  }

  function reposition(): void {
    const trigger = ctx.triggerEl.current
    const content = contentEl
    if (!trigger || !content) return

    const anchor = (trigger.firstElementChild as HTMLElement | null) ?? trigger
    const rect = anchor.getBoundingClientRect()
    // Zero-size trigger (empty icon anchor) — fall back to trigger box / viewport.
    const useRect =
      rect.width < 1 && rect.height < 1 ? trigger.getBoundingClientRect() : rect
    const contentRect = content.getBoundingClientRect()
    const edge = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = contentRect.width || 232
    const height = contentRect.height || 200

    let resolvedSide = side
    let top = useRect.bottom + sideOffset
    let left = useRect.left

    if (resolvedSide === 'bottom' && useRect.bottom + sideOffset + height > vh - edge) {
      if (useRect.top - sideOffset - height >= edge) {
        resolvedSide = 'top'
      }
    }

    if (resolvedSide === 'top') top = useRect.top - height - sideOffset
    if (resolvedSide === 'left') {
      top = useRect.top
      left = useRect.left - width - sideOffset
    }
    if (resolvedSide === 'right') {
      top = useRect.top
      left = useRect.right + sideOffset
    }

    if (resolvedSide === 'top' || resolvedSide === 'bottom') {
      if (align === 'center') left = useRect.left + useRect.width / 2 - width / 2
      if (align === 'end') left = useRect.right - width
    }

    // If trigger is empty (Add icon), keep panel near page controls / left content.
    if (useRect.width < 1 && useRect.height < 1) {
      left = Math.max(edge, Math.min(left || 48, vw - width - edge))
      top = Math.max(edge, Math.min(top || 120, vh - height - edge))
    }

    const maxLeft = Math.max(edge, vw - width - edge)
    left = Math.min(Math.max(edge, left), maxLeft)

    const maxTop = Math.max(edge, vh - height - edge)
    top = Math.min(Math.max(edge, top), maxTop)

    style = {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      maxWidth: `${Math.max(160, vw - edge * 2)}px`,
      maxHeight: `${Math.max(120, vh - edge * 2)}px`,
      overflow: 'auto',
      zIndex: '10060',
    }
  }

  function onOutsideDown(event: MouseEvent): void {
    if (document.body.dataset.colorPickerDragging === 'true') return

    const target = event.target as Node
    if (contentEl?.contains(target)) return
    if (ctx.triggerEl.current?.contains(target)) return
    // "Add icon" / "Change icon" control buttons sit outside the trigger.
    if ((target as HTMLElement).closest?.('.xeditor-page-control')) return

    ctx.setOpen(false)
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') ctx.setOpen(false)
  }

  $effect(() => {
    if (!ctx.open) return

    // Defer outside-listener so the opening click doesn't immediately close us.
    let removeOutside: (() => void) | undefined
    const listenTimer = window.setTimeout(() => {
      window.addEventListener('mousedown', onOutsideDown, true)
      removeOutside = () => window.removeEventListener('mousedown', onOutsideDown, true)
    }, 0)

    void tick().then(() => {
      reposition()
      // Second pass after layout/fonts.
      requestAnimationFrame(() => reposition())
    })
    window.addEventListener('resize', reposition)
    window.addEventListener('keydown', onKeydown)

    return () => {
      window.clearTimeout(listenTimer)
      removeOutside?.()
      window.removeEventListener('mousedown', onOutsideDown, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  onDestroy(() => {
    window.removeEventListener('mousedown', onOutsideDown, true)
    window.removeEventListener('resize', reposition)
    window.removeEventListener('keydown', onKeydown)
  })
</script>

{#if ctx.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={contentEl}
    class={['xpe-popover-content', className].filter(Boolean).join(' ')}
    style={Object.entries(style)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
      .join(';')}
    onmousedown={(e) => {
      e.stopPropagation()
      onmousedown?.(e)
    }}
    use:portalToBody
  >
    {@render children?.()}
  </div>
{/if}

<style>
  .xpe-popover-content {
    z-index: 10060;
    border-radius: 12px;
    border: 1px solid var(--xpe-popover-border, var(--xpe-border, #e9e9e7));
    background: var(--xpe-popover-bg, var(--xpe-background, #ffffff));
    color: var(--xpe-foreground, #37352f);
    box-shadow:
      0 10px 24px rgb(15 15 15 / 0.12),
      0 2px 6px rgb(15 15 15 / 0.06);
    color-scheme: inherit;
    isolation: isolate;
    opacity: 1;
  }
</style>
