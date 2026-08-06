<script lang="ts">
  import { getContext } from 'svelte'
  import LinkIcon from '@lucide/svelte/icons/link'
  import { spansToHtml, tableWrapperStyle } from '@xproeditor/core'
  import type { Block } from '@xproeditor/core'
  import IconValueDisplay from '../ui/IconValueDisplay.svelte'
  import { DOC_RENDERER_CTX, type DocRendererContext } from './doc-renderer-context'

  let {
    block,
    indentPx,
  }: {
    block: Block
    indentPx?: number
  } = $props()

  const ctx = getContext<DocRendererContext>(DOC_RENDERER_CTX)!

  function indentStyle(): string {
    const px = indentPx ?? (block.props.indent ?? 0) * 24
    return `padding-inline-start: ${px}px`
  }

  function marginStartStyle(extra?: string): string {
    const px = indentPx ?? (block.props.indent ?? 0) * 24
    return `margin-inline-start: ${px}px${extra ? `; ${extra}` : ''}`
  }

  function styleToString(style: Record<string, string> | string | null | undefined): string {
    if (!style) return ''
    if (typeof style === 'string') return style
    return Object.entries(style)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v}`)
      .join('; ')
  }

  let headingTag = $derived(ctx.headingTag(block.type))
  let table = $derived(block.type === 'table' && block.props.table ? ctx.tableForBlock(block) : null)
</script>

{#if block.type.startsWith('heading')}
  <svelte:element this={headingTag} id={ctx.anchorFor(block.id)} class="db-heading group db-{block.type}" dir="auto">
    <span>{@html ctx.inlineHtml(block)}</span>
    {#if ctx.anchorFor(block.id)}
      <button
        type="button"
        class="db-anchor-btn"
        title={ctx.isCopiedAnchor(ctx.anchorFor(block.id)!) ? 'Copied!' : 'Copy link'}
        onclick={() => ctx.copyAnchor(ctx.anchorFor(block.id)!)}
      >
        <LinkIcon class="w-3.5 h-3.5" />
      </button>
    {/if}
  </svelte:element>
{:else if block.type === 'paragraph'}
  <p
    class="db-p"
    dir="auto"
    style="{indentStyle()}; text-align: {block.props.align ?? ''}"
  >
    {@html ctx.inlineHtml(block)}
  </p>
{:else if block.type === 'bulleted_list_item' || block.type === 'numbered_list_item'}
  <div class="db-li" dir={ctx.blockDirection(block)} style={indentStyle()}>
    <span class="db-li-marker" class:tabular-nums={block.type === 'numbered_list_item'}>
      {#if block.type === 'bulleted_list_item'}
        •
      {:else}
        {#if ctx.blockDirection(block) === 'rtl'}
          {String(ctx.listNumber(block.id)).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d)}.
        {:else}
          {ctx.listNumber(block.id)}.
        {/if}
      {/if}
    </span>
    <span class="db-li-content">{@html ctx.inlineHtml(block)}</span>
  </div>
{:else if block.type === 'to_do'}
  <div class="db-li" dir={ctx.blockDirection(block)} style={indentStyle()}>
    <span class="db-todo-box" class:db-todo-checked={!!block.props.checked}>
      {#if block.props.checked}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3.5 8.2 6.6 11.2 12.5 4.8"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      {/if}
    </span>
    <span class="db-li-content" class:line-through={!!block.props.checked} class:opacity-50={!!block.props.checked}>
      {@html ctx.inlineHtml(block)}
    </span>
  </div>
{:else if block.type === 'quote'}
  <blockquote class="db-quote" dir="auto" style={marginStartStyle()}>
    {@html ctx.inlineHtml(block)}
  </blockquote>
{:else if block.type === 'callout'}
  <div
    class="db-callout"
    dir={ctx.blockDirection(block)}
    style={marginStartStyle(block.props.color ? `background: ${block.props.color}` : undefined)}
  >
    <span class="db-callout-icon">
      <IconValueDisplay icon={block.props.icon ?? '💡'} class="text-lg" />
    </span>
    <span class="db-li-content">{@html ctx.inlineHtml(block)}</span>
  </div>
{:else if block.type === 'code'}
  <div class="db-code" dir="ltr">
    <div class="db-code-header">
      <span>{block.props.language ?? 'plaintext'}</span>
    </div>
    <pre><code class="hljs">{@html ctx.highlightCode(block.props.code ?? '', block.props.language)}</code></pre>
  </div>
{:else if block.type === 'divider'}
  <hr class="db-divider" />
{:else if block.type === 'page'}
  <div class="db-page-ref">
    {#if block.props.pageIcon}
      <span class="db-page-ref__icon">{block.props.pageIcon}</span>
    {/if}
    <span class="db-page-ref__title">{block.props.pageTitle?.trim() || 'Untitled'}</span>
  </div>
{:else if block.type === 'poll'}
  <div class="db-poll">
    <div class="db-poll__header">
      <span class="db-poll__label">Poll</span>
      {#if block.props.pollClosed}
        <span class="db-poll__badge">Closed</span>
      {/if}
    </div>
    <p class="db-poll__question">{@html ctx.inlineHtml(block) || 'Poll'}</p>
    <ul class="db-poll__options">
      {#each block.props.pollOptions ?? [] as opt (opt.id)}
        <li class="db-poll__option">
          <span class="db-poll__option-text">{opt.text || 'Option'}</span>
          <span class="db-poll__option-votes">{opt.votes?.length ?? 0}</span>
        </li>
      {/each}
    </ul>
  </div>
{:else if block.type === 'image' && block.props.url}
  <figure class="db-figure">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <button type="button" class="db-img-btn" onclick={() => ctx.openLightbox(block.props.url ?? '')}>
      <img
        src={block.props.url}
        alt={block.props.caption || ''}
        style:width="{(block.props.width ?? 100)}%"
        class="db-img"
        loading="lazy"
      />
    </button>
    {#if block.props.caption}
      <figcaption class="db-caption">{block.props.caption}</figcaption>
    {/if}
  </figure>
{:else if block.type === 'table' && table}
  <div
    class="db-table-wrap"
    class:db-table-wrap--expanded={table.expanded}
    dir="auto"
    style={styleToString(tableWrapperStyle(table.style, table.width))}
  >
    <table class="db-table">
      <tbody>
        {#each table.rows as row, rIdx (rIdx)}
          <tr>
            {#each row as cell, cIdx (cIdx)}
              {#if !cell.hidden}
                {#if rIdx === 0 && table.hasHeader}
                  <th
                    colspan={cell.colspan && cell.colspan > 1 ? cell.colspan : undefined}
                    rowspan={cell.rowspan && cell.rowspan > 1 ? cell.rowspan : undefined}
                    style={ctx.renderCellStyle(cell, rIdx, table.hasHeader, block)}
                    dir="auto"
                  >
                    {@html spansToHtml(cell.content)}
                  </th>
                {:else}
                  <td
                    colspan={cell.colspan && cell.colspan > 1 ? cell.colspan : undefined}
                    rowspan={cell.rowspan && cell.rowspan > 1 ? cell.rowspan : undefined}
                    style={ctx.renderCellStyle(cell, rIdx, table.hasHeader, block)}
                    dir="auto"
                  >
                    {@html spansToHtml(cell.content)}
                  </td>
                {/if}
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
.db-img-btn {
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
  width: 100%;
  text-align: inherit;
}
</style>
