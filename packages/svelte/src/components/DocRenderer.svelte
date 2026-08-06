<script lang="ts">
import { setContext } from 'svelte'

import hljs from '../highlight/hljs-lite'
import X from '@lucide/svelte/icons/x'
import {
  buildBlockDirectionMap,
  buildBlockRenderTree,
  computeListNumbering,
  escapeHtml,
  headingAnchorIds,
  normalizeTableData,
  resolveBlockDirection,
  spansToHtml,
  tableCellStyle,
} from '@xproeditor/core'
import type { Block, TableCell } from '@xproeditor/core'
import DocBlockTree from './DocBlockTree.svelte'
import { DOC_RENDERER_CTX } from './doc-renderer-context'

// Avoid naming the binding `props` — it collides with the `$props` rune (store syntax).
let {
  blocks = [] as Block[],
  editorDir = 'ltr' as 'ltr' | 'rtl',
  ..._rest
} = $props() as {
  blocks?: Block[]
  editorDir?: 'ltr' | 'rtl'
  [key: string]: unknown
}

let directionMap = $derived(buildBlockDirectionMap(blocks, editorDir ?? 'ltr'))

function blockDirection(block: Block): 'ltr' | 'rtl' {
  return directionMap.get(block.id) ?? resolveBlockDirection(block, editorDir ?? 'ltr')
}

function tableForBlock(block: Block) {
  return normalizeTableData(block.props.table)
}

function styleToString(style: Record<string, string> | string | null | undefined): string {
  if (!style) return ''
  if (typeof style === 'string') return style
  return Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v}`)
    .join('; ')
}

function renderCellStyle(cell: TableCell, rowIdx: number, hasHeader: boolean, block: Block): string {
  const table = tableForBlock(block)
  return styleToString(tableCellStyle(cell, rowIdx, hasHeader, table.style))
}

// Toggle collapse state (block-id keyed)
let toggleOverrides = $state<Record<string, boolean>>({})

function isCollapsed(block: Block): boolean {
  return toggleOverrides[block.id] ?? (block.props.collapsed ?? false)
}

function setCollapsed(block: Block, collapsed: boolean): void {
  toggleOverrides[block.id] = collapsed
}

interface VisibleEntry {
  block: Block
  idx: number
}

let blocksForTree = $derived.by((): Block[] => {
  const out: Block[] = []
  let hideDeeperThan: number | null = null

  for (const block of blocks) {
    const ind = block.props.indent ?? 0

    if (hideDeeperThan !== null) {
      if (ind > hideDeeperThan) {
        continue
      }

      hideDeeperThan = null
    }

    out.push(block)

    if (block.type === 'toggle' && isCollapsed(block)) {
      hideDeeperThan = ind
    }
  }

  return out
})

let visible = $derived.by((): VisibleEntry[] => {
  const out: VisibleEntry[] = []
  let hideDeeperThan: number | null = null
  blocks.forEach((block: Block, idx: number) => {
    if (block.type === 'column_list' || block.type === 'column') {
      return
    }

    const ind = block.props.indent ?? 0

    if (hideDeeperThan !== null) {
      if (ind > hideDeeperThan) {
return
}

      hideDeeperThan = null
    }

    out.push({ block, idx })

    if (block.type === 'toggle' && isCollapsed(block)) {
hideDeeperThan = ind
}
  })

  return out
})

let renderTree = $derived(buildBlockRenderTree(blocksForTree))

let numbering = $derived(computeListNumbering(visible.map(v => v.block)))
let anchors = $derived(headingAnchorIds(blocks))

function headingTag(type: string): string {
  switch (type) {
    case 'heading_1':
      return 'h2'
    case 'heading_2':
      return 'h3'
    case 'heading_3':
      return 'h4'
    case 'heading_4':
      return 'h5'
    case 'heading_5':
    case 'heading_6':
      return 'h6'
    default:
      return 'h4'
  }
}

function inlineHtml(block: Block): string {
  return spansToHtml(block.content)
}

function highlightCode(code: string, language?: string): string {
  try {
    if (language && language !== 'plaintext' && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value
    }
  } catch { /* fall through */ }

  return escapeHtml(code)
}

// Heading anchor copy
let copiedAnchor = $state<string | null>(null)

function copyAnchor(id: string) {
  const url = `${window.location.origin}${window.location.pathname}#${id}`
  navigator.clipboard?.writeText(url)
  copiedAnchor = id
  setTimeout(() => {
 copiedAnchor = null 
}, 1500)
}

// Image lightbox
let lightboxUrl = $state<string | null>(null)

setContext(DOC_RENDERER_CTX, {
  listNumber: (blockId: string) => numbering.get(blockId) ?? 1,
  anchorFor: (blockId: string) => anchors.get(blockId),
  isCopiedAnchor: (anchorId: string) => copiedAnchor === anchorId,
  openLightbox: (url: string) => { lightboxUrl = url },
  get editorDir() { return editorDir },
  isCollapsed,
  setCollapsed,
  blockDirection,
  inlineHtml,
  headingTag,
  highlightCode,
  tableForBlock,
  renderCellStyle,
  copyAnchor,
})

</script>

<div class="doc-blocks" dir="auto">
    <DocBlockTree entries={renderTree} />

    <!-- Lightbox -->
    
      {#if lightboxUrl}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          class="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          role="button"
          tabindex="0"
          aria-label="Close image preview"
          onclick={() => { lightboxUrl = null }}
          onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lightboxUrl = null } }}
        >
          <img src={lightboxUrl} class="max-w-full max-h-full rounded-lg shadow-2xl" alt="" />
          <button type="button" class="absolute top-4 right-4 text-white/80 hover:text-white" aria-label="Close" onclick={(e) => { e.stopPropagation(); lightboxUrl = null }}>
            <X class="w-6 h-6" />
          </button>
        </div>
      {/if}
    
  </div>

<style>

.doc-blocks {
  font-size: 1rem;
  line-height: 1.8;
  color: var(--xpe-foreground);
  word-break: break-word;
}

/* --- Headings --- */
.db-heading {
  position: relative;
  scroll-margin-top: 90px;
  letter-spacing: -0.015em;
  color: var(--xpe-foreground);
}
.db-heading_1 {
  font-size: 1.875em;
  font-weight: 800;
  line-height: 1.2;
  margin-top: 1.6em;
  margin-bottom: 0.55em;
}
.db-heading_2 {
  font-size: 1.4em;
  font-weight: 700;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--xpe-border);
}
.db-heading_3 {
  font-size: 1.15em;
  font-weight: 650;
  line-height: 1.4;
  margin-top: 1.3em;
  margin-bottom: 0.4em;
}
.db-heading_4 {
  font-size: 1.05em;
  font-weight: 650;
  line-height: 1.45;
  margin-top: 1.15em;
  margin-bottom: 0.35em;
}
.db-heading_5 {
  font-size: 1em;
  font-weight: 600;
  line-height: 1.5;
  margin-top: 1em;
  margin-bottom: 0.3em;
}
.db-heading_6 {
  font-size: 0.95em;
  font-weight: 600;
  line-height: 1.5;
  margin-top: 0.9em;
  margin-bottom: 0.25em;
  color: var(--xpe-muted-foreground);
}
.db-heading:first-child { margin-top: 0; }
.db-anchor-btn {
  display: inline-flex;
  vertical-align: middle;
  margin-inline-start: 8px;
  padding: 3px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--xpe-muted-foreground);
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.db-heading:hover .db-anchor-btn { opacity: 0.7; }
.db-anchor-btn:hover { opacity: 1 !important; background: var(--xpe-muted); }

/* --- Paragraph --- */
.db-p {
  margin: 0 0 0.9em;
}
.db-p:empty { min-height: 1.2em; }

/* --- List items --- */
.db-li {
  display: flex;
  align-items: flex-start;
  gap: 0.6em;
  margin-bottom: 0.35em;
}
.db-li-marker {
  flex-shrink: 0;
  min-width: 1.1em;
  text-align: center;
  line-height: 1.8;
  color: color-mix(in srgb, var(--xpe-foreground, #37352f) 88%, transparent);
}

:global(html[data-theme='dark']) .db-li-marker {
  color: color-mix(in srgb, var(--xpe-foreground, #e6e6e6) 92%, #fff 8%);
}
.db-li-content { flex: 1; min-width: 0; }

.db-todo-box {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 0.45em;
  border-radius: 4px;
  border: 1.5px solid var(--xpe-border, #d1d5db);
  background: var(--xpe-background, #fff);
  color: #fff;
}
.db-todo-checked {
  background: var(--xpe-primary, #2383e2);
  border-color: var(--xpe-primary, #2383e2);
  color: #fff;
}
.db-todo-box svg {
  display: block;
  width: 11px;
  height: 11px;
  color: #fff;
}

.db-toggle {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding-inline-start: 2px;
  border-radius: 6px;
  color: inherit;
  fill: inherit;
}

.db-toggle-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  min-height: 1.5em;
  height: 28px;
  padding-top: 2px;
  padding-bottom: 2px;
  flex-shrink: 0;
}

.db-toggle-btn {
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
  transition: background 0.12s;
}

.db-toggle-btn:hover {
  background: var(--xpe-hover, rgb(55 53 47 / 0.08));
}

/* Path points ▼ at 0°. Closed = sideways; open always faces down. */
.db-toggle-caret {
  width: 0.85em;
  height: 0.85em;
  opacity: 0.55;
  fill: currentColor;
  transition: transform 200ms ease-out;
  transform: rotate(-90deg); /* closed: ► */
}

.db-toggle-btn--open .db-toggle-caret {
  transform: rotate(0deg); /* open: ▼ */
}

.db-toggle-btn--rtl .db-toggle-caret {
  transform: rotate(90deg); /* closed: ◄ */
}

.db-toggle-btn--rtl.db-toggle-btn--open .db-toggle-caret {
  transform: rotate(0deg); /* open still ▼ */
}

.db-toggle-label {
  flex: 1 1 0;
  min-width: 1px;
  padding-top: 2px;
  padding-bottom: 2px;
  padding-inline-start: 6px;
  font-weight: 500;
}

/* --- Quote --- */
.db-quote {
  border-inline-start: 3px solid var(--xpe-primary);
  padding: 0.4em 1.1em;
  margin: 1em 0;
  color: var(--xpe-muted-foreground);
  font-style: italic;
  background: var(--xpe-muted);
  border-radius: 0.5rem;
}

/* --- Callout --- */
.db-callout {
  display: flex;
  align-items: flex-start;
  gap: 0.7em;
  padding: 0.85em 1.1em;
  margin: 1em 0;
  border-radius: 0.75rem;
  border: 1px solid var(--xpe-border);
  background: var(--xpe-muted);
}
:global(.dark) .db-callout { background: var(--xpe-muted) !important; }
.db-callout-icon { font-size: 1.15em; line-height: 1.5; }

/* --- Code --- */
.db-code {
  margin: 1.25em 0;
  border-radius: 0;
  overflow: hidden;
  border: 1px solid var(--xpe-border);
}
.db-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4em 1em;
  background: #16182a;
  color: #8b8fa3;
  font-size: 0.72em;
  font-family: var(--xpe-font-mono, ui-monospace, monospace);
  text-transform: lowercase;
}
.db-code pre {
  margin: 0;
  padding: 1.1em 1.25em;
  background: #1e1e2e;
  color: #cdd6f4;
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.7;
}
.db-code code {
  background: none;
  padding: 0;
  border: none;
  font-family: var(--xpe-font-mono, ui-monospace, monospace);
}

/* --- Divider --- */
.db-divider {
  border: none;
  border-top: 1px solid var(--xpe-border);
  margin: 1.8em 0;
}

.db-page-ref {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  margin: 0.2em 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--xpe-hover, #f1f1ef);
  color: var(--xpe-foreground);
  font-size: 14px;
  font-weight: 500;
}

.db-page-ref__icon {
  font-size: 14px;
  line-height: 1;
}

.db-page-ref__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.db-poll {
  margin: 1em 0;
  padding: 14px;
  border: 1px solid var(--xpe-border);
  border-radius: 12px;
  background: var(--xpe-background, #fff);
}

.db-poll__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--xpe-muted-foreground);
}

.db-poll__badge {
  margin-inline-start: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--xpe-muted);
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
}

.db-poll__question {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
}

.db-poll__options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.db-poll__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--xpe-muted);
  font-size: 14px;
}

.db-poll__option-votes {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--xpe-muted-foreground);
  font-variant-numeric: tabular-nums;
}

/* --- Image --- */
.db-figure { margin: 1.4em 0; }
.db-img {
  border-radius: 0.75rem;
  cursor: zoom-in;
  display: block;
  margin: 0 auto;
  height: auto;
  max-width: 100%;
}
.db-caption {
  margin-top: 0.5em;
  text-align: center;
  font-size: 0.8em;
  color: var(--xpe-muted-foreground);
}

/* --- Table --- */
.db-table-wrap {
  overflow-x: auto;
  margin: 1.25em 0;
  border: 1px solid var(--xpe-border);
  border-radius: 0.5rem;
  background: var(--xpe-background);
}
.db-table-wrap--expanded {
  --db-table-breakout-start: calc(
    var(--page-content-inset-start, 36px) + var(--page-padding-x, 96px)
  );
  --db-table-breakout-end: calc(
    var(--page-content-inset-end, 44px) + var(--page-padding-x, 96px)
  );
  width: calc(100% + var(--db-table-breakout-start) + var(--db-table-breakout-end));
  max-width: none;
  margin-inline-start: calc(-1 * var(--db-table-breakout-start));
  box-sizing: border-box;
}
.db-table {
  width: 100%;
  border-collapse: collapse;
  overflow: hidden;
  color: var(--xpe-foreground);
}
.db-table th,
.db-table td {
  padding: 0.55em 1em;
  text-align: start;
  vertical-align: top;
  line-height: 1.6;
  font-size: 0.9em;
  border: 1px solid var(--xpe-border);
  background: var(--xpe-background);
  color: var(--xpe-foreground);
}
.db-table th {
  font-weight: 600;
  background: var(--xpe-muted);
}

/* --- Inline marks (from spansToHtml) --- */
.doc-blocks :global(strong) { font-weight: 700; }
.doc-blocks :global(s) { text-decoration: line-through; }
.doc-blocks :global(u) { text-decoration: underline; text-underline-offset: 3px; }
.doc-blocks :global(code) {
  background: var(--xpe-muted);
  border: 1px solid var(--xpe-border);
  border-radius: 0.375rem;
  padding: 0.12em 0.4em;
  font-size: 0.85em;
  font-family: var(--xpe-font-mono, ui-monospace, monospace);
  font-weight: 500;
}
.doc-blocks :global(a) {
  color: var(--xpe-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}
.doc-blocks :global(a:hover) { opacity: 0.8; }

/* --- Syntax highlighting (Catppuccin-ish, matches previous theme) --- */
.db-code :global(.hljs-comment), .db-code :global(.hljs-quote) { color: #6c7086; font-style: italic; }
.db-code :global(.hljs-keyword), .db-code :global(.hljs-selector-tag), .db-code :global(.hljs-built_in) { color: #cba6f7; }
.db-code :global(.hljs-string), .db-code :global(.hljs-doctag), .db-code :global(.hljs-title), .db-code :global(.hljs-section), .db-code :global(.hljs-attribute) { color: #a6e3a1; }
.db-code :global(.hljs-number), .db-code :global(.hljs-literal) { color: #fab387; }
.db-code :global(.hljs-type), .db-code :global(.hljs-class .hljs-title) { color: #f9e2af; }
.db-code :global(.hljs-function), .db-code :global(.hljs-function .hljs-title) { color: #89b4fa; }
.db-code :global(.hljs-params) { color: #f2cdcd; }
.db-code :global(.hljs-variable), .db-code :global(.hljs-template-variable) { color: #f5c2e7; }
.db-code :global(.hljs-tag), .db-code :global(.hljs-name) { color: #89b4fa; }
.db-code :global(.hljs-attr) { color: #f9e2af; }
.db-code :global(.hljs-symbol), .db-code :global(.hljs-bullet), .db-code :global(.hljs-deletion) { color: #f38ba8; }
.db-code :global(.hljs-meta) { color: #fab387; }
.db-code :global(.hljs-addition) { color: #a6e3a1; }
.db-code :global(.hljs-emphasis) { font-style: italic; }
.db-code :global(.hljs-strong) { font-weight: 700; }

</style>
