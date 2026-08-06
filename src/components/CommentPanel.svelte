<script lang="ts">
  import { portal } from '../lib/portal'
  import MessageCircle from '@lucide/svelte/icons/message-circle'
  import X from '@lucide/svelte/icons/x'
  import { detectDir } from '@xproeditor/core'
  import { isPageLevelComment, PAGE_COMMENT_BLOCK_ID, type PageComment } from '../collab/document'
  import { tick } from 'svelte'
  import { closeUiLayer, isUiLayerOpen } from '../composables/useUiLayers'

  let {
    open = $bindable(false),
    comments,
    pageTitle,
    activeId = null,
    onselect,
    onadd,
    onreply,
  }: {
    open?: boolean
    comments: PageComment[]
    pageTitle?: string
    activeId?: string | null
    onselect?: (commentId: string | null) => void
    onadd?: (text: string) => void
    onreply?: (commentId: string, text: string) => void
  } = $props()

  let draft = $state('')
  let replyDrafts = $state<Record<string, string>>({})
  let listEl: HTMLElement | null = $state(null)
  let composerEl: HTMLTextAreaElement | null = $state(null)

  const visibleComments = $derived(
    [...comments]
      .filter((comment) => !comment.resolved)
      .sort((a, b) => b.createdAt - a.createdAt),
  )

  function isPageComment(comment: PageComment) {
    return isPageLevelComment(comment) || comment.blockId === PAGE_COMMENT_BLOCK_ID
  }

  function quoteFor(comment: PageComment) {
    if (isPageComment(comment)) {
      const pageLabel = pageTitle?.trim()
      return pageLabel ? `Page · ${pageLabel}` : 'Page comment'
    }
    const quote = comment.quote?.trim()
    if (quote) return quote
    return 'Selected text'
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function authorInitial(name: string) {
    return (name?.trim()?.charAt(0) || '?').toUpperCase()
  }

  function textDir(text: string | undefined | null): 'ltr' | 'rtl' {
    const value = text?.trim()
    if (!value) return 'ltr'
    return detectDir(value)
  }

  const draftDir = $derived(textDir(draft))

  function closePanel() {
    // Prefer the UI-layer store so Escape / close stay consistent with App’s stack.
    if (isUiLayerOpen('comments')) {
      closeUiLayer('comments')
      return
    }
    open = false
  }

  function submitNew() {
    const text = draft.trim()
    if (!text) return
    onadd?.(text)
    draft = ''
    void tick().then(() => {
      listEl?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  function submitReply(commentId: string) {
    const text = (replyDrafts[commentId] ?? '').trim()
    if (!text) return
    onreply?.(commentId, text)
    replyDrafts = { ...replyDrafts, [commentId]: '' }
  }

  function selectComment(commentId: string) {
    onselect?.(activeId === commentId ? null : commentId)
  }

  $effect(() => {
    if (!open) return
    void tick().then(() => composerEl?.focus())
  })
</script>

<div use:portal class="comment-panel-root" class:comment-panel-root--open={open}>
  {#if open}
    <button
      type="button"
      class="comment-panel-backdrop"
      aria-label="Close comments"
      onclick={closePanel}
    ></button>
  {/if}

  <div
    class="comment-panel"
    role="dialog"
    tabindex="-1"
    aria-modal="false"
    aria-labelledby="comment-panel-title"
    aria-hidden={!open}
  >
    <header class="comment-panel__header">
      <div class="comment-panel__leading">
        <MessageCircle size={18} strokeWidth={1.75} class="comment-panel__heading-icon" aria-hidden="true" />
        <h2 id="comment-panel-title" class="comment-panel__title">Comments</h2>
      </div>
      <div class="comment-panel__trailing">
        <button type="button" class="comment-panel__close" aria-label="Close" onclick={closePanel}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </header>

    <div bind:this={listEl} class="comment-panel__list">
      {#if !visibleComments.length}
        <p class="comment-panel__empty">
          No comments on this page yet. Start a discussion below.
        </p>
      {/if}

      {#each visibleComments as comment (comment.id)}
        {@const rootMessage = comment.messages[0]}
        {@const replies = comment.messages.slice(1)}
        <article
          class="comment-thread"
          class:comment-thread--active={activeId === comment.id}
        >
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <div
            class="comment-thread__body"
            role="button"
            tabindex="0"
            aria-pressed={activeId === comment.id}
            onclick={() => selectComment(comment.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                selectComment(comment.id)
              }
            }}
          >
            {#if quoteFor(comment)}
              <p class="comment-thread__context" dir={textDir(quoteFor(comment))}>
                {quoteFor(comment)}
              </p>
            {/if}

            {#if rootMessage}
              <div class="comment-msg comment-msg--root">
                <span class="comment-msg__avatar" aria-hidden="true">
                  {authorInitial(rootMessage.author)}
                </span>
                <div class="comment-msg__content">
                  <div class="comment-msg__head" dir="auto">
                    <span class="comment-msg__author">{rootMessage.author}</span>
                    <time class="comment-msg__time" datetime={new Date(rootMessage.createdAt).toISOString()}>
                      {formatTime(rootMessage.createdAt)}
                    </time>
                  </div>
                  <p class="comment-msg__text" dir={textDir(rootMessage.text)}>{rootMessage.text}</p>
                </div>
              </div>
            {/if}

            {#if replies.length}
              <div class="comment-thread__replies">
                {#each replies as message (message.id)}
                  <div class="comment-msg comment-msg--reply">
                    <span class="comment-msg__avatar comment-msg__avatar--sm" aria-hidden="true">
                      {authorInitial(message.author)}
                    </span>
                    <div class="comment-msg__content">
                      <div class="comment-msg__head" dir="auto">
                        <span class="comment-msg__author">{message.author}</span>
                        <time class="comment-msg__time" datetime={new Date(message.createdAt).toISOString()}>
                          {formatTime(message.createdAt)}
                        </time>
                      </div>
                      <p class="comment-msg__text" dir={textDir(message.text)}>{message.text}</p>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="comment-thread__compose" dir={textDir(replyDrafts[comment.id])}>
            <input
              class="comment-thread__reply-input"
              type="text"
              placeholder="Reply…"
              aria-label="Reply to thread"
              dir={textDir(replyDrafts[comment.id])}
              value={replyDrafts[comment.id] ?? ''}
              onfocus={() => selectComment(comment.id)}
              oninput={(e) => {
                replyDrafts = { ...replyDrafts, [comment.id]: (e.currentTarget as HTMLInputElement).value }
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitReply(comment.id)
                }
              }}
            />
            <button
              type="button"
              class="comment-thread__reply-send"
              disabled={!(replyDrafts[comment.id] ?? '').trim()}
              onclick={() => submitReply(comment.id)}
            >
              Send
            </button>
          </div>
        </article>
      {/each}
    </div>

    <footer class="comment-panel__composer">
      <textarea
        id="comment-panel-composer"
        bind:this={composerEl}
        bind:value={draft}
        class="comment-panel__input"
        rows="3"
        placeholder="Write a page comment…"
        aria-label="Write a page comment"
        dir={draftDir}
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submitNew()
          }
        }}
      ></textarea>
      <div class="comment-panel__composer-actions">
        <span class="comment-panel__hint">Enter to send · no mention required</span>
        <button
          type="button"
          class="comment-panel__send comment-panel__send--primary"
          disabled={!draft.trim()}
          onclick={submitNew}
        >
          Comment
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
.comment-panel-root {
  position: fixed;
  inset: 0;
  z-index: 80;
  pointer-events: none;
}

.comment-panel-root--open {
  pointer-events: auto;
}

.comment-panel-backdrop {
  position: absolute;
  inset: 0;
  border: none;
  padding: 0;
  background: rgb(15 15 15 / 0.18);
  cursor: default;
}

.comment-panel {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  width: min(360px, 100vw);
  height: 100%;
  background: var(--comment-panel-bg, #fff);
  border-left: 1px solid var(--comment-panel-border, #e9e9e7);
  box-shadow: -12px 0 40px rgb(15 15 15 / 0.1);
  transform: translateX(100%);
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: auto;
}

.comment-panel-root--open .comment-panel {
  transform: translateX(0);
}

/* Apple-style toolbar: leading group (left) + trailing group (right). */
.comment-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--comment-panel-border, #e9e9e7);
  flex-shrink: 0;
  box-sizing: border-box;
}

.comment-panel__leading,
.comment-panel__trailing {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 32px;
}

.comment-panel__leading {
  flex: 1 1 auto;
  gap: 8px;
  justify-content: flex-start;
}

.comment-panel__trailing {
  flex: 0 0 auto;
  gap: 2px;
  justify-content: flex-end;
  margin-inline-start: auto;
}

.comment-panel__heading-icon {
  flex-shrink: 0;
  display: block;
  width: 18px;
  height: 18px;
  color: var(--comment-accent, #2383e2);
}

.comment-panel__title {
  margin: 0;
  padding: 0;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--comment-text, #37352f);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comment-panel__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--comment-muted, #9b9a97);
  cursor: pointer;
  padding: 0;
  line-height: 0;
}

.comment-panel__close:hover {
  background: var(--comment-hover, #f1f1ef);
  color: var(--comment-text, #37352f);
}

.comment-panel__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.comment-panel__empty {
  margin: 28px 12px;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  color: var(--comment-muted, #9b9a97);
}

/* ── Chat-style threads ─────────────────────────────────────────── */

.comment-thread {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 8px 6px 6px;
  border-radius: 10px;
  border: 1px solid transparent;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.comment-thread--active {
  background: color-mix(in srgb, var(--comment-accent, #2383e2) 5%, transparent);
  border-color: color-mix(in srgb, var(--comment-accent, #2383e2) 14%, transparent);
}

.comment-thread__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 2px 4px 4px;
  border: none;
  background: transparent;
  text-align: start;
  cursor: pointer;
  font: inherit;
  color: inherit;
  outline: none;
}

.comment-thread__body:focus-visible {
  border-radius: 8px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--comment-accent, #2383e2) 30%, transparent);
}

.comment-thread__context {
  margin: 0 0 2px 36px;
  padding: 0;
  font-size: 11px;
  line-height: 1.35;
  color: var(--comment-muted, #9b9a97);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  unicode-bidi: plaintext;
}

.comment-thread__context::before {
  content: '↳ ';
  opacity: 0.7;
}

.comment-msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.comment-msg--reply {
  margin-inline-start: 20px;
  padding-inline-start: 10px;
  border-inline-start: 1.5px solid color-mix(in srgb, var(--comment-panel-border, #e9e9e7) 90%, transparent);
}

.comment-thread__replies {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}

.comment-msg__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--comment-accent, #2383e2) 85%, #1a1a1a);
  color: #fff;
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
}

.comment-msg__avatar--sm {
  width: 22px;
  height: 22px;
  font-size: 10px;
  background: color-mix(in srgb, var(--comment-muted, #9b9a97) 55%, var(--comment-accent, #2383e2));
}

.comment-msg__content {
  flex: 1 1 auto;
  min-width: 0;
  padding-top: 1px;
}

.comment-msg__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 2px;
  min-width: 0;
}

.comment-msg__author {
  font-size: 12.5px;
  font-weight: 650;
  line-height: 1.25;
  color: var(--comment-text, #37352f);
}

.comment-msg__time {
  font-size: 11px;
  line-height: 1.25;
  color: var(--comment-muted, #9b9a97);
}

.comment-msg__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--comment-text, #37352f);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  unicode-bidi: plaintext;
}

.comment-thread__compose {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0 36px;
  min-width: 0;
}

.comment-thread__reply-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: color-mix(in srgb, var(--comment-hover, #f1f1ef) 80%, transparent);
  color: var(--comment-text, #37352f);
  font: inherit;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  unicode-bidi: plaintext;
  text-align: start;
}

.comment-thread__reply-input::placeholder {
  color: var(--comment-muted, #9b9a97);
}

.comment-thread__reply-input:focus {
  border-color: color-mix(in srgb, var(--comment-accent, #2383e2) 45%, transparent);
  background: var(--comment-panel-bg, #fff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--comment-accent, #2383e2) 12%, transparent);
}

.comment-thread__reply-send {
  flex: 0 0 auto;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: var(--comment-accent, #2383e2);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.comment-thread__reply-send:disabled {
  opacity: 0.35;
  cursor: default;
}

.comment-thread__reply-send:not(:disabled):hover {
  background: color-mix(in srgb, var(--comment-accent, #2383e2) 10%, transparent);
}

.comment-panel__composer {
  flex-shrink: 0;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--comment-panel-border, #e9e9e7);
  background: var(--comment-panel-bg, #fff);
}

.comment-panel__input {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  padding: 10px 12px;
  border: 1px solid var(--comment-panel-border, #e9e9e7);
  border-radius: 10px;
  background: var(--comment-panel-bg, #fff);
  color: var(--comment-text, #37352f);
  font: inherit;
  /* ≥16px prevents iOS focus zoom that breaks the sliding panel. */
  font-size: 16px;
  line-height: 1.45;
  box-sizing: border-box;
  unicode-bidi: plaintext;
  text-align: start;
}

.comment-panel__input--reply {
  min-height: 48px;
  resize: none;
  font-size: 16px;
}

.comment-panel__input:focus {
  outline: none;
  border-color: var(--comment-accent, #2383e2);
  box-shadow: 0 0 0 2px rgb(35 131 226 / 0.12);
}

.comment-panel__composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.comment-panel__hint {
  font-size: 11px;
  color: var(--comment-muted, #9b9a97);
}

.comment-panel__send {
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: var(--comment-hover, #f1f1ef);
  color: var(--comment-text, #37352f);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
}

.comment-panel__send:hover:not(:disabled) {
  background: var(--header-hover, #e9e9e7);
}

.comment-panel__send--primary {
  background: var(--comment-accent, #2383e2);
  color: #fff;
}

.comment-panel__send--primary:hover:not(:disabled) {
  filter: brightness(0.96);
}

.comment-panel__send:disabled {
  opacity: 0.45;
  cursor: default;
}

@media (max-width: 480px) {
  .comment-panel {
    width: 100vw;
  }
}
</style>
