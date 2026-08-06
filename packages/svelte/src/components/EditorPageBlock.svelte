<script lang="ts">

  import { onMount, tick } from 'svelte'
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right'
  import FileText from '@lucide/svelte/icons/file-text'
  import Plus from '@lucide/svelte/icons/plus'
  import Search from '@lucide/svelte/icons/search'
  import type { Block } from '@xproeditor/core'

  export type PageOption = { id: string; title: string; icon?: string }

  let {
    block,
    selected = false,
    readonly = false,
    pages = [],
    currentPageId,
    autoPick = false,
    onpatch,
    onselect,
    onnavigate,
    oncreatepage,
    onpickeropened,
  }: {
    block: Block
    selected?: boolean
    readonly?: boolean
    pages?: PageOption[]
    currentPageId?: string
    autoPick?: boolean
    onpatch?: (patch: Record<string, unknown>) => void
    onselect?: () => void
    onnavigate?: (pageId: string) => void
    oncreatepage?: (title: string) => void
    onpickeropened?: () => void
  } = $props()

  let query = $state('')
  let pickerOpen = $state(false)
  /** When true, show “name this page” step before create. */
  let namingOpen = $state(false)
  let nameDraft = $state('')
  let inputRef = $state<HTMLInputElement | null>(null)
  let nameInputRef = $state<HTMLInputElement | null>(null)
  let activeIndex = $state(0)

  let linked = $derived(Boolean(block.props.pageId))
  let displayTitle = $derived.by(() => {
    const pageId = block.props.pageId
    if (!pageId) return 'Untitled'
    const live = pages.find((page) => page.id === pageId)
    return live?.title?.trim() || block.props.pageTitle?.trim() || 'Untitled'
  })
  let targetMissing = $derived.by(() => {
    const pageId = block.props.pageId
    if (!pageId) return false
    return !pages.some((page) => page.id === pageId)
  })
  let filteredPages = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const list = pages.filter((page) => page.id !== currentPageId)
    if (!q) return list
    return list.filter((page) => (page.title || 'Untitled').toLowerCase().includes(q))
  })
  let optionCount = $derived(filteredPages.length + 1)

  $effect(() => {
    void filteredPages
    if (activeIndex >= optionCount) activeIndex = Math.max(0, optionCount - 1)
  })
  $effect(() => {
    void query
    activeIndex = 0
  })

  function openPicker() {
    if (readonly) return
    pickerOpen = true
    namingOpen = false
    nameDraft = ''
    query = ''
    activeIndex = 0
    onpickeropened?.()
    tick().then(() => inputRef?.focus())
  }

  function linkPage(page: PageOption) {
    onpatch?.({
      pageId: page.id,
      pageTitle: page.title?.trim() || 'Untitled',
      pageIcon: page.icon ?? '',
    })
    pickerOpen = false
    namingOpen = false
  }

  /** Start create — always confirm a name first when the search box is empty. */
  function createAndLink() {
    const typed = query.trim()
    if (typed) {
      finishCreate(typed)
      return
    }
    // Empty search → ask for the page name before creating.
    namingOpen = true
    nameDraft = ''
    tick().then(() => {
      nameInputRef?.focus()
      nameInputRef?.select()
    })
  }

  function finishCreate(title: string) {
    const name = title.trim() || 'Untitled'
    oncreatepage?.(name)
    pickerOpen = false
    namingOpen = false
    nameDraft = ''
    query = ''
  }

  function cancelNaming() {
    namingOpen = false
    nameDraft = ''
    tick().then(() => inputRef?.focus())
  }

  function confirmNaming() {
    finishCreate(nameDraft)
  }

  function confirmActiveOption() {
    if (namingOpen) {
      confirmNaming()
      return
    }
    if (activeIndex >= 0 && activeIndex < filteredPages.length) {
      linkPage(filteredPages[activeIndex]!)
      return
    }
    createAndLink()
  }

  function onPickerKeydown(e: KeyboardEvent) {
    if (namingOpen) {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        confirmNaming()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelNaming()
        return
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      activeIndex = Math.min(optionCount - 1, activeIndex + 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      activeIndex = Math.max(0, activeIndex - 1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      confirmActiveOption()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      pickerOpen = false
    }
  }

  function onNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      confirmNaming()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelNaming()
    }
  }

  function onNavigate() {
    onselect?.()
    const pageId = block.props.pageId
    if (!pageId || targetMissing) {
      openPicker()
      return
    }
    onnavigate?.(pageId)
  }

  function onBlockKeydown(e: KeyboardEvent) {
    if (pickerOpen) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') onselect?.()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (linked && !targetMissing) onNavigate()
      else openPicker()
    }
  }

  function maybeAutoPick() {
    if (autoPick && !linked && !readonly && !pickerOpen) openPicker()
  }

  onMount(maybeAutoPick)
  $effect(() => {
    if (autoPick) maybeAutoPick()
  })

</script>


<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="page-ref"
  class:page-ref--selected={selected}
  class:page-ref--missing={targetMissing}
  onkeydown={onBlockKeydown}
>
  {#if linked}
    <button
      class="page-ref__link"
      type="button"
      title={targetMissing ? 'Page missing — click to relink' : `Open ${displayTitle}`}
      onclick={(e) => { e.stopPropagation(); onNavigate() }}
      onfocus={() => onselect?.()}
      onkeydown={onBlockKeydown}
    >
      <span class="page-ref__icon" aria-hidden="true"><FileText size={16} strokeWidth={1.75} /></span>
      <span class="page-ref__title">{displayTitle}</span>
      {#if targetMissing}
        <span class="page-ref__missing-label">Missing</span>
      {:else}
        <ArrowUpRight class="page-ref__arrow" size={14} strokeWidth={2} />
      {/if}
    </button>
  {:else}
    <div class="page-ref__picker-shell">
      {#if !pickerOpen}
        <button class="page-ref__placeholder" type="button" onclick={openPicker} onfocus={() => onselect?.()} onkeydown={onBlockKeydown}>
          <FileText size={16} strokeWidth={1.75} />
          <span>Link to a page…</span>
        </button>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="page-ref__picker" onmousedown={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()} onkeydown={onPickerKeydown}>
          {#if namingOpen}
            <div class="page-ref__name-step">
              <p class="page-ref__name-label" id="page-ref-name-label">Name your new page</p>
              <input
                bind:this={nameInputRef}
                bind:value={nameDraft}
                type="text"
                class="page-ref__name-input"
                placeholder="Page title"
                aria-labelledby="page-ref-name-label"
                maxlength="120"
                onkeydown={onNameKeydown}
              />
              <div class="page-ref__name-actions">
                <button type="button" class="page-ref__name-btn page-ref__name-btn--ghost" onclick={cancelNaming}>
                  Back
                </button>
                <button type="button" class="page-ref__name-btn page-ref__name-btn--primary" onclick={confirmNaming}>
                  Create page
                </button>
              </div>
            </div>
          {:else}
            <div class="page-ref__search">
              <Search size={14} strokeWidth={2} />
              <input bind:this={inputRef} bind:value={query} type="text" class="page-ref__search-input" placeholder="Search or create a page…" onkeydown={onPickerKeydown} />
            </div>
            <div class="page-ref__options">
              {#each filteredPages as page, index (page.id)}
                <button
                  class="page-ref__option"
                  class:page-ref__option--active={activeIndex === index}
                  type="button"
                  onclick={() => linkPage(page)}
                  onmouseenter={() => (activeIndex = index)}
                >
                  <span class="page-ref__option-icon" aria-hidden="true"><FileText size={14} strokeWidth={1.75} /></span>
                  <span class="page-ref__option-title">{page.title?.trim() || 'Untitled'}</span>
                </button>
              {/each}
              <button
                class="page-ref__option page-ref__option--create"
                class:page-ref__option--active={activeIndex === filteredPages.length}
                type="button"
                onclick={createAndLink}
                onmouseenter={() => (activeIndex = filteredPages.length)}
              >
                <span class="page-ref__option-icon page-ref__option-icon--create"><Plus size={14} strokeWidth={2} /></span>
                <span class="page-ref__option-title">{query.trim() ? `Create "${query.trim()}"` : 'New page…'}</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>


<style>

.page-ref {
  margin: 2px 0;
}

.page-ref__link,
.page-ref__placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.page-ref__link:hover,
.page-ref__placeholder:hover,
.page-ref--selected .page-ref__link {
  background: var(--xpe-hover, #f1f1ef);
}

.page-ref--missing .page-ref__link {
  background: rgb(239 68 68 / 0.06);
}

.page-ref__icon,
.page-ref__option-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: var(--xpe-muted-foreground, #9b9a97);
}

.page-ref__icon :global(svg),
.page-ref__option-icon :global(svg) {
  display: block;
}

.page-ref__title,
.page-ref__option-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  color: var(--xpe-foreground, #37352f);
}

.page-ref__arrow,
.page-ref__missing-label {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--xpe-muted-foreground, #9b9a97);
}

.page-ref__missing-label {
  font-size: 11px;
  font-weight: 600;
  color: #ef4444;
}

.page-ref__placeholder {
  color: var(--xpe-muted-foreground, #9b9a97);
  font-size: 14px;
}

.page-ref__picker {
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 10px;
  background: var(--xpe-popover-bg, #fff);
  box-shadow: 0 12px 32px rgb(15 15 15 / 0.1);
  overflow: hidden;
}

.page-ref__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--xpe-border, #e9e9e7);
  color: var(--xpe-muted-foreground, #9b9a97);
}

.page-ref__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: 14px;
  color: var(--xpe-foreground, #37352f);
}

.page-ref__search-input::placeholder {
  color: var(--xpe-muted-foreground, #9b9a97);
}

.page-ref__options {
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
}

.page-ref__option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.page-ref__option:hover,
.page-ref__option--active {
  background: var(--xpe-hover, #f1f1ef);
}

.page-ref__option--create {
  color: var(--xpe-primary, #2383e2);
}

.page-ref__option-icon--create {
  border: 1px dashed var(--xpe-border, #e9e9e7);
  border-radius: 4px;
  color: var(--xpe-primary, #2383e2);
}

.page-ref__name-step {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.page-ref__name-label {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--xpe-foreground, #37352f);
}

.page-ref__name-input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 6px;
  background: var(--xpe-background, #fff);
  outline: none;
  font: inherit;
  font-size: 14px;
  color: var(--xpe-foreground, #37352f);
}

.page-ref__name-input:focus {
  border-color: var(--xpe-primary, #2383e2);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--xpe-primary, #2383e2) 20%, transparent);
}

.page-ref__name-input::placeholder {
  color: var(--xpe-muted-foreground, #9b9a97);
}

.page-ref__name-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.page-ref__name-btn {
  margin: 0;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.page-ref__name-btn--ghost {
  background: transparent;
  color: var(--xpe-muted-foreground, #6b6b6b);
}

.page-ref__name-btn--ghost:hover {
  background: var(--xpe-hover, #f1f1ef);
  color: var(--xpe-foreground, #37352f);
}

.page-ref__name-btn--primary {
  background: var(--xpe-primary, #2383e2);
  color: #fff;
}

.page-ref__name-btn--primary:hover {
  filter: brightness(1.05);
}

</style>
