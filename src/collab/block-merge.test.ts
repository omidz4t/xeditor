import { describe, expect, it } from 'vitest'
import { createBlock } from '@xproeditor/core'
import {
  dedupeBlocksById,
  mergeBlocksForPush,
  mergeRemoteBlocks,
} from './block-merge'

function para(id: string, text: string) {
  return createBlock('paragraph', { id, content: text ? [{ text }] : [] })
}

describe('dedupeBlocksById', () => {
  it('keeps first occurrence of each id', () => {
    const a = para('a', 'one')
    const a2 = para('a', 'two')
    const b = para('b', 'b')
    expect(dedupeBlocksById([a, b, a2]).map((block) => block.id)).toEqual(['a', 'b'])
    expect(dedupeBlocksById([a, b, a2])[0].content[0]?.text).toBe('one')
  })
})

describe('mergeRemoteBlocks', () => {
  it('does not reintroduce remote-deleted neighbors of a protected block', () => {
    const local = [para('a', 'A'), para('b', 'B-local'), para('c', 'C')]
    const remote = [para('a', 'A'), para('b', 'B-remote')]
    const merged = mergeRemoteBlocks(local, remote, new Set(['b']))
    expect(merged.map((block) => block.id)).toEqual(['a', 'b'])
    expect(merged[1].content[0]?.text).toBe('B-local')
  })

  it('keeps a dirty local-only insert', () => {
    const local = [para('a', 'A'), para('new', 'mine')]
    const remote = [para('a', 'A')]
    const merged = mergeRemoteBlocks(local, remote, new Set(['new']))
    expect(merged.map((block) => block.id)).toEqual(['a', 'new'])
  })
})

describe('mergeBlocksForPush', () => {
  it('dedupes and includes peer-only inserts once', () => {
    const local = [para('a', 'A'), para('a', 'A-dup'), para('mine', 'M')]
    const remote = [para('a', 'A-remote'), para('peer', 'P')]
    const pushed = mergeBlocksForPush(local, remote, new Set(['mine']), null)
    // Peer insert lands after its remote predecessor (`a`); local-only `mine` stays once.
    expect(pushed.map((block) => block.id)).toEqual(['a', 'peer', 'mine'])
    // Non-dirty shared block uses remote payload.
    expect(pushed[0].content[0]?.text).toBe('A-remote')
  })
})
