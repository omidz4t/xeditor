import { describe, expect, it } from 'vitest'
import {
  blocksToHtmlContent,
  clipboardPrefersUrlOverImages,
  isEmbeddableImageUrl,
  isPlainHttpUrl,
} from './clipboard'
import { htmlToBlocks } from './normalize'
import { createBlock } from './ops'
import { isPastedTextMergeable } from './types'

describe('isPlainHttpUrl', () => {
  it('accepts a single http(s) URL', () => {
    expect(isPlainHttpUrl('https://delta.chat/')).toBe(true)
    expect(isPlainHttpUrl('  http://example.com/path?q=1#h  ')).toBe(true)
  })

  it('rejects surrounding text, missing protocol, and empty', () => {
    expect(isPlainHttpUrl('see https://delta.chat/')).toBe(false)
    expect(isPlainHttpUrl('delta.chat')).toBe(false)
    expect(isPlainHttpUrl('')).toBe(false)
  })
})

describe('isEmbeddableImageUrl', () => {
  it('accepts data URLs and http(s) image paths', () => {
    expect(isEmbeddableImageUrl('data:image/png;base64,aaaa')).toBe(true)
    expect(isEmbeddableImageUrl('https://cdn.example.com/pic.png')).toBe(true)
    expect(isEmbeddableImageUrl('https://cdn.example.com/pic.JPG?w=800#1')).toBe(true)
    expect(isEmbeddableImageUrl('https://cdn.example.com/a.webp')).toBe(true)
  })

  it('does not treat ordinary page URLs as images', () => {
    expect(isEmbeddableImageUrl('https://delta.chat/')).toBe(false)
    expect(isEmbeddableImageUrl('https://github.com/omidz4t/xeditor')).toBe(false)
    expect(isEmbeddableImageUrl('https://example.com/docs/image')).toBe(false)
  })
})

describe('clipboardPrefersUrlOverImages', () => {
  it('prefers a page URL over a preview bitmap', () => {
    expect(clipboardPrefersUrlOverImages('https://delta.chat/en/help')).toBe(true)
    expect(clipboardPrefersUrlOverImages('https://cdn.example.com/a.png')).toBe(false)
    expect(clipboardPrefersUrlOverImages('hello')).toBe(false)
  })
})

describe('toggle clipboard HTML', () => {
  it('does not merge a toggle into a host paragraph', () => {
    expect(isPastedTextMergeable('paragraph')).toBe(true)
    expect(isPastedTextMergeable('toggle')).toBe(false)
  })

  it('serializes a toggle and its body as details', () => {
    const html = blocksToHtmlContent([
      createBlock('toggle', { content: [{ text: 'Section' }] }),
      createBlock('paragraph', { content: [{ text: 'Inside' }], props: { indent: 1 } }),
    ])
    expect(html).toContain('<details')
    expect(html).toContain('<summary>Section</summary>')
    expect(html).toContain('Inside')
    expect(html).not.toMatch(/^<p>Section<\/p>/)

    const parsed = htmlToBlocks(html)
    expect(parsed[0]?.type).toBe('toggle')
    expect(parsed.some((b) => b.type === 'paragraph' && b.content.some((s) => s.text === 'Inside'))).toBe(true)
  })
})
