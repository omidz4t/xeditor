<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getContext, onMount } from 'svelte'
  import { popoverContextKey, type PopoverContext } from './popoverContext'

  let {
    asChild: _asChild = false,
    children,
  }: {
    asChild?: boolean
    children?: Snippet
  } = $props()

  const ctx = getContext<PopoverContext>(popoverContextKey)
  if (!ctx) {
    throw new Error('<DropdownMenuTrigger> must be used inside <DropdownMenu>')
  }

  let root: HTMLElement | null = $state(null)

  function syncTriggerEl(): void {
    ctx.triggerEl.current = root
  }

  onMount(syncTriggerEl)
  $effect(() => {
    void root
    syncTriggerEl()
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<span
  bind:this={root}
  role="button"
  tabindex="0"
  onclick={() => ctx.setOpen(!ctx.open)}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      ctx.setOpen(!ctx.open)
    }
  }}
>
  {@render children?.()}
</span>
