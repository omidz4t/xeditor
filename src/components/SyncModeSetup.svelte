<script lang="ts">
  import {
    collabModeDescription,
    collabModeLabel,
    isBrowserWebxdcMock,
    type CollabSyncMode,
  } from '../collab/sync-mode'
  import { portal } from '../lib/portal'

  let {
    open = $bindable(false),
    onselect,
  }: {
    open?: boolean
    onselect?: (mode: CollabSyncMode) => void
  } = $props()

  const options: CollabSyncMode[] = ['realtime', 'chat', 'local']
  const browserOnly = $derived(isBrowserWebxdcMock())
  let deltaModalOpen = $state(false)

  function isModeAllowed(mode: CollabSyncMode): boolean {
    if (!browserOnly) return true
    return mode === 'local'
  }

  function choose(mode: CollabSyncMode) {
    if (!isModeAllowed(mode)) {
      deltaModalOpen = true
      return
    }
    onselect?.(mode)
  }

  function showDeltaNeeded() {
    deltaModalOpen = true
  }

  function closeDeltaModal() {
    deltaModalOpen = false
  }
</script>

{#if open}
  <div use:portal class="sync-setup-root">
    <div class="sync-setup-backdrop" aria-hidden="true"></div>

    <div
      class="sync-setup-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-setup-title"
    >
      <header class="sync-setup-header">
        <h2 id="sync-setup-title">How should this app sync?</h2>
        <p class="sync-setup-lead">
          {#if browserOnly}
            This is the <strong>browser demo</strong>. Only
            <strong>Local only</strong> is available here (data stays in this
            browser’s IndexedDB). Chat and realtime sync need Delta Chat.
          {:else}
            Pick once for everyone in this chat. Your choice is shared silently
            (no chat notification). Later openers use the same mode.
          {/if}
        </p>
      </header>

      <div class="sync-setup-options" role="list">
        {#each options as mode (mode)}
          {@const allowed = isModeAllowed(mode)}
          <button
            type="button"
            class="sync-setup-option"
            class:sync-setup-option--disabled={!allowed}
            class:sync-setup-option--recommended={browserOnly && mode === 'local'}
            aria-disabled={!allowed}
            title={!allowed ? 'Requires Delta Chat' : undefined}
            onmouseenter={() => {
              if (!allowed) showDeltaNeeded()
            }}
            onfocus={() => {
              if (!allowed) showDeltaNeeded()
            }}
            onclick={() => choose(mode)}
          >
            <span class="sync-setup-option__row">
              <span class="sync-setup-option__title">{collabModeLabel(mode)}</span>
              {#if !allowed}
                <span class="sync-setup-option__badge">Delta Chat</span>
              {/if}
            </span>
            <span class="sync-setup-option__desc">{collabModeDescription(mode)}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if deltaModalOpen}
      <!-- Above the sync setup dialog -->
      <div class="delta-need-root" role="presentation">
        <button
          type="button"
          class="delta-need-backdrop"
          aria-label="Dismiss"
          onclick={closeDeltaModal}
        ></button>
        <div
          class="delta-need-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delta-need-title"
        >
          <h3 id="delta-need-title" class="delta-need-title">Install Delta Chat</h3>
          <p class="delta-need-body">
            <strong>Realtime</strong> and <strong>Chat + live</strong> sync only work
            inside a Delta Chat (or other WebXDC) host, where the app can send updates
            over the chat. This browser demo can only use <strong>Local only</strong>.
          </p>
          <p class="delta-need-body delta-need-body--muted">
            Install Delta Chat, open a chat, and send an <code>.xdc</code> from
            Releases to collaborate with others.
          </p>
          <div class="delta-need-actions">
            <a
              class="delta-need-btn delta-need-btn--primary"
              href="https://delta.chat/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get Delta Chat
            </a>
            <a
              class="delta-need-btn"
              href="https://github.com/omidz4t/xeditor/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download .xdc
            </a>
            <button type="button" class="delta-need-btn" onclick={closeDeltaModal}>
              Use local only
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .sync-setup-root {
    position: fixed;
    inset: 0;
    z-index: 12000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }

  .sync-setup-backdrop {
    position: absolute;
    inset: 0;
    background: var(--settings-backdrop, rgb(15 15 15 / 0.4));
  }

  .sync-setup-panel {
    position: relative;
    width: min(440px, 100%);
    border-radius: 14px;
    background: var(--settings-panel-bg, #fff);
    box-shadow: var(--settings-panel-shadow, 0 24px 48px rgb(15 15 15 / 0.16));
    border: 1px solid var(--settings-panel-border, rgb(15 15 15 / 0.06));
    overflow: hidden;
  }

  .sync-setup-header {
    padding: 20px 20px 12px;
    border-bottom: 1px solid var(--settings-divider, #ebebea);
  }

  .sync-setup-header h2 {
    margin: 0 0 8px;
    font-size: 17px;
    font-weight: 650;
    color: var(--settings-text, #37352f);
  }

  .sync-setup-lead {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--settings-muted, #9b9a97);
  }

  .sync-setup-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 18px;
  }

  .sync-setup-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    margin: 0;
    padding: 14px 14px;
    border-radius: 10px;
    border: 1px solid var(--settings-control-border, #e9e9e7);
    background: var(--settings-control-bg, #f7f6f3);
    color: var(--settings-text, #37352f);
    text-align: start;
    cursor: pointer;
    font: inherit;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      opacity 0.12s ease;
  }

  .sync-setup-option:hover:not(.sync-setup-option--disabled) {
    background: var(--settings-hover, #f1f1ef);
    border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 35%, var(--settings-control-border, #e9e9e7));
  }

  .sync-setup-option--recommended {
    border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 45%, var(--settings-control-border, #e9e9e7));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--xpe-primary, #2383e2) 20%, transparent);
  }

  .sync-setup-option--disabled {
    opacity: 0.55;
    cursor: not-allowed;
    background: color-mix(in srgb, var(--settings-control-bg, #f7f6f3) 70%, transparent);
  }

  .sync-setup-option--disabled:hover {
    opacity: 0.72;
  }

  .sync-setup-option:focus-visible {
    outline: 2px solid var(--xpe-primary, #2383e2);
    outline-offset: 2px;
  }

  .sync-setup-option__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
  }

  .sync-setup-option__title {
    font-size: 14px;
    font-weight: 650;
  }

  .sync-setup-option__badge {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--xpe-primary, #2383e2);
    background: color-mix(in srgb, var(--xpe-primary, #2383e2) 14%, transparent);
  }

  .sync-setup-option__desc {
    font-size: 12px;
    line-height: 1.4;
    color: var(--settings-muted, #9b9a97);
  }

  /* ── Delta Chat required modal (above setup) ───────────────────────────── */

  .delta-need-root {
    position: fixed;
    inset: 0;
    z-index: 12100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }

  .delta-need-backdrop {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: rgb(15 15 15 / 0.45);
    cursor: pointer;
  }

  .delta-need-panel {
    position: relative;
    width: min(400px, 100%);
    padding: 20px 20px 16px;
    border-radius: 14px;
    background: var(--settings-panel-bg, #fff);
    border: 1px solid var(--settings-panel-border, rgb(15 15 15 / 0.08));
    box-shadow: 0 28px 56px rgb(15 15 15 / 0.22);
    color: var(--settings-text, #37352f);
  }

  .delta-need-title {
    margin: 0 0 10px;
    font-size: 16px;
    font-weight: 650;
  }

  .delta-need-body {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.5;
  }

  .delta-need-body--muted {
    color: var(--settings-muted, #9b9a97);
  }

  .delta-need-body code {
    font-size: 0.92em;
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: var(--settings-control-bg, #f7f6f3);
  }

  .delta-need-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }

  .delta-need-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--settings-control-border, #e9e9e7);
    background: var(--settings-control-bg, #f7f6f3);
    color: inherit;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }

  .delta-need-btn:hover {
    background: var(--settings-hover, #f1f1ef);
  }

  .delta-need-btn--primary {
    border-color: transparent;
    background: var(--xpe-primary, #2383e2);
    color: #fff;
  }

  .delta-need-btn--primary:hover {
    filter: brightness(1.05);
    background: var(--xpe-primary, #2383e2);
  }
</style>
