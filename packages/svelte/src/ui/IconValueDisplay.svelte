<script lang="ts">
  let {
    icon = '',
    value,
    class: className = '',
  }: {
    icon?: string
    value?: string
    class?: string
  } = $props()

  let display = $derived(icon || value || '')
</script>

<span class={['icon-value', className].filter(Boolean).join(' ')}>{display}</span>
