<script lang="ts">

  import { getContext, onDestroy } from 'svelte'
  import type { Block, BlockRenderEntry, ColumnRenderEntry } from '@xproeditor/core'
  import { resolveBlockDirection, toggleGroupPaddingPx } from '@xproeditor/core'
  import EditorBlockItem from './EditorBlockItem.svelte'
  import EditorBlockTree from './EditorBlockTree.svelte'
  import { BLOCK_EDITOR_CTX, type BlockEditorContext } from './block-editor-context'

  let {
    entries,
    vboxBaseIndent,
    /** Must be a prop so soft-locks re-render when peers change (context alone does not). */
    lockedBlocks = null as Record<string, { name: string; color: string }> | null,
  }: {
    entries: BlockRenderEntry[]
    vboxBaseIndent?: number
    lockedBlocks?: Record<string, { name: string; color: string }> | null
  } = $props()

  const ctx = getContext<BlockEditorContext>(BLOCK_EDITOR_CTX)!

  let liveWidths = $state<Record<string, number> | null>(null)
  let resizing = $state(false)
  let resizeCleanup: (() => void) | null = null

  function entryKey(entry: BlockRenderEntry): string {
    if (entry.kind === 'toggle') return `${entry.block.id}:toggle:${entry.block.props.collapsed ? 'c' : 'o'}`
    if (entry.kind === 'column_list') return `${entry.block.id}:column_list:${entry.columns.length}`
    if (entry.block.type === 'page') return `${entry.block.id}:${entry.block.props.pageId ?? ''}`
    return `${entry.block.id}:${entry.block.type}`
  }

  function columnListPadding(entry: Extract<BlockRenderEntry, { kind: 'column_list' }>): number {
    return toggleGroupPaddingPx(entry.block.props.indent ?? 0, vboxBaseIndent)
  }
  function togglePadding(entry: Extract<BlockRenderEntry, { kind: 'toggle' }>): number {
    return toggleGroupPaddingPx(entry.block.props.indent ?? 0, vboxBaseIndent)
  }

  /** Writing direction for a toggle group so padding-inline-start indents on the correct side. */
  function toggleDir(block: Block): 'ltr' | 'rtl' {
    return ctx.directionFor?.(block.id) ?? resolveBlockDirection(block, ctx.editorDir ?? 'ltr')
  }

  function resolveWidths(columns: ColumnRenderEntry[]): number[] {
    const n = columns.length
    if (n === 0) return []
    const live = liveWidths
    const raw = columns.map((col) => {
      if (live && live[col.block.id] != null) return live[col.block.id]
      const w = col.block.props.width
      return typeof w === 'number' && w > 0 ? w : null
    })
    if (raw.every((w) => w != null)) {
      const total = raw.reduce<number>((sum, w) => sum + (w as number), 0)
      if (total > 0) return raw.map((w) => ((w as number) / total) * 100)
    }
    return columns.map(() => 100 / n)
  }

  function columnStyle(columns: ColumnRenderEntry[], index: number): string {
    const widths = resolveWidths(columns)
    const pct = widths[index] ?? 100 / Math.max(1, columns.length)
    return `flex: ${pct} 1 0; min-width: 0; max-width: 100%`
  }

  function stopResizeListeners() {
    resizeCleanup?.()
    resizeCleanup = null
  }

  function onColumnResizeStart(
    entry: Extract<BlockRenderEntry, { kind: 'column_list' }>,
    leftIndex: number,
    event: PointerEvent,
  ) {
    if (ctx.isReadonly(entry.block.id)) return
    if (leftIndex < 0 || leftIndex >= entry.columns.length - 1) return
    event.preventDefault()
    event.stopPropagation()
    const row = (event.currentTarget as HTMLElement).closest('.ebi-column-list__row') as HTMLElement | null
    if (!row) return
    const leftCol = entry.columns[leftIndex]
    const rightCol = entry.columns[leftIndex + 1]
    const widths = resolveWidths(entry.columns)
    const startLeft = widths[leftIndex]
    const startRight = widths[leftIndex + 1]
    const pair = startLeft + startRight
    const startX = event.clientX
    const rowWidth = row.getBoundingClientRect().width
    if (rowWidth < 8) return
    const minPct = Math.min(18, pair / 2)
    resizing = true
    liveWidths = { [leftCol.block.id]: startLeft, [rightCol.block.id]: startRight }

    const onMove = (ev: PointerEvent) => {
      const dPct = ((ev.clientX - startX) / rowWidth) * 100
      let nextLeft = Math.max(minPct, Math.min(pair - minPct, startLeft + dPct))
      liveWidths = { [leftCol.block.id]: nextLeft, [rightCol.block.id]: pair - nextLeft }
    }
    const onUp = () => {
      const final = liveWidths
      stopResizeListeners()
      resizing = false
      if (!final) { liveWidths = null; return }
      const leftW = Math.round((final[leftCol.block.id] ?? startLeft) * 10) / 10
      const rightW = Math.round((final[rightCol.block.id] ?? startRight) * 10) / 10
      const leftLive = ctx.resolveBlock?.(leftCol.block.id) ?? leftCol.block
      ctx.patchProps(leftLive, { width: leftW })
      const rightAfter = ctx.resolveBlock?.(rightCol.block.id) ?? rightCol.block
      ctx.patchProps(rightAfter, { width: rightW })
      liveWidths = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
    resizeCleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }

  onDestroy(stopResizeListeners)

  function bindItem(block: Block) {
    // Read lockedBlocks from props so Svelte invalidates this when peer soft-locks change.
    const lockedBy =
      (lockedBlocks && lockedBlocks[block.id])
      || ctx.lockFor(block.id)
      || null
    return {
      block,
      number: ctx.listNumberFor(block.id),
      placeholder: ctx.placeholderFor(block),
      selected: ctx.isSelected(block.id),
      textHighlight: ctx.textHighlightFor(block.id),
      dropPosition: ctx.dropPositionFor(block.id),
      upload: ctx.upload,
      pickMedia: ctx.pickMedia,
      editorDir: ctx.editorDir,
      readonly: ctx.isReadonly(block.id),
      lockedBy,
      iconPickerRequest: ctx.iconPickerRequestFor(block.id),
      pagePickerRequest: ctx.pagePickerRequestFor(block.id),
      pages: ctx.pages ?? [],
      currentPageId: ctx.currentPageId,
      voterId: ctx.voterId,
      oninput: (s: any, c: any) => ctx.handleInput(block, s, c),
      onenter: (o: any) => ctx.handleEnter(block, o),
      onbackspacestart: () => ctx.handleBackspaceStart(block),
      ondeleteend: () => ctx.handleDeleteEnd(block),
      onarrowup: () => ctx.handleArrow(block, -1),
      onarrowdown: () => ctx.handleArrow(block, 1),
      ontab: (s: boolean) => ctx.handleTab(block, s),
      onformat: (m: any, o: any) => ctx.handleFormat(block, m, o),
      onpasted: (p: any) => ctx.handlePasted(block, p),
      onfocus: () => ctx.onBlockFocus(block),
      onpatch: (p: any) => ctx.patchProps(block, p),
      oniconpickeropened: () => ctx.clearIconPickerRequest(),
      onpagepickeropened: () => ctx.clearPagePickerRequest(),
      onpageblockcreate: (title: string) => ctx.onPageBlockCreate(block.id, title),
      onnavigatepage: (id: string) => ctx.onPageBlockNavigate(id),
      onselect: () => ctx.selectBlock(block.id),
      onaddbelow: () => ctx.addBelow(block),
      onduplicate: () => ctx.duplicateBlock(block),
      onremove: () => ctx.removeBlock(block),
      ondraghandlestart: (e: DragEvent) => ctx.onDragHandleStart(block, e),
      onpointerdown: (e: PointerEvent) => ctx.onBlockPointerDown(block, e),
      onselectionpointerdown: (p: any) => ctx.onSelectionPointerDown(block, p),
      ontablecellfocus: (p: any) => ctx.onTableCellFocus(block, p),
      ontablecellinput: (p: any) => ctx.onTableCellInput(block, p),
      ontablecellformat: (p: any) => ctx.handleTableFormat(block, p),
      ontablecelltab: (p: any) => ctx.handleTableTab(block, p),
      ontablecellnavigate: (p: any) => ctx.handleTableNavigate(block, p),
      ontablecellselectionchange: (cells: any) => ctx.onTableCellSelectionChange(block, cells),
    }
  }

</script>


{#each entries as entry (entryKey(entry))}
  {#if entry.kind === 'column_list'}
    <div class="ebi-column-list" class:ebi-column-list--resizing={resizing} style:padding-inline-start="{columnListPadding(entry)}px">
      <div class="ebi-column-list__row">
        {#each entry.columns as column, colIndex (column.block.id)}
          <div class="ebi-column-list__col" style={columnStyle(entry.columns, colIndex)}>
            <EditorBlockTree entries={column.children} {lockedBlocks} />
          </div>
          {#if colIndex < entry.columns.length - 1}
            <div
              class="ebi-column-list__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize columns"
              title="Drag to resize"
              onpointerdown={(e) => onColumnResizeStart(entry, colIndex, e)}
            >
              <span class="ebi-column-list__resizer-bar" aria-hidden="true"></span>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {:else if entry.kind === 'toggle'}
    <div
      class="ebi-toggle-group"
      dir={toggleDir(entry.block)}
      style:padding-inline-start="{togglePadding(entry)}px"
    >
      <div class="ebi-toggle-vbox-header">
        <EditorBlockItem {...bindItem(entry.block)} suppressOuterIndent={true} class={ctx.isDragging(entry.block.id) ? 'opacity-40' : ''} />
      </div>
      {#if !entry.block.props.collapsed}
        <div class="ebi-toggle-vbox">
          {#if entry.children.length > 0}
            <EditorBlockTree
              entries={entry.children}
              vboxBaseIndent={entry.block.props.indent ?? 0}
              {lockedBlocks}
            />
          {:else}
            <button type="button" class="ebi-toggle-empty" onclick={() => ctx.addBelow(entry.block)}>Empty toggle. Click or drop blocks inside.</button>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <EditorBlockItem {...bindItem(entry.block)} {vboxBaseIndent} class={ctx.isDragging(entry.block.id) ? 'opacity-40' : ''} />
  {/if}
{/each}


<style>

.ebi-toggle-group {
  width: 100%;
}

.ebi-toggle-vbox-header :global(.ebi) {
  padding-inline-start: 0 !important;
}

.ebi-toggle-vbox {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  /* Align body with toggle title text (after the 24px caret column). */
  padding-inline-start: 24px;
  box-sizing: border-box;
}

.ebi-toggle-empty {
  width: 100%;
  margin-top: 2px;
  padding: 3px 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--xpe-muted-foreground, #9b9a97);
  font: inherit;
  font-size: inherit;
  text-align: start;
  cursor: text;
}

.ebi-toggle-empty:hover {
  background: var(--xpe-hover, rgb(55 53 47 / 0.06));
}

.ebi-column-list {
  width: 100%;
  margin: 2px 0;
}

.ebi-column-list__row {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  gap: 0;
}

.ebi-column-list__col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  /* Tight padding so text sits close to the divider */
  padding-inline: 2px;
}

/* Hit area is always there; the visible bar only appears when near it. */
.ebi-column-list__resizer {
  position: relative;
  flex: 0 0 10px;
  width: 10px;
  margin-inline: 0;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  align-self: stretch;
  display: flex;
  align-items: stretch;
  justify-content: center;
  z-index: 2;
}

.ebi-column-list__resizer-bar {
  display: block;
  width: 2px;
  margin-block: 2px;
  border-radius: 999px;
  background: var(--xpe-primary, #2383e2);
  opacity: 0;
  transform: scaleX(0.5);
  transition: opacity 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
}

.ebi-column-list__resizer:hover .ebi-column-list__resizer-bar,
.ebi-column-list__resizer:focus-visible .ebi-column-list__resizer-bar,
.ebi-column-list--resizing .ebi-column-list__resizer-bar {
  opacity: 1;
  transform: scaleX(1);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--xpe-primary, #2383e2) 30%, transparent);
}

.ebi-column-list--resizing {
  cursor: col-resize;
  user-select: none;
}

.ebi-column-list--resizing :global(*) {
  cursor: col-resize !important;
}

</style>
