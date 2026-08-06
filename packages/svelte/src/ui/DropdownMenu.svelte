<script lang="ts">
  import type { Snippet } from 'svelte'
  import { setContext } from 'svelte'
  import { popoverContextKey, type PopoverContext } from './popoverContext'

  let { children }: { children?: Snippet } = $props()

  let triggerEl = { current: null as HTMLElement | null }

  const ctx = $state<PopoverContext & { setOpen: (value: boolean) => void }>({
    open: false as boolean,
    triggerEl,
    setOpen(value: boolean) {
      ctx.open = value
    },
  })

  setContext(popoverContextKey, ctx)
</script>

{@render children?.()}
