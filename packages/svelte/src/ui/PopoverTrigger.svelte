<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getContext, onMount } from 'svelte'
  import { popoverContextKey, type PopoverContext } from './popoverContext'

  let {
    disabled = false,
    children,
  }: {
    disabled?: boolean
    children?: Snippet
  } = $props()

  const ctx = getContext<PopoverContext>(popoverContextKey)
  if (!ctx) {
    throw new Error('<PopoverTrigger> must be used inside <Popover>')
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

  function toggle(event: MouseEvent): void {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    ctx.setOpen(!ctx.open)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  bind:this={root}
  class={['xpe-popover-trigger', disabled && 'xpe-popover-trigger--disabled'].filter(Boolean).join(' ')}
  onclick={toggle}
  role="button"
  tabindex={disabled ? -1 : 0}
  onkeydown={(e) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      ctx.setOpen(!ctx.open)
    }
  }}
>
  {@render children?.()}
</span>

<style>
  .xpe-popover-trigger {
    display: inline-flex;
    max-width: 100%;
  }
  .xpe-popover-trigger--disabled {
    pointer-events: none;
    opacity: 0.55;
  }
</style>
