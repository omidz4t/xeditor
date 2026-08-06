<script lang="ts">
  import { getContext } from 'svelte'
  import type { BlockRenderEntry } from '@xproeditor/core'
  import { toggleGroupPaddingPx, toggleVBoxChildPaddingPx } from '@xproeditor/core'
  import DocRendererBlock from './DocRendererBlock.svelte'
  import DocBlockTree from './DocBlockTree.svelte'
  import { DOC_RENDERER_CTX, type DocRendererContext } from './doc-renderer-context'

  let {
    entries,
    vboxBaseIndent,
  }: {
    entries: BlockRenderEntry[]
    vboxBaseIndent?: number
  } = $props()

  const ctx = getContext<DocRendererContext>(DOC_RENDERER_CTX)

  function childIndentPx(blockIndent: number): number {
    if (vboxBaseIndent === undefined) {
      return blockIndent * 24
    }
    return toggleVBoxChildPaddingPx(blockIndent, vboxBaseIndent, 24)
  }
</script>

{#each entries as entry (entry.block.id)}
  {#if entry.kind === 'column_list'}
    <div
      class="db-column-list"
      style="padding-inline-start: {toggleGroupPaddingPx(entry.block.props.indent ?? 0, vboxBaseIndent, 24)}px"
    >
      <div class="db-column-list__row">
        {#each entry.columns as column (column.block.id)}
          <div class="db-column-list__col">
            <DocBlockTree entries={column.children} />
          </div>
        {/each}
      </div>
    </div>
  {:else if entry.kind === 'toggle'}
    <div
      class="db-toggle-group"
      dir={ctx?.blockDirection(entry.block) ?? 'ltr'}
      style="padding-inline-start: {toggleGroupPaddingPx(entry.block.props.indent ?? 0, vboxBaseIndent, 24)}px"
    >
      <div class="db-toggle-vbox-header">
        <div class="db-toggle" dir={ctx.blockDirection(entry.block)}>
          <div class="db-toggle-marker">
            <button
              type="button"
              class={['db-toggle-btn', !ctx.isCollapsed(entry.block) && 'db-toggle-btn--open', ctx.blockDirection(entry.block) === 'rtl' && 'db-toggle-btn--rtl']
                .filter(Boolean)
                .join(' ')}
              aria-expanded={!ctx.isCollapsed(entry.block)}
              aria-label={ctx.isCollapsed(entry.block) ? 'Open' : 'Close'}
              onclick={() => ctx.setCollapsed(entry.block, !ctx.isCollapsed(entry.block))}
            >
              <svg class="db-toggle-caret" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2.835 3.25a.8.8 0 0 0-.69 1.203l5.164 8.854a.8.8 0 0 0 1.382 0l5.165-8.854a.8.8 0 0 0-.691-1.203z"
                />
              </svg>
            </button>
          </div>
          <span class="db-toggle-label">{@html ctx.inlineHtml(entry.block)}</span>
        </div>
      </div>

      {#if !ctx.isCollapsed(entry.block) && entry.children.length > 0}
        <div class="db-toggle-vbox">
          <DocBlockTree entries={entry.children} vboxBaseIndent={entry.block.props.indent ?? 0} />
        </div>
      {/if}
    </div>
  {:else}
    <DocRendererBlock block={entry.block} indentPx={childIndentPx(entry.block.props.indent ?? 0)} />
  {/if}
{/each}

<style>
  .db-toggle-group {
    width: 100%;
  }

  .db-toggle-vbox {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    padding-inline-start: 24px;
    box-sizing: border-box;
  }

  .db-column-list {
    width: 100%;
    margin: 0.35em 0;
  }

  .db-column-list__row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
  }

  .db-column-list__col {
    min-width: 0;
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
  }
</style>
