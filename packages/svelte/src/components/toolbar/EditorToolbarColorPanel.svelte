<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import type { MarkName } from '@xproeditor/core'
  import {
    DEFAULT_TEXT_COLOR,
    HIGHLIGHT_PRESETS,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    TEXT_COLOR_PRESETS,
  } from '../../ui'
  import { cn } from '../../utils/cn'

  let {
    open = false,
    currentColor = null,
    currentHighlight = null,
    onmark,
  }: {
    open?: boolean
    currentColor?: string | null
    currentHighlight?: string | null
    onmark?: (mark: MarkName, value: boolean | string | null) => void
  } = $props()

  let activeTab = $state<'text' | 'highlight'>('text')

  $effect(() => {
    if (open) {
      activeTab = 'text'
    }
  })

  let activeTextColor = $derived(currentColor?.toLowerCase() ?? null)
  let activeHighlight = $derived(currentHighlight?.toLowerCase() ?? null)

  function isPresetActive(color: string, active: string | null): boolean {
    return active !== null && active === color.toLowerCase()
  }

  /** Click active color again to clear (toggle). */
  function selectTextColor(color: string): void {
    const next = color.toLowerCase()
    if (activeTextColor === next || next === DEFAULT_TEXT_COLOR.toLowerCase()) {
      onmark?.('color', null)
      return
    }
    onmark?.('color', color)
  }

  /** Click active highlight again to clear (toggle). */
  function selectHighlight(color: string): void {
    if (activeHighlight === color.toLowerCase()) {
      onmark?.('highlight', null)
      return
    }
    onmark?.('highlight', color)
  }
</script>

<!-- mousedown.prevent keeps the editor selection alive while picking a color -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="xpe-color-panel" onmousedown={(e) => e.preventDefault()}>
  <Tabs bind:value={activeTab} class="w-[260px]">
    <TabsList class="mb-2 grid w-full grid-cols-2">
      <TabsTrigger value="text" class="text-xs">Text</TabsTrigger>
      <TabsTrigger value="highlight" class="text-xs">Highlight</TabsTrigger>
    </TabsList>

    <TabsContent value="text" class="mt-0 space-y-3">
      <div class="grid grid-cols-5 gap-1.5">
        {#each TEXT_COLOR_PRESETS as color (color)}
          <button
            type="button"
            class={cn(
              'relative flex size-8 items-center justify-center rounded-md border border-black/10 text-sm font-bold transition-transform hover:scale-105',
              isPresetActive(color, activeTextColor) && 'ring-2 ring-indigo-500 ring-offset-1',
            )}
            style="color: {color}; background: var(--xpe-background, #fff)"
            title={color}
            aria-label="Text color {color}"
            aria-pressed={isPresetActive(color, activeTextColor)}
            onclick={() => selectTextColor(color)}
          >
            A
            {#if isPresetActive(color, activeTextColor)}
              <Check class="absolute -top-1 -right-1 size-3 rounded-full bg-indigo-500 p-0.5 text-white" />
            {/if}
          </button>
        {/each}
      </div>
    </TabsContent>

    <TabsContent value="highlight" class="mt-0 space-y-3">
      <div class="grid grid-cols-4 gap-1.5">
        {#each HIGHLIGHT_PRESETS as color (color)}
          <button
            type="button"
            class={cn(
              'relative size-8 rounded-md border border-black/10 transition-transform hover:scale-105',
              isPresetActive(color, activeHighlight) && 'ring-2 ring-indigo-500 ring-offset-1',
            )}
            style="background-color: {color}"
            title={color}
            aria-label="Highlight {color}"
            aria-pressed={isPresetActive(color, activeHighlight)}
            onclick={() => selectHighlight(color)}
          >
            {#if isPresetActive(color, activeHighlight)}
              <Check class="absolute -top-1 -right-1 size-3 rounded-full bg-indigo-500 p-0.5 text-white" />
            {/if}
          </button>
        {/each}
      </div>
    </TabsContent>
  </Tabs>
</div>
