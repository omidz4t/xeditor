/**
 * Delayed hover tooltip (default 1s). Works on any element via `use:hoverTooltip`.
 *
 * ```svelte
 * <button use:hoverTooltip={'Bold — make text strong'}>B</button>
 * <button use:hoverTooltip={{ text: 'Bold', shortcut: '⌘B' }}>B</button>
 * ```
 *
 * Shortcuts in the text like `(Ctrl+B)` are shown as a kbd chip automatically.
 */

import {
  ensureTooltipStyles,
  fillTooltipElement,
  placeTooltip,
  resolveTipContent,
  TIP_CLASS,
  type TipContent,
} from './tooltipContent'

export type HoverTooltipParams =
  | string
  | {
      text?: string
      /** Explicit shortcut chip (also auto-detected from text / label). */
      shortcut?: string
      /** ms before show; default 1000 */
      delay?: number
      /** preferred side; default 'top' */
      side?: 'top' | 'bottom'
    }
  | null
  | undefined

const BOUND_ATTR = 'data-xpe-tooltip-bound'

function parseParams(params: HoverTooltipParams): {
  content: TipContent
  delay: number
  side: 'top' | 'bottom'
} {
  if (!params) return { content: { text: '' }, delay: 1000, side: 'top' }
  if (typeof params === 'string') {
    return { content: resolveTipContent(params), delay: 1000, side: 'top' }
  }
  const raw = (params.text ?? '').trim()
  return {
    content: resolveTipContent(raw, { shortcut: params.shortcut }),
    delay: params.delay ?? 1000,
    side: params.side ?? 'top',
  }
}

export function hoverTooltip(node: HTMLElement, params: HoverTooltipParams) {
  ensureTooltipStyles()
  // Skip global app-wide tooltips for this node (avoid double popovers).
  node.setAttribute(BOUND_ATTR, '')

  let { content, delay, side } = parseParams(params)
  let timer: ReturnType<typeof setTimeout> | null = null
  let tip: HTMLElement | null = null
  let showGen = 0

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function hide() {
    clearTimer()
    showGen++
    if (tip) {
      tip.remove()
      tip = null
    }
  }

  function show() {
    if (!content.text || tip) return
    const gen = ++showGen
    const el = document.createElement('div')
    fillTooltipElement(el, content)
    document.body.appendChild(el)
    tip = el
    placeTooltip(el, node.getBoundingClientRect(), side)
    requestAnimationFrame(() => {
      if (gen !== showGen || !tip) return
      tip.classList.add(`${TIP_CLASS}--visible`)
      placeTooltip(tip, node.getBoundingClientRect(), side)
    })
  }

  function onEnter() {
    clearTimer()
    if (!content.text) return
    timer = setTimeout(() => {
      timer = null
      show()
    }, delay)
  }

  function onLeave() {
    hide()
  }

  function onScrollOrResize() {
    if (tip) placeTooltip(tip, node.getBoundingClientRect(), side)
  }

  node.addEventListener('pointerenter', onEnter)
  node.addEventListener('pointerleave', onLeave)
  node.addEventListener('pointerdown', onLeave)
  node.addEventListener('focus', onEnter)
  node.addEventListener('blur', onLeave)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)

  return {
    update(next: HoverTooltipParams) {
      const parsed = parseParams(next)
      content = parsed.content
      delay = parsed.delay
      side = parsed.side
      node.setAttribute(BOUND_ATTR, '')
      if (tip) {
        if (!content.text) hide()
        else {
          fillTooltipElement(tip, content)
          tip.classList.add(`${TIP_CLASS}--visible`)
          placeTooltip(tip, node.getBoundingClientRect(), side)
        }
      }
    },
    destroy() {
      hide()
      node.removeAttribute(BOUND_ATTR)
      node.removeEventListener('pointerenter', onEnter)
      node.removeEventListener('pointerleave', onLeave)
      node.removeEventListener('pointerdown', onLeave)
      node.removeEventListener('focus', onEnter)
      node.removeEventListener('blur', onLeave)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    },
  }
}
