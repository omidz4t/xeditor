<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy'
  import GripVertical from '@lucide/svelte/icons/grip-vertical'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import { getContext, onMount, tick } from 'svelte'
  import { isTextBlock, resolveBlockDirection, toggleVBoxChildPaddingPx } from '@xproeditor/core'
  import type { Block, InlineSpan, MarkName, TableCellCoord } from '@xproeditor/core'
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    IconEmojiPicker,
    IconValueDisplay,
  } from '../ui'
  import EditorCodeBlock from './EditorCodeBlock.svelte'
  import EditorImageBlock from './EditorImageBlock.svelte'
  import EditorPollBlock from './EditorPollBlock.svelte'
  import EditorSelectionHighlight from './EditorSelectionHighlight.svelte'
  import EditorTableBlock from './EditorTableBlock.svelte'
  import EditorTextBlock from './EditorTextBlock.svelte'
  import { BLOCK_EDITOR_CTX, type BlockEditorContext } from './block-editor-context'
  import EditorPageBlock from './EditorPageBlock.svelte'

  /** Format list index for display — Persian digits when the block is RTL. */
  function formatListNumber(n: number, dir: 'ltr' | 'rtl'): string {
    const western = String(Math.max(1, n | 0))
    if (dir !== 'rtl') return western
    // Persian / Farsi digits ۰-۹
    return western.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d)
  }

  let {
    block,
    number,
    placeholder,
    selected = false,
    textHighlight = null,
    dropPosition = null,
    upload,
    pickMedia,
    editorDir,
    readonly = false,
    lockedBy = null,
    iconPickerRequest = null,
    pagePickerRequest = false,
    pages,
    currentPageId,
    voterId,
    suppressOuterIndent = false,
    vboxBaseIndent,
    oninput,
    onenter,
    onbackspacestart,
    ondeleteend,
    onarrowup,
    onarrowdown,
    ontab,
    onformat,
    onpasted,
    onfocus,
    onpatch,
    onselect,
    onaddbelow,
    onduplicate,
    onremove,
    ondraghandlestart,
    onpointerdown,
    onselectionpointerdown,
    oniconpickeropened,
    ontablecellfocus,
    ontablecellinput,
    ontablecellformat,
    ontablecelltab,
    ontablecellnavigate,
    ontablecellselectionchange,
    onpagepickeropened,
    onpageblockcreate,
    onnavigatepage,
    class: className = '',
  }: {
    block: Block
    number?: number
    placeholder?: string
    selected?: boolean
    textHighlight?: { start: number; end: number } | null
    dropPosition?: 'before' | 'after' | 'left' | 'right' | null
    upload?: (file: File) => Promise<string>
    pickMedia?: (options: {
      accept: string[]
      title?: string
    }) => Promise<{ url: string; alt?: string; caption?: string } | null>
    editorDir?: 'ltr' | 'rtl'
    readonly?: boolean
    lockedBy?: { name: string; color: string } | null
    iconPickerRequest?: { tab: 'emoji' | 'icon' } | null
    pagePickerRequest?: boolean
    pages?: Array<{ id: string; title: string; icon?: string }>
    currentPageId?: string
    voterId?: string
    suppressOuterIndent?: boolean
    vboxBaseIndent?: number
    class?: string
    oninput?: (spans: InlineSpan[], caret: number | null) => void
    onenter?: (offsets: { start: number; end: number }) => void
    onbackspacestart?: () => void
    ondeleteend?: () => void
    onarrowup?: () => void
    onarrowdown?: () => void
    ontab?: (shift: boolean) => void
    onformat?: (mark: MarkName, offsets?: { start: number; end: number }) => void
    onpasted?: (payload: {
      html: string
      text: string
      files: File[]
      offsets: { start: number; end: number }
    }) => void
    onfocus?: () => void
    onpatch?: (patch: Record<string, unknown>) => void
    onselect?: () => void
    onaddbelow?: () => void
    onduplicate?: () => void
    onremove?: () => void
    ondraghandlestart?: (e: DragEvent) => void
    onpointerdown?: (e: PointerEvent) => void
    onselectionpointerdown?: (payload: {
      shiftKey: boolean
      clientX: number
      clientY: number
    }) => void
    oniconpickeropened?: () => void
    ontablecellfocus?: (payload: { row: number; col: number; shiftKey: boolean }) => void
    ontablecellinput?: (payload: {
      row: number
      col: number
      content: InlineSpan[]
      caret: number | null
    }) => void
    ontablecellformat?: (payload: { row: number; col: number; mark: MarkName }) => void
    ontablecelltab?: (payload: { row: number; col: number; shift: boolean }) => void
    ontablecellnavigate?: (payload: {
      row: number
      col: number
      direction: 'up' | 'down' | 'left' | 'right'
    }) => void
    ontablecellselectionchange?: (cells: TableCellCoord[]) => void
    onpagepickeropened?: () => void
    onpageblockcreate?: (title: string) => void
    onnavigatepage?: (pageId: string) => void
  } = $props()

  const CALLOUT_COLORS = [
    { id: 'default', light: 'var(--xpe-muted, #f7f6f3)', dark: 'var(--xpe-muted, #2f2f2f)', swatch: '#9b9a97' },
    { id: 'yellow', light: '#fbf3db', dark: 'rgb(255 212 0 / 0.14)', swatch: '#dfab01' },
    { id: 'orange', light: '#fadec9', dark: 'rgb(255 163 68 / 0.16)', swatch: '#e67e22' },
    { id: 'red', light: '#fdebec', dark: 'rgb(255 115 105 / 0.14)', swatch: '#eb5757' },
    { id: 'green', light: '#ddedea', dark: 'rgb(77 171 154 / 0.16)', swatch: '#4dab9a' },
    { id: 'blue', light: '#ddebf1', dark: 'rgb(35 131 226 / 0.16)', swatch: '#2383e2' },
    { id: 'purple', light: '#eae4f2', dark: 'rgb(144 101 176 / 0.16)', swatch: '#9065b0' },
  ] as const

  let inner: any = $state(null)
  let calloutIconPickerRef: any = $state(null)
  let showCalloutColors = $state(false)
  let calloutHovered = $state(false)

  let calloutIcon = $derived(block.props.icon ?? '💡')

  let calloutBackground = $derived.by(() => {
    const raw = block.props.color?.trim()
    if (!raw || raw === '#f8fafc' || raw === '#ffffff' || raw === 'default') {
      return 'var(--xpe-muted, #f7f6f3)'
    }
    const match = CALLOUT_COLORS.find((c) => c.id === raw || c.light === raw || c.swatch === raw)
    return match?.light ?? raw
  })

  function selectCalloutColor(colorId: string) {
    if (colorId === 'default') {
      onpatch?.({ color: undefined })
    } else {
      const entry = CALLOUT_COLORS.find((c) => c.id === colorId)
      onpatch?.({ color: entry?.light ?? colorId })
    }
    showCalloutColors = false
  }

  function isCalloutColorActive(colorId: string): boolean {
    const raw = block.props.color?.trim()
    if (!raw || colorId === 'default') {
      return !raw && colorId === 'default'
    }
    const entry = CALLOUT_COLORS.find((c) => c.id === colorId)
    return !!entry && (raw === entry.light || raw === entry.swatch || raw === entry.id)
  }

  function onReorderPointerDown(e: PointerEvent) {
    e.stopPropagation()
  }

  function onReorderDragStart(e: DragEvent) {
    ondraghandlestart?.(e)
  }

  $effect(() => {
    const request = iconPickerRequest
    if (!request || readonly || block.type !== 'callout') return
    tick().then(() => {
      calloutIconPickerRef?.openPicker?.(request.tab)
      oniconpickeropened?.()
    })
  })

  let indent = $derived(block.props.indent ?? 0)
  let outerIndentPx = $derived.by(() => {
    if (suppressOuterIndent) return 0
    if (vboxBaseIndent !== undefined) {
      return toggleVBoxChildPaddingPx(indent, vboxBaseIndent)
    }
    return indent * 28
  })
  let textual = $derived(isTextBlock(block.type))
  const editorCtx = getContext<BlockEditorContext | undefined>(BLOCK_EDITOR_CTX)
  let blockDir = $derived.by(() => {
    void editorCtx?.getContentRevision?.()
    // Prefer map that inherits empty lines from the block above.
    return editorCtx?.directionFor?.(block.id) ?? resolveBlockDirection(block, editorDir ?? 'ltr')
  })
  let isRtl = $derived(blockDir === 'rtl')
  let isHeading = $derived(
    block.type === 'heading_1' ||
      block.type === 'heading_2' ||
      block.type === 'heading_3' ||
      block.type === 'heading_4' ||
      block.type === 'heading_5' ||
      block.type === 'heading_6',
  )

  /**
   * Contenteditable host for cross-block selection paint.
   * Prefer getEl() — Svelte 5 component instances do not expose private `el`.
   * Re-resolve after tick so bind:this on the editable has landed.
   */
  let textEditableEl = $state<HTMLElement | null>(null)

  $effect(() => {
    const inst = inner as { getEl?: () => HTMLElement | null; el?: HTMLElement | null } | null
    if (!inst) {
      textEditableEl = null
      return
    }
    textEditableEl = inst.getEl?.() ?? inst.el ?? null
    void tick().then(() => {
      textEditableEl = inst.getEl?.() ?? inst.el ?? null
    })
  })

  const textHandlers = {
    oninput: (s: InlineSpan[], c: number | null) => oninput?.(s, c),
    onenter: (o: { start: number; end: number }) => onenter?.(o),
    onbackspacestart: () => onbackspacestart?.(),
    ondeleteend: () => ondeleteend?.(),
    onarrowup: () => onarrowup?.(),
    onarrowdown: () => onarrowdown?.(),
    ontab: (s: boolean) => ontab?.(s),
    onformat: (m: MarkName, o?: { start: number; end: number }) => onformat?.(m, o),
    onpasted: (p: any) => onpasted?.(p),
    onfocus: () => onfocus?.(),
    onselectionpointerdown: (p: any) => onselectionpointerdown?.(p),
  }

  export function focusAt(pos: number | 'start' | 'end') {
    inner?.focusAt?.(pos)
  }
  export function getSelection(): { start: number; end: number } | null {
    return inner?.getSelection?.() ?? null
  }
  export function setSelection(start: number, end?: number) {
    inner?.setSelection?.(start, end)
  }
  export function getEl(): HTMLElement | null {
    return inner?.getEl?.() ?? null
  }
  export function syncFromModel(restore?: { start: number; end: number } | null) {
    inner?.syncFromModel?.(restore)
  }
  export function getTableSelectedCells() {
    return inner?.getSelectedCells?.() ?? []
  }
  export function setTableSelectedCells(cells: TableCellCoord[]) {
    inner?.setSelectedCells?.(cells)
  }
  export function focusTableCell(row: number, col: number, pos: number | 'start' | 'end' = 'start') {
    inner?.focusCell?.(row, col, pos)
  }
  export function getTableCellSelection(row: number, col: number) {
    return inner?.getCellSelection?.(row, col) ?? null
  }
  export function setTableCellSelection(row: number, col: number, start: number, end?: number) {
    inner?.setCellSelection?.(row, col, start, end ?? start)
  }
  export function isTextual() {
    return isTextBlock(block.type)
  }

  // Register with BlockEditor context (Svelte has no Vue function-ref).
  const itemApi = {
    focusAt,
    getSelection,
    setSelection,
    getEl,
    syncFromModel,
    get textual() {
      return isTextBlock(block.type)
    },
    getTableSelectedCells,
    setTableSelectedCells,
    focusTableCell,
    getTableCellSelection,
    setTableCellSelection,
  }

  onMount(() => {
    editorCtx?.setItemRef?.(block.id, itemApi)
    return () => {
      editorCtx?.setItemRef?.(block.id, null)
    }
  })

  $effect(() => {
    const id = block.id
    editorCtx?.setItemRef?.(id, itemApi)
    return () => {
      editorCtx?.setItemRef?.(id, null)
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ebi group/block relative {selected ? 'ebi-selected' : ''} {isHeading ? `ebi--heading ebi--${block.type}` : ''} {lockedBy ? 'ebi--peer-locked' : ''} {className}"
  data-block-id={block.id}
  dir={blockDir}
  style:padding-inline-start="{outerIndentPx}px"
  style:--peer-lock-color={lockedBy?.color ?? 'transparent'}
  onpointerdown={(e) => onpointerdown?.(e)}
>
  {#if dropPosition === 'before'}<div class="ebi-drop -top-[2px]"></div>{/if}
  {#if dropPosition === 'after'}<div class="ebi-drop -bottom-[2px]"></div>{/if}
  {#if dropPosition === 'left'}<div class="ebi-drop-side ebi-drop-side--left"></div>{/if}
  {#if dropPosition === 'right'}<div class="ebi-drop-side ebi-drop-side--right"></div>{/if}

  {#if !readonly && !lockedBy}
    <div class="ebi-gutter" contenteditable="false">
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button
            type="button"
            class="ebi-gutter-btn ebi-reorder-handle"
            title="Drag to move, click for menu"
            draggable="true"
            onpointerdown={(e) => {
              e.stopPropagation()
              onReorderPointerDown(e)
            }}
            ondragstart={(e) => {
              e.stopPropagation()
              onReorderDragStart(e)
            }}
          >
            <GripVertical class="w-4 h-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={isRtl ? 'end' : 'start'} class="ebi-block-menu">
          <DropdownMenuItem onclick={() => onduplicate?.()}>
            <Copy class="w-3.5 h-3.5 ebi-block-menu__icon" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem class="ebi-block-menu__danger" onclick={() => onremove?.()}>
            <Trash2 class="w-3.5 h-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  {/if}

  {#if lockedBy}
    <div
      class="ebi-lock-indicator"
      contenteditable="false"
      role="status"
      aria-label={`${lockedBy.name} is editing this block`}
    >
      <span
        class="ebi-lock-dot"
        style:background-color={lockedBy.color}
        title={`${lockedBy.name} is editing`}
      ></span>
    </div>
  {/if}

  <div class="ebi-body relative min-w-0 py-[3px]">
    {#if block.type === 'quote'}
      <div class="flex gap-3 border-s-[3px] border-gray-800 ps-3.5">
        <EditorTextBlock
          bind:this={inner}
          {block}
          placeholder={placeholder ?? 'Quote'}
          {readonly}
          {pages}
          {editorDir}
          class="flex-1"
          {...textHandlers}
        />
      </div>
    {:else if block.type === 'callout'}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="ebi-callout"
        style:background={calloutBackground}
        onmouseenter={() => (calloutHovered = true)}
        onmouseleave={() => (calloutHovered = false)}
      >
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          class="ebi-callout__aside"
          contenteditable="false"
          onclick={(e) => e.stopPropagation()}
          onpointerdown={(e) => e.stopPropagation()}
        >
          <IconEmojiPicker
            bind:this={calloutIconPickerRef}
            value={calloutIcon}
            disabled={readonly}
            onchange={(v) => onpatch?.({ icon: v ?? '💡' })}
          >
            {#snippet trigger({ selected, isIconify })}
              <button
                type="button"
                class="ebi-callout__icon-btn"
                disabled={readonly}
                title="Change icon"
                aria-label="Change callout icon"
                onpointerdown={(e) => e.stopPropagation()}
              >
                {#if selected && isIconify}
                  <span class="ebi-callout__icon-svg">
                    <IconValueDisplay icon={selected} class="size-6" />
                  </span>
                {:else}
                  <span class="ebi-callout__emoji">{selected ?? '💡'}</span>
                {/if}
              </button>
            {/snippet}
          </IconEmojiPicker>

          {#if !readonly && (calloutHovered || showCalloutColors)}
            <div class="ebi-callout__colors">
              {#each CALLOUT_COLORS as c (c.id)}
                <button
                  type="button"
                  class="ebi-callout__swatch"
                  class:ebi-callout__swatch--active={isCalloutColorActive(c.id)}
                  style:background={c.swatch}
                  title={c.id}
                  aria-label={`Callout color ${c.id}`}
                  onclick={() => selectCalloutColor(c.id)}
                ></button>
              {/each}
            </div>
          {/if}
        </div>
        <EditorTextBlock
          bind:this={inner}
          {block}
          placeholder={placeholder ?? 'Type something...'}
          {readonly}
          {pages}
          {editorDir}
          class="ebi-callout__body"
          {...textHandlers}
        />
      </div>
    {:else if block.type === 'toggle'}
      <div class="ebi-toggle-row flex w-full items-start">
        <div
          class="ebi-toggle-marker shrink-0 select-none"
          contenteditable="false"
          data-content-editable-void="true"
        >
          <button
            type="button"
            class="ebi-toggle"
            class:ebi-toggle--open={block.props.collapsed !== true}
            class:ebi-toggle--rtl={isRtl}
            disabled={readonly}
            aria-expanded={block.props.collapsed !== true}
            aria-label={block.props.collapsed === true ? 'Open' : 'Close'}
            onmousedown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onclick={(e) => {
              e.stopPropagation()
              onpatch?.({ collapsed: block.props.collapsed !== true })
            }}
          >
            <svg class="ebi-toggle__caret" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M2.835 3.25a.8.8 0 0 0-.69 1.203l5.164 8.854a.8.8 0 0 0 1.382 0l5.165-8.854a.8.8 0 0 0-.691-1.203z"
              />
            </svg>
          </button>
        </div>
        <EditorTextBlock
          bind:this={inner}
          {block}
          placeholder={placeholder ?? 'Toggle'}
          {readonly}
          {pages}
          {editorDir}
          class="ebi-toggle-body min-w-0 flex-1"
          {...textHandlers}
        />
      </div>
    {:else if ['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(block.type)}
      <div class="ebi-list-row flex items-start gap-1.5">
        <div class="ebi-list-marker shrink-0 flex items-center justify-center select-none" contenteditable="false">
          {#if block.type === 'bulleted_list_item'}
            <span class="ebi-list-marker__bullet">•</span>
          {:else if block.type === 'numbered_list_item'}
            <span class="ebi-list-marker__number tabular-nums"
              >{formatListNumber(number ?? 1, resolveBlockDirection(block, editorDir ?? 'ltr'))}.</span
            >
          {:else}
            <button
              type="button"
              class="ebi-todo"
              class:ebi-todo--checked={!!block.props.checked}
              disabled={readonly}
              aria-checked={Boolean(block.props.checked)}
              role="checkbox"
              onclick={(e) => {
                e.stopPropagation()
                onpatch?.({ checked: !block.props.checked })
              }}
            >
              {#if block.props.checked}
                <svg class="ebi-todo__tick" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3.5 8.2 6.6 11.2 12.5 4.8"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              {/if}
            </button>
          {/if}
        </div>
        <EditorTextBlock
          bind:this={inner}
          {block}
          placeholder={placeholder ?? (block.type === 'to_do' ? 'To-do' : 'List item')}
          {readonly}
          {pages}
          {editorDir}
          class="flex-1 min-w-0 {block.type === 'to_do' && block.props.checked ? 'line-through !text-gray-400' : ''}"
          {...textHandlers}
        />
      </div>
    {:else if block.type === 'code'}
      <EditorCodeBlock
        bind:this={inner}
        {block}
        {readonly}
        onpatch={(p) => onpatch?.(p)}
        onarrowup={() => onarrowup?.()}
        onarrowdown={() => onarrowdown?.()}
        onremoveself={() => onremove?.()}
        onexitbelow={() => onaddbelow?.()}
      />
    {:else if block.type === 'page'}
      <EditorPageBlock
        {block}
        {selected}
        {readonly}
        pages={pages ?? []}
        {currentPageId}
        autoPick={!!pagePickerRequest}
        onpatch={(p) => onpatch?.(p)}
        onselect={() => onselect?.()}
        onnavigate={(id) => onnavigatepage?.(id)}
        oncreatepage={(title) => onpageblockcreate?.(title)}
        onpickeropened={() => onpagepickeropened?.()}
      />
    {:else if block.type === 'image'}
      <EditorImageBlock
        {block}
        {selected}
        {readonly}
        {upload}
        {pickMedia}
        onpatch={(p) => onpatch?.(p)}
        onselect={() => onselect?.()}
      />
    {:else if block.type === 'poll'}
      <EditorPollBlock
        {block}
        {selected}
        {readonly}
        {voterId}
        onpatch={(p) => onpatch?.(p)}
        onselect={() => onselect?.()}
        onfocus={() => onfocus?.()}
        onexitbelow={() => onaddbelow?.()}
      />
    {:else if block.type === 'table'}
      <EditorTableBlock
        bind:this={inner}
        {block}
        {readonly}
        onpatch={(p) => onpatch?.(p)}
        oncellfocus={(p) => ontablecellfocus?.(p)}
        oncellinput={(p) => ontablecellinput?.(p)}
        oncellformat={(p) => ontablecellformat?.(p)}
        oncelltab={(p) => ontablecelltab?.(p)}
        oncellnavigate={(p) => ontablecellnavigate?.(p)}
        oncellselectionchange={(cells) => ontablecellselectionchange?.(cells)}
      />
    {:else if block.type === 'divider'}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="py-2.5 cursor-pointer" onclick={() => onselect?.()}>
        <hr class="border-gray-200 rounded {selected ? '!border-indigo-400' : ''}" />
      </div>
    {:else}
      <EditorTextBlock
        bind:this={inner}
        {block}
        {placeholder}
        {readonly}
        {pages}
        {editorDir}
        {...textHandlers}
      />
    {/if}

    {#if textHighlight}
      <EditorSelectionHighlight
        target={textEditableEl}
        start={textHighlight.start}
        end={textHighlight.end}
      />
    {/if}
  </div>
</div>

<style>



.ebi-selected {
  /* Flat fill only — no border or rounded corners on block selection. */
  background: rgb(35 131 226 / 0.14) !important;
  border-radius: 0;
  box-shadow: none;
}

.ebi-list-marker {
  width: 24px;
  min-height: 24px;
  margin-top: 2px;
  color: var(--xpe-foreground, #37352f);
}

.ebi-list-marker__bullet {
  font-size: 1rem;
  line-height: 1;
  /* Slightly stronger than body text so the bullet reads clearly. */
  color: color-mix(in srgb, var(--xpe-foreground, #37352f) 88%, transparent);
}

.ebi-list-marker__number {
  font-size: 14px;
  line-height: 1.375;
  color: color-mix(in srgb, var(--xpe-foreground, #37352f) 80%, transparent);
}

/* Dark theme: fixed Tailwind grays were nearly invisible on #191919. */
:global(html[data-theme='dark']) .ebi-list-marker__bullet {
  color: color-mix(in srgb, var(--xpe-foreground, #e6e6e6) 92%, #fff 8%);
  opacity: 1;
}

:global(html[data-theme='dark']) .ebi-list-marker__number {
  color: color-mix(in srgb, var(--xpe-foreground, #e6e6e6) 85%, #fff 10%);
  opacity: 1;
}
.ebi-todo {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 4px;
  padding: 0;
  border-radius: 4px;
  border: 1.5px solid var(--xpe-border, #d1d5db);
  background: var(--xpe-background, #fff);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
}
.ebi-todo:hover:not(:disabled) {
  border-color: var(--xpe-primary, #2383e2);
}
.ebi-todo--checked {
  background: var(--xpe-primary, #2383e2);
  border-color: var(--xpe-primary, #2383e2);
  color: #fff;
}
.ebi-todo:disabled {
  opacity: 0.65;
  cursor: default;
}
.ebi-todo__tick {
  display: block;
  width: 11px;
  height: 11px;
  color: #fff;
}

/* ─── Callout ─────────────────────────────────────────────────────────────── */
.ebi-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 10px;
  color: var(--xpe-foreground, #37352f);
}

.ebi-callout__aside {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding-top: 1px;
}

.ebi-callout__icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.12s, transform 0.12s;
}

.ebi-callout__icon-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--xpe-foreground, #37352f) 8%, transparent);
  transform: scale(1.06);
}

.ebi-callout__icon-btn:disabled {
  cursor: default;
  opacity: 0.85;
}

.ebi-callout__emoji {
  font-size: 22px;
  line-height: 1;
}

.ebi-callout__icon-svg {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
}

.ebi-callout__colors {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 3px;
  max-width: 72px;
}

.ebi-callout__swatch {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--xpe-foreground, #37352f) 12%, transparent);
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}

.ebi-callout__swatch:hover {
  transform: scale(1.12);
}

.ebi-callout__swatch--active {
  box-shadow:
    0 0 0 1.5px var(--xpe-background, #fff),
    0 0 0 3px var(--xpe-primary, #2383e2);
}

.ebi-callout__body {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}

/* block toggle disclosure */
.ebi-toggle-row {
  padding-inline-start: 2px;
  border-radius: 6px;
  color: inherit;
  fill: inherit;
}

.ebi-toggle-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  min-height: 1.5em;
  height: 28px;
  padding-top: 2px;
  padding-bottom: 2px;
}

.ebi-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  fill: inherit;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s;
}

.ebi-toggle:hover:not(:disabled) {
  background: var(--xpe-hover, rgb(55 53 47 / 0.08));
}

.ebi-toggle:disabled {
  opacity: 0.65;
  cursor: default;
}

/* Path points ▼ at 0°. Closed = sideways; open always faces down (block editor). */
.ebi-toggle__caret {
  width: 0.85em;
  height: 0.85em;
  opacity: 0.55;
  fill: currentColor;
  transition: transform 200ms ease-out;
  transform: rotate(-90deg); /* closed: ► */
}

.ebi-toggle--open .ebi-toggle__caret {
  transform: rotate(0deg); /* open: ▼ */
}

.ebi-toggle--rtl .ebi-toggle__caret {
  transform: rotate(90deg); /* closed: ◄ */
}

.ebi-toggle--rtl.ebi-toggle--open .ebi-toggle__caret {
  transform: rotate(0deg); /* open still ▼ */
}

.ebi-toggle:focus-visible {
  outline: 2px solid var(--xpe-primary, #2383e2);
  outline-offset: 1px;
}

.ebi-toggle-body :global(.etb) {
  padding-top: 2px;
  padding-bottom: 2px;
  padding-inline-start: 6px;
}

.ebi-drop {
  position: absolute;
  inset-inline-start: 0;
  inset-inline-end: 0;
  height: 3px;
  background: #818cf8;
  border-radius: 2px;
  z-index: 10;
  pointer-events: none;
}

.ebi-drop-side {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #818cf8;
  border-radius: 2px;
  z-index: 10;
  pointer-events: none;
}

.ebi-drop-side--left {
  inset-inline-start: 0;
}

.ebi-drop-side--right {
  inset-inline-end: 0;
}
/*
 * Absolute drag handle on the block's inline-start edge (outside text) {
 * - LTR → left of content
 * - RTL → right of content
 * Never takes layout space, so page title and body share one left edge.
 */
/* Ensure each block (and its absolute drag handle) stacks above marquee strips. */
.ebi {
  z-index: 2;
  /* Let taps land on text without browser double-tap delays. */
  touch-action: manipulation;
}

/*
 * Absolute drag handle on the block's inline-start edge (outside text).
 *
 * Must overlap the block box (no gap) { a dead zone between body and handle
 * drops :hover, pointer-events go none, and the button vanishes mid-grab.
 * Width spans from outside the text into the first few px of the block.
 */
.ebi-gutter {
  position: absolute;
  top: 0;
  bottom: 0;
  inset-inline-start: -40px;
  /* -40 … +8 → continuous with the block; easy approach path */
  width: 48px;
  /* Above marquee side strips (z-index 1) so drag-to-reorder receives the gesture. */
  z-index: 20;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-block-start: 3px;
  box-sizing: border-box;
  opacity: 0;
  transition: opacity 0.1s ease;
  user-select: none;
  pointer-events: none;
}

/* Nudge drag handle down so it sits on the first line of larger headings. */
.ebi--heading_1 .ebi-gutter {
  padding-block-start: 10px;
}
.ebi--heading_2 .ebi-gutter {
  padding-block-start: 7px;
}
.ebi--heading_3 .ebi-gutter {
  padding-block-start: 5px;
}
.ebi--heading_4 .ebi-gutter {
  padding-block-start: 4px;
}
.ebi--heading_5 .ebi-gutter,
.ebi--heading_6 .ebi-gutter {
  padding-block-start: 3px;
}

.ebi:hover .ebi-gutter,
.ebi-gutter:focus-within,
.ebi-gutter:hover {
  opacity: 1;
  pointer-events: auto;
}

/* Peer editing this line — soft color wash + start edge (collab cue). */
.ebi--peer-locked {
  box-shadow: inset 3px 0 0 0 var(--peer-lock-color, #2383e2);
  background: color-mix(in srgb, var(--peer-lock-color, #2383e2) 8%, transparent);
  border-radius: 2px;
}

[dir='rtl'] .ebi--peer-locked,
.ebi[dir='rtl'].ebi--peer-locked {
  box-shadow: inset -3px 0 0 0 var(--peer-lock-color, #2383e2);
}

/*
 * Peer soft-lock indicator — same absolute slot as the drag grabber, always
 * visible while the lock is held (not hover-gated like the handle).
 */
.ebi-lock-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  inset-inline-start: -40px;
  width: 48px;
  z-index: 21;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-block-start: 3px;
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
}

.ebi--heading_1 .ebi-lock-indicator {
  padding-block-start: 10px;
}
.ebi--heading_2 .ebi-lock-indicator {
  padding-block-start: 7px;
}
.ebi--heading_3 .ebi-lock-indicator {
  padding-block-start: 5px;
}
.ebi--heading_4 .ebi-lock-indicator {
  padding-block-start: 4px;
}
.ebi--heading_5 .ebi-lock-indicator,
.ebi--heading_6 .ebi-lock-indicator {
  padding-block-start: 3px;
}

.ebi-lock-dot {
  display: block;
  width: 8px;
  height: 8px;
  margin-block-start: 12px; /* center-ish within 32px grabber height */
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--xpe-background, #fff);
  flex-shrink: 0;
  pointer-events: auto;
  cursor: default;
}

.ebi-gutter-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  /* Larger grab target — easier to hit while moving from the text */
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--xpe-muted-foreground, #9b9a97);
  cursor: grab;
  transition: background 0.1s, color 0.1s;
  padding: 0;
  flex-shrink: 0;
  /* Only interactive when the gutter is shown — avoid invisible hit targets blocking marquee. */
  pointer-events: none;
}

.ebi-gutter-btn.ebi-reorder-handle {
  cursor: grab;
}

.ebi-gutter-btn.ebi-reorder-handle:active {
  cursor: grabbing;
}

.ebi:hover .ebi-gutter .ebi-gutter-btn,
.ebi-gutter:focus-within .ebi-gutter-btn,
.ebi-gutter:hover .ebi-gutter-btn {
  pointer-events: auto;
}

.ebi-gutter-btn:hover {
  background: var(--xpe-hover, #f1f1ef);
  color: var(--xpe-foreground, #37352f);
}

/* Block ⋯ menu (teleported) — solid theme colors */
:global(.ebi-block-menu) {
  min-width: 9rem;
  background: var(--xpe-popover-bg, var(--xpe-background, #fff)) !important;
  color: var(--xpe-foreground, #37352f);
}
:global(.ebi-block-menu .ebi-block-menu__icon) {
  color: var(--xpe-muted-foreground, #9b9a97);
}
:global(.ebi-block-menu .ebi-block-menu__danger) {
  color: #eb5757;
}
:global(.ebi-block-menu .ebi-block-menu__danger:hover) {
  background: color-mix(in srgb, #eb5757 12%, transparent);
  color: #eb5757;
}

.ebi-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--xpe-foreground, #37352f);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}
.ebi-menu-item:hover { background: var(--xpe-hover, #f1f1ef); }


</style>
