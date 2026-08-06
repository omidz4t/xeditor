/** Word / line motion helpers for Vim mode (plain text offsets). */

const WORD_CHAR = /[A-Za-z0-9_]/
const BLANK = /\s/

export function clampOffset(offset: number, len: number): number {
  if (len <= 0) return 0
  return Math.max(0, Math.min(offset, len))
}

/** First non-blank offset (or 0). */
export function firstNonBlank(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (!BLANK.test(text[i]!)) return i
  }
  return 0
}

/** Start of next word (w). */
export function findNextWordStart(text: string, offset: number, count = 1): number {
  let i = clampOffset(offset, text.length)
  for (let n = 0; n < count; n++) {
    if (i >= text.length) return text.length
    const startClass = charClass(text[i]!)
    // Leave current word/punctuation run
    if (startClass !== 'blank') {
      i++
      while (i < text.length && charClass(text[i]!) === startClass) i++
    }
    // Skip blanks
    while (i < text.length && charClass(text[i]!) === 'blank') i++
  }
  return clampOffset(i, text.length)
}

/** Start of previous word (b). */
export function findPrevWordStart(text: string, offset: number, count = 1): number {
  let i = clampOffset(offset, text.length)
  for (let n = 0; n < count; n++) {
    if (i <= 0) return 0
    // Skip blanks left
    i--
    while (i > 0 && charClass(text[i]!) === 'blank') i--
    if (i <= 0) return 0
    const cls = charClass(text[i]!)
    while (i > 0 && charClass(text[i - 1]!) === cls) i--
  }
  return i
}

/** End of word (e) — inclusive last char of word. */
export function findWordEnd(text: string, offset: number, count = 1): number {
  let i = clampOffset(offset, text.length)
  for (let n = 0; n < count; n++) {
    if (i >= text.length) return Math.max(0, text.length - 1)
    // If mid-word, stay; if at end or blank, advance
    if (i < text.length - 1 && charClass(text[i]!) !== 'blank' && charClass(text[i + 1]!) === charClass(text[i]!)) {
      // move toward end of current word
      while (i < text.length - 1 && charClass(text[i + 1]!) === charClass(text[i]!)) i++
    } else {
      i++
      while (i < text.length && charClass(text[i]!) === 'blank') i++
      if (i >= text.length) return Math.max(0, text.length - 1)
      const cls = charClass(text[i]!)
      while (i < text.length - 1 && charClass(text[i + 1]!) === cls) i++
    }
  }
  return clampOffset(i, Math.max(0, text.length - 1))
}

/** WORD motions (W/B/E) — blank-separated. */
export function findNextWORDStart(text: string, offset: number, count = 1): number {
  let i = clampOffset(offset, text.length)
  for (let n = 0; n < count; n++) {
    if (i >= text.length) return text.length
    // Leave non-blank run
    if (!BLANK.test(text[i]!)) {
      while (i < text.length && !BLANK.test(text[i]!)) i++
    }
    while (i < text.length && BLANK.test(text[i]!)) i++
  }
  return clampOffset(i, text.length)
}

export function findPrevWORDStart(text: string, offset: number, count = 1): number {
  let i = clampOffset(offset, text.length)
  for (let n = 0; n < count; n++) {
    if (i <= 0) return 0
    i--
    while (i > 0 && BLANK.test(text[i]!)) i--
    while (i > 0 && !BLANK.test(text[i - 1]!)) i--
  }
  return i
}

export function findWORDEnd(text: string, offset: number, count = 1): number {
  let i = clampOffset(offset, text.length)
  for (let n = 0; n < count; n++) {
    if (i >= text.length) return Math.max(0, text.length - 1)
    if (i < text.length - 1 && !BLANK.test(text[i]!) && !BLANK.test(text[i + 1]!)) {
      while (i < text.length - 1 && !BLANK.test(text[i + 1]!)) i++
    } else {
      i++
      while (i < text.length && BLANK.test(text[i]!)) i++
      if (i >= text.length) return Math.max(0, text.length - 1)
      while (i < text.length - 1 && !BLANK.test(text[i + 1]!)) i++
    }
  }
  return clampOffset(i, Math.max(0, text.length - 1))
}

export function findChar(
  text: string,
  offset: number,
  ch: string,
  direction: 1 | -1,
  till: boolean,
  count = 1,
): number | null {
  let i = offset
  for (let n = 0; n < count; n++) {
    i += direction
    let found = -1
    if (direction === 1) {
      found = text.indexOf(ch, i)
    } else {
      found = text.lastIndexOf(ch, i)
    }
    if (found < 0) return n === 0 ? null : clampOffset(i - direction, text.length)
    i = found
  }
  if (till) {
    i -= direction
  }
  return clampOffset(i, Math.max(0, text.length - 1))
}

type CharClass = 'word' | 'punct' | 'blank'

function charClass(ch: string): CharClass {
  if (BLANK.test(ch)) return 'blank'
  if (WORD_CHAR.test(ch)) return 'word'
  return 'punct'
}
