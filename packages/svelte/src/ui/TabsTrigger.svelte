<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getContext } from 'svelte'
  import { tabsContextKey, type TabsContext } from './tabsContext'

  let {
    value,
    class: className = '',
    children,
  }: {
    value: string
    class?: string
    children?: Snippet
  } = $props()

  const ctx = getContext<TabsContext>(tabsContextKey)
  if (!ctx) {
    throw new Error('<TabsTrigger> must be used inside <Tabs>')
  }

  let isActive = $derived(ctx.active === value)
</script>

<button
  type="button"
  class={['xpe-tabs-trigger', isActive && 'xpe-tabs-trigger--active', className].filter(Boolean).join(' ')}
  onclick={() => ctx.setActive(value)}
>
  {@render children?.()}
</button>

<style>
  .xpe-tabs-trigger {
    border: none;
    background: transparent;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 500;
    color: #6b7280;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .xpe-tabs-trigger:hover {
    color: #111827;
  }
  .xpe-tabs-trigger--active {
    background: #fff;
    color: #111827;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
  }
</style>
