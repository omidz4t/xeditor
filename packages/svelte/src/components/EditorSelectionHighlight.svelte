<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { getRangeClientRects } from '@xproeditor/core'

  let {
    target,
    start,
    end,
  }: {
    target: HTMLElement | null
    start: number
    end: number
  } = $props()

  let containerRef: HTMLElement | null = $state(null)
  let rects: Array<{ top: number; left: number; width: number; height: number }> = $state([])

  function updateRects() {
    if (!target || !containerRef || end <= start) {
      rects = []
      return
    }

    const containerBox = containerRef.getBoundingClientRect()
    const clientRects = getRangeClientRects(target, start, end)

    rects = clientRects.map((r) => ({
      top: r.top - containerBox.top,
      left: r.left - containerBox.left,
      width: r.width,
      height: r.height,
    }))
  }

  let ro: ResizeObserver | null = null

  function bindObservers() {
    ro?.disconnect()
    ro = null

    if (!target) {
      return
    }

    ro = new ResizeObserver(() => updateRects())
    ro.observe(target)
  }

  $effect(() => {
    void target
    void start
    void end
    void tick().then(() => {
      updateRects()
      bindObservers()
    })
  })

  onMount(() => {
    window.addEventListener('scroll', updateRects, true)
    window.addEventListener('resize', updateRects)
  })

  onDestroy(() => {
    window.removeEventListener('scroll', updateRects, true)
    window.removeEventListener('resize', updateRects)
    ro?.disconnect()
  })
</script>

<div bind:this={containerRef} class="esh-layer pointer-events-none absolute inset-0 overflow-visible">
  {#each rects as rect, i (i)}
    <div
      class="esh-rect absolute"
      style="top: {rect.top}px; left: {rect.left}px; width: {rect.width}px; height: {rect.height}px"
    ></div>
  {/each}
</div>

<style>
  .esh-rect {
    background: var(--pro-editor-selection, rgb(35 131 226 / 0.18));
    border-radius: 0;
  }
</style>
