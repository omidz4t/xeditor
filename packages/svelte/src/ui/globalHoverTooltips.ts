/**
 * App-wide delayed hover tooltips for buttons and button-like controls.
 * Uses data-tooltip, data-shortcut, title, or aria-label (icon-only). Default delay: 1s.
 *
 * Elements with `data-xpe-tooltip-bound` (from use:hoverTooltip) are skipped.
 * Opt out with `data-no-tooltip`.
 */

import {
  ensureTooltipStyles,
  fillTooltipElement,
  placeTooltip,
  resolveTipContent,
  TIP_CLASS,
  type TipContent,
} from './tooltipContent'

const BOUND = 'data-xpe-tooltip-bound'
const NO_TIP = 'data-no-tooltip'
const SAVED_TITLE = 'data-xpe-saved-title'

const SELECTOR = [
  'button',
  '[role="button"]',
  'a[href].xeditor-icon-btn',
  '.ebt-btn',
  '.settings-tab',
  '.settings-select-card',
  '.settings-toggle-row',
  '.theme-toggle-btn',
  '.xeditor-icon-btn',
  '.xeditor-share-btn',
  '.xeditor-more-menu__item',
  '.context-menu-item',
  '.palette-item',
  '.slash-menu button',
  '.emoji-menu-item',
  '.xpe-icon-cell',
  '.xpe-dropdown-item',
].join(', ')

function isIconHeavy(el: HTMLElement): boolean {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text.length === 0) return true
  if (text.length <= 2 && el.querySelector('svg, img, .lucide')) return true
  return false
}

function resolveFromElement(el: HTMLElement): TipContent | null {
  const data =
    el.getAttribute('data-tooltip')?.trim()
    || el.dataset.tooltip?.trim()
  const dataShortcut =
    el.getAttribute('data-shortcut')?.trim()
    || el.dataset.shortcut?.trim()
    || ''

  let raw = data || ''

  if (!raw) {
    const saved = el.getAttribute(SAVED_TITLE)?.trim()
    if (saved) raw = saved
  }

  if (!raw) {
    const title = el.getAttribute('title')?.trim()
    if (title) {
      el.setAttribute(SAVED_TITLE, title)
      el.removeAttribute('title')
      raw = title
    }
  }

  if (!raw) {
    const aria = el.getAttribute('aria-label')?.trim()
    if (aria && isIconHeavy(el)) raw = aria
  }

  // Context menu / command rows often have a separate kbd child.
  if (!dataShortcut) {
    const kbd = el.querySelector('kbd')
    const kbdText = kbd?.textContent?.trim()
    if (kbdText) {
      const content = resolveTipContent(raw || (el.textContent ?? '').replace(kbdText, '').trim(), {
        shortcut: kbdText,
      })
      if (content.text) return content
    }
  }

  if (!raw) return null
  const content = resolveTipContent(raw, { shortcut: dataShortcut || undefined })
  return content.text ? content : null
}

function findTarget(from: EventTarget | null): HTMLElement | null {
  if (!(from instanceof Element)) return null
  const el = from.closest(SELECTOR)
  if (!(el instanceof HTMLElement)) return null
  if (el.hasAttribute(NO_TIP) || el.closest(`[${NO_TIP}]`)) return null
  if (el.hasAttribute(BOUND) || el.closest(`[${BOUND}]`)) return null
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null
  return el
}

export function installGlobalHoverTooltips(options?: { delay?: number }): () => void {
  if (typeof document === 'undefined') return () => {}
  ensureTooltipStyles()
  const delay = options?.delay ?? 1000

  let timer: ReturnType<typeof setTimeout> | null = null
  let tip: HTMLElement | null = null
  let current: HTMLElement | null = null
  let gen = 0

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function hide() {
    clearTimer()
    gen++
    current = null
    if (tip) {
      tip.remove()
      tip = null
    }
  }

  function show(el: HTMLElement, content: TipContent) {
    hide()
    current = el
    const my = ++gen
    const node = document.createElement('div')
    fillTooltipElement(node, content)
    document.body.appendChild(node)
    tip = node
    placeTooltip(node, el.getBoundingClientRect())
    requestAnimationFrame(() => {
      if (my !== gen || !tip) return
      tip.classList.add(`${TIP_CLASS}--visible`)
      placeTooltip(tip, el.getBoundingClientRect())
    })
  }

  function onOver(e: PointerEvent) {
    const el = findTarget(e.target)
    if (!el) return
    if (el === current && (tip || timer)) return
    const content = resolveFromElement(el)
    if (!content) return
    if (current && current !== el) hide()
    clearTimer()
    current = el
    timer = setTimeout(() => {
      timer = null
      if (current === el) show(el, content)
    }, delay)
  }

  function onOut(e: PointerEvent) {
    if (!current) return
    const related = e.relatedTarget
    if (related instanceof Node && current.contains(related)) return
    if (related instanceof Element && findTarget(related) === current) return
    hide()
  }

  function onDown() {
    hide()
  }

  function onScrollOrResize() {
    if (tip && current) placeTooltip(tip, current.getBoundingClientRect())
  }

  document.addEventListener('pointerover', onOver, true)
  document.addEventListener('pointerout', onOut, true)
  document.addEventListener('pointerdown', onDown, true)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)

  return () => {
    hide()
    document.removeEventListener('pointerover', onOver, true)
    document.removeEventListener('pointerout', onOut, true)
    document.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('scroll', onScrollOrResize, true)
    window.removeEventListener('resize', onScrollOrResize)
  }
}
