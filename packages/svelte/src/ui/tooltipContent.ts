/**
 * Shared tooltip content helpers: label + optional keyboard shortcut (kbd chip).
 */

export type TipContent = {
  text: string
  shortcut?: string
}

const STYLE_ID = 'xpe-hover-tooltip-style'
export const TIP_CLASS = 'xpe-hover-tooltip'

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac')
}

/** Display string for modifier shortcuts (⌘ on Apple, Ctrl elsewhere). */
export function formatModShortcut(...parts: string[]): string {
  const apple = isApplePlatform()
  const mod = apple ? '⌘' : 'Ctrl'
  return parts
    .map((part) => {
      if (part === 'Mod' || part === 'Ctrl' || part === 'Cmd') return mod
      if (part === 'Shift') return apple ? '⇧' : 'Shift'
      if (part === 'Alt') return apple ? '⌥' : 'Alt'
      return part
    })
    .join(apple ? '' : '+')
}

/** Map common control labels → shortcut display (matched case-insensitively). */
const SHORTCUT_BY_LABEL: Array<{ match: RegExp; keys: string[] }> = [
  { match: /^(bold)\b/i, keys: ['Mod', 'B'] },
  { match: /^(italic)\b/i, keys: ['Mod', 'I'] },
  { match: /^(underline)\b/i, keys: ['Mod', 'U'] },
  { match: /^(strikethrough|strike)\b/i, keys: ['Mod', 'Shift', 'S'] },
  { match: /^(inline\s*code|code)\b/i, keys: ['Mod', 'M'] },
  { match: /^(undo)\b/i, keys: ['Mod', 'Z'] },
  { match: /^(redo)\b/i, keys: ['Mod', 'Shift', 'Z'] },
  { match: /^(select\s*all)\b/i, keys: ['Mod', 'A'] },
  { match: /^(command\s*palette|palette|search\s*commands)\b/i, keys: ['Mod', 'K'] },
  { match: /^(new\s*page|create\s*page)\b/i, keys: ['Mod', 'N'] },
  { match: /^(toggle\s*(left\s*)?sidebar|sidebar)\b/i, keys: ['Mod', '\\'] },
  { match: /^(toggle\s*comments?|comments?)\b/i, keys: ['Mod', 'Shift', 'C'] },
  { match: /^(keyboard\s*shortcuts|shortcuts\s*help)\b/i, keys: ['Shift', '?'] },
  { match: /^(link)\b/i, keys: [] }, // no global default
]

/** Extract "(Ctrl+B)" / "(⌘B)" from tip strings and known label lookups. */
export function resolveTipContent(
  raw: string,
  options?: { shortcut?: string | null },
): TipContent {
  let text = raw.trim()
  let shortcut = (options?.shortcut ?? '').trim() || undefined

  // "Bold (Ctrl+B) — make text strong" or "Bold (Ctrl+B)"
  const paren = text.match(/^(.*?)\s*\(([^)]+)\)\s*(?:[—–\-:]\s*(.*))?$/u)
  if (paren) {
    const head = paren[1].trim()
    const keys = paren[2].trim()
    const rest = (paren[3] ?? '').trim()
    if (keys && /(?:Ctrl|Cmd|⌘|⇧|⌥|Shift|Alt|Mod|\+)/i.test(keys)) {
      if (!shortcut) shortcut = keys
      text = rest ? `${head} — ${rest}` : head
    }
  }

  if (!shortcut) {
    for (const row of SHORTCUT_BY_LABEL) {
      if (row.keys.length && row.match.test(text)) {
        shortcut = formatModShortcut(...row.keys)
        break
      }
    }
  }

  // Normalize platform-specific spelling in embedded shortcuts
  if (shortcut) {
    shortcut = shortcut
      .replace(/\bCtrl\b/gi, isApplePlatform() ? '⌘' : 'Ctrl')
      .replace(/\bCmd\b/gi, isApplePlatform() ? '⌘' : 'Ctrl')
      .replace(/\bMod\b/gi, isApplePlatform() ? '⌘' : 'Ctrl')
    if (isApplePlatform()) {
      shortcut = shortcut.replace(/\bShift\+/gi, '⇧').replace(/\+/g, '')
    }
  }

  return { text, shortcut }
}

export function ensureTooltipStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .${TIP_CLASS} {
      position: fixed;
      z-index: 10080;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      max-width: min(300px, calc(100vw - 16px));
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid var(--xpe-popover-border, var(--settings-panel-border, #e9e9e7));
      background: var(--xpe-popover-bg, var(--settings-panel-bg, #fff));
      color: var(--xpe-foreground, var(--settings-text, #37352f));
      font-size: 12px;
      font-weight: 500;
      line-height: 1.4;
      letter-spacing: 0.01em;
      box-shadow:
        0 8px 20px rgb(15 15 15 / 0.12),
        0 2px 6px rgb(15 15 15 / 0.06);
      pointer-events: none;
      opacity: 0;
      transform: translateY(2px);
      transition: opacity 0.12s ease, transform 0.12s ease;
    }
    .${TIP_CLASS}.${TIP_CLASS}--visible {
      opacity: 1;
      transform: translateY(0);
    }
    .${TIP_CLASS}__label {
      flex: 1 1 auto;
      min-width: 0;
    }
    .${TIP_CLASS}__kbd {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin: 0;
      padding: 2px 6px;
      border-radius: 5px;
      border: 1px solid var(--xpe-border, var(--settings-control-border, #e5e7eb));
      background: var(--xpe-muted, var(--settings-control-bg, #f7f6f3));
      color: var(--xpe-muted-foreground, var(--settings-muted, #6b7280));
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
  `
  document.head.appendChild(style)
}

export function fillTooltipElement(el: HTMLElement, content: TipContent): void {
  el.replaceChildren()
  el.className = TIP_CLASS
  el.setAttribute('role', 'tooltip')

  const label = document.createElement('span')
  label.className = `${TIP_CLASS}__label`
  label.textContent = content.text
  el.appendChild(label)

  if (content.shortcut) {
    const kbd = document.createElement('kbd')
    kbd.className = `${TIP_CLASS}__kbd`
    kbd.textContent = content.shortcut
    el.appendChild(kbd)
  }
}

export function placeTooltip(
  tip: HTMLElement,
  anchor: DOMRect,
  side: 'top' | 'bottom' = 'top',
): void {
  const EDGE = 8
  const GAP = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const tr = tip.getBoundingClientRect()
  let left = anchor.left + anchor.width / 2 - tr.width / 2
  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - tr.width - EDGE))

  let top: number
  if (side === 'top') {
    top = anchor.top - tr.height - GAP
    if (top < EDGE) top = anchor.bottom + GAP
  } else {
    top = anchor.bottom + GAP
    if (top + tr.height > vh - EDGE) top = anchor.top - tr.height - GAP
  }
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - tr.height - EDGE))

  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}
