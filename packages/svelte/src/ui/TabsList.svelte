<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    class: className = '',
    children,
  }: {
    class?: string
    children?: Snippet
  } = $props()
</script>

<div class={['xpe-tabs-list', className].filter(Boolean).join(' ')}>
  {@render children?.()}
</div>

<style>
  .xpe-tabs-list {
    display: grid;
    gap: 4px;
    background: #f3f4f6;
    border-radius: 8px;
    padding: 3px;
  }
</style>
