<script lang="ts">
  import type { Block } from '@xproeditor/core'
  import BlockEditor from './BlockEditor.svelte'
  import EditorFormatToolbar from './EditorFormatToolbar.svelte'
  import type { FormatToolbarState } from './EditorFormatToolbar.svelte'

  /**
   * Drop-in editor that wires BlockEditor together with the sticky
   * format toolbar and/or the Notion-like floating bubble toolbar.
   */
  let {
    modelValue,
    toolbar = 'floating',
    upload,
    pickMedia,
    editorDir,
    readonly = false,
    pages,
    currentPageId,
    createPage,
    setPageParent,
    lockedBlocks,
    voterId,
    vimMode = false,
    onchange,
    onnavigatepage,
    oncomment,
    onfocusblock,
    resolveInternalHref,
  }: {
    modelValue: Block[]
    toolbar?: 'fixed' | 'floating' | 'both' | 'none'
    upload?: (file: File) => Promise<string>
    pickMedia?: (options: {
      accept: string[]
      title?: string
    }) => Promise<{ url: string; alt?: string; caption?: string } | null>
    editorDir?: 'ltr' | 'rtl'
    readonly?: boolean
    pages?: Array<{ id: string; title: string; icon?: string }>
    currentPageId?: string
    createPage?: (title?: string, parentId?: string) => { id: string; title: string; icon?: string }
    setPageParent?: (pageId: string, parentId: string) => void
    lockedBlocks?: Record<string, { name: string; color: string }>
    voterId?: string
    vimMode?: boolean
    onchange?: () => void
    onnavigatepage?: (pageId: string) => void
    oncomment?: (payload: {
      blockId: string
      start: number
      end: number
      quote: string
      text: string
    }) => void
    onfocusblock?: (blockId: string | null) => void
    /** Map relative / internal hrefs to page ids (bound folder + titles). */
    resolveInternalHref?: (href: string) => string | null
  } = $props()

  let editorRef: Record<string, any> | null = $state(null)
  let formatState: FormatToolbarState | null = $state(null)

  let showFixedToolbar = $derived(toolbar === 'fixed' || toolbar === 'both')
  let showBubbleToolbar = $derived(toolbar === 'floating' || toolbar === 'both')

  export function undo() {
    editorRef?.undo?.()
  }
  export function redo() {
    editorRef?.redo?.()
  }
  export function focusFirst() {
    editorRef?.focusFirst?.()
  }
  export function focusEnd() {
    editorRef?.focusEnd?.()
  }
  export function getTextCommentTarget() {
    return editorRef?.getTextCommentTarget?.() ?? null
  }
  export function openCommentOnSelection(target?: {
    blockId: string
    start: number
    end: number
    quote: string
  } | null) {
    return editorRef?.openCommentOnSelection?.(target) ?? Promise.resolve(false)
  }
</script>

<div class="xpe-pro-editor">
  {#if showFixedToolbar}
    <EditorFormatToolbar
      state={formatState}
      onmark={(mark, value) => editorRef?.applyToolbarMark?.(mark, value)}
      onturninto={(type) => editorRef?.turnIntoBlock?.(type)}
      onindent={() => editorRef?.indentFocusedBlock?.()}
      onoutdent={() => editorRef?.outdentFocusedBlock?.()}
      onalign={(align) => editorRef?.setFocusedAlign?.(align)}
      ondir={(dir) => editorRef?.setFocusedDir?.(dir)}
      oncallouticon={(icon) => editorRef?.setFocusedCalloutIcon?.(icon)}
      ontablestyle={(patch) => editorRef?.patchTableStyle?.(patch)}
      oncellbackground={(color) => editorRef?.patchTableCellBackground?.(color)}
    />
  {/if}

  <BlockEditor
    bind:this={editorRef}
    {modelValue}
    {upload}
    {pickMedia}
    {editorDir}
    {readonly}
    showBubbleToolbar={showBubbleToolbar}
    {pages}
    {currentPageId}
    {createPage}
    {setPageParent}
    {lockedBlocks}
    {voterId}
    {vimMode}
    {onchange}
    onformatstate={(s) => (formatState = s)}
    {onnavigatepage}
    {oncomment}
    {onfocusblock}
    {resolveInternalHref}
  />
</div>
