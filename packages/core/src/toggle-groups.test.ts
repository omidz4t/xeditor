import { describe, expect, it } from 'vitest'
import { createBlock } from './ops'
import {
  buildBlockRenderTree,
  ensureTogglePlaceholder,
  toggleDescendantCount,
} from './toggle-groups'
import type { Block } from './types'

function typesInTree(blocks: Block[]): Array<string | { toggle: string[] }> {
  return buildBlockRenderTree(blocks).map((entry) => {
    if (entry.kind === 'toggle') {
      return {
        toggle: entry.children.map((child) =>
          child.kind === 'block' ? child.block.type : child.kind,
        ),
      }
    }
    if (entry.kind === 'column_list') {
      return 'column_list'
    }
    return entry.block.type
  })
}

describe('toggle groups', () => {
  it('nests any block type under a toggle by indent', () => {
    const toggle = createBlock('toggle', { content: [{ text: 'Section' }] })
    const blocks: Block[] = [
      toggle,
      createBlock('heading_1', { content: [{ text: 'Title' }], props: { indent: 1 } }),
      createBlock('bulleted_list_item', { content: [{ text: 'Item' }], props: { indent: 1 } }),
      createBlock('code', { props: { indent: 1, code: 'x = 1', language: 'js' } }),
      createBlock('table', { props: { indent: 1 } }),
      createBlock('image', { props: { indent: 1, url: 'https://example.com/a.png' } }),
      createBlock('paragraph', { content: [{ text: 'After' }] }),
    ]

    expect(toggleDescendantCount(blocks, 0)).toBe(5)
    expect(typesInTree(blocks)).toEqual([
      {
        toggle: ['heading_1', 'bulleted_list_item', 'code', 'table', 'image'],
      },
      'paragraph',
    ])
  })

  it('adds a nested paragraph placeholder when a toggle has no children', () => {
    const toggle = createBlock('toggle', { content: [{ text: 'Empty' }] })
    const blocks: Block[] = [toggle]

    expect(ensureTogglePlaceholder(blocks, toggle)).toBe(true)
    expect(blocks).toHaveLength(2)
    expect(blocks[1].type).toBe('paragraph')
    expect(blocks[1].props.indent).toBe(1)
    expect(toggleDescendantCount(blocks, 0)).toBe(1)
  })

  it('supports nested toggles with mixed children', () => {
    const outer = createBlock('toggle', { content: [{ text: 'Outer' }] })
    const inner = createBlock('toggle', { content: [{ text: 'Inner' }], props: { indent: 1 } })
    const blocks: Block[] = [
      outer,
      inner,
      createBlock('quote', { content: [{ text: 'Q' }], props: { indent: 2 } }),
      createBlock('to_do', { content: [{ text: 'Task' }], props: { indent: 2 } }),
    ]

    const tree = buildBlockRenderTree(blocks)
    expect(tree).toHaveLength(1)
    expect(tree[0].kind).toBe('toggle')
    if (tree[0].kind !== 'toggle') return

    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].kind).toBe('toggle')
    if (tree[0].children[0].kind !== 'toggle') return

    expect(tree[0].children[0].children.map((c) => (c.kind === 'block' ? c.block.type : c.kind))).toEqual([
      'quote',
      'to_do',
    ])
  })
})
