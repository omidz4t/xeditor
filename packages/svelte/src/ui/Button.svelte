<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '../utils/cn'
  import { hoverTooltip } from './hoverTooltip'

  let {
    type = 'button',
    variant = 'default',
    size = 'md',
    disabled = false,
    title = '',
    class: className = '',
    children,
    onclick,
  }: {
    type?: 'button' | 'submit' | 'reset'
    variant?: 'default' | 'outline' | 'ghost'
    size?: 'sm' | 'md' | 'icon'
    disabled?: boolean
    /** Delayed hover tip (1s). Also used as aria-label when size is icon. */
    title?: string
    class?: string
    children?: Snippet
    onclick?: (e: MouseEvent) => void
  } = $props()
</script>

<button
  {type}
  class={cn('xpe-btn', `xpe-btn--${variant}`, `xpe-btn--${size}`, className)}
  {disabled}
  aria-label={title || undefined}
  use:hoverTooltip={title || null}
  {onclick}
>
  {@render children?.()}
</button>

<style>
  .xpe-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 8px;
    border: 1px solid transparent;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
    white-space: nowrap;
  }
  .xpe-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .xpe-btn--md {
    height: 36px;
    padding: 0 14px;
    font-size: 13px;
  }
  .xpe-btn--sm {
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
  }
  .xpe-btn--icon {
    height: 32px;
    width: 32px;
    padding: 0;
  }
  .xpe-btn--default {
    background: var(--xpe-primary, #4f46e5);
    color: #fff;
  }
  .xpe-btn--default:hover:not(:disabled) {
    filter: brightness(0.92);
  }
  .xpe-btn--outline {
    background: var(--xpe-popover-bg, #fff);
    border-color: var(--xpe-border, #e5e7eb);
    color: var(--xpe-foreground, #374151);
  }
  .xpe-btn--outline:hover:not(:disabled) {
    background: var(--xpe-hover, #f9fafb);
  }
  .xpe-btn--ghost {
    background: transparent;
    color: var(--xpe-foreground, #374151);
  }
  .xpe-btn--ghost:hover:not(:disabled) {
    background: var(--xpe-hover, #f3f4f6);
  }
</style>
