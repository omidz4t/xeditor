<script lang="ts">
  let {
    placeholder = '',
    value = $bindable(''),
    class: className = '',
    onkeydown,
    oninput,
    onchange,
  }: {
    placeholder?: string
    value?: string
    class?: string
    onkeydown?: (e: KeyboardEvent) => void
    oninput?: (e: Event) => void
    onchange?: (e: Event) => void
  } = $props()
</script>

<input
  bind:value
  type="text"
  class={['xpe-input', className].filter(Boolean).join(' ')}
  {placeholder}
  {onkeydown}
  {oninput}
  {onchange}
/>

<style>
  .xpe-input {
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--xpe-border, #e5e7eb);
    padding: 0 10px;
    font-size: 13px;
    color: var(--xpe-foreground, #111827);
    background: var(--xpe-popover-bg, #fff);
    outline: none;
    transition:
      border-color 0.12s,
      box-shadow 0.12s;
  }
  .xpe-input:focus {
    border-color: var(--xpe-primary, #6366f1);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--xpe-primary, #6366f1) 15%, transparent);
  }
  .xpe-input::placeholder {
    color: var(--xpe-muted-foreground, #9ca3af);
  }
</style>
