<script lang="ts">
  import type { Component, Snippet } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import { detectDir } from '@xproeditor/core'
  import type { PageComment } from '../collab/document'
  import { tick } from 'svelte'
  import { portal } from '../lib/portal'

  let {
    comment,
    position,
    /** Optional icon component for the close control. Defaults to X. */
    closeIcon: CloseIcon = X,
    /** Optional full custom icon content (wins over `closeIcon` when provided). */
    closeIconSnippet,
    onclose,
    onreply,
  }: {
    comment: PageComment
    position: { x: number; y: number }
    closeIcon?: Component
    closeIconSnippet?: Snippet
    onclose?: () => void
    onreply?: (text: string) => void
  } = $props()

  let replyInput = $state('')
  let panelEl: HTMLElement | null = $state(null)
  let adjusted = $state({ x: 0, y: 0 })

  const quote = $derived(comment.quote?.trim() || 'Selected text')

  function textDir(text: string | undefined | null): 'ltr' | 'rtl' {
    const value = text?.trim()
    if (!value) return 'ltr'
    return detectDir(value)
  }

  const quoteDir = $derived(textDir(quote))
  const replyDir = $derived(textDir(replyInput))

  function formatTime(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function submitReply() {
    const text = replyInput.trim()
    if (!text) return
    onreply?.(text)
    replyInput = ''
  }

  function clampPosition() {
    const panel = panelEl
    if (!panel) return

    const margin = 12
    const rect = panel.getBoundingClientRect()
    let x = position.x
    let y = position.y

    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin)
    }

    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - rect.height - margin)
    }

    adjusted = { x, y }
  }

  $effect(() => {
    adjusted = { ...position }
    void tick().then(() => clampPosition())
  })
</script>

<div
  use:portal
  class="comment-thread-backdrop"
  role="presentation"
  onmousedown={() => onclose?.()}
></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:portal
  bind:this={panelEl}
  class="comment-thread"
  style="left: {adjusted.x}px; top: {adjusted.y}px"
  onmousedown={(e) => e.stopPropagation()}
>
  <div class="comment-thread-header">
    <span class="comment-thread-title">Comment</span>
    <button
      type="button"
      class="comment-thread-close"
      title="Close"
      aria-label="Close"
      onclick={() => onclose?.()}
    >
      <span class="comment-thread-close__icon" aria-hidden="true">
        {#if closeIconSnippet}
          {@render closeIconSnippet()}
        {:else}
          <CloseIcon size={14} strokeWidth={2} />
        {/if}
      </span>
    </button>
  </div>

  <blockquote class="comment-thread-quote" dir={quoteDir}>{quote}</blockquote>

  <div class="comment-thread-messages">
    {#each comment.messages as message (message.id)}
      <div class="comment-thread-message">
        <div class="comment-thread-meta" dir="auto">
          <span class="comment-thread-author">{message.author}</span>
          <span class="comment-thread-time">{formatTime(message.createdAt)}</span>
        </div>
        <p class="comment-thread-text" dir={textDir(message.text)}>{message.text}</p>
      </div>
    {/each}
  </div>

  <div class="comment-thread-reply" dir={replyDir}>
    <textarea
      bind:value={replyInput}
      class="comment-thread-input"
      rows="2"
      placeholder="Reply…"
      dir={replyDir}
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          submitReply()
        } else if (e.key === 'Escape') {
          onclose?.()
        }
      }}
    ></textarea>
    <button type="button" class="comment-thread-send" disabled={!replyInput.trim()} onclick={submitReply}>
      Reply
    </button>
  </div>
</div>

<style>
.comment-thread-backdrop {
  position: fixed;
  inset: 0;
  z-index: 85;
}

.comment-thread {
  position: fixed;
  z-index: 90;
  width: min(320px, calc(100vw - 24px));
  border-radius: 12px;
  border: 1px solid var(--comment-panel-border, #e9e9e7);
  background: var(--comment-panel-bg, #fff);
  box-shadow: 0 16px 40px rgb(15 15 15 / 0.14);
  overflow: hidden;
}

.comment-thread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--comment-panel-border, #e9e9e7);
}

.comment-thread-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--comment-text, #37352f);
}

.comment-thread-close {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--comment-muted, #9b9a97);
  cursor: pointer;
  line-height: 0;
  overflow: hidden;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.comment-thread-close__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  line-height: 0;
  pointer-events: none;
}

.comment-thread-close__icon :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.comment-thread-close:hover {
  background: var(--comment-hover, #f1f1ef);
  border-color: color-mix(in srgb, var(--comment-muted, #9b9a97) 28%, transparent);
  color: var(--comment-text, #37352f);
}

.comment-thread-close:focus-visible {
  outline: 2px solid var(--comment-accent, #2383e2);
  outline-offset: 2px;
}

.comment-thread-quote {
  margin: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--comment-panel-border, #e9e9e7);
  background: var(--comment-quote-bg, #f7f6f3);
  color: var(--comment-muted, #9b9a97);
  font-size: 12px;
  line-height: 1.45;
  border-inline-start: 3px solid var(--comment-accent, #2383e2);
  unicode-bidi: plaintext;
}

.comment-thread-messages {
  max-height: 240px;
  overflow-y: auto;
  padding: 8px 0;
}

.comment-thread-message {
  padding: 8px 12px;
}

.comment-thread-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.comment-thread-author {
  font-size: 12px;
  font-weight: 600;
  color: var(--comment-text, #37352f);
}

.comment-thread-time {
  font-size: 11px;
  color: var(--comment-muted, #9b9a97);
}

.comment-thread-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--comment-text, #37352f);
  white-space: pre-wrap;
  unicode-bidi: plaintext;
}

.comment-thread-reply {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--comment-panel-border, #e9e9e7);
}

.comment-thread-input {
  flex: 1;
  min-height: 52px;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--comment-panel-border, #e9e9e7);
  border-radius: 8px;
  background: var(--comment-panel-bg, #fff);
  color: var(--comment-text, #37352f);
  /* ≥16px prevents iOS focus zoom. */
  font-size: 16px;
  line-height: 1.4;
  font-family: inherit;
  unicode-bidi: plaintext;
  text-align: start;
}

.comment-thread-input:focus {
  outline: none;
  border-color: var(--comment-accent, #2383e2);
  box-shadow: 0 0 0 2px rgb(35 131 226 / 0.12);
}

.comment-thread-send {
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: var(--comment-accent, #2383e2);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.comment-thread-send:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
