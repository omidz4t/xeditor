/**
 * @xproeditor/svelte
 *
 * Svelte 5 adapter for the XProEditor block editor.
 * Prefer named imports so bundlers can tree-shake unused components.
 *
 * ```ts
 * import { ProEditor, createBlock } from '@xproeditor/svelte'
 * import '@xproeditor/svelte/style.css'
 * ```
 *
 * Read-only / less common surfaces (DocRenderer) are separate exports so
 * highlight.js is not pulled into every app that only needs the editor.
 */

import './styles/tailwind-entry.css'

// Primary editor surface (what collab apps usually need)
export { default as ProEditor } from './components/ProEditor.svelte'
export { default as BlockEditor } from './components/BlockEditor.svelte'
export { default as EditorEmojiMenu } from './components/EditorEmojiMenu.svelte'

// Optional / secondary — keep as named exports for tree-shaking
export { default as EditorBlockItem } from './components/EditorBlockItem.svelte'
export { default as EditorTextBlock } from './components/EditorTextBlock.svelte'
export { default as EditorCodeBlock } from './components/EditorCodeBlock.svelte'
export { default as EditorImageBlock } from './components/EditorImageBlock.svelte'
export { default as EditorPollBlock } from './components/EditorPollBlock.svelte'
export { default as EditorTableBlock } from './components/EditorTableBlock.svelte'
export { default as EditorTableCell } from './components/EditorTableCell.svelte'
export { default as EditorSelectionHighlight } from './components/EditorSelectionHighlight.svelte'
export { default as EditorBubbleToolbar } from './components/EditorBubbleToolbar.svelte'
export { default as EditorFormatToolbar } from './components/EditorFormatToolbar.svelte'
export { default as EditorSlashMenu } from './components/EditorSlashMenu.svelte'
/** Pulls highlight.js (lite). Only import when you need read-only rendering. */
export { default as DocRenderer } from './components/DocRenderer.svelte'

export { default as EditorTableStylePanel } from './components/toolbar/EditorTableStylePanel.svelte'
export { default as EditorToolbarButton } from './components/toolbar/EditorToolbarButton.svelte'
export { default as EditorToolbarColorPanel } from './components/toolbar/EditorToolbarColorPanel.svelte'
export { default as EditorToolbarPopover } from './components/toolbar/EditorToolbarPopover.svelte'
export { default as EditorToolbarSeparator } from './components/toolbar/EditorToolbarSeparator.svelte'

export type { FormatToolbarAlign, FormatToolbarState } from './components/EditorFormatToolbar.svelte'
export type { SlashItem } from './components/EditorSlashMenu.svelte'

// UI primitives (tree-shake per export)
export { default as Button } from './ui/Button.svelte'
export { default as Input } from './ui/Input.svelte'
export { default as IconEmojiPicker } from './ui/IconEmojiPicker.svelte'
export { default as IconValueDisplay } from './ui/IconValueDisplay.svelte'
export { hoverTooltip } from './ui/hoverTooltip'
export type { HoverTooltipParams } from './ui/hoverTooltip'
export { installGlobalHoverTooltips } from './ui/globalHoverTooltips'
export { searchEmojis, EMOJI_CATALOG } from './ui/emojiCatalog'
export type { EmojiEntry } from './ui/emojiCatalog'
export { EMOJI_PRESETS } from './ui/emojiPresets'
export {
  DEFAULT_TEXT_COLOR,
  TEXT_COLOR_PRESETS,
  HIGHLIGHT_PRESETS,
} from './ui/colorPresets'

// Block model — re-export core for one-import convenience
export * from '@xproeditor/core'
