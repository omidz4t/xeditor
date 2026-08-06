<script lang="ts">
  import Search from '@lucide/svelte/icons/search'
import X from '@lucide/svelte/icons/x'
  import { formatShortcut } from '../composables/useAppCommands'
  import { tick } from 'svelte'
  import { portal } from '../lib/portal'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  type ShortcutRow = {
    action: string
    keys: string
    keywords?: string[]
  }

  type ShortcutGroup = {
    title: string
    rows: ShortcutRow[]
  }

  const groups: ShortcutGroup[] = [
    {
      title: 'General',
      rows: [
        {
          action: 'Command palette',
          keys: `${formatShortcut('Mod', 'K')} / ${formatShortcut('Mod', 'P')}`,
          keywords: ['search', 'commands', 'palette'],
        },
        {
          action: 'Keyboard shortcuts',
          keys: 'Shift+?',
          keywords: ['help', 'cheatsheet', 'hotkeys'],
        },
        {
          action: 'Close dialog / panel',
          keys: 'Esc',
          keywords: ['escape', 'close', 'dismiss'],
        },
        {
          action: 'Live reaction pie / ask others to follow me',
          keys: 'Alt + move mouse',
          keywords: ['emoji', 'react', 'pie', 'presence', 'realtime', 'alt', 'follow'],
        },
      ],
    },
    {
      title: 'Navigation',
      rows: [
        {
          action: 'Toggle left sidebar',
          keys: formatShortcut('Mod', '\\'),
          keywords: ['panel', 'pages', 'sidebar', 'collapse', 'close'],
        },
        {
          action: 'Toggle comments',
          keys: formatShortcut('Mod', 'Shift', 'C'),
          keywords: ['comment', 'discuss', 'feedback'],
        },
        {
          action: 'Create new page',
          keys: formatShortcut('Mod', 'N'),
          keywords: ['page', 'new', 'note', 'document'],
        },
      ],
    },
    {
      title: 'Editor',
      rows: [
        {
          action: 'Vim mode (toggle in Settings)',
          keys: 'Esc / i / hjkl / …',
          keywords: ['vim', 'modal', 'normal', 'insert', 'visual', 'bindings'],
        },
        {
          action: 'Bold',
          keys: formatShortcut('Mod', 'B'),
          keywords: ['strong', 'weight', 'format'],
        },
        {
          action: 'Italic',
          keys: formatShortcut('Mod', 'I'),
          keywords: ['emphasis', 'format'],
        },
        {
          action: 'Underline',
          keys: formatShortcut('Mod', 'U'),
          keywords: ['format'],
        },
        {
          action: 'Inline code',
          keys: formatShortcut('Mod', 'M'),
          keywords: ['code', 'monospace', 'format', 'mod+e'],
        },
        {
          action: 'Strikethrough',
          keys: formatShortcut('Mod', 'Shift', 'S'),
          keywords: ['strike', 'delete', 'format'],
        },
        {
          action: 'Slash commands',
          keys: '/',
          keywords: ['insert', 'block', 'heading', 'menu'],
        },
      ],
    },
  ]

  let query = $state('')
  let searchEl: HTMLInputElement | null = $state(null)

  const filteredGroups = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((group) => ({
        title: group.title,
        rows: group.rows.filter((row) => {
          const haystack = [row.action, row.keys, group.title, ...(row.keywords ?? [])]
            .join(' ')
            .toLowerCase()
          return haystack.includes(q)
        }),
      }))
      .filter((group) => group.rows.length > 0)
  })

  const resultCount = $derived(
    filteredGroups.reduce((sum, group) => sum + group.rows.length, 0),
  )

  function onKeydown(event: KeyboardEvent) {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      open = false
    }
  }

  $effect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      query = ''
      void tick().then(() => {
        searchEl?.focus()
        searchEl?.select()
      })
    }
    return () => {
      document.body.style.overflow = ''
    }
  })

  $effect(() => {
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })
</script>

{#if open}
  <div use:portal class="shortcuts-root">
    <button
      class="shortcuts-backdrop"
      type="button"
      aria-label="Close shortcuts"
      onclick={() => (open = false)}
    ></button>

    <div
      class="shortcuts-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <header class="shortcuts-header">
        <div>
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <p class="shortcuts-subtitle">Press <kbd>Shift</kbd>+<kbd>?</kbd> outside text fields</p>
        </div>
        <button class="shortcuts-close" type="button" aria-label="Close" onclick={() => (open = false)}>
          <X size={16} strokeWidth={2} />
        </button>
      </header>

      <div class="shortcuts-search">
        <Search class="shortcuts-search__icon" size={15} strokeWidth={2} />
        <input
          bind:this={searchEl}
          bind:value={query}
          type="search"
          class="shortcuts-search__input"
          placeholder="Search shortcuts…"
          autocomplete="off"
          spellcheck="false"
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              if (query) query = ''
              else open = false
            }
          }}
        />
        {#if query.trim()}
          <span class="shortcuts-search__count">{resultCount}</span>
        {/if}
      </div>

      <div class="shortcuts-body">
        {#if !filteredGroups.length}
          <p class="shortcuts-empty">No matching shortcuts</p>
        {/if}

        {#each filteredGroups as group (group.title)}
          <section class="shortcuts-group">
            <h3>{group.title}</h3>
            <ul>
              {#each group.rows as row (row.action)}
                <li class="shortcuts-row">
                  <span class="shortcuts-action">{row.action}</span>
                  <kbd class="shortcuts-keys">{row.keys}</kbd>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
.shortcuts-root {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  place-items: center;
  padding: 16px;
}

.shortcuts-backdrop {
  position: absolute;
  inset: 0;
  border: none;
  padding: 0;
  background: var(--settings-backdrop, rgb(15 15 15 / 0.28));
  cursor: default;
}

.shortcuts-panel {
  position: relative;
  z-index: 1;
  width: min(440px, 100%);
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--settings-panel-border, #e9e9e7);
  background: var(--settings-panel-bg, #fff);
  box-shadow: var(--settings-panel-shadow, 0 24px 48px rgb(15 15 15 / 0.14));
  overflow: hidden;
}

.shortcuts-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--settings-divider, #ebebea);
}

.shortcuts-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  color: var(--settings-text, #37352f);
}

.shortcuts-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--settings-muted, #9b9a97);
}

.shortcuts-subtitle kbd {
  display: inline-block;
  min-width: 1.4em;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--settings-control-border, #e9e9e7);
  background: var(--settings-control-bg, #f7f6f3);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

.shortcuts-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--settings-muted, #9b9a97);
  cursor: pointer;
}

.shortcuts-close:hover {
  background: var(--settings-hover, #f1f1ef);
  color: var(--settings-text, #37352f);
}

.shortcuts-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 12px 0;
  padding: 0 10px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--settings-control-border, #e9e9e7);
  background: var(--settings-control-bg, #f7f6f3);
}

.shortcuts-search__icon {
  flex-shrink: 0;
  color: var(--settings-muted, #9b9a97);
}

.shortcuts-search__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: var(--settings-text, #37352f);
}

.shortcuts-search__input::placeholder {
  color: var(--settings-muted, #9b9a97);
}

.shortcuts-search__count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--settings-muted, #9b9a97);
}

.shortcuts-body {
  overflow-y: auto;
  padding: 8px 8px 14px;
}

.shortcuts-empty {
  margin: 24px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--settings-muted, #9b9a97);
}

.shortcuts-group {
  padding: 8px;
}

.shortcuts-group h3 {
  margin: 0 0 6px 4px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--settings-muted, #9b9a97);
}

.shortcuts-group ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--settings-control-border, #e9e9e7);
  border-radius: 10px;
  overflow: hidden;
  background: var(--settings-control-bg, #f7f6f3);
}

.shortcuts-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-top: 1px solid var(--settings-divider, #ebebea);
}

.shortcuts-row:first-child {
  border-top: none;
}

.shortcuts-action {
  font-size: 13px;
  color: var(--settings-text, #37352f);
}

.shortcuts-keys {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--settings-control-border, #e9e9e7);
  background: var(--settings-panel-bg, #fff);
  color: var(--settings-text, #37352f);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
</style>
