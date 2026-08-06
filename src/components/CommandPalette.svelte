<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
import FilePlus from '@lucide/svelte/icons/file-plus'
import FileText from '@lucide/svelte/icons/file-text'
import Search from '@lucide/svelte/icons/search'
  import { tick } from 'svelte'
  import type { PageMeta } from '../collab/document'
  import { formatShortcut, type AppCommand } from '../composables/useAppCommands'
  import { portal } from '../lib/portal'

  let {
    open = $bindable(false),
    commands,
    pages,
    currentPageId,
    onnavigate,
    oncreatePage,
  }: {
    open?: boolean
    commands: AppCommand[]
    pages: PageMeta[]
    currentPageId: string
    onnavigate?: (pageId: string) => void
    oncreatePage?: (title: string) => void
  } = $props()

  type PaletteItem =
    | {
        kind: 'create'
        id: string
        label: string
        title: string
        shortcut?: string
      }
    | {
        kind: 'page'
        id: string
        label: string
        pageId: string
        icon?: string
        current: boolean
      }
    | {
        kind: 'command'
        id: string
        label: string
        shortcut?: string
        run: () => void
      }

  const createPageShortcut = formatShortcut('Mod', 'N')

  let mode = $state<'browse' | 'create'>('browse')
  let query = $state('')
  let createTitle = $state('')
  let activeIndex = $state(0)
  let inputEl: HTMLInputElement | null = $state(null)
  let createInputEl: HTMLInputElement | null = $state(null)

  const filteredItems = $derived.by((): PaletteItem[] => {
    const q = query.trim().toLowerCase()
    const items: PaletteItem[] = []
    const createTitleValue = query.trim()
    const prioritizedCommandIds = new Set(['toggle-sidebar', 'create-page', 'toggle-comments'])

    for (const command of commands) {
      if (!prioritizedCommandIds.has(command.id)) continue
      if (command.id === 'create-page' && !q) continue
      const haystack = [command.label, ...command.keywords].join(' ').toLowerCase()
      if (q && !haystack.includes(q)) continue
      items.push({
        kind: 'command',
        id: command.id,
        label: command.label,
        shortcut: command.shortcut,
        run: command.run,
      })
    }

    items.push({
      kind: 'create',
      id: 'create-page-inline',
      label: createTitleValue ? `Create page “${createTitleValue}”` : 'Create new page',
      title: createTitleValue,
      shortcut: createTitleValue ? undefined : createPageShortcut,
    })

    for (const page of pages) {
      const haystack = page.title.toLowerCase()
      if (q && !haystack.includes(q)) continue
      items.push({
        kind: 'page',
        id: `page-${page.id}`,
        label: page.title,
        pageId: page.id,
        icon: page.icon,
        current: page.id === currentPageId,
      })
    }

    for (const command of commands) {
      if (prioritizedCommandIds.has(command.id)) continue
      const haystack = [command.label, ...command.keywords].join(' ').toLowerCase()
      if (q && !haystack.includes(q)) continue
      items.push({
        kind: 'command',
        id: command.id,
        label: command.label,
        shortcut: command.shortcut,
        run: command.run,
      })
    }

    return items
  })

  function reset() {
    mode = 'browse'
    query = ''
    createTitle = ''
    activeIndex = 0
  }

  function close() {
    open = false
  }

  function openCreateMode(seedTitle = '') {
    mode = 'create'
    createTitle = seedTitle
    void tick().then(() => {
      createInputEl?.focus()
      createInputEl?.select()
    })
  }

  function backToBrowse() {
    mode = 'browse'
    void tick().then(() => inputEl?.focus())
  }

  function runItem(item: PaletteItem) {
    if (item.kind === 'page') {
      onnavigate?.(item.pageId)
      close()
      return
    }
    if (item.kind === 'command') {
      item.run()
      close()
      return
    }
    openCreateMode(item.title)
  }

  function submitCreate() {
    const title = createTitle.trim()
    oncreatePage?.(title)
    close()
  }

  function onBrowseKeydown(event: KeyboardEvent) {
    const items = filteredItems
    if (!items.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeIndex = (activeIndex + 1) % items.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex = (activeIndex - 1 + items.length) % items.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runItem(items[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab' && !event.shiftKey && query.trim()) {
      const createItem = items.find((item) => item.kind === 'create')
      if (createItem && createItem.kind === 'create') {
        event.preventDefault()
        openCreateMode(createItem.title)
      }
    }
  }

  function onCreateKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitCreate()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      backToBrowse()
    }
  }

  $effect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      reset()
      void tick().then(() => inputEl?.focus())
    }
    return () => {
      document.body.style.overflow = ''
    }
  })

  $effect(() => {
    void filteredItems
    activeIndex = 0
  })
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
  <div
    use:portal
    class="palette-root"
    role="presentation"
    onkeydown={(e) => (mode === 'browse' ? onBrowseKeydown(e) : onCreateKeydown(e))}
  >
    <button class="palette-backdrop" type="button" aria-label="Close" onclick={close}></button>

    <div class="palette-panel" role="dialog" aria-modal="true" aria-label="Command palette">
      {#if mode === 'browse'}
        <div class="palette-view">
          <div class="palette-input-wrap">
            <Search class="palette-input-icon" size={16} strokeWidth={2} />
            <input
              bind:this={inputEl}
              bind:value={query}
              type="search"
              class="palette-input"
              placeholder="Search pages or commands…"
              autocomplete="off"
              spellcheck="false"
            />
          </div>

          {#if filteredItems.length}
            <ul class="palette-list" role="listbox">
              {#each filteredItems as item, index (item.id)}
                <li role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    class="palette-item"
                    class:active={index === activeIndex}
                    class:palette-item--create={item.kind === 'create'}
                    class:palette-item--current={item.kind === 'page' && item.current}
                    onclick={() => runItem(item)}
                    onmouseenter={() => (activeIndex = index)}
                  >
                    <span class="palette-item__main">
                      {#if item.kind === 'create'}
                        <FilePlus class="palette-item__icon" size={15} strokeWidth={2} />
                      {:else if item.kind === 'page'}
                        <FileText class="palette-item__icon" size={15} strokeWidth={1.75} />
                      {/if}
                      <span>{item.label}</span>
                      {#if item.kind === 'page' && item.current}
                        <span class="palette-item__badge">Current</span>
                      {/if}
                    </span>
                    {#if (item.kind === 'command' || item.kind === 'create') && item.shortcut}
                      <kbd class="palette-kbd">{item.shortcut}</kbd>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="palette-empty">No matching pages or commands</p>
          {/if}
        </div>
      {:else}
        <div class="palette-view palette-view--create">
          <button type="button" class="palette-back" onclick={backToBrowse}>
            <ArrowLeft size={16} strokeWidth={2} />
            <span>Back</span>
          </button>

          <label class="palette-create-label" for="palette-create-input">Page name</label>
          <input
            id="palette-create-input"
            bind:this={createInputEl}
            bind:value={createTitle}
            type="text"
            class="palette-create-input"
            placeholder="Untitled"
            autocomplete="off"
            spellcheck="false"
          />

          <button type="button" class="palette-create-submit" onclick={submitCreate}>
            Create page
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
.palette-root-enter-active,
.palette-root-leave-active {
  transition: opacity 0.18s ease;
}

.palette-root-enter-active .palette-panel,
.palette-root-leave-active .palette-panel {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease;
}

.palette-root-enter-from,
.palette-root-leave-to {
  opacity: 0;
}

.palette-root-enter-from .palette-panel,
.palette-root-leave-to .palette-panel {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
}

.palette-root {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh 16px 16px;
}

.palette-backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--settings-backdrop);
  cursor: default;
}

.palette-panel {
  position: relative;
  width: min(520px, 100%);
  overflow: hidden;
  border-radius: 14px;
  background: var(--settings-panel-bg);
  border: 1px solid var(--settings-panel-border);
  box-shadow: var(--settings-panel-shadow);
}

.palette-view {
  display: flex;
  flex-direction: column;
}

.palette-morph-enter-active,
.palette-morph-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.palette-morph-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.palette-morph-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

.palette-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--settings-divider);
}

.palette-input-icon {
  flex-shrink: 0;
  color: var(--settings-muted);
}

.palette-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 14px 0;
  font-size: 15px;
  color: var(--settings-text);
  outline: none;
}

.palette-input::placeholder {
  color: var(--settings-muted);
}

.palette-list {
  margin: 0;
  padding: 6px;
  list-style: none;
  max-height: min(50vh, 360px);
  overflow: auto;
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  padding: 10px 12px;
  text-align: left;
  font-size: 14px;
  color: var(--settings-text);
  cursor: pointer;
}

.palette-item__main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.palette-item__icon,
.palette-item__emoji {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.palette-item__icon {
  color: var(--xpe-primary, #2383e2);
}

.palette-item--create {
  color: var(--xpe-primary, #2383e2);
  font-weight: 500;
}

.palette-item--current {
  font-weight: 500;
}

.palette-item__badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--settings-control-bg);
  color: var(--settings-muted);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.palette-item:hover,
.palette-item.active {
  background: var(--settings-hover);
}

.palette-kbd {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--settings-control-bg);
  border: 1px solid var(--settings-control-border);
  color: var(--settings-muted);
  font-size: 11px;
  font-family: inherit;
}

.palette-empty {
  margin: 0;
  padding: 16px;
  font-size: 14px;
  color: var(--settings-muted);
}

.palette-view--create {
  padding: 14px 16px 16px;
}

.palette-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--settings-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.palette-back:hover {
  background: var(--settings-hover);
  color: var(--settings-text);
}

.palette-create-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--settings-muted);
}

.palette-create-input {
  width: 100%;
  border: 1px solid var(--settings-control-border);
  border-radius: 10px;
  background: var(--settings-control-bg);
  padding: 12px 14px;
  font-size: 16px;
  color: var(--settings-text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.palette-create-input:focus {
  border-color: var(--xpe-primary, #2383e2);
  box-shadow: 0 0 0 3px rgb(35 131 226 / 0.14);
}

.palette-create-submit {
  width: 100%;
  margin-top: 12px;
  padding: 10px 14px;
  border: none;
  border-radius: 10px;
  background: var(--xpe-primary, #2383e2);
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.12s ease, opacity 0.12s ease;
}

.palette-create-submit:hover {
  opacity: 0.92;
}

.palette-create-submit:active {
  transform: scale(0.99);
}
</style>
