<script lang="ts">
  import {
    collabModeDescription,
    collabModeLabel,
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

  function choose(mode: CollabSyncMode) {
    onselect?.(mode)
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
          Pick once for everyone in this chat. Your choice is shared silently
          (no chat notification). Later openers use the same mode.
        </p>
      </header>

      <div class="sync-setup-options" role="list">
        {#each options as mode (mode)}
          <button
            type="button"
            class="sync-setup-option"
                        onclick={() => choose(mode)}
          >
            <span class="sync-setup-option__title">{collabModeLabel(mode)}</span>
            <span class="sync-setup-option__desc">{collabModeDescription(mode)}</span>
          </button>
        {/each}
      </div>
    </div>
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
      border-color 0.12s ease;
  }

  .sync-setup-option:hover {
    background: var(--settings-hover, #f1f1ef);
    border-color: color-mix(in srgb, var(--xpe-primary, #2383e2) 35%, var(--settings-control-border, #e9e9e7));
  }

  .sync-setup-option:focus-visible {
    outline: 2px solid var(--xpe-primary, #2383e2);
    outline-offset: 2px;
  }

  .sync-setup-option__title {
    font-size: 14px;
    font-weight: 650;
  }

  .sync-setup-option__desc {
    font-size: 12px;
    line-height: 1.4;
    color: var(--settings-muted, #9b9a97);
  }
</style>
