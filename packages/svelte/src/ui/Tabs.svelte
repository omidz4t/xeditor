<script lang="ts">
  import type { Snippet } from 'svelte'
  import { setContext } from 'svelte'
  import { tabsContextKey, type TabsContext } from './tabsContext'

  let {
    value = $bindable(),
    class: className = '',
    children,
  }: {
    value: string
    class?: string
    children?: Snippet
  } = $props()

  const ctx: TabsContext = {
    get active() {
      return value
    },
    set active(v: string) {
      value = v
    },
    setActive: (v: string) => {
      value = v
    },
  }
  setContext(tabsContextKey, ctx)
</script>

<div class={['xpe-tabs', className].filter(Boolean).join(' ')}>
  {@render children?.()}
</div>
