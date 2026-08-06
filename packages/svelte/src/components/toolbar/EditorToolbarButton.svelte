<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '../../utils/cn'
  import { hoverTooltip } from '../../ui/hoverTooltip'

  let {
    active = false,
    disabled = false,
    title = '',
    wide = false,
    class: className = '',
    children,
    onclick,
    onmousedown,
    onpointerdown,
  }: {
    active?: boolean
    disabled?: boolean
    /** Explainer shown after 1s hover (not native browser title). */
    title?: string
    wide?: boolean
    class?: string
    children?: Snippet
    onclick?: (e: MouseEvent) => void
    onmousedown?: (e: MouseEvent) => void
    onpointerdown?: (e: PointerEvent) => void
  } = $props()
</script>

<button
  type="button"
  class={cn(
    'ebt-btn',
    active && 'ebt-active',
    wide && '!w-auto gap-1 px-2 text-xs font-medium text-gray-600',
    className,
  )}
  {disabled}
  aria-label={title || undefined}
  data-tooltip={title || undefined}
  use:hoverTooltip={title || null}
  {onclick}
  {onmousedown}
  {onpointerdown}
>
  {@render children?.()}
</button>

<style>
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
  .ebt-btn:hover:not(:disabled) {
    background: var(--xpe-hover, #f3f4f6);
    color: var(--xpe-foreground, #111827);
  }
  .ebt-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .ebt-active {
    background: var(--xpe-active, #eef2ff);
    color: var(--xpe-primary, #4f46e5);
  }
</style>
