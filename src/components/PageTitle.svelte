<script lang="ts">
import { tick } from 'svelte'
import Image from '@lucide/svelte/icons/image'
import MessageCircle from '@lucide/svelte/icons/message-circle'
import Smile from '@lucide/svelte/icons/smile'
import X from '@lucide/svelte/icons/x'
import { detectDir } from '@xproeditor/core'
import {
  EditorEmojiMenu,
  IconEmojiPicker,
  searchEmojis,
  type EmojiEntry,
} from '@xproeditor/svelte'
import {
  COVER_COLORS,
  COVER_PATTERNS,
  coverBackgroundStyle,
  findCoverPreset,
} from './pageCovers'
import { portal } from '../lib/portal'
import { bindUiLayer } from '../composables/useUiLayers'
import { computePhoneUi, watchPhoneUi } from '../lib/phoneUi'

let {
  // No $bindable fallbacks for optional fields — parent may pass undefined
  // (Svelte errors on bind:x={undefined} when a fallback is declared).
  value = $bindable(''),
  /** May be `null` when IconEmojiPicker removes the icon (same as Vue v-model). */
  icon = $bindable() as string | null | undefined,
  cover = $bindable() as string | undefined,
  contentFullWidth = false,
  class: className = '',
  onaddComment,
  onenter,
}: {
  value?: string
  icon?: string | null | undefined
  cover?: string | undefined
  contentFullWidth?: boolean
  class?: string
  onaddComment?: () => void
  onenter?: () => void
} = $props()

let hovered = $state(false)
let iconHovered = $state(false)
/** Touch/phone: show remove-X only after tapping the icon. */
let iconChromeOpen = $state(false)
let coverHovered = $state(false)
/** Touch/phone: show Change/Remove only after tapping the cover. */
let coverChromeOpen = $state(false)
let coverPickerOpen = $state(false)
let coverTab = $state<'color' | 'pattern'>('color')
let inputRef = $state<HTMLTextAreaElement | null>(null)
let iconPickerRef = $state<{
  openPicker: (tab?: 'emoji' | 'icon', anchor?: HTMLElement | null) => void
  close: () => void
  toggle: (anchor?: HTMLElement | null) => void
} | null>(null)
let emojiMenuRef = $state<{ move: (d: 1 | -1) => void; confirm: () => void } | null>(null)
let coverPickerRef = $state<HTMLElement | null>(null)
/** Button that opened the cover picker — used for RTL-aware fixed placement. */
let coverAnchorEl = $state<HTMLElement | null>(null)
let coverPickerStyle = $state('top:96px;left:50%;transform:translateX(-50%)')

/** `:` emoji autocomplete state (same behavior as the block editor). */
let emojiState = $state<{
  index: number
  query: string
  position: { x: number; y: number }
} | null>(null)

const showIcon = $derived(!!icon?.trim())
const showCover = $derived(!!cover?.trim() && !!findCoverPreset(cover))
/** No cover and no page icon — keep a roomy title band. */
const bareHeader = $derived(!showIcon && !showCover)
/** Svelte `style=` must be a CSS string — Vue accepts objects; objects stringify to useless CSS. */
const coverBackground = $derived(coverBackgroundStyle(cover).background ?? '')
const coverPresets = $derived(coverTab === 'color' ? COVER_COLORS : COVER_PATTERNS)
/** Always show when incomplete; when both icon+cover, reveal on header hover. */
const controlsVisible = $derived(hovered || !showIcon || !showCover)

const titleDir = $derived.by(() => {
  const t = value?.trim()
  if (!t) return 'ltr' as const
  return detectDir(t)
})

function resize() {
  const el = inputRef
  if (!el) return
  el.style.height = '0'
  el.style.height = `${el.scrollHeight}px`
}

function openIconPicker(event?: MouseEvent) {
  event?.preventDefault()
  event?.stopPropagation()
  const anchor =
    (event?.currentTarget as HTMLElement | null) ??
    (event?.target as HTMLElement | null) ??
    null
  // Prefer ref API; fall back if bind:this not ready yet.
  if (iconPickerRef?.openPicker) {
    iconPickerRef.openPicker('emoji', anchor)
  } else {
    // Force a microtask retry after mount/bind
    void tick().then(() => iconPickerRef?.openPicker?.('emoji', anchor))
  }
}

function removeIcon() {
  icon = undefined
  iconChromeOpen = false
}

function onCoverSurfaceClick(event: MouseEvent) {
  // Toggle change/remove only when tapping the cover background (not the action buttons).
  const t = event.target as HTMLElement | null
  if (t?.closest?.('.page-cover__btn') || t?.closest?.('.page-cover__actions')) return
  // Phone: click-to-toggle only. Desktop still uses hover for reveal.
  if (!isPhoneUi && coverHovered) return
  coverChromeOpen = !coverChromeOpen
  if (coverChromeOpen) iconChromeOpen = false
}

function onIconSurfacePointerDown(event: PointerEvent) {
  // Reveal remove-X on tap; desktop still uses hover. Don't block picker open.
  if (event.pointerType === 'mouse') return
  iconChromeOpen = true
  coverChromeOpen = false
}

function positionCoverPicker() {
  const panel = coverPickerRef
  if (!panel) return

  const EDGE = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(360, vw - EDGE * 2)

  // Force measurable width before reading height.
  panel.style.width = `${width}px`
  panel.style.transform = 'none'
  const height = Math.min(panel.getBoundingClientRect().height || 280, vh - EDGE * 2)

  const anchor = coverAnchorEl
  let top = 96
  let left = (vw - width) / 2

  if (anchor) {
    const rect = anchor.getBoundingClientRect()
    // Prefer the page header dir (title RTL) so controls under a Farsi title open correctly.
    const dirEl = anchor.closest('[dir]') ?? anchor
    const dir = getComputedStyle(dirEl).direction === 'rtl' ? 'rtl' : 'ltr'

    top = rect.bottom + 6
    // Align panel to the logical start of the trigger (right edge in RTL).
    left = dir === 'rtl' ? rect.right - width : rect.left

    if (top + height > vh - EDGE) {
      const above = rect.top - height - 6
      if (above >= EDGE) top = above
    }
  }

  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - width - EDGE))
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - height - EDGE))
  coverPickerStyle = `top:${top}px;left:${left}px;transform:none;width:${width}px`
}

function openCoverPicker(event?: MouseEvent) {
  event?.preventDefault()
  event?.stopPropagation()
  coverTab = cover?.startsWith('pattern:') ? 'pattern' : 'color'
  coverAnchorEl =
    (event?.currentTarget as HTMLElement | null) ??
    (event?.target as HTMLElement | null) ??
    null
  coverIgnoreOutsideUntil = Date.now() + 200
  coverPickerOpen = true
  void tick().then(() => {
    positionCoverPicker()
    requestAnimationFrame(() => positionCoverPicker())
    coverPickerRef?.focus?.()
  })
}

function closeCoverPicker() {
  coverPickerOpen = false
  coverAnchorEl = null
}

function pickCover(id: string) {
  cover = id
  closeCoverPicker()
}

function removeCover() {
  cover = undefined
  coverChromeOpen = false
  closeCoverPicker()
}

/** True for narrow / touch-first layouts (no hover-reveal for cover actions). */
let isPhoneUi = $state(false)
const showIconChrome = $derived(iconHovered || iconChromeOpen)
/** Desktop: hover (or picker). Phone: only after tap on cover background. */
const showCoverChrome = $derived(
  isPhoneUi
    ? coverChromeOpen
    : coverHovered || coverPickerOpen || coverChromeOpen,
)

function caretPosition(): { x: number; y: number } {
  const el = inputRef
  if (!el) return { x: 100, y: 100 }

  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  const mirror = document.createElement('div')
  const span = document.createElement('span')
  const text = el.value
  const pos = el.selectionStart ?? text.length

  mirror.style.cssText = [
    'position:absolute',
    'visibility:hidden',
    'white-space:pre-wrap',
    'word-wrap:break-word',
    `width:${el.clientWidth}px`,
    `font:${style.font}`,
    `letter-spacing:${style.letterSpacing}`,
    `padding:${style.padding}`,
    `border:${style.border}`,
    `line-height:${style.lineHeight}`,
    `box-sizing:${style.boxSizing}`,
  ].join(';')

  mirror.textContent = text.slice(0, pos)
  span.textContent = text.slice(pos) || '.'
  mirror.appendChild(span)
  document.body.appendChild(mirror)

  const mirrorRect = mirror.getBoundingClientRect()
  const spanRect = span.getBoundingClientRect()
  document.body.removeChild(mirror)

  const x = Math.min(
    rect.left + (spanRect.left - mirrorRect.left),
    window.innerWidth - 300,
  )
  let y = rect.top + (spanRect.top - mirrorRect.top) + spanRect.height + 6
  if (y + 320 > window.innerHeight) {
    y = Math.max(8, rect.top + (spanRect.top - mirrorRect.top) - 320)
  }
  return { x: Math.max(8, x), y }
}

function closeEmoji() {
  emojiState = null
}

function updateEmojiFromTitle() {
  const el = inputRef
  if (!el) {
    closeEmoji()
    return
  }

  const text = el.value
  const caret = el.selectionStart ?? text.length
  const state = emojiState

  if (state) {
    if (caret <= state.index || text[state.index] !== ':') {
      closeEmoji()
      return
    }

    const query = text.slice(state.index + 1, caret)

    if (query.endsWith(':') && query.length > 1) {
      const name = query.slice(0, -1)
      if (/^[a-zA-Z0-9_+-]+$/.test(name)) {
        const matches = searchEmojis(name, 8)
        const exact = matches.find((m) => m.name === name) ?? matches[0]
        if (exact) {
          applyEmoji(state.index, state.index + 1 + query.length, exact)
          return
        }
      }
      closeEmoji()
      return
    }

    if (!/^[a-zA-Z0-9_+-]*$/.test(query) || query.length > 32) {
      closeEmoji()
      return
    }

    emojiState = {
      index: state.index,
      query,
      position: caretPosition(),
    }
    return
  }

  if (caret > 0 && text[caret - 1] === ':') {
    const before = caret >= 2 ? text[caret - 2] : ''
    if (before === '' || /\s/.test(before)) {
      emojiState = {
        index: caret - 1,
        query: '',
        position: caretPosition(),
      }
    }
  }
}

function applyEmoji(from: number, to: number, item: EmojiEntry) {
  const el = inputRef
  if (!el) {
    closeEmoji()
    return
  }

  const text = el.value
  let start = from
  let end = Math.min(to, text.length)

  if (text[start] !== ':') {
    const slice = text.slice(0, Math.max(end, start + 1))
    const match = slice.match(/:([a-zA-Z0-9_+-]*)(?::)?$/)
    if (match && match.index !== undefined) {
      start = match.index
      end = match.index + match[0].length
    }
  } else {
    let i = start + 1
    while (i < text.length && /[a-zA-Z0-9_+-]/.test(text[i])) i++
    if (text[i] === ':') i++
    end = Math.max(end, i)
  }

  const next = text.slice(0, start) + item.emoji + text.slice(end)
  value = next
  closeEmoji()

  const caret = start + item.emoji.length
  void tick().then(() => {
    const input = inputRef
    if (!input) return
    input.focus()
    input.setSelectionRange(caret, caret)
    resize()
  })
}

function onEmojiSelect(item: EmojiEntry) {
  const state = emojiState
  if (!state) return
  const el = inputRef
  const text = el?.value ?? value
  let end = state.index + 1 + state.query.length
  if (text[end] === ':') end += 1
  if (text[state.index] === ':') {
    let i = state.index + 1
    while (i < text.length && /[a-zA-Z0-9_+-]/.test(text[i])) i++
    if (text[i] === ':') i++
    end = i
  }
  applyEmoji(state.index, end, item)
}

function onTitleInput(event: Event) {
  const el = event.currentTarget as HTMLTextAreaElement
  value = el.value
  resize()
  updateEmojiFromTitle()
}

// Cover picker participates in the app Escape stack (closes before sidebar).
$effect(() => {
  bindUiLayer('cover-picker', coverPickerOpen, () => {
    coverPickerOpen = false
  })
})

function onTitleKeydown(event: KeyboardEvent) {
  if (event.isComposing) return

  if (emojiState) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeEmoji()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      emojiMenuRef?.move(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      emojiMenuRef?.move(-1)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (emojiMenuRef) {
        emojiMenuRef.confirm()
      } else {
        const hits = searchEmojis(emojiState.query, 1)
        if (hits[0]) onEmojiSelect(hits[0])
        else closeEmoji()
      }
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      emojiMenuRef?.confirm()
      return
    }
  }

  // Notion: Enter or ArrowDown leaves the title and focuses the first body block.
  // (ArrowDown while the emoji menu is open is handled above.)
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    closeEmoji()
    inputRef?.blur()
    onenter?.()
    return
  }
  if (event.key === 'ArrowDown') {
    const el = inputRef
    if (el) {
      const pos = el.selectionStart ?? 0
      const end = el.value.length
      // Only leave the title when the caret is on the last line / end
      // of a multi-line title (same idea as block arrow navigation).
      const text = el.value
      const after = text.slice(pos)
      if (after.includes('\n')) return
    }
    event.preventDefault()
    closeEmoji()
    inputRef?.blur()
    onenter?.()
  }
}

function onDocMouseDown(event: MouseEvent) {
  const target = event.target as HTMLElement

  if (emojiState) {
    if (!target.closest?.('.emoji-menu') && !inputRef?.contains(target)) {
      closeEmoji()
    }
  }

  if (coverPickerOpen) {
    if (Date.now() < coverIgnoreOutsideUntil) return
    if (
      !coverPickerRef?.contains(target)
      && !target.closest?.('.notion-page-control--cover')
      && !target.closest?.('.page-cover__btn')
      && !target.closest?.('.cover-picker')
    ) {
      closeCoverPicker()
    }
  }

  // Dismiss tap-revealed cover chrome when tapping outside the cover band.
  if (
    coverChromeOpen
    && !target.closest?.('.page-cover')
    && !target.closest?.('.cover-picker')
  ) {
    coverChromeOpen = false
  }
  if (
    iconChromeOpen
    && !target.closest?.('.notion-page-icon-wrap')
    && !target.closest?.('.xpe-icon-picker')
    && !target.closest?.('[data-icon-emoji-picker]')
  ) {
    iconChromeOpen = false
  }
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && coverPickerOpen) {
    closeCoverPicker()
  }
}

$effect(() => {
  isPhoneUi = computePhoneUi()
  const stopPhone = watchPhoneUi((phone) => {
    isPhoneUi = phone
    // Never leave hover-stuck cover chrome on phone.
    if (phone) coverHovered = false
  })

  document.addEventListener('pointerdown', onDocMouseDown, true)
  document.addEventListener('keydown', onDocKeydown)
  return () => {
    stopPhone()
    document.removeEventListener('pointerdown', onDocMouseDown, true)
    document.removeEventListener('keydown', onDocKeydown)
  }
})

// While cover picker is open, ignore outside closes for one frame after open
// (opening click / portal move can otherwise race).
let coverIgnoreOutsideUntil = 0
$effect(() => {
  if (coverPickerOpen) {
    coverIgnoreOutsideUntil = Date.now() + 50
  }
})

$effect(() => {
  if (!coverPickerOpen) return
  // Re-anchor when tab changes (panel height) or viewport moves.
  void coverTab
  void tick().then(() => positionCoverPicker())
  const onReposition = () => positionCoverPicker()
  window.addEventListener('resize', onReposition)
  window.addEventListener('scroll', onReposition, true)
  return () => {
    window.removeEventListener('resize', onReposition)
    window.removeEventListener('scroll', onReposition, true)
  }
})

$effect(() => {
  void value
  void tick().then(resize)
})
</script>

<div
  class="page-title-root {className}"
  class:page-title-root--has-cover={showCover}
  class:page-title-root--has-icon={showIcon}
  class:page-title-root--content-full={contentFullWidth}
>
  {#if showCover}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="page-cover"
      style:background={coverBackground}
      style:background-size="cover"
      style:background-position="center"
      onmouseenter={() => (coverHovered = true)}
      onmouseleave={() => (coverHovered = false)}
      onclick={onCoverSurfaceClick}
      role="presentation"
    >
      <div
        class="page-cover__actions"
        class:page-cover__actions--open={showCoverChrome}
      >
        <button type="button" class="page-cover__btn" onclick={openCoverPicker}>
          Change cover
        </button>
        <button type="button" class="page-cover__btn" onclick={removeCover}>
          Remove
        </button>
      </div>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header
    class="notion-page-header"
    class:notion-page-header--has-icon={showIcon}
    class:notion-page-header--has-cover={showCover}
    class:notion-page-header--bare={bareHeader}
    dir={titleDir}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
  >
    <!--
      Trigger click is handled only by PopoverTrigger. Slot content must NOT
      call openPicker on click or the open state flips twice.
    -->
    <IconEmojiPicker
      bind:this={iconPickerRef}
      bind:value={icon}
      allowRemove
      align="start"
      side="bottom"
    >
      {#snippet trigger({ selected })}
        {#if selected}
          <div
            class="notion-page-icon-wrap"
            class:notion-page-icon-wrap--on-cover={showCover}
            onmouseenter={() => (iconHovered = true)}
            onmouseleave={() => (iconHovered = false)}
            onpointerdown={onIconSurfacePointerDown}
            role="presentation"
          >
            <button
              type="button"
              class="notion-page-icon"
              aria-label="Change page icon"
              title="Change icon"
            >
              {selected}
            </button>
            <button
              type="button"
              class="notion-page-icon-remove"
              class:notion-page-icon-remove--open={showIconChrome}
              aria-label="Remove page icon"
              title="Remove"
              onclick={(e) => {
                e.stopPropagation()
                removeIcon()
              }}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
        {:else}
          <span class="notion-page-icon-picker-anchor" aria-hidden="true"></span>
        {/if}
      {/snippet}
    </IconEmojiPicker>

    <div class="notion-page-title-block">
      <textarea
        bind:this={inputRef}
        class="notion-page-title-input"
        rows="1"
        placeholder="Untitled"
        spellcheck="true"
        aria-roledescription="page title"
        dir={titleDir}
        value={value}
        onkeydown={onTitleKeydown}
        oninput={onTitleInput}
        onclick={updateEmojiFromTitle}
        onkeyup={updateEmojiFromTitle}
      ></textarea>
    </div>

    <div
      class="notion-page-controls notion-page-controls--below-title"
      class:notion-page-controls--visible={controlsVisible}
    >
      {#if !showIcon}
        <button
          type="button"
          class="notion-page-control"
          aria-label="Add icon"
          title="Add icon"
          onclick={(e) => openIconPicker(e)}
        >
          <Smile class="notion-page-control__icon" size={14} strokeWidth={2} />
          <span class="notion-page-control__label">Add icon</span>
        </button>
      {:else}
        <button
          type="button"
          class="notion-page-control"
          aria-label="Change icon"
          title="Change icon"
          onclick={(e) => openIconPicker(e)}
        >
          <Smile class="notion-page-control__icon" size={14} strokeWidth={2} />
          <span class="notion-page-control__label">Change icon</span>
        </button>
      {/if}
      <button
        type="button"
        class="notion-page-control notion-page-control--cover"
        aria-label={showCover ? 'Change cover' : 'Add cover'}
        title={showCover ? 'Change cover' : 'Add cover'}
        onclick={(e) => openCoverPicker(e)}
      >
        <Image class="notion-page-control__icon" size={14} strokeWidth={2} />
        <span class="notion-page-control__label">{showCover ? 'Change cover' : 'Add cover'}</span>
      </button>
      <button
        type="button"
        class="notion-page-control"
        aria-label="Add comment"
        title="Add comment"
        onclick={() => onaddComment?.()}
      >
        <MessageCircle class="notion-page-control__icon" size={14} strokeWidth={2} />
        <span class="notion-page-control__label">Add comment</span>
      </button>
    </div>

    {#if emojiState}
      <EditorEmojiMenu
        bind:this={emojiMenuRef}
        query={emojiState.query}
        position={emojiState.position}
        onselect={onEmojiSelect}
        onclose={closeEmoji}
      />
    {/if}
  </header>

  {#if coverPickerOpen}
    <div
      use:portal
      bind:this={coverPickerRef}
      class="cover-picker"
      style={coverPickerStyle}
      role="dialog"
      aria-label="Choose cover"
      tabindex="-1"
      onmousedown={(e) => e.stopPropagation()}
    >
      <div class="cover-picker__header">
        <span class="cover-picker__title">Page cover</span>
        <button
          type="button"
          class="cover-picker__close"
          aria-label="Close"
          onclick={closeCoverPicker}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div class="cover-picker__tabs" role="tablist">
        <button
          type="button"
          class="cover-picker__tab"
          class:cover-picker__tab--active={coverTab === 'color'}
          role="tab"
          aria-selected={coverTab === 'color'}
          onclick={() => (coverTab = 'color')}
        >
          Colors
        </button>
        <button
          type="button"
          class="cover-picker__tab"
          class:cover-picker__tab--active={coverTab === 'pattern'}
          role="tab"
          aria-selected={coverTab === 'pattern'}
          onclick={() => (coverTab = 'pattern')}
        >
          Patterns
        </button>
      </div>

      <div class="cover-picker__grid">
        {#each coverPresets as preset (preset.id)}
          <button
            type="button"
            class="cover-picker__swatch"
            class:cover-picker__swatch--active={cover === preset.id}
            style:background={preset.background.replace(/\s+/g, ' ').trim()}
            title={preset.label}
            aria-label={preset.label}
            onclick={() => pickCover(preset.id)}
          ></button>
        {/each}
      </div>

      {#if showCover}
        <button type="button" class="cover-picker__remove" onclick={removeCover}>
          Remove cover
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>


.page-title-root {
  position: relative;
  width: 100%;
  max-width: none;
  margin: 0 0 8px;
  overflow: visible;
}

.page-title-root--has-cover {
  /* Pull cover up under the floating header islands. */
  margin-top: calc(-1 * var(--page-chrome-height, 44px));
}

/* Full-bleed cover across the main pane (outside the content container).
 * Extra height + chrome offset so the band continues under the islands. */
.page-cover {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  height: 180px;
  margin: 0;
  background-size: cover;
  background-position: center;
  overflow: hidden;
}

.page-title-root--has-cover .page-cover {
  height: calc(180px + var(--page-chrome-height, 44px));
}

.page-cover__actions {
  position: absolute;
  top: 12px;
  inset-inline-end: max(12px, var(--page-padding-x, 96px));
  display: flex;
  gap: 6px;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  transition: opacity 100ms ease;
}

.page-cover__actions--open {
  opacity: 1;
  pointer-events: auto;
}

.page-title-root--has-cover .page-cover__actions {
  /* Sit below the floating islands, still on the cover. */
  top: calc(10px + var(--page-chrome-height, 44px));
}

.page-cover__btn {
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: rgb(15 15 15 / 0.45);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  backdrop-filter: blur(8px);
  cursor: pointer;
}

.page-cover__btn:hover {
  background: rgb(15 15 15 / 0.6);
}

/*
 * Title / icon column: same max-width + horizontal padding as `.page-inner`
 * so text lines up with the body. Cover above stays full width.
 */
.notion-page-header {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--page-width, 1000px);
  margin: 0 auto;
  padding-top: 8px;
  padding-inline: calc(var(--page-padding-x, 96px) + var(--page-content-inset-start, 36px))
    calc(var(--page-padding-x, 96px) + var(--page-content-inset-end, 44px));
  color: var(--page-text);
  font-family:
    Arad,
    Shabnam,
    ui-sans-serif,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI Variable Display',
    'Segoe UI',
    Helvetica,
    'Apple Color Emoji',
    'Noto Sans Arabic',
    'Noto Sans Hebrew',
    Arial,
    sans-serif,
    'Segoe UI Emoji',
    'Segoe UI Symbol';
  pointer-events: auto;
}

.page-title-root--content-full .notion-page-header {
  max-width: none;
}

/* No cover/icon: keep a full page-header band (title + actions), not a cramped strip. */
.notion-page-header--bare {
  padding-top: max(48px, calc(var(--page-chrome-height, 44px) + 20px));
  padding-bottom: 8px;
  min-height: 7.5rem;
}

.notion-page-header--has-icon {
  padding-top: 4px;
}

.notion-page-header--has-cover {
  padding-top: 0;
}

.notion-page-icon-wrap--on-cover {
  margin-top: -42px;
  z-index: 2;
}

/*
 * Controls bar: always takes vertical space so hover doesn't jump layout.
 * Opacity only for hover reveal (pointer-events follow visibility).
 */
.notion-page-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 2px;
  min-height: 32px;
  margin-inline-start: -6px;
  margin-bottom: 2px;
  padding-top: 2px;
  padding-bottom: 4px;
  color: var(--page-controls-color, var(--page-muted));
  opacity: 0;
  pointer-events: none;
  transition: opacity 100ms ease;
}

.notion-page-controls--visible {
  opacity: 1;
  pointer-events: auto;
}

/* Icon / cover / comment actions always sit under the page title. */
.notion-page-controls--below-title {
  margin-top: 6px;
  margin-bottom: 0;
  padding-top: 0;
}

.notion-page-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1.2;
  cursor: pointer;
  transition: background 80ms ease;
}

.notion-page-control:hover:not(:disabled) {
  background: var(--page-control-hover, rgb(55 53 47 / 0.08));
}

.notion-page-control--disabled {
  cursor: default;
  opacity: 0.72;
}

.notion-page-control__icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.notion-page-icon-wrap {
  position: relative;
  display: inline-flex;
  align-self: start;
  margin-bottom: 0;
}

.notion-page-icon {
  display: block;
  margin: 0;
  padding: 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 78px;
  line-height: 1;
  cursor: pointer;
  transition: transform 120ms ease, background 80ms ease;
}

.notion-page-icon:hover {
  transform: scale(1.04);
  background: var(--page-control-hover, rgb(55 53 47 / 0.06));
}

.notion-page-icon-remove {
  position: absolute;
  top: 4px;
  inset-inline-end: 4px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: var(--page-surface, #fff);
  color: var(--page-controls-color, var(--page-muted));
  box-shadow: 0 1px 4px rgb(15 15 15 / 0.12);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 100ms ease;
}

.notion-page-icon-remove--open {
  opacity: 1;
  pointer-events: auto;
}

.notion-page-icon-remove:hover {
  color: var(--page-text);
  background: var(--page-control-hover, #f1f1ef);
}

/* Invisible anchor so "Add icon" can still open the picker via ref.open(). */
.notion-page-icon-picker-anchor {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.notion-page-title-block {
  display: flex;
  align-items: center;
}

.notion-page-title-input {
  display: block;
  width: 100%;
  margin: 0;
  padding: 3px 0;
  border: none;
  background: transparent;
  resize: none;
  overflow: hidden;
  outline: none;
  font-family: inherit;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.2;
  text-align: start;
  color: var(--page-title-color);
  caret-color: var(--xpe-primary);
}

.notion-page-title-input::placeholder {
  color: var(--page-title-placeholder);
}

/*
 * Phone styles: media query AND html[data-phone-ui] (set by phoneUi.ts).
 * iOS Delta Chat WebXDC often fails (max-width: 768px) alone.
 */
@media (max-width: 768px) {
  .notion-page-header {
    width: 100%;
    max-width: none;
    margin-inline: 0;
    padding-top: 4px;
    padding-inline: calc(var(--page-padding-x, 16px) + var(--page-content-inset-start, 8px))
      calc(var(--page-padding-x, 16px) + var(--page-content-inset-end, 8px));
  }

  .page-title-root--content-full .notion-page-header {
    max-width: none;
  }

  .notion-page-header--bare {
    padding-top: max(36px, calc(var(--page-chrome-height, 44px) + 12px));
    min-height: 6.5rem;
  }

  .notion-page-icon {
    font-size: 64px;
  }

  .notion-page-title-input {
    font-size: 36px;
    line-height: 1.15;
    letter-spacing: -0.02em;
  }

  .notion-page-controls,
  .notion-page-controls--below-title {
    opacity: 1;
    pointer-events: auto;
    min-height: 28px;
    margin-top: 4px;
    margin-bottom: 2px;
    gap: 4px;
  }

  .notion-page-control {
    gap: 0;
    padding: 6px;
    min-width: 28px;
    min-height: 28px;
    justify-content: center;
    border-radius: 6px;
    background: var(--page-control-hover, rgb(55 53 47 / 0.06));
  }

  .notion-page-control__label {
    display: none;
  }

  .notion-page-control__icon {
    width: 15px;
    height: 15px;
  }

  .page-cover__btn {
    padding: 6px 8px;
    font-size: 12px;
  }

  .page-cover {
    height: 140px;
    width: 100%;
    max-width: none;
    margin-inline: 0;
  }

  .page-title-root--has-cover .page-cover {
    height: calc(140px + var(--page-chrome-height, 44px));
  }

  .page-cover__actions {
    inset-inline-end: max(12px, env(safe-area-inset-right, 0px));
  }
}

/* Same compact rules when JS forces phone mode (iPhone WebXDC). */
:global(html[data-phone-ui]) .notion-page-header {
  width: 100%;
  max-width: none;
  margin-inline: 0;
  padding-top: 4px;
  padding-inline: calc(var(--page-padding-x, 16px) + var(--page-content-inset-start, 8px))
    calc(var(--page-padding-x, 16px) + var(--page-content-inset-end, 8px));
}

:global(html[data-phone-ui]) .page-title-root--content-full .notion-page-header {
  max-width: none;
}

:global(html[data-phone-ui]) .notion-page-header--bare {
  padding-top: max(36px, calc(var(--page-chrome-height, 44px) + 12px));
  min-height: 6.5rem;
}

:global(html[data-phone-ui]) .notion-page-icon {
  font-size: 64px;
}

:global(html[data-phone-ui]) .notion-page-title-input {
  font-size: 36px;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

:global(html[data-phone-ui]) .notion-page-controls,
:global(html[data-phone-ui]) .notion-page-controls--below-title {
  opacity: 1;
  pointer-events: auto;
  min-height: 28px;
  margin-top: 4px;
  margin-bottom: 2px;
  gap: 4px;
}

:global(html[data-phone-ui]) .notion-page-control {
  gap: 0;
  padding: 6px;
  min-width: 28px;
  min-height: 28px;
  justify-content: center;
  border-radius: 6px;
  background: var(--page-control-hover, rgb(55 53 47 / 0.06));
}

:global(html[data-phone-ui]) .notion-page-control__label {
  display: none;
}

:global(html[data-phone-ui]) .notion-page-control__icon {
  width: 15px;
  height: 15px;
}

:global(html[data-phone-ui]) .page-cover {
  height: 140px;
  width: 100%;
  max-width: none;
  margin-inline: 0;
}

:global(html[data-phone-ui]) .page-title-root--has-cover .page-cover {
  height: calc(140px + var(--page-chrome-height, 44px));
}

:global(html[data-phone-ui]) .page-cover__actions {
  inset-inline-end: max(12px, env(safe-area-inset-right, 0px));
}

/* :global so styles still apply after portal() moves the node to <body>.
 * top/left/width come from inline style (anchor-aware, RTL-safe). */
:global(.cover-picker) {
  position: fixed;
  z-index: 10050;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 24px));
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--settings-panel-border, #e9e9e7);
  border-radius: 12px;
  background: var(--settings-panel-bg, #fff);
  box-shadow: var(--settings-panel-shadow, 0 16px 40px rgb(15 15 15 / 0.16));
  color: var(--settings-text, #37352f);
}

:global(.cover-picker__header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

:global(.cover-picker__title) {
  font-size: 13px;
  font-weight: 600;
}

:global(.cover-picker__close) {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--settings-muted, #9b9a97);
  cursor: pointer;
}

:global(.cover-picker__close:hover) {
  background: var(--settings-hover, #f1f1ef);
  color: var(--settings-text, #37352f);
}

:global(.cover-picker__tabs) {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
  padding: 3px;
  border-radius: 8px;
  background: var(--settings-control-bg, #f7f6f3);
}

:global(.cover-picker__tab) {
  flex: 1;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--settings-muted, #9b9a97);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

:global(.cover-picker__tab--active) {
  background: var(--settings-control-active, #fff);
  color: var(--settings-text, #37352f);
  box-shadow: 0 1px 2px rgb(15 15 15 / 0.08);
}

:global(.cover-picker__grid) {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

:global(.cover-picker__swatch) {
  aspect-ratio: 16 / 10;
  margin: 0;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 8px;
  background-size: cover;
  background-position: center;
  cursor: pointer;
  transition: transform 0.12s, border-color 0.12s;
}

:global(.cover-picker__swatch:hover) {
  transform: scale(1.03);
}

:global(.cover-picker__swatch--active) {
  border-color: var(--xpe-primary, #2383e2);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--xpe-primary, #2383e2) 40%, transparent);
}

:global(.cover-picker__remove) {
  width: 100%;
  margin-top: 12px;
  height: 32px;
  border: 1px solid var(--settings-control-border, #e9e9e7);
  border-radius: 8px;
  background: transparent;
  color: var(--settings-muted, #9b9a97);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

:global(.cover-picker__remove:hover) {
  background: var(--settings-hover, #f1f1ef);
  color: var(--settings-text, #37352f);
}

</style>
