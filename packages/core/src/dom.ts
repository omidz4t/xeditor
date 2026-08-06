/** Caret/selection helpers for per-block contenteditable elements. */

/** Text offset of a (node, nodeOffset) position inside `el`. BR elements count as 1 char. */
function positionToOffset(el: HTMLElement, node: Node, nodeOffset: number): number {
  const range = document.createRange()
  range.selectNodeContents(el)

  try {
    range.setEnd(node, nodeOffset)
  } catch {
    return 0
  }

  // Count text length + <br> occurrences within the range
  const frag = range.cloneContents()
  const brCount = frag.querySelectorAll?.('br').length ?? 0

  return (frag.textContent?.length ?? 0) + brCount
}

export function getSelectionOffsets(el: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection()

  if (!sel || sel.rangeCount === 0) {
return null
}

  const range = sel.getRangeAt(0)

  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) {
return null
}

  const start = positionToOffset(el, range.startContainer, range.startOffset)
  const end = positionToOffset(el, range.endContainer, range.endOffset)

  return { start: Math.min(start, end), end: Math.max(start, end) }
}

export function getCaretOffset(el: HTMLElement): number | null {
  const offsets = getSelectionOffsets(el)

  return offsets ? offsets.start : null
}

/** Resolve a text offset back into a (node, nodeOffset) pair. */
function offsetToPosition(el: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      n.nodeType === Node.TEXT_NODE || (n as HTMLElement).tagName === 'BR'
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  })
  let node = walker.nextNode()
  let lastText: Text | null = null

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length

      if (remaining <= len) {
return { node, offset: remaining }
}

      remaining -= len
      lastText = node as Text
    } else {
      // <br> counts as one character
      if (remaining <= 0) {
return { node: el, offset: 0 }
}

      remaining -= 1
    }

    node = walker.nextNode()
  }

  if (lastText) {
return { node: lastText, offset: (lastText.textContent ?? '').length }
}

  return { node: el, offset: el.childNodes.length }
}

export function setSelectionOffsets(el: HTMLElement, start: number, end = start): void {
  const sel = window.getSelection()

  if (!sel) {
return
}

  const s = offsetToPosition(el, start)
  const e = end === start ? s : offsetToPosition(el, end)
  const range = document.createRange()

  try {
    range.setStart(s.node, s.offset)
    range.setEnd(e.node, e.offset)
  } catch {
    return
  }

  sel.removeAllRanges()
  sel.addRange(range)
}

export function focusEnd(el: HTMLElement): void {
  el.focus()
  const sel = window.getSelection()

  if (!sel) {
return
}

  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

export function focusStart(el: HTMLElement): void {
  el.focus()
  setSelectionOffsets(el, 0)
}

function caretRect(): DOMRect | null {
  const sel = window.getSelection()

  if (!sel || sel.rangeCount === 0) {
return null
}

  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const rects = range.getClientRects()

  if (rects.length > 0) {
return rects[0]
}

  // Empty line: fall back to container rect
  const container = range.startContainer
  const el = container.nodeType === Node.ELEMENT_NODE ? (container as HTMLElement) : container.parentElement

  return el ? el.getBoundingClientRect() : null
}

/**
 * Sticky inline wrappers where the browser often traps the caret at the edge
 * (especially `<code>` and links). Arrow keys should step outside the mark.
 */
function isStickyInlineEl(el: Element | null | undefined): el is HTMLElement {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false
  const tag = (el as HTMLElement).tagName
  // Prefer CODE first; also leave links the same way.
  return tag === 'CODE' || tag === 'A'
}

function stickyInlineAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null)
  // Innermost sticky first so we exit code even when nested in other marks.
  while (el && el !== root && root.contains(el)) {
    if (isStickyInlineEl(el)) return el
    el = el.parentElement
  }
  return null
}

/** Character offsets of an element’s text content inside the contenteditable root. */
function stickyTextOffsets(
  root: HTMLElement,
  sticky: HTMLElement,
): { start: number; end: number } | null {
  try {
    const startRange = document.createRange()
    startRange.selectNodeContents(sticky)
    startRange.collapse(true)
    const endRange = document.createRange()
    endRange.selectNodeContents(sticky)
    endRange.collapse(false)
    const start = positionToOffset(root, startRange.startContainer, startRange.startOffset)
    const end = positionToOffset(root, endRange.startContainer, endRange.startOffset)
    return { start, end }
  } catch {
    return null
  }
}

/**
 * Zero-width space used as a caret parking spot outside sticky marks.
 * Empty text nodes are ignored by browsers, so Right at the end of a
 * trailing ``code`` span cannot leave without a real host character.
 * Stripped again when parsing DOM → spans (see html.ts).
 */
export const CARET_EXIT_ZWSP = '\u200b'

function isZwspOnly(text: string | null | undefined): boolean {
  if (text == null || text === '') return true
  return /^[\u200b\uFEFF]*$/.test(text)
}

/**
 * Ensure a text node exists just before/after sticky so the caret can leave.
 * When there is nothing after the mark, insert a ZWSP host so Right still exits.
 */
function ensureCaretHost(sticky: HTMLElement, side: 'before' | 'after'): Text {
  const parent = sticky.parentNode
  if (!parent) {
    return sticky.firstChild instanceof Text
      ? sticky.firstChild
      : sticky.appendChild(document.createTextNode(CARET_EXIT_ZWSP))
  }
  if (side === 'after') {
    const next = sticky.nextSibling
    if (next && next.nodeType === Node.TEXT_NODE) {
      const t = next as Text
      // Reuse empty / ZWSP-only hosts; keep real following text as-is.
      if (isZwspOnly(t.textContent)) {
        t.textContent = CARET_EXIT_ZWSP
      }
      return t
    }
    // Nothing after the code/link — create a ZWSP parking spot.
    const host = document.createTextNode(CARET_EXIT_ZWSP)
    parent.insertBefore(host, next)
    return host
  }
  const prev = sticky.previousSibling
  if (prev && prev.nodeType === Node.TEXT_NODE) {
    const t = prev as Text
    if (isZwspOnly(t.textContent)) {
      t.textContent = CARET_EXIT_ZWSP
    }
    return t
  }
  const host = document.createTextNode(CARET_EXIT_ZWSP)
  parent.insertBefore(host, sticky)
  return host
}

function placeCaretOutside(
  sticky: HTMLElement,
  side: 'before' | 'after',
  extend: boolean,
): boolean {
  const sel = window.getSelection()
  if (!sel) return false

  try {
    const host = ensureCaretHost(sticky, side)

    // Where to put the caret in the host text node:
    // - After mark: ALWAYS past any ZWSP-only host (offset = length) so one
    //   Right fully leaves ``code`` even when nothing follows the mark.
    //   For real following text (" bar"), sit at the start of that text.
    // - Before mark: sit at the start of a ZWSP-only host (offset 0), or at
    //   the end of real preceding text.
    let offset: number
    if (side === 'after') {
      if (isZwspOnly(host.textContent)) {
        host.textContent = CARET_EXIT_ZWSP
        offset = host.textContent.length // after ZWSP — fully outside on first press
      } else {
        offset = 0 // start of real text after the mark
      }
    } else if (isZwspOnly(host.textContent)) {
      host.textContent = CARET_EXIT_ZWSP
      offset = 0 // before ZWSP — fully outside on first press
    } else {
      offset = host.textContent?.length ?? 0
    }

    if (extend && sel.rangeCount > 0) {
      sel.extend(host, offset)
      return true
    }

    const range = document.createRange()
    range.setStart(host, offset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    // If the browser snapped the caret back into the sticky mark, force again.
    if (sel.focusNode && sticky.contains(sel.focusNode)) {
      host.textContent = CARET_EXIT_ZWSP
      const forced = document.createRange()
      forced.setStart(host, side === 'after' ? 1 : 0)
      forced.collapse(true)
      sel.removeAllRanges()
      sel.addRange(forced)
    }
    return true
  } catch {
    try {
      const range = document.createRange()
      if (side === 'after') range.setStartAfter(sticky)
      else range.setStartBefore(sticky)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Move caret out of an inline code/link mark when ArrowLeft/ArrowRight is pressed
 * at the mark boundary.
 *
 * Example: `` `something`| `` + Right → `` `something` | `` (after the code span).
 * Example: `` |`something` `` + Left  → `` | `something` `` (before the code span).
 *
 * @returns true if the caret was moved (caller should preventDefault).
 */
export function tryMoveCaretAcrossInlineBoundary(
  root: HTMLElement,
  direction: 'left' | 'right',
  options?: { extend?: boolean },
): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  if (!root.contains(sel.focusNode)) return false

  const extend = Boolean(options?.extend)
  if (!sel.isCollapsed && !extend) return false

  const focusNode = sel.focusNode
  if (!focusNode) return false

  const sticky = stickyInlineAncestor(focusNode, root)
  if (!sticky) return false

  // Prefer offset math — Range.toString edge checks miss some browser caret positions.
  const bounds = stickyTextOffsets(root, sticky)
  const caret = getSelectionOffsets(root)

  /** True when no more text remains inside sticky after the caret. */
  const noTextAfterCaretInSticky = (): boolean => {
    try {
      const after = document.createRange()
      after.setStart(sel.focusNode!, sel.focusOffset)
      after.setEnd(sticky, sticky.childNodes.length)
      return stripZwsp(after.toString()).length === 0
    } catch {
      return false
    }
  }
  const noTextBeforeCaretInSticky = (): boolean => {
    try {
      const before = document.createRange()
      before.setStart(sticky, 0)
      before.setEnd(sel.focusNode!, sel.focusOffset)
      return stripZwsp(before.toString()).length === 0
    } catch {
      return false
    }
  }

  if (direction === 'right') {
    const atEnd =
      (caret && bounds && caret.end >= bounds.end) || noTextAfterCaretInSticky()
    if (!atEnd) return false
    // Always exit — even when the code/link is the last thing in the block
    // (inserts a ZWSP host so the caret has somewhere to land).
    return placeCaretOutside(sticky, 'after', extend)
  }

  // direction === 'left'
  const atStart =
    (caret && bounds && caret.start <= bounds.start) || noTextBeforeCaretInSticky()
  if (!atStart) return false
  return placeCaretOutside(sticky, 'before', extend)
}

function stripZwsp(text: string): string {
  return text.replace(/[\u200b\uFEFF]/g, '')
}

/** Sticky ``code`` / link under the caret, if any. */
export function stickyInlineAtCaret(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel?.focusNode || !root.contains(sel.focusNode)) return null
  return stickyInlineAncestor(sel.focusNode, root)
}

/** True when there is non-ZWSP text after `node` inside `root`. */
export function hasRealTextAfterNode(root: HTMLElement, node: Node): boolean {
  try {
    const range = document.createRange()
    range.setStartAfter(node)
    range.setEnd(root, root.childNodes.length)
    return stripZwsp(range.toString()).replace(/\n/g, '').length > 0
  } catch {
    return false
  }
}

/** True when there is non-ZWSP text before `node` inside `root`. */
export function hasRealTextBeforeNode(root: HTMLElement, node: Node): boolean {
  try {
    const range = document.createRange()
    range.setStart(root, 0)
    range.setEndBefore(node)
    return stripZwsp(range.toString()).replace(/\n/g, '').length > 0
  } catch {
    return false
  }
}

/**
 * Exit an inline code/link mark immediately (not only at the text edge).
 * Used for ArrowUp / ArrowDown so the caret does not stay trapped in ``code``.
 *
 * @returns true if the caret was inside a sticky mark and was moved out.
 */
export function tryExitStickyInline(
  root: HTMLElement,
  side: 'before' | 'after',
  options?: { extend?: boolean },
): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  if (!root.contains(sel.focusNode)) return false

  const extend = Boolean(options?.extend)
  if (!sel.isCollapsed && !extend) return false

  const sticky = stickyInlineAncestor(sel.focusNode, root)
  if (!sticky) return false

  return placeCaretOutside(sticky, side, extend)
}

const LINE_TOLERANCE = 8

export function isCaretOnFirstLine(el: HTMLElement): boolean {
  const rect = caretRect()

  if (!rect) {
return true
}

  const elRect = el.getBoundingClientRect()

  return rect.top - elRect.top < rect.height + LINE_TOLERANCE
}

export function isCaretOnLastLine(el: HTMLElement): boolean {
  const rect = caretRect()

  if (!rect) {
return true
}

  const elRect = el.getBoundingClientRect()

  return elRect.bottom - rect.bottom < rect.height + LINE_TOLERANCE
}

export function getCaretClientRect(): DOMRect | null {
  return caretRect()
}

export function getSelectionClientRect(): DOMRect | null {
  const sel = window.getSelection()

  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
return null
}

  const rect = sel.getRangeAt(0).getBoundingClientRect()

  return rect.width || rect.height ? rect : null
}

/** Client rects for a character range inside a contenteditable element. */
export function getRangeClientRects(el: HTMLElement, start: number, end: number): DOMRect[] {
  if (end <= start) {
    return []
  }

  const s = offsetToPosition(el, start)
  const e = offsetToPosition(el, end)
  const range = document.createRange()

  try {
    range.setStart(s.node, s.offset)
    range.setEnd(e.node, e.offset)
  } catch {
    return []
  }

  return Array.from(range.getClientRects())
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y)
  }

  const pos = doc.caretPositionFromPoint?.(x, y)

  if (!pos) {
    return null
  }

  const range = document.createRange()

  try {
    range.setStart(pos.offsetNode, pos.offset)
    range.collapse(true)
  } catch {
    return null
  }

  return range
}

/**
 * When the pointer is between blocks / on chrome, pick the nearest text block
 * by vertical distance and map X to an offset inside its contenteditable.
 */
function nearestTextPointFromClient(
  rootEl: HTMLElement,
  x: number,
  y: number,
): { blockId: string; offset: number } | null {
  const hosts = rootEl.querySelectorAll<HTMLElement>('[data-block-id]')
  let best: { el: HTMLElement; dist: number } | null = null

  for (const host of hosts) {
    if (!rootEl.contains(host)) continue
    if (!host.querySelector('.etb')) continue
    const r = host.getBoundingClientRect()
    if (r.height <= 0 && r.width <= 0) continue
    // Distance to the block box (0 if inside). Prefer the containing block, then nearest.
    let dist = 0
    if (y < r.top) dist = r.top - y
    else if (y > r.bottom) dist = y - r.bottom
    if (x < r.left) dist = Math.hypot(dist, r.left - x)
    else if (x > r.right) dist = Math.hypot(dist, x - r.right)
    // Slight bias toward the block that contains the pointer.
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) dist -= 0.5
    if (!best || dist < best.dist) best = { el: host, dist }
  }

  if (!best) return null
  const blockId = best.el.getAttribute('data-block-id')
  if (!blockId) return null
  const editable = best.el.querySelector('.etb') as HTMLElement | null
  if (!editable) return null

  const er = editable.getBoundingClientRect()
  // Clamp into the editable; when far left/right still pick a sensible column.
  const sampleX = Math.min(Math.max(x, er.left + 1), Math.max(er.left + 1, er.right - 1))
  const sampleY = Math.min(Math.max(y, er.top + 1), Math.max(er.top + 1, er.bottom - 1))
  const range = caretRangeFromPoint(sampleX, sampleY)
  if (range && editable.contains(range.startContainer)) {
    return {
      blockId,
      offset: positionToOffset(editable, range.startContainer, range.startOffset),
    }
  }

  // Fallback: start / mid / end of the line based on Y + X within the block.
  const textLen = editable.textContent?.length ?? 0
  if (textLen === 0) return { blockId, offset: 0 }
  if (y < er.top + 2) return { blockId, offset: 0 }
  if (y > er.bottom - 2) return { blockId, offset: textLen }
  // Horizontal: left third → start-ish, right third → end-ish, else try mid.
  const t = (sampleX - er.left) / Math.max(1, er.width)
  if (t < 0.25) return { blockId, offset: 0 }
  if (t > 0.75) return { blockId, offset: textLen }
  return { blockId, offset: Math.round(textLen / 2) }
}

/** Map pointer coordinates to a block id + text offset inside `rootEl`. */
export function caretPointFromClient(
  rootEl: HTMLElement,
  x: number,
  y: number,
): { blockId: string; offset: number } | null {
  const range = caretRangeFromPoint(x, y)

  if (range && rootEl.contains(range.startContainer)) {
    const blockEl = (range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement
    )?.closest('[data-block-id]')

    if (blockEl && rootEl.contains(blockEl)) {
      const blockId = blockEl.getAttribute('data-block-id')
      const editable = blockEl.querySelector('.etb') as HTMLElement | null

      if (blockId && editable) {
        // Prefer precise caret when the hit is inside the editable.
        if (editable.contains(range.startContainer) || range.startContainer === editable) {
          return {
            blockId,
            offset: positionToOffset(editable, range.startContainer, range.startOffset),
          }
        }
        // Hit block chrome / padding — still bind to this block via a clamped caret.
        const er = editable.getBoundingClientRect()
        const sampleX = Math.min(Math.max(x, er.left + 1), Math.max(er.left + 1, er.right - 1))
        const sampleY = Math.min(Math.max(y, er.top + 1), Math.max(er.top + 1, er.bottom - 1))
        const inner = caretRangeFromPoint(sampleX, sampleY)
        if (inner && editable.contains(inner.startContainer)) {
          return {
            blockId,
            offset: positionToOffset(editable, inner.startContainer, inner.startOffset),
          }
        }
        const textLen = editable.textContent?.length ?? 0
        return { blockId, offset: y <= (er.top + er.bottom) / 2 ? 0 : textLen }
      }
    }
  }

  return nearestTextPointFromClient(rootEl, x, y)
}
