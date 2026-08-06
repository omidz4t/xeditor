<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import { DEFAULT_TABLE_BORDER, getResolvedTableBorder } from '@xproeditor/core'
  import type { MarkName, TableBorderStyleKind, TableBorderWidth, TableStyle } from '@xproeditor/core'
  import {
    Button,
    ColorPickerPanel,
    DEFAULT_TEXT_COLOR,
    HIGHLIGHT_PRESETS,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    TABLE_BG_PRESETS,
    TABLE_BORDER_PRESETS,
    TABLE_BORDER_STYLES,
    TABLE_BORDER_WIDTHS,
    TEXT_COLOR_PRESETS,
  } from '../../ui'
  import { cn } from '../../utils/cn'
  import { useDebounceFn } from '../../utils/debounce'

  let {
    open = false,
    currentColor = null,
    currentHighlight = null,
    cellBackground = null,
    tableStyle,
    onmark,
    oncellbackground,
    ontablestyle,
  }: {
    open?: boolean
    currentColor?: string | null
    currentHighlight?: string | null
    cellBackground?: string | null
    tableStyle?: TableStyle
    onmark?: (mark: MarkName, value: boolean | string | null) => void
    oncellbackground?: (color: string | null) => void
    ontablestyle?: (patch: Partial<TableStyle>) => void
  } = $props()

  let activeTab = $state<'text' | 'cell' | 'table' | 'border'>('text')
  let pickerColor = $state(DEFAULT_TEXT_COLOR)
  let isEditingPicker = $state(false)

  let resolvedBorder = $derived(getResolvedTableBorder(tableStyle))

  $effect(() => {
    if (!open) return
    isEditingPicker = false
    syncPickerColor()
  })

  $effect(() => {
    void activeTab
    isEditingPicker = false
    syncPickerColor()
  })

  function syncPickerColor(): void {
    if (activeTab === 'text') {
      pickerColor = currentColor ?? DEFAULT_TEXT_COLOR
    } else if (activeTab === 'cell') {
      pickerColor = cellBackground ?? TABLE_BG_PRESETS[0]
    } else if (activeTab === 'table') {
      pickerColor = tableStyle?.background ?? TABLE_BG_PRESETS[0]
    } else {
      pickerColor = resolvedBorder.color
    }
  }

  function isPresetActive(color: string, active: string | null | undefined): boolean {
    return !!active && active.toLowerCase() === color.toLowerCase()
  }

  /** Click active color again to clear (toggle). */
  function selectTextColor(color: string): void {
    const next = color.toLowerCase()
    const active = currentColor?.toLowerCase() ?? null
    if (active === next || next === DEFAULT_TEXT_COLOR.toLowerCase()) {
      onmark?.('color', null)
      return
    }
    onmark?.('color', color)
  }

  /** Click active highlight again to clear (toggle). */
  function selectHighlight(color: string): void {
    if (currentHighlight?.toLowerCase() === color.toLowerCase()) {
      onmark?.('highlight', null)
      return
    }
    onmark?.('highlight', color)
  }

  const debouncedApplyPickerColor = useDebounceFn((hex: string) => {
    if (activeTab === 'text') {
      selectTextColor(hex)
    } else if (activeTab === 'cell') {
      oncellbackground?.(hex)
    } else if (activeTab === 'table') {
      ontablestyle?.({ background: hex })
    } else {
      ontablestyle?.({ border: { color: hex } })
    }
  }, 80)

  function onPickerInput(hex: string): void {
    isEditingPicker = true
    pickerColor = hex
    debouncedApplyPickerColor(hex)
  }

  function onPickerFocus(): void {
    isEditingPicker = true
  }

  function resetCellBackground(): void {
    oncellbackground?.(null)
  }

  function resetTableBackground(): void {
    ontablestyle?.({ background: undefined })
  }

  function resetHeaderBackground(): void {
    ontablestyle?.({ headerBackground: undefined })
  }

  function resetBorder(): void {
    ontablestyle?.({ border: { ...DEFAULT_TABLE_BORDER } })
  }

  function selectCellBackground(color: string): void {
    oncellbackground?.(color)
  }

  function selectTableBackground(color: string): void {
    ontablestyle?.({ background: color })
  }

  function selectHeaderBackground(color: string): void {
    ontablestyle?.({ headerBackground: color })
  }

  function selectBorderColor(color: string): void {
    ontablestyle?.({ border: { color } })
  }

  function selectBorderWidth(width: TableBorderWidth): void {
    ontablestyle?.({ border: { width } })
  }

  function selectBorderStyle(style: TableBorderStyleKind): void {
    ontablestyle?.({ border: { style } })
  }
</script>

<Tabs bind:value={activeTab} class="w-[300px]">
  <TabsList class="mb-2 grid w-full grid-cols-4">
    <TabsTrigger value="text" class="text-[10px]">Text</TabsTrigger>
    <TabsTrigger value="cell" class="text-[10px]">Cell</TabsTrigger>
    <TabsTrigger value="table" class="text-[10px]">Table</TabsTrigger>
    <TabsTrigger value="border" class="text-[10px]">Border</TabsTrigger>
  </TabsList>

  <TabsContent value="text" class="mt-0 space-y-3">
    <p class="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Text color</p>
    <div class="grid grid-cols-5 gap-1.5">
      {#each TEXT_COLOR_PRESETS as color (color)}
        <button
          type="button"
          title={String(color)}
          aria-label={`Color ${color}`}
          class={cn(
            'relative flex size-7 items-center justify-center rounded-md border border-black/5 text-xs font-bold',
            isPresetActive(color, currentColor) && 'ring-2 ring-indigo-500 ring-offset-1',
          )}
          style="color: {color}"
          onclick={() => selectTextColor(color)}
        >
          A
          {#if isPresetActive(color, currentColor)}
            <Check class="absolute -top-1 -right-1 size-3 rounded-full bg-indigo-500 p-0.5 text-white" />
          {/if}
        </button>
      {/each}
    </div>

    <p class="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Highlight</p>
    <div class="grid grid-cols-4 gap-1.5">
      {#each HIGHLIGHT_PRESETS as color (color)}
        <button
          type="button"
          title={String(color)}
          aria-label={`Color ${color}`}
          class={cn(
            'relative size-7 rounded-md border border-black/10',
            isPresetActive(color, currentHighlight) && 'ring-2 ring-indigo-500 ring-offset-1',
          )}
          style="background-color: {color}"
          onclick={() => selectHighlight(color)}
        ></button>
      {/each}
    </div>

    <div class="border-t border-gray-100 pt-3" onfocusin={onPickerFocus}>
      <ColorPickerPanel
        bind:value={
          () => pickerColor,
          (v) => onPickerInput(v)
        }
        compact
        hideContrastRatio
        hideDefaultSwatches
      />
    </div>
  </TabsContent>

  <TabsContent value="cell" class="mt-0 space-y-3">
    <div class="grid grid-cols-5 gap-1.5">
      {#each TABLE_BG_PRESETS as color (color)}
        <button
          type="button"
          title={String(color)}
          aria-label={`Color ${color}`}
          class={cn(
            'relative size-7 rounded-md border border-black/10',
            isPresetActive(color, cellBackground) && 'ring-2 ring-indigo-500 ring-offset-1',
          )}
          style="background-color: {color}"
          onclick={() => selectCellBackground(color)}
        ></button>
      {/each}
    </div>
    <div onfocusin={onPickerFocus}>
      <ColorPickerPanel bind:value={pickerColor} compact hideContrastRatio hideDefaultSwatches />
    </div>
    {#if cellBackground}
      <Button type="button" variant="ghost" size="sm" class="h-7 w-full text-xs" onclick={resetCellBackground}>
        Reset cell background
      </Button>
    {/if}
  </TabsContent>

  <TabsContent value="table" class="mt-0 space-y-3">
    <p class="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Table background</p>
    <div class="grid grid-cols-5 gap-1.5">
      {#each TABLE_BG_PRESETS as color (color)}
        <button
          type="button"
          title={String(color)}
          aria-label={`Color ${color}`}
          class={cn(
            'relative size-7 rounded-md border border-black/10',
            isPresetActive(color, tableStyle?.background) && 'ring-2 ring-indigo-500 ring-offset-1',
          )}
          style="background-color: {color}"
          onclick={() => selectTableBackground(color)}
        ></button>
      {/each}
    </div>

    <p class="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Header background</p>
    <div class="grid grid-cols-5 gap-1.5">
      {#each TABLE_BG_PRESETS as color (color)}
        <button
          type="button"
          title={String(color)}
          aria-label={`Color ${color}`}
          class={cn(
            'relative size-7 rounded-md border border-black/10',
            isPresetActive(color, tableStyle?.headerBackground) && 'ring-2 ring-indigo-500 ring-offset-1',
          )}
          style="background-color: {color}"
          onclick={() => selectHeaderBackground(color)}
        ></button>
      {/each}
    </div>

    <Button type="button" variant="ghost" size="sm" class="h-7 w-full text-xs" onclick={resetTableBackground}>
      Reset table background
    </Button>
    <Button type="button" variant="ghost" size="sm" class="h-7 w-full text-xs" onclick={resetHeaderBackground}>
      Reset header background
    </Button>
  </TabsContent>

  <TabsContent value="border" class="mt-0 space-y-3">
    <div
      class="rounded-md border bg-white p-3"
      style="border: {resolvedBorder.width}px {resolvedBorder.style} {resolvedBorder.color}"
    >
      <div class="text-xs text-gray-500">Preview</div>
    </div>

    <div class="grid grid-cols-4 gap-1.5">
      {#each TABLE_BORDER_PRESETS as color (color)}
        <button
          type="button"
          title={String(color)}
          aria-label={`Color ${color}`}
          class={cn(
            'relative size-7 rounded-md border-2 bg-white',
            isPresetActive(color, resolvedBorder.color) && 'ring-2 ring-indigo-500 ring-offset-1',
          )}
          style="border-color: {color}"
          onclick={() => selectBorderColor(color)}
        ></button>
      {/each}
    </div>

    <p class="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Width</p>
    <div class="flex flex-wrap gap-1">
      {#each TABLE_BORDER_WIDTHS as width (width)}
        <button
          type="button"
          class="rounded-md border px-2 py-1 text-[11px] {resolvedBorder.width === width
            ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
            : 'border-gray-200 text-gray-600'}"
          onclick={() => selectBorderWidth(width)}
        >
          {width}px
        </button>
      {/each}
    </div>

    <p class="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Style</p>
    <div class="flex flex-wrap gap-1">
      {#each TABLE_BORDER_STYLES as style (style)}
        <button
          type="button"
          class="rounded-md border px-2 py-1 text-[11px] capitalize {resolvedBorder.style === style
            ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
            : 'border-gray-200 text-gray-600'}"
          onclick={() => selectBorderStyle(style)}
        >
          {style}
        </button>
      {/each}
    </div>

    <div onfocusin={onPickerFocus}>
      <ColorPickerPanel bind:value={pickerColor} compact hideContrastRatio hideDefaultSwatches />
    </div>

    <Button type="button" variant="ghost" size="sm" class="h-7 w-full text-xs" onclick={resetBorder}>
      Reset border
    </Button>
  </TabsContent>
</Tabs>
