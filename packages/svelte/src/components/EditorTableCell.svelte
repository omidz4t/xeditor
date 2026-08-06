<script lang="ts">
  import { onMount } from 'svelte'
  import {
    focusEnd,
    focusStart,
    getSelectionOffsets,
    isCaretOnFirstLine,
    isCaretOnLastLine,
    tryMoveCaretAcrossInlineBoundary,
    tryExitStickyInline,
    stickyInlineAtCaret,
    hasRealTextAfterNode,
    hasRealTextBeforeNode,
    setSelectionOffsets,
    elementToSpans,
    spansToHtml,
    normalizeSpans,
  } from '@xproeditor/core'
  import type { InlineSpan, MarkName, TableCell, TableCellAlign } from '@xproeditor/core'
  import { isModLetter } from '../utils/keyboard'

  let {
    cell,
    rowIdx,
    colIdx,
    isHeader = false,
    selected = false,
    readonly = false,
    cellStyle,
    oninput,
    onfocus,
    onformat,
    ontab,
    onarrowup,
    onarrowdown,
    onarrowleft,
    onarrowright,
    oncellclick,
    onregister,
  }: {
    cell: TableCell
    rowIdx: number
    colIdx: number
    isHeader?: boolean
    selected?: boolean
    readonly?: boolean
    cellStyle?: string | Record<string, string>
    oninput?: (spans: InlineSpan[], caret: number | null) => void
    onfocus?: (payload: { row: number; col: number; shiftKey: boolean }) => void
    onformat?: (mark: MarkName) => void
    ontab?: (shift: boolean) => void
    onarrowup?: () => void
    onarrowdown?: () => void
    onarrowleft?: () => void
    onarrowright?: () => void
    oncellclick?: (payload: { row: number; col: number; shiftKey: boolean }) => void
    /** Parent registers cell API (Svelte has no Vue function-ref). */
    onregister?: (api: {
      focusAt: (pos: number | 'start' | 'end') => void
      getSelection: () => { start: number; end: number } | null
      setSelection: (start: number, end?: number) => void
      getEl: () => HTMLElement | null
    } | null) => void
  } = $props()

  let el = $state<HTMLElement | null>(null)
  let lastJson = ''

  function styleToString(style?: string | Record<string, string>): string | undefined {
    if (!style) return undefined
    if (typeof style === 'string') return style
    return Object.entries(style)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v}`)
      .join('; ')
  }

  function render() {
    if (!el) return
    const html = spansToHtml(normalizeSpans(cell.content))
    if (el.innerHTML !== html) {
      el.innerHTML = html || ''
    }
    lastJson = JSON.stringify(cell.content)
  }

  onMount(() => {
    render()
    const api = {
      focusAt,
      getSelection,
      setSelection,
      getEl,
    }
    onregister?.(api)
    return () => onregister?.(null)
  })

  $effect(() => {
    const content = cell.content
    const json = JSON.stringify(content)
    if (json === lastJson) return
    const focused = el && document.activeElement === el
    const offsets = focused && el ? getSelectionOffsets(el) : null
    render()
    if (focused && offsets && el) {
      setSelectionOffsets(el, offsets.start, offsets.end)
    }
  })

  function readSpans(): InlineSpan[] {
    if (!el) return []
    let spans = elementToSpans(el)
    if (spans.length === 1 && spans[0].text === '\n' && !spans[0].marks) {
      spans = []
    }
    return spans
  }

  function handleInput() {
    if (readonly || !el) return
    const spans = readSpans()
    lastJson = JSON.stringify(spans)
    const caret = getSelectionOffsets(el)?.start ?? null
    oninput?.(spans, caret)
  }

  function onPointerDown(e: PointerEvent) {
    if (readonly || e.button !== 0) return
    oncellclick?.({ row: rowIdx, col: colIdx, shiftKey: e.shiftKey })
  }

  function handleFocus(e: FocusEvent) {
    onfocus?.({
      row: rowIdx,
      col: colIdx,
      shiftKey: (e as FocusEvent & { shiftKey?: boolean }).shiftKey ?? false,
    })
  }

  function onKeydown(e: KeyboardEvent) {
    if (readonly || !el || e.isComposing) return
    // Physical keys so formatting shortcuts work on Farsi (and other) layouts.
    if (isModLetter(e, 'b', { shift: false })) {
      e.preventDefault()
      onformat?.('bold')
      return
    }
    if (isModLetter(e, 'i', { shift: false })) {
      e.preventDefault()
      onformat?.('italic')
      return
    }
    if (isModLetter(e, 'u', { shift: false })) {
      e.preventDefault()
      onformat?.('underline')
      return
    }
    if (isModLetter(e, 'e', { shift: false }) || isModLetter(e, 'm', { shift: false })) {
      e.preventDefault()
      onformat?.('code')
      return
    }
    if (isModLetter(e, 's', { shift: true })) {
      e.preventDefault()
      onformat?.('strikethrough')
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      ontab?.(e.shiftKey)
      return
    }

    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      && !e.shiftKey
      && !e.altKey
      && !e.metaKey
      && !e.ctrlKey
    ) {
      const sticky = stickyInlineAtCaret(el)
      if (sticky) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'ArrowDown') {
          const nothingAfter = !hasRealTextAfterNode(el, sticky)
          tryExitStickyInline(el, 'after')
          if (nothingAfter || isCaretOnLastLine(el)) onarrowdown?.()
        } else {
          const nothingBefore = !hasRealTextBeforeNode(el, sticky)
          tryExitStickyInline(el, 'before')
          if (nothingBefore || isCaretOnFirstLine(el)) onarrowup?.()
        }
        return
      }
      if (e.key === 'ArrowUp' && isCaretOnFirstLine(el)) {
        e.preventDefault()
        onarrowup?.()
        return
      }
      if (e.key === 'ArrowDown' && isCaretOnLastLine(el)) {
        e.preventDefault()
        onarrowdown?.()
        return
      }
    }

    const offsets = getSelectionOffsets(el)
    const len = el.textContent?.length ?? 0

    if (
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
      && !e.altKey
      && !e.metaKey
      && !e.ctrlKey
    ) {
      if (
        tryMoveCaretAcrossInlineBoundary(el, e.key === 'ArrowRight' ? 'right' : 'left', {
          extend: e.shiftKey,
        })
      ) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
    }

    if (e.key === 'ArrowLeft' && !e.shiftKey && offsets && offsets.start === 0 && offsets.end === 0) {
      e.preventDefault()
      onarrowleft?.()
      return
    }

    if (e.key === 'ArrowRight' && !e.shiftKey && offsets && offsets.start === len && offsets.end === len) {
      e.preventDefault()
      onarrowright?.()
    }
  }

  export function focusAt(pos: number | 'start' | 'end') {
    if (!el) return
    if (pos === 'start') focusStart(el)
    else if (pos === 'end') focusEnd(el)
    else {
      el.focus()
      setSelectionOffsets(el, pos)
    }
  }

  export function getSelection(): { start: number; end: number } | null {
    return el ? getSelectionOffsets(el) : null
  }

  export function setSelection(start: number, end = start) {
    if (!el) return
    el.focus()
    setSelectionOffsets(el, start, end)
  }

  export function getEl() {
    return el
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:element
  this={isHeader ? 'th' : 'td'}
  class="etc-cell p-0 relative min-w-[100px] align-top"
  class:etc-cell--header={isHeader}
  class:etc-cell--body={!isHeader}
  class:etc-cell--selected={selected}
  style={styleToString(cellStyle)}
  colspan={cell.colspan && cell.colspan > 1 ? cell.colspan : undefined}
  rowspan={cell.rowspan && cell.rowspan > 1 ? cell.rowspan : undefined}
  onclick={(e) => e.stopPropagation()}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={el}
    contenteditable={!readonly}
    class="etc-editor outline-none w-full px-3 py-2 text-sm min-h-[2.25rem]"
    class:etc-editor--header={isHeader}
    style={cell.align ? `text-align: ${cell.align as TableCellAlign}` : undefined}
    dir="auto"
    spellcheck="false"
    oninput={handleInput}
    onpointerdown={onPointerDown}
    onfocus={handleFocus}
    onkeydown={onKeydown}
  ></div>
</svelte:element>

<style>
  .etc-cell {
    border: 1px solid var(--xpe-border, #e9e9e7);
    background: var(--xpe-background, #fff);
    color: var(--xpe-foreground, #37352f);
  }

  .etc-cell--header {
    background: var(--xpe-muted, #f7f6f3);
  }

  .etc-cell--selected {
    box-shadow: inset 0 0 0 2px var(--xpe-primary, #2383e2);
  }

  .etc-editor {
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--xpe-foreground, #37352f);
    caret-color: var(--xpe-primary, #2383e2);
  }

  .etc-editor--header {
    font-weight: 600;
  }

  .etc-editor:empty::before {
    content: ' ';
    pointer-events: none;
  }
  .etc-editor :global(code) {
    background: var(--xpe-muted, #f7f6f3);
    border: 1px solid var(--xpe-border, #e9e9e7);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--xpe-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 0.85em;
    color: var(--xpe-code-foreground, #e0316e);
  }
  .etc-editor :global(a) {
    color: var(--xpe-primary, #2383e2);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
