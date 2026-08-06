<script lang="ts">
  import { portal } from '../lib/portal'

  let {
    open = $bindable(false),
    pageTitle,
    pageCount,
    descendantCount,
    onconfirm,
  }: {
    open?: boolean
    pageTitle?: string
    pageCount?: number
    descendantCount?: number
    onconfirm?: () => void
  } = $props()

  let confirmButtonEl: HTMLButtonElement | null = $state(null)

  const multi = $derived((pageCount ?? 1) > 1)
  const title = $derived(pageTitle?.trim() || 'Untitled')
  const dialogHeading = $derived(multi ? 'Delete pages?' : 'Delete page?')
  const confirmLabel = $derived(multi ? 'Delete pages' : 'Delete page')

  const leadDetail = $derived(
    multi
      ? 'will be permanently removed. Nested sub-pages and page links pointing to them will be cleared.'
      : 'will be permanently removed. Page blocks and links pointing to it will be cleared.',
  )

  const warning = $derived.by(() => {
    const count = descendantCount ?? 0
    if (count <= 0) return null
    if (multi) {
      return count === 1
        ? '1 additional nested sub-page will also be deleted.'
        : `${count} additional nested sub-pages will also be deleted.`
    }
    return count === 1
      ? 'This page has 1 sub-page that will also be deleted.'
      : `This page has ${count} sub-pages that will also be deleted.`
  })

  function close() {
    open = false
  }

  function confirm() {
    onconfirm?.()
    close()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      confirm()
    }
  }

  $effect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      window.setTimeout(() => confirmButtonEl?.focus(), 0)
    }
    return () => {
      document.body.style.overflow = ''
    }
  })
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
  <div use:portal class="page-delete-root" role="presentation" onkeydown={onKeydown}>
    <button class="page-delete-backdrop" type="button" aria-label="Cancel" onclick={close}></button>

    <div class="page-delete-panel" role="dialog" aria-modal="true" aria-labelledby="page-delete-title">
      <header class="page-delete-header">
        <h2 id="page-delete-title">{dialogHeading}</h2>
        <button class="page-delete-close" type="button" aria-label="Close" onclick={close}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <div class="page-delete-body">
        <p class="page-delete-lead">
          <strong>{title}</strong> {leadDetail}
        </p>

        {#if warning}
          <p class="page-delete-warning" role="status">{warning}</p>
        {/if}

        <div class="page-delete-actions">
          <button class="page-delete-btn" type="button" onclick={close}>Cancel</button>
          <button
            bind:this={confirmButtonEl}
            class="page-delete-btn page-delete-btn--danger"
            type="button"
            onclick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .page-delete-root {
    position: fixed;
    inset: 0;
    z-index: 10004;
    display: grid;
    place-items: center;
    padding: 16px;
  }

  .page-delete-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    background: var(--settings-backdrop);
    cursor: default;
  }

  .page-delete-panel {
    position: relative;
    width: min(420px, 100%);
    border-radius: 12px;
    background: var(--settings-panel-bg);
    border: 1px solid var(--settings-panel-border);
    box-shadow: var(--settings-panel-shadow);
  }

  .page-delete-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--settings-panel-border);
  }

  .page-delete-header h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--settings-text);
  }

  .page-delete-close {
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

  .page-delete-close:hover {
    background: var(--settings-hover);
    color: var(--settings-text);
  }

  .page-delete-body {
    padding: 16px;
  }

  .page-delete-lead {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--settings-muted);
  }

  .page-delete-lead strong {
    color: var(--settings-text);
    font-weight: 600;
  }

  .page-delete-warning {
    margin: 12px 0 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgb(224 62 62 / 0.08);
    border: 1px solid rgb(224 62 62 / 0.2);
    font-size: 12px;
    line-height: 1.45;
    color: #c53030;
  }

  .page-delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .page-delete-btn {
    padding: 8px 14px;
    border: 1px solid var(--settings-control-border);
    border-radius: 8px;
    background: var(--settings-control-bg);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--settings-text);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .page-delete-btn:hover {
    background: var(--settings-hover);
  }

  .page-delete-btn--danger {
    border-color: rgb(224 62 62 / 0.35);
    background: rgb(224 62 62 / 0.1);
    color: #c53030;
  }

  .page-delete-btn--danger:hover {
    background: rgb(224 62 62 / 0.16);
    border-color: rgb(224 62 62 / 0.45);
  }
</style>
