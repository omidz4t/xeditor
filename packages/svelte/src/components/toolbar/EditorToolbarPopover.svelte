<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Popover, PopoverContent, PopoverTrigger } from '../../ui'
  import { cn } from '../../utils/cn'

  let {
    open = $bindable(undefined as boolean | undefined),
    align = 'start',
    side = 'bottom',
    contentClass = '',
    title = '',
    trigger,
    children,
    onOpenChange,
  }: {
    open?: boolean | undefined
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'bottom' | 'left' | 'right'
    contentClass?: string
    title?: string
    trigger?: Snippet
    children?: Snippet
    onOpenChange?: (open: boolean) => void
  } = $props()

  $effect(() => {
    if (open !== undefined) onOpenChange?.(!!open)
  })
</script>

<Popover bind:open>
  <PopoverTrigger>
    {@render trigger?.()}
  </PopoverTrigger>
  <PopoverContent
    {align}
    {side}
    sideOffset={6}
    class={cn('w-auto rounded-xl border-gray-100 p-2 shadow-xl', contentClass)}
    onmousedown={(e) => e.stopPropagation()}
  >
    {#if title}
      <p class="mb-2 px-1 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
        {title}
      </p>
    {/if}
    {@render children?.()}
  </PopoverContent>
</Popover>
