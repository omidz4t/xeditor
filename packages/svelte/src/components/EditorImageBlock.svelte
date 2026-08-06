<script lang="ts">
  import { getContext, onDestroy, tick } from 'svelte'
  import ImagePlus from '@lucide/svelte/icons/image-plus'
  import Upload from '@lucide/svelte/icons/upload'
  import Loader2 from '@lucide/svelte/icons/loader-2'
  import X from '@lucide/svelte/icons/x'
  import type { Block } from '@xproeditor/core'
  import {
    blocksToClipboardPayload,
    cloneBlock,
    fileToDataUrl,
  } from '@xproeditor/core'
  import { BLOCK_EDITOR_CTX, type BlockEditorContext } from './block-editor-context'

  let {
    block,
    selected = false,
    readonly = false,
    upload,
    pickMedia,
    onpatch,
    onselect,
  }: {
    block: Block
    selected?: boolean
    readonly?: boolean
    upload?: (file: File) => Promise<string>
    pickMedia?: (options: { accept: string[]; title?: string }) => Promise<{ url: string; alt?: string; caption?: string } | null>
    onpatch?: (patch: Record<string, unknown>) => void
    onselect?: () => void
  } = $props()

  const editorCtx = getContext<BlockEditorContext | undefined>(BLOCK_EDITOR_CTX)

  let fileInput = $state<HTMLInputElement | null>(null)
  let busy = $state(false)
  let error = $state('')
  let lightboxOpen = $state(false)
  let localWidth = $state<number | null>(null)
  let displayWidth = $derived(localWidth ?? block.props.width ?? 100)
  let contextMenu = $state<{ x: number; y: number } | null>(null)
  let contextMenuEl = $state<HTMLElement | null>(null)
  let contextStatus = $state('')

  function portalToBody(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy() { node.remove() } }
  }

  $effect(() => {
    const width = block.props.width
    if (typeof width === 'number' && width === localWidth) localWidth = null
  })

  function setWidth(width: number) {
    if (readonly) return
    localWidth = width
    onselect?.()
    onpatch?.({ width })
  }

  async function resolveFileUrl(file: File): Promise<string> {
    if (upload) return upload(file)
    return fileToDataUrl(file)
  }

  async function applyFile(file: File | null | undefined) {
    if (!file || !file.type.startsWith('image/')) {
      error = 'Please choose an image file'
      return
    }
    busy = true
    error = ''
    try {
      const url = await resolveFileUrl(file)
      onpatch?.({ url, caption: block.props.caption ?? '' })
    } catch {
      error = 'Could not load image'
    } finally {
      busy = false
      if (fileInput) fileInput.value = ''
    }
  }

  function openFilePicker() {
    if (readonly || busy) return
    onselect?.()
    fileInput?.click()
  }

  async function onUploadClick() {
    if (readonly || busy) return
    onselect?.()
    if (pickMedia) {
      busy = true
      error = ''
      try {
        const picked = await pickMedia({ accept: ['image/*'], title: 'Upload image' })
        if (picked?.url) onpatch?.({ url: picked.url, caption: picked.caption ?? block.props.caption ?? '' })
      } catch {
        error = 'Could not load image'
      } finally {
        busy = false
      }
      return
    }
    openFilePicker()
  }

  function onFileChange(event: Event) {
    void applyFile((event.target as HTMLInputElement).files?.[0])
  }

  function onDrop(event: DragEvent) {
    if (readonly || busy) return
    event.preventDefault()
    event.stopPropagation()
    void applyFile(event.dataTransfer?.files?.[0])
  }

  function onDragOver(event: DragEvent) {
    if (readonly) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function openLightbox() {
    if (block.props.url) lightboxOpen = true
  }
  function closeLightbox() { lightboxOpen = false }

  function onLightboxKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeLightbox()
    }
  }

  function closeContextMenu() {
    contextMenu = null
    contextStatus = ''
  }

  function placeContextMenu() {
    const menu = contextMenuEl
    if (!menu || !contextMenu || typeof window === 'undefined') return
    const padding = 8
    const rect = menu.getBoundingClientRect()
    let left = contextMenu.x
    let top = contextMenu.y
    if (left + rect.width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - rect.width - padding)
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = Math.max(padding, contextMenu.y - rect.height)
    }
    if (top < padding) top = padding
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  function onImageContextMenu(event: MouseEvent) {
    // Caption field keeps the native edit menu.
    const t = event.target
    if (t instanceof Element && t.closest('input, textarea, .eib-caption')) return
    if (!block.props.url && readonly) return

    event.preventDefault()
    event.stopPropagation()
    onselect?.()
    contextStatus = ''
    contextMenu = { x: event.clientX, y: event.clientY }
    void tick().then(() => {
      placeContextMenu()
      requestAnimationFrame(placeContextMenu)
    })
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        return ok
      } catch {
        return false
      }
    }
  }

  async function urlToBlob(url: string): Promise<Blob> {
    if (url.startsWith('data:')) {
      const res = await fetch(url)
      return res.blob()
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error('fetch failed')
    return res.blob()
  }

  /** Browsers often require image/png for clipboard image write. */
  async function blobAsPng(blob: Blob): Promise<Blob> {
    if (blob.type === 'image/png') return blob
    const bmp = await createImageBitmap(blob)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return blob
      ctx.drawImage(bmp, 0, 0)
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      return png ?? blob
    } finally {
      bmp.close()
    }
  }

  async function writeBlockClipboard(): Promise<boolean> {
    const live = editorCtx?.resolveBlock?.(block.id) ?? block
    const payload = blocksToClipboardPayload([cloneBlock(live, true)])
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const item: Record<string, Blob> = {
          'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' }),
        }
        await navigator.clipboard.write([new ClipboardItem(item)])
        return true
      }
    } catch {
      /* fall through */
    }
    return copyText(payload.plain || payload.json)
  }

  async function copyImagePixels(): Promise<boolean> {
    const url = block.props.url
    if (!url) return false
    try {
      const blob = await urlToBlob(url)
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          const png = await blobAsPng(blob)
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
          return true
        } catch {
          /* try original type */
          try {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
            return true
          } catch {
            /* fall through to block copy */
          }
        }
      }
    } catch {
      /* fall through */
    }
    // Fallback: still put the image block on the clipboard for in-app paste.
    return writeBlockClipboard()
  }

  async function onCtxReplace() {
    closeContextMenu()
    await onUploadClick()
  }

  async function onCtxCopyImage() {
    const ok = await copyImagePixels()
    contextStatus = ok ? 'Copied image' : 'Could not copy image'
    if (ok) closeContextMenu()
  }

  async function onCtxCopyAddress() {
    const url = block.props.url
    if (!url) return
    const ok = await copyText(url)
    contextStatus = ok ? 'Copied address' : 'Could not copy address'
    if (ok) closeContextMenu()
  }

  async function onCtxCopyBlock() {
    const ok = await writeBlockClipboard()
    contextStatus = ok ? 'Copied block' : 'Could not copy'
    if (ok) closeContextMenu()
  }

  async function onCtxCut() {
    if (readonly) return
    const ok = await writeBlockClipboard()
    if (!ok) {
      contextStatus = 'Could not cut image'
      return
    }
    // Prefer pixel copy too so paste outside the app still works.
    void copyImagePixels()
    closeContextMenu()
    const live = editorCtx?.resolveBlock?.(block.id) ?? block
    editorCtx?.removeBlock(live)
  }

  function onCtxView() {
    closeContextMenu()
    openLightbox()
  }

  function onCtxDuplicate() {
    if (readonly) return
    closeContextMenu()
    const live = editorCtx?.resolveBlock?.(block.id) ?? block
    editorCtx?.duplicateBlock(live)
  }

  function onCtxDelete() {
    if (readonly) return
    closeContextMenu()
    const live = editorCtx?.resolveBlock?.(block.id) ?? block
    editorCtx?.removeBlock(live)
  }

  function onCtxClearImage() {
    if (readonly) return
    closeContextMenu()
    onselect?.()
    onpatch?.({ url: '', caption: block.props.caption ?? '' })
  }

  async function onCtxDownload() {
    const url = block.props.url
    if (!url) return
    try {
      const blob = await urlToBlob(url)
      const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
      const name = (block.props.caption || 'image').replace(/[^\w.-]+/g, '_').slice(0, 48) || 'image'
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${name}.${ext}`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
      closeContextMenu()
    } catch {
      // Last resort: open in a new tab (data URLs may work as navigation).
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
        closeContextMenu()
      } catch {
        contextStatus = 'Could not download'
      }
    }
  }

  function onCtxSetWidth(width: number) {
    setWidth(width)
    closeContextMenu()
  }

  function onDocPointerDown(event: MouseEvent) {
    if (!contextMenu) return
    const t = event.target
    if (t instanceof Node && contextMenuEl?.contains(t)) return
    closeContextMenu()
  }

  function onDocKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && contextMenu) {
      event.preventDefault()
      closeContextMenu()
    }
  }

  $effect(() => {
    if (typeof window === 'undefined') return
    if (lightboxOpen) {
      window.addEventListener('keydown', onLightboxKeydown)
      return () => window.removeEventListener('keydown', onLightboxKeydown)
    }
  })

  $effect(() => {
    if (typeof window === 'undefined' || !contextMenu) return
    window.addEventListener('mousedown', onDocPointerDown, true)
    window.addEventListener('keydown', onDocKeydown, true)
    window.addEventListener('scroll', closeContextMenu, true)
    window.addEventListener('resize', closeContextMenu)
    return () => {
      window.removeEventListener('mousedown', onDocPointerDown, true)
      window.removeEventListener('keydown', onDocKeydown, true)
      window.removeEventListener('scroll', closeContextMenu, true)
      window.removeEventListener('resize', closeContextMenu)
    }
  })

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onLightboxKeydown)
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="eib" oncontextmenu={onImageContextMenu}>
  <input bind:this={fileInput} type="file" class="eib-file" accept="image/*" disabled={readonly || busy} onchange={onFileChange} />

  {#if !block.props.url && !readonly}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="eib-empty" class:eib-empty--selected={selected} class:eib-empty--busy={busy} onclick={() => onselect?.()} ondragover={onDragOver} ondrop={onDrop} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect?.() } }}>
      <ImagePlus class="eib-empty__icon" size={28} strokeWidth={1.5} />
      <span class="eib-empty__title">Add an image</span>
      <span class="eib-empty__hint">Upload a file or drop one here</span>
      <button type="button" class="eib-upload-btn" disabled={busy} onclick={(e) => { e.stopPropagation(); onUploadClick() }}>
        {#if busy}<Loader2 class="eib-spin" size={16} strokeWidth={2} />{:else}<Upload size={16} strokeWidth={2} />{/if}
        {busy ? 'Uploading…' : 'Upload image'}
      </button>
      {#if error}<p class="eib-error">{error}</p>{/if}
    </div>
  {:else if block.props.url}
    <figure class="eib-figure group/img" class:eib-figure--selected={selected} style:width="{displayWidth}%">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="eib-img-wrap" title="Double-click to expand" onclick={() => onselect?.()} ondblclick={(e) => { e.stopPropagation(); e.preventDefault(); openLightbox() }} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect?.() } }}>
        <img src={block.props.url} alt={block.props.caption || ''} class="eib-img" class:eib-img--selected={selected} draggable="false" />
      </div>
      {#if !readonly}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_interactive_supports_focus -->
        <div class="eib-toolbar" role="toolbar" tabindex="-1" onmousedown={(e) => { e.preventDefault(); e.stopPropagation() }} onpointerdown={(e) => e.stopPropagation()}>
          {#each [40, 60, 80, 100] as w (w)}
            <button type="button" class="eib-tool" class:eib-tool--active={displayWidth === w} aria-pressed={displayWidth === w} onclick={(e) => { e.stopPropagation(); setWidth(w) }}>{w}%</button>
          {/each}
          <button type="button" class="eib-tool" title="Replace image" disabled={busy} onclick={(e) => { e.stopPropagation(); onUploadClick() }}>Replace</button>
        </div>
      {/if}
      <div class="eib-caption">
        <input
          class="eib-caption-input"
          value={block.props.caption ?? ''}
          placeholder="Add caption..."
          {readonly}
          onfocus={() => onselect?.()}
          oninput={(e) => onpatch?.({ caption: (e.target as HTMLInputElement).value })}
          onmousedown={(e) => e.stopPropagation()}
          onclick={(e) => e.stopPropagation()}
          onpointerdown={(e) => e.stopPropagation()}
        />
      </div>
    </figure>
  {:else}
    <div class="eib-empty eib-empty--readonly"><span class="eib-empty__hint">No image</span></div>
  {/if}

  {#if lightboxOpen && block.props.url}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <div class="eib-lightbox" role="dialog" aria-modal="true" aria-label="Image preview" tabindex="-1" onclick={closeLightbox} onkeydown={(e) => { if (e.key === 'Escape') closeLightbox() }}>
      <button type="button" class="eib-lightbox__close" title="Close" aria-label="Close" onclick={(e) => { e.stopPropagation(); closeLightbox() }}><X size={24} strokeWidth={2} /></button>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <button type="button" class="eib-lightbox__img-btn" onclick={(e) => e.stopPropagation()}>
        <img src={block.props.url} alt={block.props.caption || ''} class="eib-lightbox__img" draggable="false" />
      </button>
    </div>
  {/if}

  {#if contextMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="eib-context-menu"
      role="menu"
      tabindex="-1"
      aria-label="Image options"
      style="left:{contextMenu.x}px;top:{contextMenu.y}px"
      use:portalToBody
      bind:this={contextMenuEl}
      onmousedown={(e) => e.preventDefault()}
      onpointerdown={(e) => e.stopPropagation()}
      oncontextmenu={(e) => e.preventDefault()}
    >
      {#if block.props.url}
        <div class="eib-context-menu__preview" title={block.props.caption || 'Image'}>
          <img src={block.props.url} alt="" class="eib-context-menu__thumb" draggable="false" />
          <span class="eib-context-menu__preview-label">{block.props.caption || 'Image'}</span>
        </div>

        <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxView}>
          View image
        </button>
        {#if !readonly}
          <button type="button" class="eib-context-menu__item" role="menuitem" disabled={busy} onclick={onCtxReplace}>
            Replace image…
          </button>
        {/if}

        <div class="eib-context-menu__sep" role="separator"></div>

        <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxCopyImage}>
          Copy image
        </button>
        <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxCopyAddress}>
          Copy image address
        </button>
        <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxCopyBlock}>
          Copy block
        </button>
        {#if !readonly}
          <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxCut}>
            Cut image
          </button>
        {/if}

        <div class="eib-context-menu__sep" role="separator"></div>

        <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxDownload}>
          Download image
        </button>

        {#if !readonly}
          <div class="eib-context-menu__sep" role="separator"></div>
          <div class="eib-context-menu__section-label">Width</div>
          <div class="eib-context-menu__width-row" role="group" aria-label="Image width">
            {#each [40, 60, 80, 100] as w (w)}
              <button
                type="button"
                class="eib-context-menu__width"
                class:eib-context-menu__width--active={displayWidth === w}
                aria-pressed={displayWidth === w}
                onclick={() => onCtxSetWidth(w)}
              >{w}%</button>
            {/each}
          </div>

          <div class="eib-context-menu__sep" role="separator"></div>
          <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxDuplicate}>
            Duplicate
          </button>
          <button type="button" class="eib-context-menu__item" role="menuitem" onclick={onCtxClearImage}>
            Remove image file
          </button>
          <button type="button" class="eib-context-menu__item eib-context-menu__item--danger" role="menuitem" onclick={onCtxDelete}>
            Delete block
          </button>
        {/if}
      {:else if !readonly}
        <button type="button" class="eib-context-menu__item" role="menuitem" disabled={busy} onclick={onCtxReplace}>
          Upload image…
        </button>
        <button type="button" class="eib-context-menu__item eib-context-menu__item--danger" role="menuitem" onclick={onCtxDelete}>
          Delete block
        </button>
      {/if}

      {#if contextStatus}
        <div class="eib-context-menu__status" role="status">{contextStatus}</div>
      {/if}
    </div>
  {/if}
</div>

<style>

.eib {
  margin-block: 4px;
}

.eib-file {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.eib-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 16px;
  border: 2px dashed var(--xpe-border, #e9e9e7);
  border-radius: 12px;
  background: var(--xpe-muted, #f7f6f3);
  color: var(--xpe-muted-foreground, #9b9a97);
  transition: border-color 0.12s, background 0.12s;
}

.eib-empty:hover {
  border-color: color-mix(in srgb, var(--xpe-foreground, #37352f) 22%, transparent);
}

.eib-empty--selected {
  border-color: var(--xpe-primary, #2383e2);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--xpe-primary, #2383e2) 35%, transparent);
}

.eib-empty--busy {
  opacity: 0.85;
}

.eib-empty--readonly {
  padding: 16px;
}

.eib-empty__icon {
  color: var(--xpe-muted-foreground, #9b9a97);
  opacity: 0.85;
}

.eib-empty__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--xpe-foreground, #37352f);
}

.eib-empty__hint {
  font-size: 12px;
  color: var(--xpe-muted-foreground, #9b9a97);
}

.eib-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 8px;
  background: var(--xpe-background, #fff);
  color: var(--xpe-foreground, #37352f);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.eib-upload-btn:hover:not(:disabled) {
  background: var(--xpe-hover, #f1f1ef);
  border-color: color-mix(in srgb, var(--xpe-foreground, #37352f) 18%, transparent);
}

.eib-upload-btn:disabled {
  cursor: default;
  opacity: 0.7;
}

.eib-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #ef4444;
}

.eib-spin {
  animation: eib-spin 0.8s linear infinite;
}

@keyframes eib-spin {
  to {
    transform: rotate(360deg);
  }
}

.eib-figure {
  position: relative;
  margin: 0;
  /* Instant width response when using 40/60/80/100 controls */
  max-width: 100%;
}

.eib-img-wrap {
  cursor: zoom-in;
}

.eib-img {
  display: block;
  width: 100%;
  border-radius: 12px;
  transition: box-shadow 0.12s;
  user-select: none;
}

.eib-lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 0.82);
  cursor: zoom-out;
}

.eib-lightbox__img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.45);
  object-fit: contain;
  cursor: default;
}

.eib-lightbox__close {
  position: absolute;
  top: 16px;
  inset-inline-end: 16px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.12);
  color: rgb(255 255 255 / 0.9);
  cursor: pointer;
}

.eib-lightbox__close:hover {
  background: rgb(255 255 255 / 0.2);
  color: #fff;
}

.eib-img--selected {
  box-shadow: 0 0 0 2px var(--xpe-primary, #2383e2);
}

.eib-toolbar {
  position: absolute;
  top: 8px;
  inset-inline-end: 8px;
  z-index: 3;
  display: none;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: rgb(15 15 15 / 0.62);
  backdrop-filter: blur(8px);
}

.group\/img:hover .eib-toolbar,
.eib-figure:focus-within .eib-toolbar,
.eib-figure--selected .eib-toolbar {
  display: flex;
}

.eib-tool {
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  background: transparent;
  color: rgb(255 255 255 / 0.85);
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.eib-tool:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.16);
}

.eib-tool--active {
  background: #fff;
  color: #111827;
}

.eib-tool:disabled {
  opacity: 0.5;
  cursor: default;
}

.eib-caption {
  margin: 0;
}

.eib-caption-input {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 0;
  border: none;
  background: transparent;
  text-align: center;
  font: inherit;
  font-size: 12px;
  color: var(--xpe-muted-foreground, #9b9a97);
  outline: none;
}

.eib-caption-input::placeholder {
  color: color-mix(in srgb, var(--xpe-muted-foreground, #9b9a97) 70%, transparent);
}


.eib-lightbox__img-btn {
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  cursor: default;
  max-width: 100%;
  max-height: 100%;
}
</style>
