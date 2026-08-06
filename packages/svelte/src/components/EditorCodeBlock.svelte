<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { Block } from '@xproeditor/core'

  let {
    block,
    readonly = false,
    onpatch,
    onarrowup,
    onarrowdown,
    onremoveself,
    onexitbelow,
  }: {
    block: Block
    readonly?: boolean
    onpatch?: (patch: Record<string, unknown>) => void
    onarrowup?: () => void
    onarrowdown?: () => void
    onremoveself?: () => void
    onexitbelow?: () => void
  } = $props()

  const LANGUAGES = [
    'plaintext',
    'javascript',
    'typescript',
    'python',
    'bash',
    'json',
    'yaml',
    'html',
    'css',
    'sql',
    'go',
    'rust',
    'java',
    'c',
    'cpp',
    'csharp',
    'php',
    'ruby',
    'swift',
    'kotlin',
    'dockerfile',
    'markdown',
    'xml',
    'diff',
  ]

  let textarea: HTMLTextAreaElement | null = $state(null)
  let code = $derived(block.props.code ?? '')

  function autoresize() {
    const ta = textarea
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }

  onMount(autoresize)

  function onInput(e: Event) {
    if (readonly) return
    onpatch?.({ code: (e.target as HTMLTextAreaElement).value })
    autoresize()
  }

  function onKeydown(e: KeyboardEvent) {
    if (readonly) return
    const ta = textarea
    if (!ta) return

    if (e.key === 'Tab') {
      e.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const value = ta.value.slice(0, start) + '  ' + ta.value.slice(end)
      onpatch?.({ code: value })
      void tick().then(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
        autoresize()
      })
      return
    }

    if (e.key === 'Backspace' && ta.value === '') {
      e.preventDefault()
      onremoveself?.()
      return
    }

    // Leave the code block when the caret is on the first / last line.
    if (e.key === 'ArrowUp' && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      const before = ta.value.slice(0, ta.selectionStart)
      if (!before.includes('\n')) {
        e.preventDefault()
        onarrowup?.()
        return
      }
    }

    if (e.key === 'ArrowDown' && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      const after = ta.value.slice(ta.selectionStart)
      // Last line (nothing after caret contains a newline) → leave the block.
      // When this is the last block in the doc, handleArrow creates a paragraph below.
      if (!after.includes('\n')) {
        e.preventDefault()
        onarrowdown?.()
        return
      }
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onexitbelow?.()
    }
  }

  export function focusAt(pos: number | 'start' | 'end' = 'end') {
    const ta = textarea
    if (!ta) return
    ta.focus()
    const offset = pos === 'start' ? 0 : pos === 'end' ? ta.value.length : pos
    ta.selectionStart = ta.selectionEnd = offset
  }
</script>

<div class="ecb group/code overflow-hidden border border-gray-200" dir="ltr">
  <div class="flex items-center justify-between px-3 py-1.5 bg-[#16182a] border-b border-white/5">
    <select
      class="bg-transparent text-[11px] text-gray-400 outline-none cursor-pointer hover:text-gray-200"
      value={block.props.language ?? 'plaintext'}
      disabled={readonly}
      onchange={(e) => onpatch?.({ language: (e.target as HTMLSelectElement).value })}
      onmousedown={(e) => e.stopPropagation()}
    >
      {#each LANGUAGES as lang (lang)}
        <option value={lang} class="bg-[#16182a]">{lang}</option>
      {/each}
    </select>
    <span class="text-[10px] text-gray-500 opacity-0 group-hover/code:opacity-100 transition-opacity select-none"
      >Ctrl+Enter to exit</span
    >
  </div>
  <textarea
    bind:this={textarea}
    value={code}
    {readonly}
    class="block w-full resize-none outline-none px-4 py-3 bg-[#1e1e2e] text-[#cdd6f4] font-mono text-[13px] leading-relaxed"
    rows="1"
    placeholder="Write code..."
    spellcheck="false"
    oninput={onInput}
    onkeydown={onKeydown}
  ></textarea>
</div>

<style>
  .ecb,
  .ecb textarea {
    border-radius: 0 !important;
  }
  .ecb textarea {
    min-height: 48px;
    tab-size: 2;
  }
</style>
