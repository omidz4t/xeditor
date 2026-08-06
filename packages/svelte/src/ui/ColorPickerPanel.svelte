<script lang="ts">
  let {
    compact: _compact = false,
    hideContrastRatio: _hideContrastRatio = false,
    hideDefaultSwatches: _hideDefaultSwatches = false,
    value = $bindable('#000000'),
  }: {
    compact?: boolean
    hideContrastRatio?: boolean
    hideDefaultSwatches?: boolean
    value?: string
  } = $props()

  let hexDraft = $state(value)

  $effect(() => {
    hexDraft = value
  })

  let isValidHex = $derived(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hexDraft))

  function commitHex(): void {
    if (isValidHex) value = hexDraft
  }

  function onNativeColorInput(event: Event): void {
    const v = (event.target as HTMLInputElement).value
    hexDraft = v
    value = v
  }

  function onHexKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitHex()
    }
  }
</script>

<div class="xpe-color-picker">
  <input type="color" class="xpe-color-swatch" value={value} oninput={onNativeColorInput} />
  <input
    bind:value={hexDraft}
    type="text"
    class="xpe-color-hex"
    spellcheck="false"
    placeholder="#000000"
    onkeydown={onHexKeydown}
    onblur={commitHex}
  />
</div>

<style>
  .xpe-color-picker {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .xpe-color-swatch {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    background: none;
  }
  .xpe-color-hex {
    flex: 1;
    height: 32px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 0 8px;
    font-size: 12px;
    font-family: var(--xpe-font-mono, ui-monospace, monospace);
    outline: none;
  }
  .xpe-color-hex:focus {
    border-color: #6366f1;
  }
</style>
