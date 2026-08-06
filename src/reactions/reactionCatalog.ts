/**
 * Quick-reaction emoji catalog with bundled Twemoji SVGs (CC-BY 4.0).
 * Unicode strings are still sent over the wire; SVGs are display-only.
 */

import eyesSvg from './svgs/1f440.svg'
import thumbsUpSvg from './svgs/1f44d.svg'
import joySvg from './svgs/1f602.svg'
import openMouthSvg from './svgs/1f62e.svg'
import crySvg from './svgs/1f622.svg'
import tadaSvg from './svgs/1f389.svg'
import fireSvg from './svgs/1f525.svg'
import heartSvg from './svgs/2764.svg'

export type ReactionEntry = {
  /** Unicode emoji sent/stored in presence messages. */
  emoji: string
  label: string
  src: string
}

/** Classic 8-wedge pie of quick reactions. */
export const REACTION_CATALOG: ReactionEntry[] = [
  { emoji: '👍', label: 'Thumbs up', src: thumbsUpSvg },
  { emoji: '❤️', label: 'Heart', src: heartSvg },
  { emoji: '😂', label: 'Joy', src: joySvg },
  { emoji: '😮', label: 'Surprised', src: openMouthSvg },
  { emoji: '😢', label: 'Sad', src: crySvg },
  { emoji: '🎉', label: 'Party', src: tadaSvg },
  { emoji: '🔥', label: 'Fire', src: fireSvg },
  { emoji: '👀', label: 'Eyes', src: eyesSvg },
]

export const REACTIONS = REACTION_CATALOG.map((entry) => entry.emoji)

const byEmoji = new Map<string, ReactionEntry>()
for (const entry of REACTION_CATALOG) {
  byEmoji.set(entry.emoji, entry)
  byEmoji.set(normalizeEmoji(entry.emoji), entry)
}

function normalizeEmoji(emoji: string): string {
  return [...emoji]
    .filter((ch) => ch !== '\uFE0F' && ch !== '\u200D')
    .join('')
}

export function getReactionEntry(emoji: string): ReactionEntry | undefined {
  const trimmed = emoji.trim()
  if (!trimmed) return undefined
  return byEmoji.get(trimmed) ?? byEmoji.get(normalizeEmoji(trimmed))
}

export function getReactionSvg(emoji: string): string | undefined {
  return getReactionEntry(emoji)?.src
}

export function getReactionLabel(emoji: string): string | undefined {
  return getReactionEntry(emoji)?.label
}