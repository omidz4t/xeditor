import type { Block, TextPoint } from '@xproeditor/core'
import {
  buildRegExp,
  countMatches,
  findAllMatches,
  nextMatch,
  parseExCommand,
  type TextMatch,
} from './cmdline'
import {
  clampOffset,
  findChar,
  findNextWordStart,
  findNextWORDStart,
  findPrevWordStart,
  findPrevWORDStart,
  findWordEnd,
  findWORDEnd,
  firstNonBlank,
} from './motions'

export type VimModeName =
  | 'normal'
  | 'insert'
  | 'visual'
  | 'visual-line'
  | 'replace'
  | 'operator-pending'
  | 'cmdline'

export type VimRegister = {
  /** Plain text (linewise includes trailing newlines between blocks). */
  text: string
  linewise: boolean
}

export type VimEngineState = {
  mode: VimModeName
  /** Pending operator: d / y / c / > / < */
  operator: string | null
  /** Numeric prefix (e.g. 3 for 3w). */
  count: number
  /** After f/t/F/T waiting for char. */
  findPending: { key: string; till: boolean; dir: 1 | -1 } | null
  /** Last f/t for ; and , */
  lastFind: { ch: string; till: boolean; dir: 1 | -1 } | null
  /** g-prefix (gg). */
  gPending: boolean
  /** r waiting for replacement char. */
  replacePending: boolean
  /** Visual anchor. */
  visualAnchor: TextPoint | null
  /** Last yank/delete register. */
  register: VimRegister
  /** Status label for UI. */
  status: string
  /** ':' or '/' command-line buffer (without the prompt char). */
  cmdline: string
  /** Prompt character for cmdline mode. */
  cmdlinePrompt: ':' | '/'
  /** Ephemeral message shown in the status bar (Pattern not found, etc.). */
  message: string
  /** Last search pattern for n/N. */
  lastSearch: { pattern: string; ignoreCase: boolean } | null
}

export interface VimHost {
  isReadonly(): boolean
  getVisibleBlocks(): Block[]
  getBlock(id: string): Block | undefined
  getText(block: Block): string
  isTextLike(block: Block): boolean
  getCaret(): TextPoint | null
  setCaret(blockId: string, offset: number): void
  /** Inclusive visual selection in one or more blocks. */
  setVisualRange(anchor: TextPoint, focus: TextPoint, linewise: boolean): void
  clearVisual(): void
  /** Delete from a→b (ordered). Returns caret after delete. */
  deleteRange(a: TextPoint, b: TextPoint): TextPoint | null
  /** Replace [a,b) with text, place caret. */
  replaceRange(a: TextPoint, b: TextPoint, text: string): TextPoint | null
  /**
   * Replace all text in a block with plain text (marks collapsed).
   * Used by :s / :%s regex substitute.
   */
  setBlockPlainText(blockId: string, text: string, caret?: number): void
  insertText(blockId: string, offset: number, text: string): TextPoint | null
  openLineBelow(blockId: string): void
  openLineAbove(blockId: string): void
  joinWithNext(blockId: string): void
  undo(): void
  redo(): void
  indentBlock(blockId: string): void
  outdentBlock(blockId: string): void
  focusNeighbor(blockId: string, dir: 1 | -1, prefer: 'start' | 'end' | 'same-col'): void
  getBlockIndex(blockId: string): number
  focusBlockAtIndex(index: number, pos: 'start' | 'end' | number): void
  onModeChange(mode: VimModeName, status: string): void
  /** Optional clipboard sync for yank. */
  writeClipboard?(text: string): void
  /** Focus the cmdline input when entering cmdline mode. */
  focusCmdline?(): void
  /** Restore editor focus when leaving cmdline mode. */
  blurCmdline?(): void
}

function orderedPoints(a: TextPoint, b: TextPoint, blocks: Block[]): [TextPoint, TextPoint] {
  const ia = blocks.findIndex((x) => x.id === a.blockId)
  const ib = blocks.findIndex((x) => x.id === b.blockId)
  if (ia < ib) return [a, b]
  if (ia > ib) return [b, a]
  return a.offset <= b.offset ? [a, b] : [b, a]
}

export function createVimEngine(host: VimHost) {
  const state: VimEngineState = {
    mode: 'normal',
    operator: null,
    count: 0,
    findPending: null,
    lastFind: null,
    gPending: false,
    replacePending: false,
    visualAnchor: null,
    register: { text: '', linewise: false },
    status: 'NORMAL',
    cmdline: '',
    cmdlinePrompt: ':',
    message: '',
    lastSearch: null,
  }

  function modeLabel(mode: VimModeName): string {
    if (mode === 'insert') return 'INSERT'
    if (mode === 'replace') return 'REPLACE'
    if (mode === 'visual') return 'VISUAL'
    if (mode === 'visual-line') return 'V-LINE'
    if (mode === 'cmdline') return state.cmdlinePrompt === '/' ? 'SEARCH' : 'COMMAND'
    if (mode === 'operator-pending') return state.operator ? state.operator : 'NORMAL'
    return 'NORMAL'
  }

  function pendingKeys(): string {
    let s = ''
    if (state.count > 0) s += String(state.count)
    if (state.operator) s += state.operator
    if (state.gPending) s += 'g'
    if (state.findPending) s += state.findPending.key
    if (state.replacePending) s += 'r'
    return s
  }

  function notifyMode() {
    state.status = modeLabel(state.mode)
    host.onModeChange(state.mode, state.status)
  }

  function setMessage(msg: string) {
    state.message = msg
    notifyMode()
  }

  function setMode(mode: VimModeName) {
    const prev = state.mode
    state.mode = mode
    state.operator = null
    state.count = 0
    state.findPending = null
    state.gPending = false
    state.replacePending = false
    if (mode !== 'visual' && mode !== 'visual-line') {
      state.visualAnchor = null
      host.clearVisual()
    }
    if (mode !== 'cmdline') {
      state.cmdline = ''
      if (prev === 'cmdline') host.blurCmdline?.()
    }
    if (mode !== 'cmdline') {
      // keep message until next command overwrites
    }
    notifyMode()
  }

  function enterCmdline(prompt: ':' | '/') {
    state.mode = 'cmdline'
    state.cmdlinePrompt = prompt
    state.cmdline = ''
    state.operator = null
    state.count = 0
    state.findPending = null
    state.gPending = false
    state.replacePending = false
    state.message = ''
    notifyMode()
    host.focusCmdline?.()
  }

  function textBlocks(): Array<{ id: string; text: string }> {
    return host.getVisibleBlocks()
      .filter((b) => host.isTextLike(b))
      .map((b) => ({ id: b.id, text: host.getText(b) }))
  }

  function collectMatches(pattern: string, ignoreCase: boolean): TextMatch[] {
    return findAllMatches(textBlocks(), pattern, ignoreCase)
  }

  function jumpToMatch(match: TextMatch) {
    host.setCaret(match.blockId, match.start)
    if (match.end > match.start) {
      host.setVisualRange(
        { blockId: match.blockId, offset: match.start },
        { blockId: match.blockId, offset: match.end },
        false,
      )
      // Leave visual after landing? Keep selection highlight via managed range is heavy.
      // Just place caret at start of match for navigation clarity.
      host.clearVisual()
      host.setCaret(match.blockId, match.start)
    }
  }

  /**
   * @param advance when true (n/N), skip a match that starts at the caret.
   */
  function runSearch(
    pattern: string,
    ignoreCase: boolean,
    dir: 1 | -1 = 1,
    advance = false,
  ): string {
    try {
      const matches = collectMatches(pattern, ignoreCase)
      state.lastSearch = { pattern, ignoreCase }
      if (matches.length === 0) return `Pattern not found: ${pattern}`
      const caret = host.getCaret() ?? { blockId: matches[0]!.blockId, offset: 0 }
      const order = textBlocks().map((b) => b.id)
      // nextMatch uses strict > / < on offset. For a fresh `/` we pass offset-1 so a
      // match at the caret is included; for n/N we pass the caret offset as-is.
      const fromOffset = advance
        ? caret.offset
        : dir === 1
          ? caret.offset - 1
          : caret.offset + 1
      const hit = nextMatch(
        matches,
        order,
        { blockId: caret.blockId, offset: fromOffset },
        dir,
      )
      if (!hit) return `Pattern not found: ${pattern}`
      jumpToMatch(hit)
      return `${matches.length} match${matches.length === 1 ? '' : 'es'}`
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid pattern'
    }
  }

  function runSubstitute(
    pattern: string,
    replacement: string,
    flags: string,
    wholeDocument: boolean,
  ): string {
    try {
      const global = flags.includes('g')
      const ignoreCase = flags.includes('i')
      const caret = host.getCaret()
      const blocks = wholeDocument
        ? textBlocks()
        : (() => {
            if (!caret) {
              const all = textBlocks()
              return all.length ? [all[0]!] : []
            }
            const b = host.getBlock(caret.blockId)
            if (!b || !host.isTextLike(b)) return []
            return [{ id: b.id, text: host.getText(b) }]
          })()

      let total = 0
      let lastCaret: TextPoint | null = null
      for (const b of blocks) {
        if (global) {
          const re = buildRegExp(pattern, ignoreCase ? 'gi' : 'g', true)
          const n = countMatches(b.text, re)
          if (n === 0) continue
          const next = b.text.replace(re, replacement)
          host.setBlockPlainText(b.id, next, 0)
          total += n
          lastCaret = { blockId: b.id, offset: 0 }
        } else {
          const re = buildRegExp(pattern, ignoreCase ? 'i' : '', false)
          const m = b.text.match(re)
          if (!m || m.index == null) continue
          const start = m.index
          const next = b.text.replace(re, replacement)
          if (next === b.text) continue
          const caretOff = start + replacement.length
          host.setBlockPlainText(b.id, next, caretOff)
          total += 1
          lastCaret = { blockId: b.id, offset: caretOff }
          if (!wholeDocument) break
        }
      }
      if (lastCaret) host.setCaret(lastCaret.blockId, lastCaret.offset)
      if (total === 0) return `Pattern not found: ${pattern}`
      return `${total} substitution${total === 1 ? '' : 's'}`
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid pattern'
    }
  }

  function executeCmdline(): void {
    const prompt = state.cmdlinePrompt
    const raw = state.cmdline
    setMode('normal')

    if (prompt === '/') {
      if (!raw) {
        setMessage('')
        return
      }
      const msg = runSearch(raw, /\\c/.test(raw), 1)
      setMessage(msg)
      return
    }

    // ':' ex commands
    const parsed = parseExCommand(raw)
    if (parsed.kind === 'help') {
      setMessage(':%s/pat/repl/g  :s/pat/repl/  :/pat  /pat  n N  :noh')
      return
    }
    if (parsed.kind === 'nohl') {
      state.lastSearch = null
      host.clearVisual()
      setMessage('')
      return
    }
    if (parsed.kind === 'search') {
      const msg = runSearch(parsed.pattern, parsed.ignoreCase, 1)
      setMessage(msg)
      return
    }
    if (parsed.kind === 'substitute') {
      const msg = runSubstitute(
        parsed.pattern,
        parsed.replacement,
        parsed.flags,
        parsed.wholeDocument,
      )
      setMessage(msg)
      return
    }
    setMessage(parsed.message)
  }

  function handleCmdlineKey(e: KeyboardEvent): boolean {
    // Let the focused cmdline <input> handle most typing; we still intercept Esc/Enter
    // when keys arrive via document capture without targeting the input.
    if (e.key === 'Escape') {
      consume(e)
      setMode('normal')
      setMessage('')
      return true
    }
    if (e.key === 'Enter') {
      consume(e)
      executeCmdline()
      return true
    }
    // When the real input is focused, allow default typing/backspace.
    // Document-level capture still sees the event; don't swallow printable.
    if (e.key === 'Backspace') {
      // if capture fires before input updates, still ok — UI owns buffer via v-model
      return false
    }
    return false
  }

  /** Called from the UI when cmdline buffer changes. */
  function setCmdline(value: string) {
    state.cmdline = value
    notifyMode()
  }

  function getCmdline(): { prompt: ':' | '/'; value: string } {
    return { prompt: state.cmdlinePrompt, value: state.cmdline }
  }

  function resetPrefix() {
    state.count = 0
    state.gPending = false
    state.findPending = null
    state.replacePending = false
    if (state.mode === 'operator-pending') {
      state.operator = null
      setMode('normal')
    }
  }

  function takeCount(defaultCount = 1): number {
    const n = state.count > 0 ? state.count : defaultCount
    state.count = 0
    return n
  }

  function requireCaret(): TextPoint | null {
    return host.getCaret()
  }

  function blockText(blockId: string): { block: Block; text: string } | null {
    const block = host.getBlock(blockId)
    if (!block || !host.isTextLike(block)) return null
    return { block, text: host.getText(block) }
  }

  function moveTo(blockId: string, offset: number) {
    const info = blockText(blockId)
    const len = info?.text.length ?? 0
    host.setCaret(blockId, clampOffset(offset, len))
    if (state.mode === 'visual' || state.mode === 'visual-line') {
      const anchor = state.visualAnchor ?? { blockId, offset }
      refreshVisual(anchor, { blockId, offset })
    }
  }

  function refreshVisual(anchor: TextPoint, focus: TextPoint) {
    state.visualAnchor = anchor
    host.setVisualRange(anchor, focus, state.mode === 'visual-line')
  }

  function enterVisual(linewise: boolean) {
    const caret = requireCaret()
    if (!caret) return
    state.visualAnchor = { ...caret }
    setMode(linewise ? 'visual-line' : 'visual')
    refreshVisual(state.visualAnchor, caret)
  }

  function yankToRegister(text: string, linewise: boolean) {
    state.register = { text, linewise }
    host.writeClipboard?.(text)
  }

  function extractRangeText(a: TextPoint, b: TextPoint): { text: string; linewise: boolean } {
    const blocks = host.getVisibleBlocks()
    const [start, end] = orderedPoints(a, b, blocks)
    const si = blocks.findIndex((x) => x.id === start.blockId)
    const ei = blocks.findIndex((x) => x.id === end.blockId)
    if (si < 0 || ei < 0) return { text: '', linewise: false }

    if (si === ei) {
      const t = host.getText(blocks[si]!)
      return { text: t.slice(start.offset, end.offset), linewise: false }
    }

    const parts: string[] = []
    for (let i = si; i <= ei; i++) {
      const b = blocks[i]!
      if (!host.isTextLike(b)) {
        parts.push('')
        continue
      }
      const t = host.getText(b)
      if (i === si) parts.push(t.slice(start.offset))
      else if (i === ei) parts.push(t.slice(0, end.offset))
      else parts.push(t)
    }
    return { text: parts.join('\n'), linewise: true }
  }

  function applyDelete(a: TextPoint, b: TextPoint, enterInsert: boolean) {
    const blocks = host.getVisibleBlocks()
    const [start, end] = orderedPoints(a, b, blocks)
    const yanked = extractRangeText(start, end)
    yankToRegister(yanked.text, yanked.linewise)
    const caret = host.deleteRange(start, end)
    if (enterInsert) {
      setMode('insert')
      if (caret) host.setCaret(caret.blockId, caret.offset)
    } else {
      setMode('normal')
      if (caret) host.setCaret(caret.blockId, caret.offset)
    }
  }

  function applyYank(a: TextPoint, b: TextPoint) {
    const blocks = host.getVisibleBlocks()
    const [start, end] = orderedPoints(a, b, blocks)
    const yanked = extractRangeText(start, end)
    yankToRegister(yanked.text, yanked.linewise)
    setMode('normal')
    host.setCaret(start.blockId, start.offset)
  }

  function applyChange(a: TextPoint, b: TextPoint) {
    applyDelete(a, b, true)
  }

  /** Resolve a motion from caret; returns exclusive end for operators (like vim). */
  function resolveMotion(
    key: string,
    count: number,
    caret: TextPoint,
    opts?: { inclusive?: boolean },
  ): TextPoint | null {
    const info = blockText(caret.blockId)
    if (!info) return null
    const { text } = info
    const off = caret.offset
    const inclusive = opts?.inclusive ?? false

    switch (key) {
      case 'h':
        return { blockId: caret.blockId, offset: Math.max(0, off - count) }
      case 'l':
        return { blockId: caret.blockId, offset: Math.min(text.length, off + count) }
      case '0':
        return { blockId: caret.blockId, offset: 0 }
      case '^':
        return { blockId: caret.blockId, offset: firstNonBlank(text) }
      case '$':
        return { blockId: caret.blockId, offset: Math.max(0, text.length - (inclusive ? 0 : 0)) }
      case 'w':
        return { blockId: caret.blockId, offset: findNextWordStart(text, off, count) }
      case 'W':
        return { blockId: caret.blockId, offset: findNextWORDStart(text, off, count) }
      case 'b':
        return { blockId: caret.blockId, offset: findPrevWordStart(text, off, count) }
      case 'B':
        return { blockId: caret.blockId, offset: findPrevWORDStart(text, off, count) }
      case 'e': {
        const end = findWordEnd(text, off, count)
        return { blockId: caret.blockId, offset: inclusive ? end + 1 : end }
      }
      case 'E': {
        const end = findWORDEnd(text, off, count)
        return { blockId: caret.blockId, offset: inclusive ? end + 1 : end }
      }
      case 'j':
      case 'k': {
        // Line motion across blocks
        const dir = key === 'j' ? 1 : -1
        let id = caret.blockId
        for (let i = 0; i < count; i++) {
          const blocks = host.getVisibleBlocks()
          const idx = blocks.findIndex((b) => b.id === id)
          const next = blocks[idx + dir]
          if (!next) break
          id = next.id
        }
        const nb = host.getBlock(id)
        if (!nb) return null
        const t = host.isTextLike(nb) ? host.getText(nb) : ''
        return { blockId: id, offset: Math.min(off, t.length) }
      }
      case '{':
      case '}': {
        const dir = key === '}' ? 1 : -1
        let id = caret.blockId
        for (let i = 0; i < count; i++) {
          const blocks = host.getVisibleBlocks()
          const idx = blocks.findIndex((b) => b.id === id)
          let j = idx + dir
          // Skip to next "paragraph" (empty text block boundary)
          while (j >= 0 && j < blocks.length) {
            const b = blocks[j]!
            if (host.isTextLike(b) && host.getText(b).trim() === '') {
              j += dir
              continue
            }
            break
          }
          // Then advance one more paragraph group
          while (j >= 0 && j < blocks.length) {
            const b = blocks[j]!
            if (host.isTextLike(b) && host.getText(b).trim() === '') break
            j += dir
          }
          const target = blocks[Math.max(0, Math.min(blocks.length - 1, j))]
          if (!target) break
          id = target.id
        }
        return { blockId: id, offset: 0 }
      }
      default:
        return null
    }
  }

  function runOperator(op: string, from: TextPoint, to: TextPoint) {
    if (op === 'd') applyDelete(from, to, false)
    else if (op === 'y') applyYank(from, to)
    else if (op === 'c') applyChange(from, to)
    else if (op === '>') {
      const blocks = host.getVisibleBlocks()
      const [a, b] = orderedPoints(from, to, blocks)
      const si = blocks.findIndex((x) => x.id === a.blockId)
      const ei = blocks.findIndex((x) => x.id === b.blockId)
      for (let i = Math.min(si, ei); i <= Math.max(si, ei); i++) {
        const bl = blocks[i]
        if (bl) host.indentBlock(bl.id)
      }
      setMode('normal')
      host.setCaret(from.blockId, from.offset)
    } else if (op === '<') {
      const blocks = host.getVisibleBlocks()
      const [a, b] = orderedPoints(from, to, blocks)
      const si = blocks.findIndex((x) => x.id === a.blockId)
      const ei = blocks.findIndex((x) => x.id === b.blockId)
      for (let i = Math.min(si, ei); i <= Math.max(si, ei); i++) {
        const bl = blocks[i]
        if (bl) host.outdentBlock(bl.id)
      }
      setMode('normal')
      host.setCaret(from.blockId, from.offset)
    }
    state.operator = null
  }

  function lineRange(blockId: string): { a: TextPoint; b: TextPoint } | null {
    const info = blockText(blockId)
    if (!info) return null
    return {
      a: { blockId, offset: 0 },
      b: { blockId, offset: info.text.length },
    }
  }

  function multiLineRange(blockId: string, count: number): { a: TextPoint; b: TextPoint } | null {
    const blocks = host.getVisibleBlocks()
    const idx = blocks.findIndex((b) => b.id === blockId)
    if (idx < 0) return null
    const endIdx = Math.min(blocks.length - 1, idx + Math.max(1, count) - 1)
    const start = blocks[idx]!
    const end = blocks[endIdx]!
    const endText = host.isTextLike(end) ? host.getText(end) : ''
    return {
      a: { blockId: start.id, offset: 0 },
      b: { blockId: end.id, offset: endText.length },
    }
  }

  function pasteRegister(before: boolean) {
    const caret = requireCaret()
    if (!caret || !state.register.text) return
    if (state.register.linewise) {
      if (before) host.openLineAbove(caret.blockId)
      else host.openLineBelow(caret.blockId)
      const c = host.getCaret()
      if (c) {
        host.replaceRange(c, c, state.register.text.replace(/\n$/, ''))
      }
      return
    }
    // Vim p pastes after the character under the cursor; P pastes before.
    const info = blockText(caret.blockId)
    if (!info) return
    let insertAt = caret.offset
    if (!before) {
      if (caret.offset < info.text.length) insertAt = caret.offset + 1
      else insertAt = info.text.length
    }
    const next = host.insertText(caret.blockId, insertAt, state.register.text)
    if (next) host.setCaret(next.blockId, Math.max(0, next.offset - 1))
  }

  function handleInsertKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' || (e.key === '[' && e.ctrlKey && !e.metaKey && !e.altKey)) {
      e.preventDefault()
      e.stopPropagation()
      // Leave insert: move left like vim
      const caret = requireCaret()
      if (caret && caret.offset > 0) {
        host.setCaret(caret.blockId, caret.offset - 1)
      }
      setMode('normal')
      return true
    }
    // Let all other keys through to contenteditable
    return false
  }

  /** Map arrow keys to vim motions in normal/visual. */
  function mapArrowKey(key: string): string | null {
    if (key === 'ArrowLeft') return 'h'
    if (key === 'ArrowRight') return 'l'
    if (key === 'ArrowUp') return 'k'
    if (key === 'ArrowDown') return 'j'
    return null
  }

  function consume(e: KeyboardEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function handleReplaceKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      e.preventDefault()
      setMode('normal')
      return true
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      const caret = requireCaret()
      if (!caret) return true
      const info = blockText(caret.blockId)
      if (!info) return true
      const end = Math.min(info.text.length, caret.offset + 1)
      host.replaceRange(caret, { blockId: caret.blockId, offset: end }, e.key)
      host.setCaret(caret.blockId, caret.offset + 1)
      return true
    }
    return true
  }

  function handleVisualKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      e.preventDefault()
      setMode('normal')
      return true
    }

    const caret = requireCaret()
    if (!caret || !state.visualAnchor) return false

    // Counts
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey) {
      e.preventDefault()
      state.count = state.count * 10 + Number(e.key)
      return true
    }
    if (e.key === '0' && state.count > 0) {
      e.preventDefault()
      state.count = state.count * 10
      return true
    }

    const count = takeCount(1)

    if (e.key === 'd' || e.key === 'x') {
      e.preventDefault()
      applyDelete(state.visualAnchor, caret, false)
      return true
    }
    if (e.key === 'c' || e.key === 's') {
      e.preventDefault()
      applyChange(state.visualAnchor, caret)
      return true
    }
    if (e.key === 'y') {
      e.preventDefault()
      applyYank(state.visualAnchor, caret)
      return true
    }
    if (e.key === '>') {
      e.preventDefault()
      runOperator('>', state.visualAnchor, caret)
      return true
    }
    if (e.key === '<') {
      e.preventDefault()
      runOperator('<', state.visualAnchor, caret)
      return true
    }
    if (e.key === 'v') {
      e.preventDefault()
      if (state.mode === 'visual') setMode('normal')
      else {
        setMode('visual')
        refreshVisual(state.visualAnchor, caret)
      }
      return true
    }
    if (e.key === 'V') {
      e.preventDefault()
      if (state.mode === 'visual-line') setMode('normal')
      else {
        setMode('visual-line')
        refreshVisual(state.visualAnchor, caret)
      }
      return true
    }
    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault()
      // Swap anchor and focus
      const oldAnchor = state.visualAnchor
      state.visualAnchor = { ...caret }
      moveTo(oldAnchor.blockId, oldAnchor.offset)
      return true
    }

    // Motions extend selection (arrows map to hjkl)
    const motionKey = mapArrowKey(e.key) ?? e.key
    const motionKeys = ['h', 'j', 'k', 'l', 'w', 'W', 'b', 'B', 'e', 'E', '0', '^', '$', '{', '}']
    if (motionKeys.includes(motionKey)) {
      e.preventDefault()
      e.stopPropagation()
      if (motionKey === 'j' || motionKey === 'k') {
        host.focusNeighbor(caret.blockId, motionKey === 'j' ? 1 : -1, 'same-col')
        const next = host.getCaret()
        if (next && state.visualAnchor) refreshVisual(state.visualAnchor, next)
        return true
      }
      const dest = resolveMotion(motionKey, count, caret, { inclusive: true })
      if (dest) moveTo(dest.blockId, dest.offset)
      return true
    }

    if (e.key === 'g') {
      e.preventDefault()
      if (state.gPending) {
        state.gPending = false
        const blocks = host.getVisibleBlocks()
        const first = blocks[0]
        if (first) moveTo(first.id, 0)
      } else {
        state.gPending = true
      }
      return true
    }
    if (e.key === 'G') {
      e.preventDefault()
      state.gPending = false
      const blocks = host.getVisibleBlocks()
      const last = blocks[blocks.length - 1]
      if (last) {
        const t = host.isTextLike(last) ? host.getText(last) : ''
        moveTo(last.id, t.length)
      }
      return true
    }

    // f/t
    if (e.key === 'f' || e.key === 'F' || e.key === 't' || e.key === 'T') {
      e.preventDefault()
      state.findPending = {
        key: e.key,
        till: e.key === 't' || e.key === 'T',
        dir: e.key === 'f' || e.key === 't' ? 1 : -1,
      }
      return true
    }

    if (state.findPending && e.key.length === 1 && !e.ctrlKey) {
      e.preventDefault()
      const fp = state.findPending
      state.findPending = null
      const info = blockText(caret.blockId)
      if (!info) return true
      const found = findChar(info.text, caret.offset, e.key, fp.dir, fp.till, count)
      if (found != null) {
        state.lastFind = { ch: e.key, till: fp.till, dir: fp.dir }
        moveTo(caret.blockId, found)
      }
      return true
    }

    // Swallow unknown keys in visual
    if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
      e.preventDefault()
      return true
    }
    return false
  }

  function handleNormalKey(e: KeyboardEvent): boolean {
    // Allow browser/app shortcuts with Mod:
    // - Ctrl/Cmd+Z undo & Ctrl/Cmd+Y / Ctrl/Cmd+Shift+Z redo are handled by the editor
    // - Ctrl-r remains vim redo when we claim it below
    // - Ctrl-[ is Esc
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') return false
      if (k !== 'r' && e.key !== '[') return false
    }

    const key = mapArrowKey(e.key) ?? e.key
    return handleNormalKeyWithKey(e, key)
  }

  function handleNormalKeyWithKey(e: KeyboardEvent, key: string): boolean {
    if (key === 'Escape') {
      consume(e)
      resetPrefix()
      setMode('normal')
      return true
    }

    // Pending char for r / f / t
    if (state.replacePending && key.length === 1 && !e.ctrlKey) {
      consume(e)
      state.replacePending = false
      const caret = requireCaret()
      if (!caret) return true
      const info = blockText(caret.blockId)
      if (!info || info.text.length === 0) return true
      const end = Math.min(info.text.length, caret.offset + 1)
      host.replaceRange(caret, { blockId: caret.blockId, offset: end }, key)
      host.setCaret(caret.blockId, caret.offset)
      notifyMode()
      return true
    }

    if (state.findPending && key.length === 1 && !e.ctrlKey) {
      consume(e)
      const fp = state.findPending
      state.findPending = null
      const caret = requireCaret()
      if (!caret) return true
      const info = blockText(caret.blockId)
      if (!info) return true
      const count = takeCount(1)
      const found = findChar(info.text, caret.offset, key, fp.dir, fp.till, count)
      if (found != null) {
        state.lastFind = { ch: key, till: fp.till, dir: fp.dir }
        if (state.operator) {
          const op = state.operator
          state.operator = null
          const to = { blockId: caret.blockId, offset: found + (fp.dir === 1 ? 1 : 0) }
          runOperator(op, caret, to)
        } else {
          moveTo(caret.blockId, found)
        }
      }
      notifyMode()
      return true
    }

    // Count digits
    if (key >= '1' && key <= '9') {
      consume(e)
      state.count = state.count * 10 + Number(key)
      notifyMode()
      return true
    }
    if (key === '0' && state.count > 0) {
      consume(e)
      state.count = state.count * 10
      notifyMode()
      return true
    }

    const caret = requireCaret()
    if (!caret) {
      // No caret: still allow insert entry / navigation
      if (key === 'i' || key === 'a' || key === 'I' || key === 'A' || key === 'o' || key === 'O') {
        const blocks = host.getVisibleBlocks()
        const first = blocks.find((b) => host.isTextLike(b)) ?? blocks[0]
        if (first) {
          consume(e)
          host.focusBlockAtIndex(host.getBlockIndex(first.id), key === 'A' || key === 'a' ? 'end' : 'start')
          setMode('insert')
          return true
        }
      }
      if (key === 'j' || key === 'k' || key === 'G' || key === 'g') {
        const blocks = host.getVisibleBlocks()
        const first = blocks.find((b) => host.isTextLike(b)) ?? blocks[0]
        if (first) {
          consume(e)
          host.setCaret(first.id, 0)
          return handleNormalKeyWithKey(e, key)
        }
      }
      // Still swallow printable so normal mode never types into random fields in editor
      if (!e.ctrlKey && !e.metaKey && !e.altKey && key.length === 1) {
        consume(e)
        return true
      }
      return false
    }

    // gg
    if (key === 'g') {
      consume(e)
      if (state.gPending) {
        state.gPending = false
        const count = takeCount(0)
        const blocks = host.getVisibleBlocks()
        if (count > 0) {
          const idx = Math.min(blocks.length - 1, count - 1)
          const b = blocks[idx]
          if (b) moveTo(b.id, 0)
        } else {
          const first = blocks[0]
          if (first) moveTo(first.id, 0)
        }
        if (state.operator) {
          const op = state.operator
          state.operator = null
          runOperator(op, caret, host.getCaret() ?? caret)
        }
      } else {
        state.gPending = true
      }
      notifyMode()
      return true
    }

    if (key === 'G') {
      consume(e)
      state.gPending = false
      const count = takeCount(0)
      const blocks = host.getVisibleBlocks()
      let target = blocks[blocks.length - 1]
      if (count > 0) target = blocks[Math.min(blocks.length - 1, count - 1)]
      if (target) {
        const t = host.isTextLike(target) ? host.getText(target) : ''
        const dest = { blockId: target.id, offset: t.length }
        if (state.operator) {
          const op = state.operator
          state.operator = null
          runOperator(op, caret, dest)
        } else {
          moveTo(dest.blockId, dest.offset)
        }
      }
      notifyMode()
      return true
    }

    // Operators doubled: dd yy cc >> <<
    if (
      state.operator
      && (key === state.operator || (state.operator === '>' && key === '>') || (state.operator === '<' && key === '<'))
    ) {
      consume(e)
      const op = state.operator
      state.operator = null
      const count = takeCount(1)
      const range = multiLineRange(caret.blockId, count)
      if (range) runOperator(op, range.a, range.b)
      else setMode('normal')
      notifyMode()
      return true
    }

    // Start operators
    if (key === 'd' || key === 'y' || key === 'c' || key === '>' || key === '<') {
      consume(e)
      if (state.operator) {
        state.operator = null
        setMode('normal')
        return true
      }
      state.operator = key
      state.mode = 'operator-pending'
      notifyMode()
      return true
    }

    // Motions with pending operator
    if (state.operator) {
      const op = state.operator
      const motionKeys = ['h', 'j', 'k', 'l', 'w', 'W', 'b', 'B', 'e', 'E', '0', '^', '$', '{', '}']
      if (motionKeys.includes(key)) {
        consume(e)
        const count = takeCount(1)
        const dest = resolveMotion(key, count, caret, {
          inclusive: key === 'e' || key === 'E' || key === '$',
        })
        state.operator = null
        if (dest) {
          let end = dest
          if (key === 'e' || key === 'E') {
            end = { blockId: dest.blockId, offset: dest.offset }
          }
          if (key === '$') {
            const info = blockText(caret.blockId)
            end = { blockId: caret.blockId, offset: info?.text.length ?? dest.offset }
          }
          runOperator(op, caret, end)
        } else {
          setMode('normal')
        }
        notifyMode()
        return true
      }
      if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
        consume(e)
        state.findPending = {
          key,
          till: key === 't' || key === 'T',
          dir: key === 'f' || key === 't' ? 1 : -1,
        }
        notifyMode()
        return true
      }
      if (key === 'i' || key === 'a') {
        // iw / aw simplified: current word
        consume(e)
        const info = blockText(caret.blockId)
        if (!info) {
          state.operator = null
          setMode('normal')
          return true
        }
        const start = findPrevWordStart(info.text, caret.offset + 1, 1)
        const end = findWordEnd(info.text, start, 1) + 1
        state.operator = null
        runOperator(op, { blockId: caret.blockId, offset: start }, { blockId: caret.blockId, offset: end })
        notifyMode()
        return true
      }
      // cancel op on unknown
      consume(e)
      state.operator = null
      setMode('normal')
      return true
    }

    // Command-line / search
    if (key === ':') {
      consume(e)
      enterCmdline(':')
      return true
    }
    if (key === '/') {
      consume(e)
      enterCmdline('/')
      return true
    }
    if (key === 'n' || key === 'N') {
      consume(e)
      if (!state.lastSearch) {
        setMessage('No previous regular expression')
        return true
      }
      const msg = runSearch(
        state.lastSearch.pattern,
        state.lastSearch.ignoreCase,
        key === 'n' ? 1 : -1,
        true,
      )
      setMessage(msg)
      return true
    }

    // Insert-mode entries
    if (key === 'i') {
      consume(e)
      setMode('insert')
      return true
    }
    if (key === 'a') {
      consume(e)
      const info = blockText(caret.blockId)
      if (info) moveTo(caret.blockId, Math.min(info.text.length, caret.offset + 1))
      setMode('insert')
      return true
    }
    if (key === 'I') {
      consume(e)
      const info = blockText(caret.blockId)
      if (info) moveTo(caret.blockId, firstNonBlank(info.text))
      setMode('insert')
      return true
    }
    if (key === 'A') {
      consume(e)
      const info = blockText(caret.blockId)
      if (info) moveTo(caret.blockId, info.text.length)
      setMode('insert')
      return true
    }
    if (key === 'o') {
      consume(e)
      host.openLineBelow(caret.blockId)
      setMode('insert')
      return true
    }
    if (key === 'O') {
      consume(e)
      host.openLineAbove(caret.blockId)
      setMode('insert')
      return true
    }
    if (key === 's') {
      consume(e)
      const count = takeCount(1)
      const info = blockText(caret.blockId)
      if (info) {
        const end = Math.min(info.text.length, caret.offset + count)
        applyChange(caret, { blockId: caret.blockId, offset: end })
      }
      return true
    }
    if (key === 'S' || key === 'C') {
      consume(e)
      if (key === 'S') {
        const range = lineRange(caret.blockId)
        if (range) applyChange(range.a, range.b)
      } else {
        const info = blockText(caret.blockId)
        if (info) applyChange(caret, { blockId: caret.blockId, offset: info.text.length })
      }
      return true
    }
    if (key === 'R') {
      consume(e)
      setMode('replace')
      return true
    }
    if (key === 'r') {
      consume(e)
      state.replacePending = true
      notifyMode()
      return true
    }

    // Visual
    if (key === 'v') {
      consume(e)
      enterVisual(false)
      return true
    }
    if (key === 'V') {
      consume(e)
      enterVisual(true)
      return true
    }

    // Delete/yank shortcuts
    if (key === 'x') {
      consume(e)
      const count = takeCount(1)
      const info = blockText(caret.blockId)
      if (info && info.text.length > 0) {
        const end = Math.min(info.text.length, caret.offset + count)
        applyDelete(caret, { blockId: caret.blockId, offset: end }, false)
      }
      return true
    }
    if (key === 'X') {
      consume(e)
      const count = takeCount(1)
      const start = Math.max(0, caret.offset - count)
      applyDelete({ blockId: caret.blockId, offset: start }, caret, false)
      return true
    }
    if (key === 'D') {
      consume(e)
      const info = blockText(caret.blockId)
      if (info) applyDelete(caret, { blockId: caret.blockId, offset: info.text.length }, false)
      return true
    }
    if (key === 'p') {
      consume(e)
      pasteRegister(false)
      return true
    }
    if (key === 'P') {
      consume(e)
      pasteRegister(true)
      return true
    }
    if (key === 'u' && !e.ctrlKey) {
      consume(e)
      host.undo()
      return true
    }
    if (e.ctrlKey && key.toLowerCase() === 'r') {
      consume(e)
      host.redo()
      return true
    }
    if (key === 'J') {
      consume(e)
      host.joinWithNext(caret.blockId)
      return true
    }

    // f t ; ,
    if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
      consume(e)
      state.findPending = {
        key,
        till: key === 't' || key === 'T',
        dir: key === 'f' || key === 't' ? 1 : -1,
      }
      notifyMode()
      return true
    }
    if (key === ';' || key === ',') {
      consume(e)
      if (!state.lastFind) return true
      const count = takeCount(1)
      const dir = (key === ';' ? state.lastFind.dir : (-state.lastFind.dir as 1 | -1))
      const info = blockText(caret.blockId)
      if (!info) return true
      const found = findChar(info.text, caret.offset, state.lastFind.ch, dir, state.lastFind.till, count)
      if (found != null) moveTo(caret.blockId, found)
      return true
    }

    // Motions
    const motionKeys = ['h', 'j', 'k', 'l', 'w', 'W', 'b', 'B', 'e', 'E', '0', '^', '$', '{', '}']
    if (motionKeys.includes(key)) {
      consume(e)
      const count = takeCount(1)
      if (key === 'j' || key === 'k') {
        host.focusNeighbor(caret.blockId, key === 'j' ? 1 : -1, 'same-col')
        notifyMode()
        return true
      }
      const dest = resolveMotion(key, count, caret)
      if (dest) moveTo(dest.blockId, dest.offset)
      notifyMode()
      return true
    }

    // Swallow printable keys so they don't type in normal mode
    if (!e.ctrlKey && !e.metaKey && !e.altKey && key.length === 1) {
      consume(e)
      return true
    }

    // Swallow navigation keys that would otherwise move the browser caret
    if (key.startsWith('Arrow') || key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown') {
      consume(e)
      return true
    }

    return false
  }

  function handleKeydown(e: KeyboardEvent): boolean {
    if (host.isReadonly()) return false
    if (e.isComposing) return false

    if (state.mode === 'cmdline') return handleCmdlineKey(e)
    if (state.mode === 'insert') return handleInsertKey(e)
    if (state.mode === 'replace') return handleReplaceKey(e)
    if (state.mode === 'visual' || state.mode === 'visual-line') return handleVisualKey(e)
    // normal + operator-pending
    return handleNormalKey(e)
  }

  function getState(): VimEngineState {
    return state
  }

  function getPendingKeys(): string {
    return pendingKeys()
  }

  /** True when contenteditable should accept typing. */
  function allowsTextInput(): boolean {
    return state.mode === 'insert' || state.mode === 'replace'
  }

  function enable() {
    // Re-entering enable while already NORMAL still needs a clean pending state,
    // but avoid redundant mode churn that can re-enter Svelte effects.
    if (state.mode === 'normal' && !state.operator && state.count === 0 && !state.gPending) {
      notifyMode()
      return
    }
    setMode('normal')
  }

  function disable() {
    if (state.mode === 'cmdline') host.blurCmdline?.()
    if (state.mode === 'insert' && !state.operator && state.count === 0) {
      state.operator = null
      state.count = 0
      state.findPending = null
      state.gPending = false
      state.replacePending = false
      state.visualAnchor = null
      state.cmdline = ''
      state.message = ''
      host.clearVisual()
      notifyMode()
      return
    }
    setMode('insert')
    state.operator = null
    state.count = 0
    state.findPending = null
    state.gPending = false
    state.replacePending = false
    state.visualAnchor = null
    state.cmdline = ''
    state.message = ''
    host.clearVisual()
  }

  return {
    handleKeydown,
    getState,
    getPendingKeys,
    allowsTextInput,
    setMode,
    setCmdline,
    getCmdline,
    executeCmdline,
    enterCmdline,
    enable,
    disable,
  }
}

export type VimEngine = ReturnType<typeof createVimEngine>
