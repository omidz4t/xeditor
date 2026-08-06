import type { Block } from '@xproeditor/core'

/** Drop duplicate block ids (keep first). Concurrent Y.Array merges used to produce these. */
export function dedupeBlocksById(blocks: Block[]): Block[] {
  const seen = new Set<string>()
  const out: Block[] = []
  for (const block of blocks) {
    if (!block?.id || seen.has(block.id)) continue
    seen.add(block.id)
    out.push(block)
  }
  return out
}

/**
 * Merge remote page blocks into local ones while protecting blocks the local
 * user is actively editing (and any dirty local-only blocks).
 */
export function mergeRemoteBlocks(
  local: Block[],
  remote: Block[],
  protectedIds: ReadonlySet<string>,
  removedIds: ReadonlySet<string> = new Set(),
): Block[] {
  const localClean = dedupeBlocksById(local)
  const remoteClean = dedupeBlocksById(remote)

  if (protectedIds.size === 0 && removedIds.size === 0) {
    return remoteClean.map(cloneBlock)
  }

  const localById = new Map(localClean.map((block) => [block.id, block]))
  const remoteIds = new Set(remoteClean.map((block) => block.id))
  const result: Block[] = []
  const resultIds = new Set<string>()

  for (const remoteBlock of remoteClean) {
    if (removedIds.has(remoteBlock.id)) continue
    if (resultIds.has(remoteBlock.id)) continue

    if (protectedIds.has(remoteBlock.id)) {
      const localBlock = localById.get(remoteBlock.id)
      result.push(localBlock ?? cloneBlock(remoteBlock))
    } else {
      result.push(cloneBlock(remoteBlock))
    }
    resultIds.add(remoteBlock.id)
  }

  // Keep local-only blocks the user created while typing (split/enter/page ref).
  // Only keep when the block itself is protected/dirty — not merely "near" a
  // protected neighbor (that re-inserted peer-deleted or stale clones).
  for (let index = 0; index < localClean.length; index++) {
    const localBlock = localClean[index]
    if (remoteIds.has(localBlock.id) || resultIds.has(localBlock.id)) continue
    if (removedIds.has(localBlock.id)) continue
    if (!protectedIds.has(localBlock.id)) continue

    const prev = index > 0 ? localClean[index - 1] : null
    let insertAt = result.length
    if (prev) {
      const prevIdx = result.findIndex((block) => block.id === prev.id)
      if (prevIdx >= 0) insertAt = prevIdx + 1
    }
    result.splice(insertAt, 0, localBlock)
    resultIds.add(localBlock.id)
  }

  return result
}

/**
 * Build the block list to publish.
 * - Dirty / focused blocks: local version (our edits)
 * - Everything else: remote version from Y (peer's concurrent edits on other blocks)
 * - Remote-only blocks: included so peer inserts appear after we push
 */
export function mergeBlocksForPush(
  local: Block[],
  remote: Block[],
  dirtyIds: ReadonlySet<string>,
  myFocusId: string | null,
  removedIds: ReadonlySet<string> = new Set(),
): Block[] {
  const localClean = dedupeBlocksById(local)
  const remoteClean = dedupeBlocksById(remote)
  const remoteById = new Map(remoteClean.map((block) => [block.id, block]))
  const localIds = new Set(localClean.map((block) => block.id))
  const result: Block[] = []
  const resultIds = new Set<string>()

  for (const localBlock of localClean) {
    if (resultIds.has(localBlock.id)) continue
    const useLocal = dirtyIds.has(localBlock.id) || localBlock.id === myFocusId
    result.push(useLocal ? localBlock : (remoteById.get(localBlock.id) ?? localBlock))
    resultIds.add(localBlock.id)
  }

  // Include blocks peers created that we don't have yet (but not ones we deleted locally).
  for (let index = 0; index < remoteClean.length; index++) {
    const remoteBlock = remoteClean[index]
    if (localIds.has(remoteBlock.id) || resultIds.has(remoteBlock.id)) continue
    if (removedIds.has(remoteBlock.id)) continue

    const prev = index > 0 ? remoteClean[index - 1] : null
    let insertAt = result.length
    if (prev) {
      const prevIdx = result.findIndex((block) => block.id === prev.id)
      if (prevIdx >= 0) insertAt = prevIdx + 1
    }
    result.splice(insertAt, 0, cloneBlock(remoteBlock))
    resultIds.add(remoteBlock.id)
  }

  return result
}

function cloneBlock(block: Block): Block {
  return JSON.parse(JSON.stringify(block)) as Block
}
