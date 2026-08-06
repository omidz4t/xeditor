<script lang="ts">
  import type { AppCommand } from '../composables/useAppCommands'
  import { portal } from '../lib/portal'

  let {
    open = $bindable(false),
    commands,
    x,
    y,
  }: {
    open?: boolean
    commands: AppCommand[]
    x: number
    y: number
  } = $props()

  let menuEl: HTMLElement | null = $state(null)

  function close() {
    open = false
  }

  function run(command: AppCommand) {
    command.run()
    close()
  }

  function onDocumentPointerDown(event: MouseEvent) {
    if (!open || !menuEl) return
    if (!menuEl.contains(event.target as Node)) close()
  }

  function onDocumentKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close()
  }

  function placeMenu() {
    const menu = menuEl
    if (!menu || typeof window === 'undefined') return
    const rect = menu.getBoundingClientRect()
    const padding = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y

    // Prefer opening slightly below the cursor, but keep fully on-screen.
    if (left + rect.width > vw - padding) {
      left = vw - rect.width - padding
    }
    if (left < padding) left = padding

    if (top + rect.height > vh - padding) {
      // Flip above the cursor when it would overflow the bottom.
      top = y - rect.height
    }
    if (top < padding) top = padding
    if (top + rect.height > vh - padding) {
      top = Math.max(padding, vh - rect.height - padding)
    }

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.maxWidth = `min(280px, calc(100vw - ${padding * 2}px))`
    menu.style.maxHeight = `calc(100vh - ${padding * 2}px)`
    menu.style.overflowY = 'auto'
  }

  $effect(() => {
    if (!open) return
    void x
    void y
    void commands.length
    requestAnimationFrame(() => {
      placeMenu()
      requestAnimationFrame(() => placeMenu())
    })
  })

  $effect(() => {
    document.addEventListener('mousedown', onDocumentPointerDown)
    document.addEventListener('keydown', onDocumentKeydown)
    return () => {
      document.removeEventListener('mousedown', onDocumentPointerDown)
      document.removeEventListener('keydown', onDocumentKeydown)
    }
  })
</script>

{#if open}
  <div
    use:portal
    bind:this={menuEl}
    class="context-menu"
    role="menu"
    tabindex="-1"
    style="left: {x}px; top: {y}px"
    onmousedown={(e) => e.preventDefault()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each commands as command (command.id)}
      <button
        type="button"
        class="context-menu-item"
        role="menuitem"
        onclick={() => run(command)}
      >
        <span>{command.label}</span>
        {#if command.shortcut}
          <kbd class="context-menu-kbd">{command.shortcut}</kbd>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 10002;
    box-sizing: border-box;
    min-width: 220px;
    max-width: min(280px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
    border-radius: 10px;
    background: var(--settings-panel-bg);
    border: 1px solid var(--settings-panel-border);
    box-shadow: var(--settings-panel-shadow);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    border: none;
    border-radius: 7px;
    background: transparent;
    padding: 8px 10px;
    text-align: left;
    font-size: 13px;
    color: var(--settings-text);
    cursor: pointer;
  }

  .context-menu-item:hover {
    background: var(--settings-hover);
  }

  .context-menu-kbd {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--settings-control-bg);
    border: 1px solid var(--settings-control-border);
    color: var(--settings-muted);
    font-size: 10px;
    font-family: inherit;
  }
</style>
