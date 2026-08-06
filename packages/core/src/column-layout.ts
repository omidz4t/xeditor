import { cloneBlock, createBlock } from './ops'
import type { Block } from './types'

export const COLUMN_DROP_EDGE_PX = 28

export type ColumnDropSide = 'left' | 'right'

const NON_COLUMNIZABLE_TYPES = new Set<Block['type']>(['column_list', 'column', 'divider'])

export function canColumnizeBlock(block: Block): boolean {
  return !NON_COLUMNIZABLE_TYPES.has(block.type)
}

export interface ColumnListContext {
  listIdx: number
  columnIdx: number
  listIndent: number
  columnIndent: number
}

/** Locate the column_list / column containing a block, if any. */
export function findColumnListContext(blocks: Block[], blockIdx: number): ColumnListContext | null {
  const block = blocks[blockIdx]

  if (!block) {
    return null
  }

  let contentIndent = block.props.indent ?? 0

  for (let i = blockIdx; i >= 0; i--) {
    const candidate = blocks[i]
    const indent = candidate.props.indent ?? 0

    if (candidate.type === 'column' && indent < contentIndent) {
      const columnIndent = indent

      for (let j = i - 1; j >= 0; j--) {
        const list = blocks[j]

        if (list.type === 'column_list' && (list.props.indent ?? 0) === columnIndent - 1) {
          return {
            listIdx: j,
            columnIdx: i,
            listIndent: list.props.indent ?? 0,
            columnIndent,
          }
        }

        if ((list.props.indent ?? 0) < columnIndent - 1) {
          break
        }
      }
    }

    contentIndent = indent
  }

  return null
}

/** Extract a block plus any nested toggle/column descendants as one movable unit. */
export function blockUnitSpan(blocks: Block[], idx: number): { start: number; end: number } {
  const block = blocks[idx]

  if (!block) {
    return { start: idx, end: idx }
  }

  const indent = block.props.indent ?? 0
  let end = idx + 1

  if (block.type === 'toggle' || block.type === 'column_list') {
    while (end < blocks.length && (blocks[end].props.indent ?? 0) > indent) {
      end++
    }
  }

  return { start: idx, end }
}

function propsWithIndent(indent: number): Block['props'] {
  return indent > 0 ? { indent } : {}
}

function setBlockIndent(block: Block, indent: number): Block {
  const next = cloneBlock(block, false)
  next.props = { ...next.props, ...propsWithIndent(indent) }

  return next
}

function reindentUnit(blocks: Block[], baseIndent: number): Block[] {
  const contentIndent = baseIndent + 2

  return blocks.map((block) => {
    const offset = (block.props.indent ?? 0) - (blocks[0].props.indent ?? 0)

    return setBlockIndent(block, contentIndent + offset)
  })
}

function extractUnit(blocks: Block[], idx: number): Block[] {
  const { start, end } = blockUnitSpan(blocks, idx)

  return blocks.splice(start, end - start)
}

function insertColumnUnit(
  blocks: Block[],
  at: number,
  listIndent: number,
  unit: Block[],
): void {
  // New column gets an equal share; existing sibling widths stay until the user resizes.
  const column = createBlock('column', {
    props: { ...propsWithIndent(listIndent + 1), width: 50 },
  })
  const content = reindentUnit(unit, listIndent)

  blocks.splice(at, 0, column, ...content)
}

/**
 * Drag block beside another to create (or extend) a horizontal column row.
 * Mutates `blocks`. Returns false when the drop is not allowed.
 */
export function createColumnLayoutFromDrop(
  blocks: Block[],
  draggedId: string,
  targetId: string,
  side: ColumnDropSide,
): boolean {
  const dragIdx = blocks.findIndex(b => b.id === draggedId)
  const targetIdx = blocks.findIndex(b => b.id === targetId)

  if (dragIdx === -1 || targetIdx === -1 || dragIdx === targetIdx) {
    return false
  }

  const dragged = blocks[dragIdx]
  const target = blocks[targetIdx]

  if (!canColumnizeBlock(dragged) || !canColumnizeBlock(target)) {
    return false
  }

  const targetCtx = findColumnListContext(blocks, targetIdx)
  const dragCtx = findColumnListContext(blocks, dragIdx)

  if (dragCtx && targetCtx && dragCtx.listIdx === targetCtx.listIdx) {
    return false
  }

  if (targetCtx && !dragCtx) {
    const unit = extractUnit(blocks, dragIdx)
    // After extract, indices after dragIdx shift left.
    let columnIdx = targetCtx.columnIdx
    if (dragIdx < columnIdx) {
      columnIdx -= unit.length
    }
    let insertAt = side === 'left'
      ? columnIdx
      : blockUnitSpan(blocks, columnIdx).end

    insertColumnUnit(blocks, insertAt, targetCtx.listIndent, unit)

    return true
  }

  // Extract higher index first so the lower index stays stable.
  const higherIdx = Math.max(dragIdx, targetIdx)
  const lowerIdx = Math.min(dragIdx, targetIdx)
  const higherUnit = extractUnit(blocks, higherIdx)
  const lowerUnit = extractUnit(blocks, lowerIdx)

  if (lowerUnit.length === 0 || higherUnit.length === 0) {
    return false
  }

  // Map units by role (not by document order) so side: 'right' means
  // "dragged becomes the right column" even when it started above the target.
  const draggedUnit = dragIdx === higherIdx ? higherUnit : lowerUnit
  const targetUnit = dragIdx === higherIdx ? lowerUnit : higherUnit
  const leftUnit = side === 'left' ? draggedUnit : targetUnit
  const rightUnit = side === 'left' ? targetUnit : draggedUnit

  const baseIndent = Math.min(
    leftUnit[0].props.indent ?? 0,
    rightUnit[0].props.indent ?? 0,
  )

  const list = createBlock('column_list', { props: propsWithIndent(baseIndent) })
  const leftColumn = createBlock('column', {
    props: { ...propsWithIndent(baseIndent + 1), width: 50 },
  })
  const rightColumn = createBlock('column', {
    props: { ...propsWithIndent(baseIndent + 1), width: 50 },
  })
  const leftContent = reindentUnit(leftUnit, baseIndent)
  const rightContent = reindentUnit(rightUnit, baseIndent)

  // Both units removed; insertion point is where the earlier block was.
  blocks.splice(
    lowerIdx,
    0,
    list,
    leftColumn,
    ...leftContent,
    rightColumn,
    ...rightContent,
  )

  return true
}