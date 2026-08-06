<script lang="ts">
  import { onDestroy } from 'svelte'
  import Columns2 from '@lucide/svelte/icons/columns-2'
  import Expand from '@lucide/svelte/icons/expand'
  import Merge from '@lucide/svelte/icons/merge'
  import Plus from '@lucide/svelte/icons/plus'
  import SplitSquareHorizontal from '@lucide/svelte/icons/split-square-horizontal'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import X from '@lucide/svelte/icons/x'
  import {
    addTableColumn,
    addTableRow,
    canMergeCells,
    canUnmergeCell,
    columnWidthStyle,
    getResolvedColumnWidth,
    mergeCells,
    normalizeTableData,
    patchTableCell,
    patchTableStyle,
    removeTableColumn,
    removeTableRow,
    setColumnWidthsForIndices,
    spansToText,
    tableCellFromText,
    tableCellStyle,
    tableWrapperStyle,
    unmergeCell,
  } from '@xproeditor/core'
  import type { Block, InlineSpan, MarkName, TableCellCoord, TableData, TableStyle, TableWidth } from '@xproeditor/core'
  import EditorTableCell from './EditorTableCell.svelte'

  let {
    block,
    readonly = false,
    onpatch,
    oncellfocus,
    oncellinput,
    oncellformat,
    oncelltab,
    oncellnavigate,
    oncellselectionchange,
  }: {
    block: Block
    readonly?: boolean
    onpatch?: (patch: Record<string, unknown>) => void
    oncellfocus?: (payload: { row: number; col: number; shiftKey: boolean }) => void
    oncellinput?: (payload: { row: number; col: number; content: InlineSpan[]; caret: number | null }) => void
    oncellformat?: (payload: { row: number; col: number; mark: MarkName }) => void
    oncelltab?: (payload: { row: number; col: number; shift: boolean }) => void
    oncellnavigate?: (payload: {
      row: number
      col: number
      direction: 'up' | 'down' | 'left' | 'right'
    }) => void
    oncellselectionchange?: (cells: TableCellCoord[]) => void
  } = $props()

  function styleToString(style: Record<string, string> | string | null | undefined): string {
    if (!style) return ''
    if (typeof style === 'string') return style
    return Object.entries(style)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v}`)
      .join('; ')
  }

  type EditorTableCellApi = {
    focusAt: (pos: number | 'start' | 'end') => void
    getSelection: () => { start: number; end: number } | null
    setSelection: (start: number, end?: number) => void
    getEl: () => HTMLElement | null
  }
  const cellRefs = new Map<string, EditorTableCellApi>()
  let selectedCells = $state<TableCellCoord[]>([])
  const widthPresets = [10, 15, 20, 25, 33, 50, 75, 100]
  let manageOpen = $state(false)
  let manageSelected = $state<TableCellCoord[]>([])
  let manageAnchor = $state<TableCellCoord | null>(null)
  const MANAGE_COL_MIN_PX = 100
  let manageColWidths = $state<number[]>([])
  let manageResizeCleanup: (() => void) | null = null

  function table(): TableData {
    return normalizeTableData(block.props.table)
  }

  let wrapperStyle = $derived.by(() => {
    const current = table()
    void block
    return styleToString(tableWrapperStyle(current.style, current.width) as Record<string, string>)
  })

  function cellKey(row: number, col: number): string {
    return `${row}:${col}`
  }

  function setCellRef(row: number, col: number, instance: EditorTableCellApi | null) {
    const key = cellKey(row, col)
    if (instance) cellRefs.set(key, instance)
    else cellRefs.delete(key)
  }

  function updateTable(next: TableData) {
    onpatch?.({ table: next })
  }

  function patchTable(nextTable: TableData) {
    updateTable(nextTable)
  }

  function toggleHeader() {
    const current = table()
    updateTable({ ...current, hasHeader: !current.hasHeader })
  }

  let selectedColumnIndices = $derived.by(() => {
    const set = new Set(selectedCells.map((cell) => cell.col))
    return [...set].sort((a, b) => a - b)
  })

  let hasColumnSelection = $derived(selectedColumnIndices.length > 0)

  let showColumnWidthControls = $derived.by(() => {
    if (!hasColumnSelection) return false
    return selectedCells.some((cell) => cell.row === 0)
  })

  let activeColumnWidth = $derived.by(() => {
    void block
    const cols = selectedColumnIndices
    if (!cols.length) return { mode: 'auto' as const, value: 0 }
    return getResolvedColumnWidth(table(), cols[0])
  })

  function setSelectedColumnWidthMode(mode: TableWidth['mode']) {
    const cols = selectedColumnIndices
    if (!cols.length) return
    const current = activeColumnWidth
    if (mode === 'auto') {
      patchTable(setColumnWidthsForIndices(table(), cols, { mode: 'auto', value: 0 }))
      return
    }
    const value = mode === current.mode ? current.value : mode === 'percent' ? 25 : 160
    patchTable(setColumnWidthsForIndices(table(), cols, { mode, value }))
  }

  function setSelectedColumnWidthValue(value: number) {
    const cols = selectedColumnIndices
    if (!cols.length) return
    const mode = activeColumnWidth.mode
    if (mode === 'auto') return
    patchTable(setColumnWidthsForIndices(table(), cols, { mode, value }))
  }

  function editorColStyle(colIdx: number): string {
    void block
    return styleToString(columnWidthStyle(getResolvedColumnWidth(table(), colIdx)) as Record<string, string>)
  }

  function cellStyleStr(cell: any, rowIdx: number): string {
    const current = table()
    const base = tableCellStyle(cell, rowIdx, current.hasHeader, current.style) as Record<string, string>
    const col = columnWidthStyle(getResolvedColumnWidth(current, cell ? 0 : 0)) as Record<string, string>
    // col style applied separately via editorColStyle on cell — match Vue merge for this colIdx later
    return styleToString(base)
  }

  function cellFullStyle(cell: any, rowIdx: number, colIdx: number): string {
    const current = table()
    const base = {
      ...(tableCellStyle(cell, rowIdx, current.hasHeader, current.style) as Record<string, string>),
      ...(columnWidthStyle(getResolvedColumnWidth(current, colIdx)) as Record<string, string>),
    }
    return styleToString(base)
  }

  function manageColCount(): number {
    return table().rows[0]?.length ?? 0
  }

  function ensureManageColWidths() {
    const cols = manageColCount()
    const next = manageColWidths.slice(0, cols)
    while (next.length < cols) next.push(MANAGE_COL_MIN_PX)
    for (let i = 0; i < next.length; i += 1) {
      if (!Number.isFinite(next[i]) || next[i] < MANAGE_COL_MIN_PX) next[i] = MANAGE_COL_MIN_PX
    }
    manageColWidths = next
  }

  function manageColStyle(colIdx: number): string {
    const w = manageColWidths[colIdx] ?? MANAGE_COL_MIN_PX
    return styleToString({
      width: `${w}px`,
      minWidth: `${MANAGE_COL_MIN_PX}px`,
      maxWidth: `${w}px`,
    })
  }

  function startManageColResize(colIdx: number, event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    ensureManageColWidths()
    manageResizeCleanup?.()

    const startX = event.clientX
    const startW = manageColWidths[colIdx] ?? MANAGE_COL_MIN_PX

    const onMove = (ev: MouseEvent) => {
      const nextW = Math.max(MANAGE_COL_MIN_PX, Math.round(startW + (ev.clientX - startX)))
      const next = [...manageColWidths]
      next[colIdx] = nextW
      manageColWidths = next
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      manageResizeCleanup = null
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    manageResizeCleanup = onUp
  }

  function openDataManager() {
    if (readonly) return
    manageSelected = []
    manageAnchor = null
    ensureManageColWidths()
    manageOpen = true
  }

  function closeDataManager() {
    manageOpen = false
    manageSelected = []
    manageAnchor = null
    manageResizeCleanup?.()
    manageResizeCleanup = null
  }

  function cellPlainText(row: number, col: number): string {
    const cell = table().rows[row]?.[col]
    if (!cell || cell.hidden) return ''
    return spansToText(cell.content)
  }

  function setCellPlainText(row: number, col: number, text: string) {
    const current = table()
    const cell = current.rows[row]?.[col]
    if (!cell || cell.hidden) return
    const nextContent = tableCellFromText(text).content
    if (spansToText(cell.content) === spansToText(nextContent)) return
    updateTable(patchTableCell(current, row, col, { content: nextContent }))
  }

  function isManageSelected(row: number, col: number): boolean {
    return manageSelected.some((cell) => cell.row === row && cell.col === col)
  }

  function selectManageRange(from: TableCellCoord, to: TableCellCoord) {
    const current = table()
    const minRow = Math.min(from.row, to.row)
    const maxRow = Math.max(from.row, to.row)
    const minCol = Math.min(from.col, to.col)
    const maxCol = Math.max(from.col, to.col)
    const next: TableCellCoord[] = []
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const cell = current.rows[row]?.[col]
        if (cell && !cell.hidden) next.push({ row, col })
      }
    }
    manageSelected = next
  }

  function onManageCellMouseDown(row: number, col: number, event: MouseEvent) {
    if (event.shiftKey && manageAnchor) {
      event.preventDefault()
      selectManageRange(manageAnchor, { row, col })
      return
    }
    manageAnchor = { row, col }
    manageSelected = [{ row, col }]
  }

  function onManageCellFocus(row: number, col: number) {
    if (isManageSelected(row, col) && manageSelected.length > 1) return
    manageAnchor = { row, col }
    manageSelected = [{ row, col }]
  }

  function clearManageSelectedCells() {
    if (manageSelected.length === 0) return
    let current = table()
    for (const { row, col } of manageSelected) {
      const cell = current.rows[row]?.[col]
      if (!cell || cell.hidden) continue
      if (spansToText(cell.content) === '') continue
      current = patchTableCell(current, row, col, { content: [] })
    }
    updateTable(current)
  }

  function onManageKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDataManager()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && manageSelected.length > 1) {
      event.preventDefault()
      clearManageSelectedCells()
    }
  }

  $effect(() => {
    const open = manageOpen
    if (open) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onManageKeydown, true)
      ensureManageColWidths()
      return () => {
        document.body.style.overflow = ''
        window.removeEventListener('keydown', onManageKeydown, true)
      }
    }
    document.body.style.overflow = ''
    window.removeEventListener('keydown', onManageKeydown, true)
    manageSelected = []
    manageAnchor = null
    manageResizeCleanup?.()
    manageResizeCleanup = null
  })

  $effect(() => {
    const open = manageOpen
    const cols = open ? manageColCount() : 0
    void cols
    void block
    if (open) ensureManageColWidths()
  })

  onDestroy(() => {
    document.body.style.overflow = ''
    window.removeEventListener('keydown', onManageKeydown, true)
    manageResizeCleanup?.()
    manageResizeCleanup = null
  })

  function onCellClick(payload: { row: number; col: number; shiftKey: boolean }) {
    if (payload.shiftKey && selectedCells.length > 0) {
      const current = table()
      const anchor = selectedCells[0]
      const minRow = Math.min(anchor.row, payload.row)
      const maxRow = Math.max(anchor.row, payload.row)
      const minCol = Math.min(anchor.col, payload.col)
      const maxCol = Math.max(anchor.col, payload.col)
      const next: TableCellCoord[] = []
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const cell = current.rows[row]?.[col]
          if (cell && !cell.hidden) next.push({ row, col })
        }
      }
      selectedCells = next
    } else {
      selectedCells = [{ row: payload.row, col: payload.col }]
    }
    oncellselectionchange?.([...selectedCells])
    oncellfocus?.(payload)
  }

  function isCellSelected(row: number, col: number): boolean {
    return selectedCells.some((cell) => cell.row === row && cell.col === col)
  }

  function handleMerge() {
    const current = table()
    if (!canMergeCells(current, selectedCells)) return
    patchTable(mergeCells(current, selectedCells))
    selectedCells = [selectedCells[0]]
    oncellselectionchange?.([...selectedCells])
  }

  function handleUnmerge() {
    const focus = selectedCells[0]
    const current = table()
    if (!focus || !canUnmergeCell(current, focus.row, focus.col)) return
    patchTable(unmergeCell(current, focus.row, focus.col))
  }

  let mergeEnabled = $derived(canMergeCells(table(), selectedCells))
  let unmergeEnabled = $derived.by(() => {
    const focus = selectedCells[0]
    return !!focus && canUnmergeCell(table(), focus.row, focus.col)
  })

  function patchStyle(patch: Partial<TableStyle>) {
    patchTable(patchTableStyle(table(), patch))
  }

  function handleAddRow() {
    patchTable(addTableRow(table()))
  }

  function handleAddColumn() {
    patchTable(addTableColumn(table()))
  }

  function handleRemoveRow(rowIdx: number) {
    patchTable(removeTableRow(table(), rowIdx))
  }

  function handleRemoveLastColumn() {
    const current = table()
    patchTable(removeTableColumn(current, (current.rows[0]?.length ?? 1) - 1))
  }

  function handleRemoveLastColumnCol(colIdx: number) {
    patchTable(removeTableColumn(table(), colIdx))
  }

  export function getSelectedCells() {
    return [...selectedCells]
  }
  export function setSelectedCells(cells: TableCellCoord[]) {
    selectedCells = [...cells]
    oncellselectionchange?.([...selectedCells])
  }
  export function focusCell(row: number, col: number, pos: number | 'start' | 'end' = 'start') {
    cellRefs.get(cellKey(row, col))?.focusAt?.(pos)
  }
  export function getCellSelection(row: number, col: number) {
    return cellRefs.get(cellKey(row, col))?.getSelection?.() ?? null
  }
  export function setCellSelection(row: number, col: number, start: number, end = start) {
    cellRefs.get(cellKey(row, col))?.setSelection?.(start, end)
  }
  export function applyTableStyle(patch: Partial<TableStyle>) {
    patchStyle(patch)
  }
</script>

<div class="group/table etable-root my-1">
  {#if !readonly}
    <div class="mb-1 flex flex-wrap items-center gap-2 opacity-0 transition-opacity group-hover/table:opacity-100">
      <button type="button" class="etable-btn" onclick={toggleHeader}>
        {table().hasHeader ? 'Header: on' : 'Header: off'}
      </button>
      <button type="button" class="etable-btn" disabled={!mergeEnabled} onclick={handleMerge}>
        <Merge class="inline h-3 w-3" /> Merge
      </button>
      <button type="button" class="etable-btn" disabled={!unmergeEnabled} onclick={handleUnmerge}>
        <SplitSquareHorizontal class="inline h-3 w-3" /> Unmerge
      </button>
      {#if showColumnWidthControls}
        <div class="etable-width-group flex items-center gap-1 rounded-md px-1 py-0.5" title="Width of selected column(s)">
          <span class="etable-width-label">Col</span>
          <button type="button" class="etable-btn" class:etable-btn-active={activeColumnWidth.mode === 'auto'} onclick={() => setSelectedColumnWidthMode('auto')}>Auto</button>
          <button type="button" class="etable-btn" class:etable-btn-active={activeColumnWidth.mode === 'percent'} onclick={() => setSelectedColumnWidthMode('percent')}>%</button>
          <button type="button" class="etable-btn" class:etable-btn-active={activeColumnWidth.mode === 'pixel'} onclick={() => setSelectedColumnWidthMode('pixel')}>px</button>
          {#if activeColumnWidth.mode === 'percent'}
            {#each widthPresets as preset (preset)}
              <button type="button" class="etable-btn" class:etable-btn-active={activeColumnWidth.value === preset} onclick={() => setSelectedColumnWidthValue(preset)}>{preset}%</button>
            {/each}
          {:else if activeColumnWidth.mode === 'pixel'}
            <input
              type="number"
              min="40"
              max="2000"
              step="10"
              class="etable-width-input w-16 rounded px-1 py-0.5 text-[11px]"
              value={activeColumnWidth.value}
              onchange={(e) => setSelectedColumnWidthValue(Number((e.currentTarget as HTMLInputElement).value))}
            />
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex items-start">
    <div class="etable-frame flex-1 overflow-x-auto rounded-lg" style={wrapperStyle}>
      <table class="etable w-full border-collapse">
        <colgroup>
          {#each (table().rows[0] ?? []) as _, colIdx (`ecol-${colIdx}`)}
            <col style={editorColStyle(colIdx)} />
          {/each}
          <col class="etable-col-action" />
        </colgroup>
        <tbody>
          {#each table().rows as row, rowIdx (rowIdx)}
            <tr class="group/row">
              {#each row as cell, colIdx (colIdx)}
                {#if !cell.hidden}
                  <EditorTableCell
                    {cell}
                    {rowIdx}
                    {colIdx}
                    isHeader={rowIdx === 0 && table().hasHeader}
                    selected={isCellSelected(rowIdx, colIdx)}
                    {readonly}
                    cellStyle={cellFullStyle(cell, rowIdx, colIdx)}
                    onregister={(api) => setCellRef(rowIdx, colIdx, api as any)}
                    onfocus={(payload) => oncellfocus?.(payload)}
                    oninput={(content, caret) => oncellinput?.({ row: rowIdx, col: colIdx, content, caret })}
                    onformat={(mark) => oncellformat?.({ row: rowIdx, col: colIdx, mark })}
                    ontab={(shift) => oncelltab?.({ row: rowIdx, col: colIdx, shift })}
                    onarrowup={() => oncellnavigate?.({ row: rowIdx, col: colIdx, direction: 'up' })}
                    onarrowdown={() => oncellnavigate?.({ row: rowIdx, col: colIdx, direction: 'down' })}
                    onarrowleft={() => oncellnavigate?.({ row: rowIdx, col: colIdx, direction: 'left' })}
                    onarrowright={() => oncellnavigate?.({ row: rowIdx, col: colIdx, direction: 'right' })}
                    oncellclick={(payload) => onCellClick(payload)}
                  />
                {/if}
              {/each}
              <td class="etable-row-action w-6 border-0 align-middle">
                {#if !readonly}
                  <button
                    type="button"
                    class="etable-icon-btn etable-icon-btn--danger hidden h-5 w-5 items-center justify-center rounded group-hover/row:flex"
                    title="Remove row"
                    onclick={() => handleRemoveRow(rowIdx)}
                  >
                    <Trash2 class="h-3 w-3" />
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if !readonly}
        <button type="button" class="etable-add-row" title="Add row" onclick={handleAddRow}>
          <Plus class="h-3.5 w-3.5" />
        </button>
      {/if}
    </div>
    {#if !readonly}
      <div class="ms-1 flex flex-col gap-1 self-stretch">
        <button type="button" class="etable-icon-btn" title="Add column" onclick={handleAddColumn}>
          <Columns2 class="h-3.5 w-3.5" />
        </button>
        {#if table().rows[0]?.length}
          <button type="button" class="etable-icon-btn etable-icon-btn--danger" title="Remove last column" onclick={handleRemoveLastColumn}>
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        {/if}
        <button type="button" class="etable-icon-btn" title="Open table data manager" aria-label="Open table data manager" onclick={openDataManager}>
          <Expand class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    {/if}
  </div>

  {#if manageOpen}
    <div class="etable-manage-root" role="dialog" aria-modal="true" aria-label="Edit table">
      <button type="button" class="etable-manage-backdrop" aria-label="Close" onclick={closeDataManager}></button>
      <div class="etable-manage-panel">
        <div class="etable-manage-bar">
          <button type="button" class="etable-manage-tool" title="Add row" onclick={handleAddRow}>
            <Plus class="h-3.5 w-3.5" /> Row
          </button>
          <button type="button" class="etable-manage-tool" title="Add column" onclick={handleAddColumn}>
            <Columns2 class="h-3.5 w-3.5" /> Col
          </button>
          <button type="button" class="etable-manage-tool" title="Toggle header row" onclick={toggleHeader}>
            {table().hasHeader ? 'Header' : 'No header'}
          </button>
          <span class="etable-manage-spacer"></span>
          <button type="button" class="etable-manage-tool etable-manage-tool--icon" aria-label="Close" title="Close" onclick={closeDataManager}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div class="etable-manage-body">
          <table class="etable-manage-grid">
            <colgroup>
              {#each (table().rows[0] ?? []) as _, colIdx (`mgr-col-${colIdx}`)}
                <col style={manageColStyle(colIdx)} />
              {/each}
              <col class="etable-manage-col-edge" />
            </colgroup>
            <tbody>
              {#each table().rows as row, rowIdx (`mgr-r-${rowIdx}`)}
                <tr>
                  {#each row as cell, colIdx (`mgr-c-${rowIdx}-${colIdx}`)}
                    {#if !cell.hidden}
                      <td
                        class="etable-manage-td"
                        class:etable-manage-td--selected={isManageSelected(rowIdx, colIdx)}
                        class:etable-manage-td--header={rowIdx === 0 && table().hasHeader}
                        style={manageColStyle(colIdx)}
                        onmousedown={(e) => onManageCellMouseDown(rowIdx, colIdx, e)}
                      >
                        <input
                          class="etable-manage-input"
                          class:etable-manage-input--header={rowIdx === 0 && table().hasHeader}
                          type="text"
                          value={cellPlainText(rowIdx, colIdx)}
                          aria-label={`R${rowIdx + 1}C${colIdx + 1}`}
                          onfocus={() => onManageCellFocus(rowIdx, colIdx)}
                          onchange={(e) => setCellPlainText(rowIdx, colIdx, (e.currentTarget as HTMLInputElement).value)}
                        />
                        {#if rowIdx === 0}
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <span
                            class="etable-manage-resize"
                            title="Drag to resize column"
                            onmousedown={(e) => startManageColResize(colIdx, e)}
                          ></span>
                        {/if}
                      </td>
                    {/if}
                  {/each}
                  <td class="etable-manage-edge etable-manage-edge--row">
                    <button
                      type="button"
                      class="etable-manage-edge-btn"
                      title="Remove row"
                      disabled={table().rows.length <= 1}
                      onclick={() => handleRemoveRow(rowIdx)}
                    >
                      <Trash2 class="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              {/each}
              <tr>
                {#each (table().rows[0] ?? []) as _, colIdx (`mgr-col-del-${colIdx}`)}
                  <td class="etable-manage-edge etable-manage-edge--col" style={manageColStyle(colIdx)}>
                    <button
                      type="button"
                      class="etable-manage-edge-btn"
                      title="Remove column"
                      disabled={(table().rows[0]?.length ?? 0) <= 1}
                      onclick={() => handleRemoveLastColumnCol(colIdx)}
                    >
                      <Trash2 class="h-3 w-3" />
                    </button>
                  </td>
                {/each}
                <td class="etable-manage-edge etable-manage-edge--row etable-manage-edge--corner"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
.etable-frame {
  border: 1px solid var(--xpe-border, #e9e9e7);
  background: var(--xpe-background, #fff);
  color: var(--xpe-foreground, #37352f);
}
.etable {
  background: transparent;
  table-layout: fixed;
}
.etable-row-action {
  background: transparent;
}
.etable-add-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
  border: none;
  border-top: 1px solid var(--xpe-border, #e9e9e7);
  background: var(--xpe-muted, #f7f6f3);
  color: var(--xpe-muted-foreground, #9b9a97);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.etable-add-row:hover {
  background: var(--xpe-hover, #f1f1ef);
  color: var(--xpe-primary, #2383e2);
}
.etable-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--xpe-muted-foreground, #9b9a97);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.etable-icon-btn:hover {
  background: var(--xpe-hover, #f1f1ef);
  color: var(--xpe-primary, #2383e2);
}
.etable-icon-btn--danger:hover {
  background: color-mix(in srgb, #ef4444 14%, transparent);
  color: #ef4444;
}
.etable-manage-root {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.etable-manage-backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: rgb(15 15 15 / 0.28);
  cursor: default;
}
.etable-manage-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(80vw, 1000px);
  max-width: 1000px;
  height: auto;
  max-height: 80vh;
  min-height: 0;
  border-radius: 10px;
  background: var(--xpe-background, #fff);
  border: 1px solid var(--xpe-border, #e9e9e7);
  box-shadow: 0 12px 32px rgb(15 15 15 / 0.12);
  overflow: hidden;
}
.etable-manage-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--xpe-border, #e9e9e7);
  background: var(--xpe-muted, #f7f6f3);
}
.etable-manage-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--xpe-muted-foreground, #9b9a97);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.etable-manage-tool:hover {
  background: var(--xpe-hover, #f1f1ef);
  color: var(--xpe-foreground, #37352f);
}
.etable-manage-tool--icon {
  padding: 4px;
}
.etable-manage-spacer {
  flex: 1;
}
.etable-manage-body {
  flex: 0 1 auto;
  min-height: 0;
  max-height: calc(80vh - 42px);
  overflow-x: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0 4px 8px 0;
  scrollbar-gutter: stable;
}
.etable-manage-grid {
  width: max(100%, max-content);
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.etable-manage-col-edge {
  width: 40px;
  min-width: 40px;
}
.etable-manage-td {
  position: relative;
  border: 1px solid var(--xpe-border, #e9e9e7);
  padding: 0;
  vertical-align: middle;
  background: var(--xpe-background, #fff);
  min-width: 100px;
  box-sizing: border-box;
}
.etable-manage-td--header {
  min-height: 36px;
}
.etable-manage-resize {
  position: absolute;
  top: 0;
  right: -3px;
  z-index: 2;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
}
.etable-manage-resize:hover,
.etable-manage-resize:active {
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 45%, transparent);
}
.etable-manage-td--selected {
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--xpe-primary, #2383e2) 45%, transparent);
}
.etable-manage-td--selected .etable-manage-input {
  background: transparent;
}
.etable-manage-input {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--xpe-foreground, #37352f);
  font: inherit;
  font-size: 13px;
  line-height: 1.3;
}
.etable-manage-input:focus {
  outline: none;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--xpe-primary, #2383e2) 55%, transparent);
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 6%, transparent);
}
.etable-manage-input--header {
  font-weight: 600;
  background: var(--xpe-muted, #f7f6f3);
}
.etable-manage-td--selected .etable-manage-input--header {
  background: transparent;
}
.etable-manage-edge {
  border: none !important;
  background: transparent !important;
  text-align: center;
  vertical-align: middle;
}
.etable-manage-edge--row {
  position: sticky;
  right: 0;
  z-index: 3;
  width: 40px;
  min-width: 40px;
  max-width: 40px;
  padding: 0 8px 0 10px !important;
  background: var(--xpe-background, #fff) !important;
  box-shadow: -6px 0 10px rgb(15 15 15 / 0.06);
}
.etable-manage-edge--col {
  height: 32px;
  padding: 4px 0 0 !important;
}
.etable-manage-edge--corner {
  box-shadow: none;
  background: transparent !important;
}
.etable-manage-edge-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--xpe-muted-foreground, #9b9a97);
  cursor: pointer;
  opacity: 0.55;
}
.etable-manage-edge-btn:hover:not(:disabled) {
  opacity: 1;
  background: color-mix(in srgb, #ef4444 12%, transparent);
  color: #ef4444;
}
.etable-manage-edge-btn:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}
.etable-width-group {
  border: 1px solid var(--xpe-border, #e9e9e7);
  background: var(--xpe-muted, #f7f6f3);
}
.etable-width-group--disabled {
  opacity: 0.55;
}
.etable-width-label {
  padding: 0 4px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--xpe-muted-foreground, #9b9a97);
  user-select: none;
}
.etable-width-input {
  border: 1px solid var(--xpe-border, #e9e9e7);
  background: var(--xpe-background, #fff);
  color: var(--xpe-foreground, #37352f);
}
.etable-width-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.etable-col-action {
  width: 24px;
  min-width: 24px;
}
.etable-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--xpe-muted-foreground, #9b9a97);
  background: var(--xpe-muted, #f7f6f3);
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.etable-btn:hover:not(:disabled) {
  color: var(--xpe-primary, #2383e2);
  border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 35%, transparent);
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 10%, transparent);
}
.etable-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.etable-btn-active {
  color: var(--xpe-primary, #2383e2);
  border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 45%, transparent);
  background: color-mix(in srgb, var(--xpe-primary, #2383e2) 14%, transparent);
}
.group\/table :global(input[type='number']) {
  background: var(--xpe-background, #fff);
  border-color: var(--xpe-border, #e9e9e7);
  color: var(--xpe-foreground, #37352f);
}
</style>
