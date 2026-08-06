<script lang="ts">
  import type { Component } from 'svelte'
  import AlignCenter from '@lucide/svelte/icons/align-center'
  import AlignJustify from '@lucide/svelte/icons/align-justify'
  import AlignLeft from '@lucide/svelte/icons/align-left'
  import AlignRight from '@lucide/svelte/icons/align-right'
  import Bold from '@lucide/svelte/icons/bold'
  import Check from '@lucide/svelte/icons/check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Code from '@lucide/svelte/icons/code'
  import IndentDecrease from '@lucide/svelte/icons/indent-decrease'
  import IndentIncrease from '@lucide/svelte/icons/indent-increase'
  import Italic from '@lucide/svelte/icons/italic'
  import Languages from '@lucide/svelte/icons/languages'
  import Link2 from '@lucide/svelte/icons/link-2'
  import List from '@lucide/svelte/icons/list'
  import ListOrdered from '@lucide/svelte/icons/list-ordered'
  import Paintbrush from '@lucide/svelte/icons/paintbrush'
  import Quote from '@lucide/svelte/icons/quote'
  import Strikethrough from '@lucide/svelte/icons/strikethrough'
  import Type from '@lucide/svelte/icons/type'
  import Heading1 from '@lucide/svelte/icons/heading-1'
  import Heading2 from '@lucide/svelte/icons/heading-2'
  import Heading3 from '@lucide/svelte/icons/heading-3'
  import Heading4 from '@lucide/svelte/icons/heading-4'
  import Heading5 from '@lucide/svelte/icons/heading-5'
  import Heading6 from '@lucide/svelte/icons/heading-6'
  import CheckSquare from '@lucide/svelte/icons/check-square'
  import Lightbulb from '@lucide/svelte/icons/lightbulb'
  import Underline from '@lucide/svelte/icons/underline'
  import type { BlockType, MarkName, TableStyle } from '@xproeditor/core'
  import Button from '../ui/Button.svelte'
  import IconEmojiPicker from '../ui/IconEmojiPicker.svelte'
  import IconValueDisplay from '../ui/IconValueDisplay.svelte'
  import Input from '../ui/Input.svelte'
  import EditorTableStylePanel from './toolbar/EditorTableStylePanel.svelte'
  import EditorToolbarButton from './toolbar/EditorToolbarButton.svelte'
  import EditorToolbarColorPanel from './toolbar/EditorToolbarColorPanel.svelte'
  import EditorToolbarPopover from './toolbar/EditorToolbarPopover.svelte'
  import EditorToolbarSeparator from './toolbar/EditorToolbarSeparator.svelte'

  export type FormatToolbarAlign = 'left' | 'center' | 'right' | 'justify'

  export type FormatToolbarState = {
    blockId: string
    blockType: BlockType
    activeMarks: Partial<Record<MarkName, boolean>>
    currentLink: string | null
    currentColor?: string | null
    currentHighlight?: string | null
    hasSelection: boolean
    multiBlock?: boolean
    align: FormatToolbarAlign
    indent: number
    dir: 'auto' | 'ltr' | 'rtl'
    calloutIcon?: string | null
    tableStyle?: TableStyle
    cellBackground?: string | null
  }

  // Avoid naming the binding `state` — it collides with the `$state` rune (store syntax).
  let {
    state: toolbarState = null,
    onmark,
    onturninto,
    onindent,
    onoutdent,
    onalign,
    ondir,
    oncallouticon,
    ontablestyle,
    oncellbackground,
  }: {
    state?: FormatToolbarState | null
    onmark?: (mark: MarkName, value: boolean | string | null) => void
    onturninto?: (type: BlockType) => void
    onindent?: () => void
    onoutdent?: () => void
    onalign?: (align: FormatToolbarAlign) => void
    ondir?: (dir: 'auto' | 'ltr' | 'rtl') => void
    oncallouticon?: (icon: string | null) => void
    ontablestyle?: (patch: Partial<TableStyle>) => void
    oncellbackground?: (color: string | null) => void
  } = $props()

  const TURN_INTO: Array<{ type: BlockType; label: string; icon: Component }> = [
    { type: 'paragraph', label: 'Paragraph', icon: Type },
    { type: 'heading_1', label: 'Heading 1', icon: Heading1 },
    { type: 'heading_2', label: 'Heading 2', icon: Heading2 },
    { type: 'heading_3', label: 'Heading 3', icon: Heading3 },
    { type: 'heading_4', label: 'Heading 4', icon: Heading4 },
    { type: 'heading_5', label: 'Heading 5', icon: Heading5 },
    { type: 'heading_6', label: 'Heading 6', icon: Heading6 },
    { type: 'bulleted_list_item', label: 'Bulleted list', icon: List },
    { type: 'numbered_list_item', label: 'Numbered list', icon: ListOrdered },
    { type: 'to_do', label: 'To-do', icon: CheckSquare },
    { type: 'quote', label: 'Quote', icon: Quote },
    { type: 'callout', label: 'Callout', icon: Lightbulb },
  ]

  let turnIntoOpen = $state(false)
  let linkOpen = $state(false)
  let colorOpen = $state(false)
  let tableStyleOpen = $state(false)
  let linkInput = $state('')
  let calloutIcon = $state<string | null | undefined>(undefined)

  let isTable = $derived(toolbarState?.blockType === 'table')
  let isDisabled = $derived(!toolbarState)
  let blockActionsDisabled = $derived(isDisabled || !!toolbarState?.multiBlock)
  let tableActionsDisabled = $derived(isDisabled || !isTable)

  $effect(() => {
    void toolbarState?.blockId
    turnIntoOpen = false
    linkOpen = false
    colorOpen = false
    tableStyleOpen = false
  })

  $effect(() => {
    calloutIcon = toolbarState?.calloutIcon ?? '💡'
  })

  function turnIntoLabel(): string {
    return TURN_INTO.find((t) => t.type === toolbarState?.blockType)?.label ?? 'Paragraph'
  }

  function openLinkPopover(open: boolean): void {
    if (open) {
      linkInput = toolbarState?.currentLink ?? ''
      turnIntoOpen = false
      colorOpen = false
    }
    linkOpen = open
  }

  function applyLink(): void {
    const url = linkInput.trim()
    onmark?.('link', url || null)
    linkOpen = false
  }

  function onTurnIntoOpen(open: boolean): void {
    if (open) {
      linkOpen = false
      colorOpen = false
    }
    turnIntoOpen = open
  }

  function onColorOpen(open: boolean): void {
    if (open) {
      linkOpen = false
      turnIntoOpen = false
      tableStyleOpen = false
    }
    colorOpen = open
  }

  function onTableStyleOpen(open: boolean): void {
    if (open) {
      linkOpen = false
      turnIntoOpen = false
      colorOpen = false
    }
    tableStyleOpen = open
  }

  </script>

<div class="border-b border-gray-100 bg-white px-4 py-2" data-pro-editor-toolbar>
  <div class="mx-auto flex max-w-4xl flex-wrap items-center gap-0.5">
    <EditorToolbarPopover bind:open={turnIntoOpen} contentClass="w-48 py-1">
      {#snippet trigger()}
        <EditorToolbarButton wide disabled={blockActionsDisabled || isTable}>
          {turnIntoLabel()}
          <ChevronDown class="size-3" />
        </EditorToolbarButton>
      {/snippet}
      {#each TURN_INTO as t (t.type)}
        <button
          type="button"
          class="flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] transition-colors {t.type ===
          toolbarState?.blockType
            ? 'bg-indigo-50/60 text-indigo-600'
            : 'text-gray-700 hover:bg-gray-50'}"
          onclick={() => {
            onturninto?.(t.type)
            turnIntoOpen = false
          }}
        >
          <t.icon class="size-3.5 shrink-0 text-gray-400" />
          <span class="flex-1">{t.label}</span>
          {#if t.type === toolbarState?.blockType}
            <Check class="size-3.5 shrink-0 text-indigo-500" />
          {/if}
        </button>
      {/each}
    </EditorToolbarPopover>

    <EditorToolbarSeparator />

    <EditorToolbarButton
      active={!!toolbarState?.activeMarks.bold}
      disabled={isDisabled || !toolbarState?.hasSelection}
      title="Bold"
      onclick={() => onmark?.('bold', !toolbarState?.activeMarks.bold)}
    >
      <Bold class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={!!toolbarState?.activeMarks.italic}
      disabled={isDisabled || !toolbarState?.hasSelection}
      title="Italic"
      onclick={() => onmark?.('italic', !toolbarState?.activeMarks.italic)}
    >
      <Italic class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={!!toolbarState?.activeMarks.underline}
      disabled={isDisabled || !toolbarState?.hasSelection}
      title="Underline"
      onclick={() => onmark?.('underline', !toolbarState?.activeMarks.underline)}
    >
      <Underline class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={!!toolbarState?.activeMarks.strikethrough}
      disabled={isDisabled || !toolbarState?.hasSelection}
      title="Strikethrough"
      onclick={() => onmark?.('strikethrough', !toolbarState?.activeMarks.strikethrough)}
    >
      <Strikethrough class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={!!toolbarState?.activeMarks.code}
      disabled={isDisabled || !toolbarState?.hasSelection}
      title="Inline code"
      onclick={() => onmark?.('code', !toolbarState?.activeMarks.code)}
    >
      <Code class="size-3.5" />
    </EditorToolbarButton>

    <EditorToolbarSeparator />

    <EditorToolbarPopover
      open={linkOpen}
      contentClass="p-2"
      title="Link"
      onOpenChange={openLinkPopover}
    >
      {#snippet trigger()}
        <EditorToolbarButton
          active={linkOpen || !!toolbarState?.currentLink}
          disabled={isDisabled || !toolbarState?.hasSelection}
          title="Link"
        >
          <Link2 class="size-3.5" />
        </EditorToolbarButton>
      {/snippet}
      <div class="flex min-w-[260px] items-center gap-1.5">
        <Input
          bind:value={linkInput}
          class="h-8 flex-1 text-xs"
          placeholder="https://..."
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyLink()
            }
            if (e.key === 'Escape') linkOpen = false
          }}
        />
        <Button type="button" size="sm" class="h-8 px-3 text-xs" onclick={applyLink}>Set</Button>
        {#if toolbarState?.currentLink}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-8 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
            onclick={() => {
              onmark?.('link', null)
              linkOpen = false
            }}
          >
            Remove
          </Button>
        {/if}
      </div>
    </EditorToolbarPopover>

    <EditorToolbarPopover open={colorOpen} contentClass="p-2" onOpenChange={onColorOpen}>
      {#snippet trigger()}
        <EditorToolbarButton
          active={colorOpen || !!toolbarState?.currentColor || !!toolbarState?.currentHighlight}
          disabled={isDisabled || !toolbarState?.hasSelection}
          title="Color"
        >
          <Paintbrush class="size-3.5" />
        </EditorToolbarButton>
      {/snippet}
      <EditorToolbarColorPanel
        open={colorOpen}
        currentColor={toolbarState?.currentColor}
        currentHighlight={toolbarState?.currentHighlight}
        onmark={(mark, value) => onmark?.(mark, value)}
      />
    </EditorToolbarPopover>

    <EditorToolbarButton
      disabled={blockActionsDisabled}
      title="Quote"
      onclick={() => onturninto?.('quote')}
    >
      <Quote class="size-3.5" />
    </EditorToolbarButton>

    {#if toolbarState?.blockType === 'callout'}
      <EditorToolbarSeparator />
      <IconEmojiPicker
        bind:value={calloutIcon}
        align="start"
        side="bottom"
        onchange={(v) => oncallouticon?.(v ?? null)}
      >
        {#snippet trigger({ selected }: { selected: string | null | undefined })}
          <EditorToolbarButton
            wide
            disabled={blockActionsDisabled}
            title="Callout icon"
            onpointerdown={(e) => e.stopPropagation()}
          >
            <IconValueDisplay icon={selected ?? '💡'} class="size-4" />
            <ChevronDown class="size-3 text-gray-400" />
          </EditorToolbarButton>
        {/snippet}
      </IconEmojiPicker>
    {/if}

    <EditorToolbarSeparator />

    <EditorToolbarButton
      active={toolbarState?.blockType === 'bulleted_list_item'}
      disabled={blockActionsDisabled}
      title="Bulleted list"
      onclick={() => onturninto?.('bulleted_list_item')}
    >
      <List class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={toolbarState?.blockType === 'numbered_list_item'}
      disabled={blockActionsDisabled}
      title="Numbered list"
      onclick={() => onturninto?.('numbered_list_item')}
    >
      <ListOrdered class="size-3.5" />
    </EditorToolbarButton>

    <EditorToolbarButton
      active={toolbarState?.align === 'left'}
      disabled={blockActionsDisabled}
      title="Align left"
      onclick={() => onalign?.('left')}
    >
      <AlignLeft class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={toolbarState?.align === 'center'}
      disabled={blockActionsDisabled}
      title="Align center"
      onclick={() => onalign?.('center')}
    >
      <AlignCenter class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={toolbarState?.align === 'right'}
      disabled={blockActionsDisabled}
      title="Align right"
      onclick={() => onalign?.('right')}
    >
      <AlignRight class="size-3.5" />
    </EditorToolbarButton>
    {#if isTable}
      <EditorToolbarButton
        active={toolbarState?.align === 'justify'}
        disabled={tableActionsDisabled}
        title="Justify"
        onclick={() => onalign?.('justify')}
      >
        <AlignJustify class="size-3.5" />
      </EditorToolbarButton>

      <EditorToolbarPopover open={tableStyleOpen} contentClass="p-2" onOpenChange={onTableStyleOpen}>
        {#snippet trigger()}
          <EditorToolbarButton active={tableStyleOpen} disabled={tableActionsDisabled} title="Table style">
            <Paintbrush class="size-3.5" />
          </EditorToolbarButton>
        {/snippet}
        <EditorTableStylePanel
          open={tableStyleOpen}
          currentColor={toolbarState?.currentColor}
          currentHighlight={toolbarState?.currentHighlight}
          cellBackground={toolbarState?.cellBackground}
          tableStyle={toolbarState?.tableStyle}
          onmark={(mark, value) => onmark?.(mark, value)}
          oncellbackground={(c) => oncellbackground?.(c)}
          ontablestyle={(p) => ontablestyle?.(p)}
        />
      </EditorToolbarPopover>
    {/if}

    {#if !isTable}
      <EditorToolbarSeparator />
    {/if}

    <EditorToolbarButton
      active={toolbarState?.dir === 'auto'}
      disabled={blockActionsDisabled || isTable}
      title="Auto direction"
      onclick={() => ondir?.('auto')}
    >
      <Languages class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      active={toolbarState?.dir === 'ltr'}
      disabled={blockActionsDisabled || isTable}
      title="Left-to-right"
      onclick={() => ondir?.('ltr')}
    >
      <span class="text-[10px] font-bold">LTR</span>
    </EditorToolbarButton>
    <EditorToolbarButton
      active={toolbarState?.dir === 'rtl'}
      disabled={blockActionsDisabled || isTable}
      title="Right-to-left"
      onclick={() => ondir?.('rtl')}
    >
      <span class="text-[10px] font-bold">RTL</span>
    </EditorToolbarButton>

    <EditorToolbarButton
      disabled={blockActionsDisabled || isTable || (toolbarState?.indent ?? 0) <= 0}
      title="Decrease indent"
      onclick={() => onoutdent?.()}
    >
      <IndentDecrease class="size-3.5" />
    </EditorToolbarButton>
    <EditorToolbarButton
      disabled={blockActionsDisabled || isTable || (toolbarState?.indent ?? 0) >= 6}
      title="Increase indent"
      onclick={() => onindent?.()}
    >
      <IndentIncrease class="size-3.5" />
    </EditorToolbarButton>
  </div>
</div>
