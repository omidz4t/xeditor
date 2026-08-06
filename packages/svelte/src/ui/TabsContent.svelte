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
    throw new Error('<TabsContent> must be used inside <Tabs>')
  }
</script>

{#if ctx.active === value}
  <div class={['xpe-tabs-content', className].filter(Boolean).join(' ')}>
    {@render children?.()}
  </div>
{/if}
