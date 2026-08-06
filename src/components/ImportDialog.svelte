<script lang="ts">
  import FileUp from '@lucide/svelte/icons/file-up'
  import FolderOpen from '@lucide/svelte/icons/folder-open'
  import FolderUp from '@lucide/svelte/icons/folder-up'
  import FileArchive from '@lucide/svelte/icons/file-archive'
  import FileJson from '@lucide/svelte/icons/file-json'
  import X from '@lucide/svelte/icons/x'
  import { canUseDirectoryPicker } from '../collab/import-document'
  import { portal } from '../lib/portal'

  export type ImportDialogAction =
    | 'md-files'
    | 'md-folder-native'
    | 'md-folder-legacy'
    | 'md-zip'
    | 'json-workspace'
    | 'md-replace'

  let {
    open = $bindable(false),
    busy = false,
    status = null as string | null,
    onaction,
  }: {
    open?: boolean
    busy?: boolean
    status?: string | null
    onaction?: (action: ImportDialogAction) => void | Promise<void>
  } = $props()

  const nativeFolder = $derived(canUseDirectoryPicker())

  function close() {
    if (busy) return
    open = false
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    if (busy) return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  async function run(action: ImportDialogAction) {
    if (busy) return
    await onaction?.(action)
  }

  $effect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    // Window-level capture: the dialog root is not focused, so onkeydown on the
    // panel never sees Escape unless something inside is focused.
    window.addEventListener('keydown', onWindowKeydown, true)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onWindowKeydown, true)
    }
  })
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
  <div use:portal class="import-root" role="presentation">
    <button class="import-backdrop" type="button" aria-label="Close" disabled={busy} onclick={close}></button>

    <div
      class="import-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      tabindex="-1"
    >
      <header class="import-header">
        <h2 id="import-title">Open / bind</h2>
        <button class="import-close" type="button" aria-label="Close" disabled={busy} onclick={close}>
          <X size={16} strokeWidth={2} />
        </button>
      </header>

      <div class="import-body">
        <p class="import-lead">
          Bind a local folder to edit and save with Ctrl+S, or open Markdown files, a ZIP, or a workspace snapshot.
        </p>

        <div class="import-list">
          <button
            type="button"
            class="import-option"
            disabled={busy}
            onclick={() => run('md-files')}
          >
            <span class="import-option__icon" aria-hidden="true">
              <FileUp size={18} strokeWidth={1.75} />
            </span>
            <span class="import-option__copy">
              <strong>Markdown files</strong>
              <small>Pick one or more .md files as new pages</small>
            </span>
          </button>

          {#if nativeFolder}
            <button
              type="button"
              class="import-option import-option--primary"
              disabled={busy}
              onclick={() => run('md-folder-native')}
            >
              <span class="import-option__icon" aria-hidden="true">
                <FolderOpen size={18} strokeWidth={1.75} />
              </span>
              <span class="import-option__copy">
                <strong>Bind folder</strong>
                <small>Link a local folder (read + write) — Ctrl+S saves Markdown back to disk</small>
              </span>
            </button>
          {:else}
            <button
              type="button"
              class="import-option import-option--primary"
              disabled={busy}
              onclick={() => run('md-folder-legacy')}
            >
              <span class="import-option__icon" aria-hidden="true">
                <FolderUp size={18} strokeWidth={1.75} />
              </span>
              <span class="import-option__copy">
                <strong>Open folder (read-only)</strong>
                <small>Classic directory dialog — cannot save back to disk</small>
              </span>
            </button>
          {/if}

          {#if nativeFolder}
            <button
              type="button"
              class="import-option import-option--subtle"
              disabled={busy}
              onclick={() => run('md-folder-legacy')}
            >
              <span class="import-option__icon" aria-hidden="true">
                <FolderUp size={18} strokeWidth={1.75} />
              </span>
              <span class="import-option__copy">
                <strong>Open folder (read-only)</strong>
                <small>One-shot open without binding for save</small>
              </span>
            </button>
          {/if}

          <button
            type="button"
            class="import-option"
            disabled={busy}
            onclick={() => run('md-zip')}
          >
            <span class="import-option__icon" aria-hidden="true">
              <FileArchive size={18} strokeWidth={1.75} />
            </span>
            <span class="import-option__copy">
              <strong>Markdown ZIP</strong>
              <small>Import an exported .zip of nested pages</small>
            </span>
          </button>

          <button
            type="button"
            class="import-option"
            disabled={busy}
            onclick={() => run('json-workspace')}
          >
            <span class="import-option__icon" aria-hidden="true">
              <FileJson size={18} strokeWidth={1.75} />
            </span>
            <span class="import-option__copy">
              <strong>Workspace JSON</strong>
              <small>Merge a .collab-doc.json snapshot under this page</small>
            </span>
          </button>

          <button
            type="button"
            class="import-option"
            disabled={busy}
            onclick={() => run('md-replace')}
          >
            <span class="import-option__icon" aria-hidden="true">
              <FileUp size={18} strokeWidth={1.75} />
            </span>
            <span class="import-option__copy">
              <strong>Replace current page</strong>
              <small>Overwrite this page’s body from a single .md file</small>
            </span>
          </button>
        </div>

        {#if status}
          <p class="import-status" role="status">{status}</p>
        {/if}

        <p class="import-note">
          {#if nativeFolder}
            “Open folder” uses the browser’s folder access API when available.
          {:else}
            This environment doesn’t support the modern folder picker — the classic directory dialog is used instead.
          {/if}
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  .import-root {
    position: fixed;
    inset: 0;
    z-index: 10003;
    display: grid;
    place-items: center;
    padding: 16px;
  }

  .import-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    background: var(--settings-backdrop, rgb(15 15 15 / 0.28));
    cursor: default;
  }

  .import-panel {
    position: relative;
    width: min(440px, 100%);
    max-height: min(88vh, 720px);
    overflow: auto;
    border-radius: 14px;
    background: var(--settings-panel-bg, #fff);
    border: 1px solid var(--settings-panel-border, rgb(15 15 15 / 0.06));
    box-shadow: var(--settings-panel-shadow, 0 24px 48px rgb(15 15 15 / 0.14));
    color: var(--settings-text, #37352f);
  }

  .import-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px 10px;
  }

  .import-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .import-close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--settings-muted, #9b9a97);
    cursor: pointer;
  }

  .import-close:hover:not(:disabled) {
    background: var(--settings-hover, #f1f1ef);
    color: var(--settings-text, #37352f);
  }

  .import-close:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .import-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 16px 16px;
  }

  .import-lead {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--settings-muted, #9b9a97);
  }

  .import-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .import-option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    margin: 0;
    padding: 12px;
    border: 1px solid var(--settings-control-border, #e9e9e7);
    border-radius: 12px;
    background: var(--settings-control-bg, #f7f6f3);
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      transform 0.12s ease;
  }

  .import-option:hover:not(:disabled) {
    background: var(--settings-hover, #f1f1ef);
    border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 28%, var(--settings-control-border, #e9e9e7));
  }

  .import-option:active:not(:disabled) {
    transform: scale(0.99);
  }

  .import-option:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .import-option--primary {
    background: color-mix(in srgb, var(--xpe-primary, #2383e2) 10%, var(--settings-control-bg, #f7f6f3));
    border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 30%, var(--settings-control-border, #e9e9e7));
  }

  .import-option--subtle {
    background: transparent;
  }

  .import-option__icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--settings-control-active, #fff);
    color: var(--xpe-primary, #2383e2);
    box-shadow: 0 1px 2px rgb(15 15 15 / 0.06);
  }

  .import-option__copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .import-option__copy strong {
    font-size: 13.5px;
    font-weight: 650;
  }

  .import-option__copy small {
    font-size: 12px;
    line-height: 1.35;
    color: var(--settings-muted, #9b9a97);
  }

  .import-status {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--xpe-primary, #2383e2) 10%, transparent);
    color: var(--settings-text, #37352f);
    font-size: 12.5px;
    line-height: 1.4;
  }

  .import-note {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--settings-muted, #9b9a97);
  }
</style>
