import { createBlock } from './ops'
import type { Block } from './types'

export type ColumnRenderEntry = {
  block: Block
  children: BlockRenderEntry[]
}

export type BlockRenderEntry =
  | { kind: 'block'; block: Block }
  | { kind: 'toggle'; block: Block; children: BlockRenderEntry[] }
  | { kind: 'column_list'; block: Block; columns: ColumnRenderEntry[] }

/** Group visible blocks into toggle / column trees (Notion-style layout). */
export function groupToggleEntries(
  blocks: Block[],
  start = 0,
  minIndent = -1,
): { entries: BlockRenderEntry[]; end: number } {
  const entries: BlockRenderEntry[] = []
  let i = start

  while (i < blocks.length) {
    const block = blocks[i]
    const indent = block.props.indent ?? 0

    if (indent <= minIndent) {
      break
    }

    if (block.type === 'column_list') {
      i++
      const columns: ColumnRenderEntry[] = []

      while (i < blocks.length && blocks[i].type === 'column' && (blocks[i].props.indent ?? 0) === indent + 1) {
        const column = blocks[i]
        i++
        const nested = groupToggleEntries(blocks, i, column.props.indent ?? 0)
        columns.push({ block: column, children: nested.entries })
        i = nested.end
      }

      entries.push({ kind: 'column_list', block, columns })
    } else if (block.type === 'column') {
      i++
    } else if (block.type === 'toggle') {
      i++
      const nested = groupToggleEntries(blocks, i, indent)
      entries.push({ kind: 'toggle', block, children: nested.entries })
      i = nested.end
    } else {
      entries.push({ kind: 'block', block })
      i++
    }
  }

  return { entries, end: i }
}

export function buildBlockRenderTree(blocks: Block[]): BlockRenderEntry[] {
  return groupToggleEntries(blocks, 0, -1).entries
}

/**
 * Padding for a toggle group wrapper (page indent or nested vbox offset).
 * Inside a parent toggle body, extra steps are relative to the parent so deeper
 * nests stack on top of the body's base indent (see .ebi-toggle-vbox padding).
 */
export function toggleGroupPaddingPx(toggleIndent: number, vboxBaseIndent?: number, step = 28): number {
  if (vboxBaseIndent === undefined) {
    return toggleIndent * step
  }

  // Relative to parent body: direct nested toggle (indent = base+1) gets 0 extra
  // (the vbox already pads); deeper nested toggles add full steps.
  return Math.max(0, toggleIndent - vboxBaseIndent - 1) * step
}

/**
 * Extra padding for a block inside a toggle vbox, relative to the parent toggle.
 * Direct body children get 0 here — the vbox supplies a shared base indent so
 * every element under a collapsible is inset under the title.
 * Deeper nests (indent > parent+1) add further steps.
 */
export function toggleVBoxChildPaddingPx(blockIndent: number, vboxBaseIndent: number, step = 28): number {
  return Math.max(0, blockIndent - vboxBaseIndent - 1) * step
}

/** Count nested blocks inside a toggle (any depth until same/shallower indent). */
export function toggleDescendantCount(blocks: Block[], toggleIdx: number): number {
  const toggle = blocks[toggleIdx]

  if (!toggle || toggle.type !== 'toggle') {
    return 0
  }

  const toggleIndent = toggle.props.indent ?? 0
  let count = 0

  for (let i = toggleIdx + 1; i < blocks.length; i++) {
    if ((blocks[i].props.indent ?? 0) <= toggleIndent) {
      break
    }

    count++
  }

  return count
}

/** Index of the nearest toggle that contains `blockIdx` via indent, or null. */
export function findContainingToggleIndex(blocks: Block[], blockIdx: number): number | null {
  const child = blocks[blockIdx]
  if (!child) return null

  const childIndent = child.props.indent ?? 0
  if (childIndent <= 0) return null

  // Walk upward: first toggle with a strictly smaller indent is the container.
  // Do not break early on intermediate blocks — indent holes used to miss parents.
  for (let i = blockIdx - 1; i >= 0; i--) {
    const block = blocks[i]
    const indent = block.props.indent ?? 0

    if (block.type === 'toggle' && indent < childIndent) {
      return i
    }
  }

  return null
}

/** True when `blockIdx` is a direct body child of its containing toggle. */
export function isDirectToggleBodyBlock(blocks: Block[], blockIdx: number): boolean {
  const parentIdx = findContainingToggleIndex(blocks, blockIdx)
  if (parentIdx === null) return false

  const parentIndent = blocks[parentIdx].props.indent ?? 0
  const childIndent = blocks[blockIdx].props.indent ?? 0
  return childIndent === parentIndent + 1
}

/**
 * True when no later block is still nested under the same containing toggle.
 * Used so Enter on an empty mid-body line does not leave the collapse while
 * content still exists below inside it.
 */
export function isLastToggleDescendant(blocks: Block[], blockIdx: number): boolean {
  const parentIdx = findContainingToggleIndex(blocks, blockIdx)
  if (parentIdx === null) return false

  const parentIndent = blocks[parentIdx].props.indent ?? 0
  const next = blocks[blockIdx + 1]
  if (!next) return true

  return (next.props.indent ?? 0) <= parentIndent
}

function makeTogglePlaceholderChild(toggle: Block): Block {
  const childIndent = (toggle.props.indent ?? 0) + 1

  return createBlock('paragraph', {
    content: [],
    props: childIndent > 0 ? { indent: childIndent } : {},
  })
}

/** Insert an empty nested paragraph when a toggle has no children. Mutates `blocks`. */
export function ensureTogglePlaceholder(blocks: Block[], toggle: Block): boolean {
  const idx = blocks.indexOf(toggle)

  if (idx === -1 || toggle.type !== 'toggle' || toggleDescendantCount(blocks, idx) > 0) {
    return false
  }

  blocks.splice(idx + 1, 0, makeTogglePlaceholderChild(toggle))

  return true
}

/** Ensure every toggle in the document has at least one nested child. Mutates `blocks`. */
export function ensureTogglePlaceholders(blocks: Block[]): boolean {
  let changed = false

  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type !== 'toggle') {
      continue
    }

    if (toggleDescendantCount(blocks, i) > 0) {
      continue
    }

    blocks.splice(i + 1, 0, makeTogglePlaceholderChild(blocks[i]))
    changed = true
  }

  return changed
}