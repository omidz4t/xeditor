import { describe, expect, it } from 'vitest'
import { htmlToBlocks } from './normalize'
import { looksLikeMarkdown, markdownToBlocks } from './markdown'
import { buildBlockRenderTree } from './toggle-groups'

describe('HTML details → toggle (collapse)', () => {
  it('maps details/summary to a toggle with nested body', () => {
    const html = `
      <details>
        <summary>📌 <b>Section one</b></summary>
        <p>Body paragraph</p>
        <ul><li>Item A</li><li>Item B</li></ul>
      </details>
    `
    const blocks = htmlToBlocks(html)
    expect(blocks[0]?.type).toBe('toggle')
    expect(blocks[0]?.props.collapsed).toBe(true)
    const title = blocks[0]!.content.map((s) => s.text).join('')
    expect(title).toContain('Section one')

    const tree = buildBlockRenderTree(blocks)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.kind).toBe('toggle')
    if (tree[0]!.kind !== 'toggle') return
    expect(tree[0]!.children.length).toBeGreaterThanOrEqual(2)
  })

  it('respects open attribute (not collapsed)', () => {
    const blocks = htmlToBlocks(
      '<details open><summary>Open me</summary><p>Hi</p></details>',
    )
    expect(blocks[0]?.type).toBe('toggle')
    expect(blocks[0]?.props.collapsed).toBe(false)
  })

  it('detects details in markdown looksLikeMarkdown', () => {
    expect(looksLikeMarkdown('<details><summary>x</summary></details>')).toBe(true)
  })

  it('markdown paste with details parses body as markdown under the toggle', () => {
    const md = `Intro line

<details>
<summary>🎨 Styles</summary>

- one
- two

### Nested heading
</details>
`
    const blocks = markdownToBlocks(md)
    const toggle = blocks.find((b) => b.type === 'toggle')
    expect(toggle).toBeTruthy()
    expect(toggle!.content.map((s) => s.text).join('')).toContain('Styles')
    expect(blocks.some((b) => b.type === 'bulleted_list_item' && (b.props.indent ?? 0) >= 1)).toBe(true)
    expect(blocks.some((b) => b.type === 'heading_3' && (b.props.indent ?? 0) >= 1)).toBe(true)
  })

  it('HTML details with markdown-looking body becomes real list items', () => {
    const html = `
      <details>
        <summary>Section</summary>
        <p>* **Bold label:** detail text</p>
        <p>* second item</p>
      </details>
    `
    const blocks = htmlToBlocks(html)
    const lists = blocks.filter((b) => b.type === 'bulleted_list_item')
    expect(lists.length).toBeGreaterThanOrEqual(2)
    expect(lists[0]!.content.some((s) => s.marks?.bold)).toBe(true)
  })
})
