<script lang="ts">
  import { getContext, onMount } from 'svelte'
  import {
    getSelectionOffsets,
    setSelectionOffsets,
    isCaretOnFirstLine,
    isCaretOnLastLine,
    tryMoveCaretAcrossInlineBoundary,
    tryExitStickyInline,
    stickyInlineAtCaret,
    hasRealTextAfterNode,
    hasRealTextBeforeNode,
    focusStart,
    focusEnd,
    spansToHtml,
    elementToSpans,
    getClipboardImageFiles,
    resolveBlockDirection,
  } from '@xproeditor/core'
  import type { Block, InlineSpan, MarkName } from '@xproeditor/core'
  import { isModLetter } from '../utils/keyboard'
  import { BLOCK_EDITOR_CTX, type BlockEditorContext } from './block-editor-context'

  let {
    block,
    placeholder = '',
    readonly = false,
    pages,
    editorDir,
    class: className = '',
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
    onselectionpointerdown,
  }: {
    block: Block
    placeholder?: string
    readonly?: boolean
    pages?: Array<{ id: string; title: string; icon?: string }>
    editorDir?: 'ltr' | 'rtl'
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
    onselectionpointerdown?: (payload: {
      shiftKey: boolean
      clientX: number
      clientY: number
      pointerType?: string
    }) => void
  } = $props()

  let el = $state<HTMLElement | null>(null)
  let lastSyncedJson = ''
  let lastPagesJson = ''

  const editorCtx = getContext<BlockEditorContext | null>(BLOCK_EDITOR_CTX) ?? null

  let typeClass = $derived(`etb-${block.type}`)
  let textDir = $derived.by(() => {
    void editorCtx?.getContentRevision?.()
    return editorCtx?.directionFor?.(block.id) ?? resolveBlockDirection(block, editorDir ?? 'ltr')
  })

  let typeStyle = $derived.by(() => {
    const type = block.type
    const align = block.props.align
      ? { textAlign: block.props.align as 'left' | 'center' | 'right' }
      : ({} as Record<string, string>)

    if (type === 'heading_1') {
      return {
        ...align,
        fontSize: '30px',
        fontWeight: '700',
        lineHeight: '1.25',
        letterSpacing: '-0.02em',
      }
    }
    if (type === 'heading_2') {
      return {
        ...align,
        fontSize: '24px',
        fontWeight: '700',
        lineHeight: '1.3',
        letterSpacing: '-0.015em',
      }
    }
    if (type === 'heading_3') {
      return { ...align, fontSize: '20px', fontWeight: '600', lineHeight: '1.35' }
    }
    if (type === 'heading_4') {
      return { ...align, fontSize: '18px', fontWeight: '600', lineHeight: '1.4' }
    }
    if (type === 'heading_5') {
      return { ...align, fontSize: '16px', fontWeight: '600', lineHeight: '1.45' }
    }
    if (type === 'heading_6') {
      return {
        ...align,
        fontSize: '14px',
        fontWeight: '600',
        lineHeight: '1.5',
        color: 'var(--xpe-muted-foreground, #9b9a97)',
      }
    }
    return align
  })

  function styleObjToString(style: Record<string, string>): string {
    return Object.entries(style)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v}`)
      .join('; ')
  }

  function pageLinkLabel(pageId: string) {
    const page = pages?.find((entry) => entry.id === pageId)
    const icon = page?.icon || '📄'
    const title = page?.title?.trim() || 'Untitled'
    return `${icon} ${title}`
  }

  let isVimNormal = $derived.by(() => {
    void editorCtx?.getVimEditRevision?.()
    return !!(
      editorCtx?.isVimEnabled?.() &&
      editorCtx.vimAllowsTextInput &&
      !editorCtx.vimAllowsTextInput()
    )
  })

  export function syncFromModel(restore?: { start: number; end: number } | null) {
    if (!el) return

    const contentJson = JSON.stringify(block.content)
    const pagesJson = JSON.stringify(pages ?? [])
    const html = spansToHtml(block.content, {
      resolvePageLink: pageLinkLabel,
    })

    const focused = document.activeElement === el
    const prevLen = el.textContent?.length ?? 0
    const nextLen = block.content.map((s) => s.text).join('').length

    let offsets = restore ?? null
    if (!offsets && focused && prevLen === nextLen) {
      offsets = getSelectionOffsets(el)
    }

    if (contentJson !== lastSyncedJson || pagesJson !== lastPagesJson || el.innerHTML !== html) {
      el.innerHTML = html
    }

    lastSyncedJson = contentJson
    lastPagesJson = pagesJson

    if (offsets && el) {
      setSelectionOffsets(el, offsets.start, offsets.end)
    }
  }

  function render() {
    syncFromModel(null)
  }

  onMount(render)

  $effect(() => {
    void editorCtx?.getContentRevision?.()
    void block.id
    const contentJson = JSON.stringify(block.content)
    const pagesJson = JSON.stringify(pages ?? [])
    if (contentJson === lastSyncedJson && pagesJson === lastPagesJson) return
    syncFromModel(null)
  })

  function readSpans(): InlineSpan[] {
    if (!el) return []
    let spans = elementToSpans(el)
    if (spans.length === 1 && spans[0].text === '\n' && !spans[0].marks) {
      spans = []
    }
    return spans
  }

  function onPointerDown(e: PointerEvent) {
    if (readonly || !el || e.button !== 0) return
    onselectionpointerdown?.({
      shiftKey: e.shiftKey,
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
    })
    // Shift+click/drag is owned by BlockEditor so multi-block ranges work;
    // without this, the browser only selects inside this contenteditable.
    if (e.shiftKey) {
      e.preventDefault()
    }
  }

  function handleInput() {
    if (readonly || !el) return
    const spans = readSpans()
    lastSyncedJson = JSON.stringify(spans)
    const caret = getSelectionOffsets(el)?.start ?? null
    oninput?.(spans, caret)
  }

  function onKeydown(e: KeyboardEvent) {
    if (readonly || !el || e.isComposing) return
    if (isVimNormal) return

    // Use physical keys (event.code) so shortcuts work on Farsi and other layouts.
    if (isModLetter(e, 'b', { shift: false })) {
      e.preventDefault()
      onformat?.('bold', getSelectionOffsets(el) ?? undefined)
      return
    }
    if (isModLetter(e, 'i', { shift: false })) {
      e.preventDefault()
      onformat?.('italic', getSelectionOffsets(el) ?? undefined)
      return
    }
    if (isModLetter(e, 'u', { shift: false })) {
      e.preventDefault()
      onformat?.('underline', getSelectionOffsets(el) ?? undefined)
      return
    }
    if (isModLetter(e, 'e', { shift: false }) || isModLetter(e, 'm', { shift: false })) {
      e.preventDefault()
      onformat?.('code', getSelectionOffsets(el) ?? undefined)
      return
    }
    if (isModLetter(e, 's', { shift: true })) {
      e.preventDefault()
      onformat?.('strikethrough', getSelectionOffsets(el) ?? undefined)
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const offsets = getSelectionOffsets(el) ?? { start: 0, end: 0 }
      onenter?.(offsets)
      return
    }

    if (e.key === 'Backspace') {
      const offsets = getSelectionOffsets(el)
      if (offsets && offsets.start === 0 && offsets.end === 0) {
        e.preventDefault()
        onbackspacestart?.()
      }
      return
    }

    if (e.key === 'Delete') {
      const offsets = getSelectionOffsets(el)
      const len = el.textContent?.length ?? 0
      if (offsets && offsets.start === offsets.end && offsets.start >= len) {
        e.preventDefault()
        ondeleteend?.()
      }
      return
    }

    // ArrowUp/Down: leave inline ``code`` / links first, then maybe change block.
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
          // Nothing after the mark → exit and go to the next block in one press.
          // (isCaretOnLastLine is unreliable after parking on a ZWSP host.)
          const nothingAfter = !hasRealTextAfterNode(el, sticky)
          tryExitStickyInline(el, 'after')
          if (nothingAfter || isCaretOnLastLine(el)) {
            onarrowdown?.()
          }
        } else {
          const nothingBefore = !hasRealTextBeforeNode(el, sticky)
          tryExitStickyInline(el, 'before')
          if (nothingBefore || isCaretOnFirstLine(el)) {
            onarrowup?.()
          }
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

    // Leave inline code / links when the caret is at the mark edge.
    // `` `something`| `` + Right → after the mark
    // `` |`something` `` + Left  → before the mark
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

    if (e.key === 'Tab') {
      e.preventDefault()
      ontab?.(e.shiftKey)
    }
  }

  function onPaste(e: ClipboardEvent) {
    if (readonly || !el || !e.clipboardData) return
    e.preventDefault()
    e.stopPropagation()
    const offsets = getSelectionOffsets(el) ?? { start: 0, end: 0 }
    const files = getClipboardImageFiles(e.clipboardData)
    onpasted?.({
      html: e.clipboardData.getData('text/html'),
      text: e.clipboardData.getData('text/plain'),
      files,
      offsets,
    })
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
<div
  bind:this={el}
  contenteditable={!readonly}
  class="etb outline-none w-full {typeClass} {className}"
  class:etb-readonly={readonly}
  class:etb-vim-normal={isVimNormal}
  data-block-type={block.type}
  dir={textDir}
  style={styleObjToString(typeStyle as Record<string, string>)}
  data-placeholder={placeholder}
  spellcheck="false"
  oninput={handleInput}
  onpointerdown={onPointerDown}
  onkeydown={onKeydown}
  onkeydowncapture={(e) => {
    // Run before browser caret moves so we can exit <code> at the edges.
    if (readonly || !el || e.isComposing || isVimNormal) return
    if (e.altKey || e.metaKey || e.ctrlKey) return
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const sticky = stickyInlineAtCaret(el)
      if (sticky) {
        e.preventDefault()
        e.stopPropagation()
        const nothingAfter = !hasRealTextAfterNode(el, sticky)
        tryExitStickyInline(el, 'after')
        if (nothingAfter || isCaretOnLastLine(el)) onarrowdown?.()
        return
      }
    }
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const sticky = stickyInlineAtCaret(el)
      if (sticky) {
        e.preventDefault()
        e.stopPropagation()
        const nothingBefore = !hasRealTextBeforeNode(el, sticky)
        tryExitStickyInline(el, 'before')
        if (nothingBefore || isCaretOnFirstLine(el)) onarrowup?.()
        return
      }
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    if (
      tryMoveCaretAcrossInlineBoundary(el, e.key === 'ArrowRight' ? 'right' : 'left', {
        extend: e.shiftKey,
      })
    ) {
      e.preventDefault()
      e.stopPropagation()
    }
  }}
  onpaste={onPaste}
  onfocus={() => onfocus?.()}
></div>

<style>
  .etb {
    min-height: 1.6em;
    line-height: 1.65;
    font-size: 16px;
    font-weight: 400;
    color: var(--xpe-foreground, #37352f);
    white-space: pre-wrap;
    word-break: break-word;
    text-align: start;
    caret-color: var(--xpe-primary, #2383e2);
    touch-action: manipulation;
    -webkit-user-select: text;
    user-select: text;
    --pro-editor-selection: var(--xpe-selection, rgb(35 131 226 / 0.18));
  }
  .etb::selection {
    background: var(--pro-editor-selection);
  }
  .etb-readonly {
    cursor: default;
    user-select: text;
  }
  .etb:empty::before {
    content: attr(data-placeholder);
    color: var(--xpe-muted-foreground, #9b9a97);
    pointer-events: none;
    float: inline-start;
  }

  .etb[data-block-type='heading_1'],
  .etb.etb-heading_1 {
    font-size: 30px !important;
    font-weight: 700 !important;
    line-height: 1.25 !important;
    letter-spacing: -0.02em;
    margin-top: 0.4em;
    margin-bottom: 0.15em;
    color: var(--xpe-foreground, #37352f);
  }
  .etb[data-block-type='heading_2'],
  .etb.etb-heading_2 {
    font-size: 24px !important;
    font-weight: 700 !important;
    line-height: 1.3 !important;
    letter-spacing: -0.015em;
    margin-top: 0.35em;
    margin-bottom: 0.1em;
    color: var(--xpe-foreground, #37352f);
  }
  .etb[data-block-type='heading_3'],
  .etb.etb-heading_3 {
    font-size: 20px !important;
    font-weight: 600 !important;
    line-height: 1.35 !important;
    margin-top: 0.3em;
    margin-bottom: 0.08em;
    color: var(--xpe-foreground, #37352f);
  }
  .etb[data-block-type='heading_4'],
  .etb.etb-heading_4 {
    font-size: 18px !important;
    font-weight: 600 !important;
    line-height: 1.4 !important;
    margin-top: 0.28em;
    margin-bottom: 0.06em;
    color: var(--xpe-foreground, #37352f);
  }
  .etb[data-block-type='heading_5'],
  .etb.etb-heading_5 {
    font-size: 16px !important;
    font-weight: 600 !important;
    line-height: 1.45 !important;
    margin-top: 0.25em;
    margin-bottom: 0.05em;
    color: var(--xpe-foreground, #37352f);
  }
  .etb[data-block-type='heading_6'],
  .etb.etb-heading_6 {
    font-size: 14px !important;
    font-weight: 600 !important;
    line-height: 1.5 !important;
    margin-top: 0.22em;
    margin-bottom: 0.04em;
    color: var(--xpe-muted-foreground, #9b9a97);
  }
  .etb[data-block-type='quote'],
  .etb.etb-quote {
    font-style: italic;
    color: var(--xpe-muted-foreground, #9b9a97);
  }
  .etb[data-block-type='callout'],
  .etb.etb-callout {
    font-size: 15px;
  }

  .etb :global(code) {
    background: var(--xpe-muted, #f7f6f3);
    border: 1px solid var(--xpe-border, #e9e9e7);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--xpe-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 0.85em;
    color: var(--xpe-code-foreground, #e0316e);
  }
  .etb :global(a) {
    color: var(--xpe-primary, #2383e2);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .etb :global(a.page-inline-link) {
    text-decoration: none;
    border-radius: 4px;
    background: var(--xpe-hover, #f1f1ef);
    padding: 1px 6px;
    font-weight: 500;
  }
  .etb :global(a.page-inline-link:hover) {
    background: var(--xpe-active, #e9f3fd);
  }
  .etb :global(a.external-inline-link) {
    cursor: pointer;
  }

  .etb-vim-normal {
    cursor: default;
    caret-color: var(--xpe-primary, #2383e2);
  }

  .etb :global(span[data-highlight]),
  .etb :global(span[style*='background-color']) {
    border-radius: 2px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
</style>
