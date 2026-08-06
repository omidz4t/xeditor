<script lang="ts">
  import type { Snippet } from 'svelte'
  import PopoverContent from './PopoverContent.svelte'

  let {
    align = 'start',
    class: className = '',
    children,
  }: {
    align?: 'start' | 'center' | 'end'
    class?: string
    children?: Snippet
  } = $props()
</script>

<PopoverContent {align} side="bottom" sideOffset={4} class={`xpe-dropdown-content ${className}`.trim()}>
  {@render children?.()}
</PopoverContent>

<style>
  :global(.xpe-popover-content.xpe-dropdown-content) {
    padding: 4px;
    min-width: 9rem;
    background: var(--xpe-popover-bg, var(--xpe-background, #ffffff)) !important;
    color: var(--xpe-foreground, #37352f);
    border: 1px solid var(--xpe-popover-border, var(--xpe-border, #e9e9e7));
    border-radius: 10px;
    box-shadow:
      0 10px 24px rgb(15 15 15 / 0.12),
      0 2px 6px rgb(15 15 15 / 0.06);
    opacity: 1;
  }
</style>
