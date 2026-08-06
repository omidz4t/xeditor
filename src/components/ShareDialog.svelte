<script lang="ts">
  import {
    shareDocumentFileToChat,
    shareWebxdcWithDocumentToChat,
  } from '../collab/share-to-chat'
  import type { CollabDocument } from '../collab/document'
  import { portal } from '../lib/portal'

  let {
    open = $bindable(false),
    getDocument,
    pageTitle,
    onBeforeShare,
  }: {
    open?: boolean
    getDocument: () => CollabDocument
    pageTitle?: string
    onBeforeShare?: () => void
  } = $props()

  let busy = $state(false)
  let error = $state('')

  function close() {
    open = false
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close()
  }

  $effect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) error = ''
    return () => {
      document.body.style.overflow = ''
    }
  })

  function showError(reason: string) {
    switch (reason) {
      case 'empty':
        error = 'Add some content before sharing.'
        break
      case 'unavailable':
        error = 'Sharing is only available inside Delta Chat.'
        break
      case 'not-packaged':
        error = 'Share as WebXDC requires the packaged app (build with make build), not the dev server.'
        break
      case 'pack-failed':
        error = 'Could not build a WebXDC package. Rebuild the app and try again.'
        break
      default:
        error = 'Sharing failed. Please try again.'
    }
  }

  async function runShare(kind: 'webxdc' | 'file') {
    if (busy) return
    busy = true
    error = ''

    try {
      onBeforeShare?.()
      const doc = getDocument()
      const result = kind === 'webxdc'
        ? await shareWebxdcWithDocumentToChat(doc, pageTitle)
        : await shareDocumentFileToChat(doc, pageTitle)

      if (!result.ok) {
        showError(result.reason)
        return
      }

      close()
    } finally {
      busy = false
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
  <div use:portal class="share-root" role="presentation" onkeydown={onKeydown}>
    <button class="share-backdrop" type="button" aria-label="Close" onclick={close}></button>

    <div class="share-panel" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <header class="share-header">
        <h2 id="share-title">Share</h2>
        <button class="share-close" type="button" aria-label="Close" onclick={close}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <div class="share-body">
        <p class="share-lead">
          Send this document to another chat. Recipients can open the attachment and collaborate on the same content.
        </p>

        <button
          class="share-action share-action--primary"
          type="button"
          disabled={busy}
          onclick={() => runShare('webxdc')}
        >
          <svg
            class="share-action__icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
            <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
          </svg>
          <span>
            <strong>Share as WebXDC</strong>
            <small>Recommended — opens ready to edit in another chat</small>
          </span>
        </button>

        <button
          class="share-action"
          type="button"
          disabled={busy}
          onclick={() => runShare('file')}
        >
          <svg
            class="share-action__icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          </svg>
          <span>
            <strong>Share document file</strong>
            <small>JSON snapshot for chats that already have this app</small>
          </span>
        </button>

        {#if error}
          <p class="share-error" role="alert">{error}</p>
        {/if}

        <p class="share-note">
          Delta Chat will ask you to pick a chat. The app may close after you confirm — your work is saved in this chat.
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  .share-root {
    position: fixed;
    inset: 0;
    z-index: 10003;
    display: grid;
    place-items: center;
    padding: 16px;
  }

  .share-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    background: var(--settings-backdrop);
    cursor: default;
  }

  .share-panel {
    position: relative;
    width: min(420px, 100%);
    border-radius: 12px;
    background: var(--settings-panel-bg);
    border: 1px solid var(--settings-panel-border);
    box-shadow: var(--settings-panel-shadow);
  }

  .share-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--settings-panel-border);
  }

  .share-header h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--settings-text);
  }

  .share-close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--settings-muted);
    cursor: pointer;
  }

  .share-close:hover {
    background: var(--settings-hover);
    color: var(--settings-text);
  }

  .share-body {
    padding: 16px;
  }

  .share-lead {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--settings-muted);
  }

  .share-action {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    margin-bottom: 8px;
    padding: 12px;
    border: 1px solid var(--settings-control-border);
    border-radius: 10px;
    background: var(--settings-control-bg);
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .share-action:hover:not(:disabled) {
    background: var(--settings-hover);
    border-color: var(--settings-panel-border);
  }

  .share-action:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .share-action--primary {
    border-color: rgb(35 131 226 / 0.35);
    background: rgb(35 131 226 / 0.08);
  }

  .share-action--primary:hover:not(:disabled) {
    background: rgb(35 131 226 / 0.12);
  }

  .share-action__icon {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--settings-text);
  }

  .share-action span {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .share-action strong {
    font-size: 13px;
    font-weight: 600;
    color: var(--settings-text);
  }

  .share-action small {
    font-size: 12px;
    line-height: 1.4;
    color: var(--settings-muted);
  }

  .share-error {
    margin: 10px 0 0;
    font-size: 12px;
    color: #e03e3e;
  }

  .share-note {
    margin: 12px 0 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--settings-muted);
  }
</style>
