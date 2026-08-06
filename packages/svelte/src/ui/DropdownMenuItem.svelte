<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getContext } from 'svelte'
  import { popoverContextKey, type PopoverContext } from './popoverContext'

  let {
    class: className = '',
    children,
    onclick,
  }: {
    class?: string
    children?: Snippet
    onclick?: (e: MouseEvent) => void
  } = $props()

  const ctx = getContext<PopoverContext | undefined>(popoverContextKey)

  function onItemClick(e: MouseEvent) {
    onclick?.(e)
    if (!e.defaultPrevented) ctx?.setOpen(false)
  }
</script>

<button type="button" class={`xpe-dropdown-item ${className}`.trim()} onclick={onItemClick}>
  {@render children?.()}
</button>

<style>
  .xpe-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: transparent;
    border-radius: 6px;
    font-size: 13px;
    color: var(--xpe-foreground, #37352f);
    cursor: pointer;
    text-align: start;
    font: inherit;
  }
  .xpe-dropdown-item:hover {
    background: var(--xpe-hover, #f1f1ef);
    color: var(--xpe-foreground, #37352f);
  }
</style>
