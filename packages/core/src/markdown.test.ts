import { describe, expect, it } from 'vitest'
import {
  blocksToMarkdown,
  looksLikeMarkdown,
  markdownToBlocks,
  parseInlineMarkdown,
} from './markdown'
import { createBlock, spansToText } from './ops'

describe('looksLikeMarkdown', () => {
  it('detects headings and lists', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true)
    expect(looksLikeMarkdown('- item')).toBe(true)
    expect(looksLikeMarkdown('1. item')).toBe(true)
    expect(looksLikeMarkdown('plain hello')).toBe(false)
  })

  it('detects inline marks and links', () => {
    expect(looksLikeMarkdown('hello **world**')).toBe(true)
    expect(looksLikeMarkdown('[a](https://x.test)')).toBe(true)
  })
})

describe('parseInlineMarkdown', () => {
  it('parses bold, italic, code, link, strike', () => {
    const spans = parseInlineMarkdown('**b** *i* `c` [l](https://a.test) ~~s~~')
    expect(spans).toEqual([
      { text: 'b', marks: { bold: true } },
      { text: ' ' },
      { text: 'i', marks: { italic: true } },
      { text: ' ' },
      { text: 'c', marks: { code: true } },
      { text: ' ' },
      { text: 'l', marks: { link: 'https://a.test' } },
      { text: ' ' },
      { text: 's', marks: { strikethrough: true } },
    ])
  })
})

describe('markdownToBlocks', () => {
  it('parses all heading levels h1–h6', () => {
    const md = [
      '# One',
      '## Two',
      '### Three',
      '#### Four',
      '##### Five',
      '###### Six',
    ].join('\n')
    const blocks = markdownToBlocks(md)
    expect(blocks.map((b) => b.type)).toEqual([
      'heading_1',
      'heading_2',
      'heading_3',
      'heading_4',
      'heading_5',
      'heading_6',
    ])
    expect(spansToText(blocks[3].content)).toBe('Four')
  })

  it('parses mixed document', () => {
    const md = [
      '# Hello',
      '',
      'A **bold** paragraph.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '',
      '- [ ] todo',
      '- [x] done',
      '',
      '> quoted',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '---',
      '',
      '![cap](https://img.test/a.png)',
    ].join('\n')

    const blocks = markdownToBlocks(md)
    expect(blocks.map((b) => b.type)).toEqual([
      'heading_1',
      'paragraph',
      'bulleted_list_item',
      'bulleted_list_item',
      'numbered_list_item',
      'to_do',
      'to_do',
      'quote',
      'code',
      'divider',
      'image',
    ])
    expect(spansToText(blocks[0].content)).toBe('Hello')
    expect(blocks[1].content.some((s) => s.marks?.bold)).toBe(true)
    expect(blocks[5].props.checked).toBe(false)
    expect(blocks[6].props.checked).toBe(true)
    expect(blocks[8].props.code).toBe('const x = 1')
    expect(blocks[8].props.language).toBe('js')
    expect(blocks[10].props.url).toBe('https://img.test/a.png')
    expect(blocks[10].props.caption).toBe('cap')
  })

  it('parses simple tables', () => {
    const md = [
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n')
    const blocks = markdownToBlocks(md)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('table')
    expect(blocks[0].props.table?.rows).toHaveLength(2)
    expect(spansToText(blocks[0].props.table!.rows[0][0].content)).toBe('A')
    expect(spansToText(blocks[0].props.table!.rows[1][1].content)).toBe('2')
  })
})

describe('blocksToMarkdown', () => {
  it('exports common block types', () => {
    const blocks = [
      createBlock('heading_1', { content: [{ text: 'Hello' }] }),
      createBlock('paragraph', {
        content: [
          { text: 'A ' },
          { text: 'bold', marks: { bold: true } },
          { text: ' word' },
        ],
      }),
      createBlock('bulleted_list_item', { content: [{ text: 'one' }] }),
      createBlock('to_do', { content: [{ text: 'task' }], props: { checked: true } }),
      createBlock('code', { props: { code: 'x = 1', language: 'js' } }),
      createBlock('divider'),
    ]
    const md = blocksToMarkdown(blocks)
    expect(md).toContain('# Hello')
    expect(md).toContain('**bold**')
    expect(md).toContain('- one')
    expect(md).toContain('- [x] task')
    expect(md).toContain('```js')
    expect(md).toContain('x = 1')
    expect(md).toContain('---')
  })

  it('does not over-escape prose, paths, or parentheses', () => {
    const blocks = [
      createBlock('paragraph', {
        content: [
          {
            text: 'See chatmail (crates/chatmail/) and file 01-architecture.md for details.',
          },
        ],
      }),
    ]
    const md = blocksToMarkdown(blocks)
    expect(md).toContain('chatmail (crates/chatmail/)')
    expect(md).toContain('01-architecture.md')
    expect(md).not.toMatch(/\\[\(\)\.\-]/)
  })

  it('exports links without escaping path dots or parentheses', () => {
    const blocks = [
      createBlock('paragraph', {
        content: [
          {
            text: '01-architecture.md',
            marks: { link: '01-architecture.md#rust-workspace-crates' },
          },
        ],
      }),
    ]
    const md = blocksToMarkdown(blocks)
    expect(md).toContain('[01-architecture.md](01-architecture.md#rust-workspace-crates)')
    expect(md).not.toContain('\\.')
    expect(md).not.toContain('\\(')
  })

  it('preserves raw link syntax in plain text without backslash escapes', () => {
    const blocks = [
      createBlock('paragraph', {
        content: [
          {
            text: 'See [01-architecture.md](01-architecture.md#rust) and chatmail (crates/).',
          },
        ],
      }),
    ]
    const md = blocksToMarkdown(blocks)
    expect(md).toContain('[01-architecture.md](01-architecture.md#rust)')
    expect(md).toContain('chatmail (crates/)')
    expect(md).not.toMatch(/\\[\[\]\(\)\.]/)
  })

  it('cleans residual over-escapes on export and parse', () => {
    const blocks = [
      createBlock('paragraph', {
        content: [
          {
            text: 'Technical Design Document \\(TDD\\) for **madmail\\-v2** and 01\\-architecture\\.md',
          },
        ],
      }),
    ]
    const md = blocksToMarkdown(blocks)
    expect(md).toContain('Technical Design Document (TDD)')
    expect(md).toContain('madmail-v2')
    expect(md).toContain('01-architecture.md')
    expect(md).not.toMatch(/\\[\(\)\.\-]/)

    const parsed = markdownToBlocks(
      'Full dependency diagram: **\\[01\\-architecture\\.md\\]\\(01\\-architecture\\.md\\#rust\\)**.',
    )
    const export2 = blocksToMarkdown(parsed)
    expect(export2).toContain('[01-architecture.md](01-architecture.md#rust)')
    expect(export2).not.toContain('\\-')
    expect(export2).not.toContain('\\[')
  })
})
