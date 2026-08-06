/**
 * Parse and execute Vim-style ex commands for this editor.
 * Supported:
 *   :s/pat/repl/flags     substitute in current block
 *   :%s/pat/repl/flags    substitute in all text blocks
 *   :/pat  or  :g/pat     search (same as /pat)
 *   :noh / :nohlsearch    clear last search
 *   :help / :h            short help message
 */

export type SubstituteCommand = {
  kind: 'substitute'
  /** true for :%s */
  wholeDocument: boolean
  pattern: string
  replacement: string
  /** raw flag chars, e.g. "gi" */
  flags: string
}

export type SearchCommand = {
  kind: 'search'
  pattern: string
  /** case-insensitive when pattern uses \c or flags include i — default false */
  ignoreCase: boolean
}

export type SimpleCommand =
  | { kind: 'nohl' }
  | { kind: 'help' }
  | { kind: 'unknown'; message: string }

export type ParsedExCommand = SubstituteCommand | SearchCommand | SimpleCommand

/** Split by separator, respecting backslash escapes. */
function splitEscaped(input: string, sep: string): string[] {
  const parts: string[] = []
  let cur = ''
  let escaped = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      // Keep backslash so JS RegExp / replacement can use escapes like \n, \1
      cur += ch
      continue
    }
    if (ch === sep) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
}

/**
 * Parse substitute: s/pat/repl/flags or %s/pat/repl/flags
 * Separator may be any non-word char (vim-style), commonly /.
 */
export function parseSubstitute(cmd: string): SubstituteCommand | null {
  const trimmed = cmd.trim()
  const m = trimmed.match(/^(%?)\s*s([^\w\s\\])([\s\S]*)$/)
  if (!m) return null
  const wholeDocument = m[1] === '%'
  const sep = m[2]!
  const rest = m[3] ?? ''
  const parts = splitEscaped(rest, sep)
  // parts: [pattern, replacement, flags?] — flags may be missing
  if (parts.length < 2) return null
  const pattern = parts[0] ?? ''
  const replacement = parts[1] ?? ''
  const flags = (parts[2] ?? '').replace(/[^gi]/g, '')
  if (!pattern) return null
  return { kind: 'substitute', wholeDocument, pattern, replacement, flags }
}

export function parseSearchFromEx(cmd: string): SearchCommand | null {
  const trimmed = cmd.trim()
  // :/pattern  :g/pattern  :g/pattern/  (flags ignored except we accept trailing /)
  let m = trimmed.match(/^(?:g\s*)?\/([\s\S]*?)(?:\/([gi]*))?$/)
  if (m && m[1] !== undefined && m[1] !== '') {
    return {
      kind: 'search',
      pattern: m[1],
      ignoreCase: (m[2] ?? '').includes('i') || /\\c/.test(m[1]),
    }
  }
  // :search pattern
  m = trimmed.match(/^(?:search|find)\s+(.+)$/i)
  if (m?.[1]) {
    return { kind: 'search', pattern: m[1].trim(), ignoreCase: false }
  }
  return null
}

export function parseExCommand(raw: string): ParsedExCommand {
  const cmd = raw.replace(/^\s*[:]+/, '').trim()
  if (!cmd) return { kind: 'unknown', message: 'Empty command' }

  if (/^noh(l(search)?)?$/i.test(cmd)) return { kind: 'nohl' }
  if (/^h(elp)?$/i.test(cmd)) return { kind: 'help' }

  const sub = parseSubstitute(cmd)
  if (sub) return sub

  const search = parseSearchFromEx(cmd)
  if (search) return search

  return {
    kind: 'unknown',
    message: `Not an editor command: ${cmd}`,
  }
}

/** Build a RegExp for search/replace. Throws on invalid pattern. */
export function buildRegExp(pattern: string, flags: string, forceGlobal = false): RegExp {
  // Strip vim \c / \C case toggles from pattern body
  let body = pattern.replace(/\\c/g, '').replace(/\\C/g, '')
  let f = flags.replace(/[^gi]/g, '')
  if (forceGlobal && !f.includes('g')) f += 'g'
  if (/\\c/.test(pattern) && !f.includes('i')) f += 'i'
  return new RegExp(body, f)
}

/** Count matches of re in text (re should have g for full count). */
export function countMatches(text: string, re: RegExp): number {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const m = text.match(global)
  return m?.length ?? 0
}

export type TextMatch = {
  blockId: string
  start: number
  end: number
}

/** Find all matches of pattern across ordered text blocks. */
export function findAllMatches(
  blocks: Array<{ id: string; text: string }>,
  pattern: string,
  ignoreCase: boolean,
): TextMatch[] {
  const re = buildRegExp(pattern, ignoreCase ? 'gi' : 'g', true)
  const out: TextMatch[] = []
  for (const b of blocks) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(b.text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      out.push({ blockId: b.id, start, end })
      if (m[0].length === 0) {
        re.lastIndex = start + 1
        if (re.lastIndex > b.text.length) break
      }
    }
  }
  return out
}

/** Next match after (blockId, offset), wrapping. */
export function nextMatch(
  matches: TextMatch[],
  blockOrder: string[],
  from: { blockId: string; offset: number },
  dir: 1 | -1,
): TextMatch | null {
  if (matches.length === 0) return null
  const orderIndex = new Map(blockOrder.map((id, i) => [id, i]))
  const ranked = matches.map((m, i) => ({
    m,
    i,
    bi: orderIndex.get(m.blockId) ?? 0,
  }))
  ranked.sort((a, b) => a.bi - b.bi || a.m.start - b.m.start || a.i - b.i)

  if (dir === 1) {
    for (const r of ranked) {
      const bi = orderIndex.get(from.blockId) ?? 0
      if (r.bi > bi || (r.bi === bi && r.m.start > from.offset)) return r.m
    }
    return ranked[0]?.m ?? null
  }

  for (let i = ranked.length - 1; i >= 0; i--) {
    const r = ranked[i]!
    const bi = orderIndex.get(from.blockId) ?? 0
    if (r.bi < bi || (r.bi === bi && r.m.start < from.offset)) return r.m
  }
  return ranked[ranked.length - 1]?.m ?? null
}
