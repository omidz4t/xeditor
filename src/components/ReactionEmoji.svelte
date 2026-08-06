<script lang="ts">
  import { getReactionEntry } from '../reactions/reactionCatalog'

  let {
    emoji,
    size = '1em',
    decorative = false,
    class: className = '',
  }: {
    emoji: string
    size?: number | string
    decorative?: boolean
    class?: string
  } = $props()

  const entry = $derived(getReactionEntry(emoji))
  const sizeStyle = $derived.by(() => {
    const value = typeof size === 'number' ? `${size}px` : size
    return `width: ${value}; height: ${value}`
  })
</script>

{#if entry}
  <img
    class="reaction-emoji {className}"
    src={entry.src}
    alt={decorative ? '' : entry.label}
    title={entry.label}
    style={sizeStyle}
    aria-hidden={decorative ? 'true' : undefined}
    draggable="false"
  />
{:else}
  <span
    class="reaction-emoji reaction-emoji--fallback {className}"
    style={sizeStyle}
    title={emoji}
    aria-hidden={decorative ? 'true' : undefined}
  >{emoji}</span>
{/if}

<style>
  .reaction-emoji {
    display: block;
    flex: none;
    object-fit: contain;
    user-select: none;
    pointer-events: none;
  }

  .reaction-emoji--fallback {
    line-height: 1;
    text-align: center;
  }
</style>
