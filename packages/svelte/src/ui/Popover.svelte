<script lang="ts">
  import type { Snippet } from 'svelte'
  import { setContext } from 'svelte'
  import { popoverContextKey, type PopoverContext } from './popoverContext'

  /**
   * Controlled when parent uses bind:open; otherwise internal.
   * Context exposes a $state bag so PopoverContent/Trigger react to open changes.
   */
  let {
    open = $bindable(false),
    children,
  }: {
    open?: boolean
    children?: Snippet
  } = $props()

  let triggerEl = { current: null as HTMLElement | null }

  /** Shared reactive state for descendants via context. */
  const ctx = $state<PopoverContext & { setOpen: (value: boolean) => void }>({
    open: false as boolean,
    triggerEl,
    setOpen(value: boolean) {
      ctx.open = value
      open = value
    },
  })

  // Keep context in sync when parent drives bind:open.
  $effect(() => {
    ctx.open = !!open
  })

  setContext(popoverContextKey, ctx)
</script>

{@render children?.()}
