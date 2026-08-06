<script lang="ts">
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3'
  import Plus from '@lucide/svelte/icons/plus'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import { generateBlockId, spansToText, type Block, type PollOption } from '@xproeditor/core'

  let {
    block, selected = false, readonly = false, voterId,
    onpatch, onselect, onfocus, onexitbelow,
  }: {
    block: Block
    selected?: boolean
    readonly?: boolean
    voterId?: string
    onpatch?: (patch: Record<string, unknown>) => void
    onselect?: () => void
    onfocus?: () => void
    onexitbelow?: () => void
  } = $props()

  let localVoterId = $state('')
  function resolveVoterId(): string {
    if (voterId?.trim()) return voterId.trim()
    if (typeof localStorage !== 'undefined') {
      const key = 'xpe-poll-voter'
      let id = localStorage.getItem(key)
      if (!id) { id = generateBlockId(); localStorage.setItem(key, id) }
      localVoterId = id
      return id
    }
    if (!localVoterId) localVoterId = generateBlockId()
    return localVoterId
  }

  let question = $derived(spansToText(block.content))
  let options = $derived(block.props.pollOptions ?? [])
  let allowMultiple = $derived(!!block.props.pollAllowMultiple)
  let closed = $derived(!!block.props.pollClosed)
  let totalVotes = $derived(options.reduce((sum: number, opt: PollOption) => sum + (opt.votes?.length ?? 0), 0))

  function percent(opt: PollOption): number {
    if (totalVotes <= 0) return 0
    return Math.round(((opt.votes?.length ?? 0) / totalVotes) * 100)
  }
  function hasVoted(opt: PollOption): boolean {
    return (opt.votes ?? []).includes(resolveVoterId())
  }
  function emitOptions(next: PollOption[]) {
    onpatch?.({ pollOptions: next.map((o) => ({ ...o, votes: [...(o.votes ?? [])] })) })
  }
  function onQuestionInput(event: Event) {
    const value = (event.target as HTMLInputElement).value
    block.content = value ? [{ text: value }] : []
    onpatch?.({})
    onfocus?.()
  }
  function onOptionText(optId: string, event: Event) {
    const value = (event.target as HTMLInputElement).value
    emitOptions(options.map((o) => (o.id === optId ? { ...o, text: value } : o)))
    onfocus?.()
  }
  function addOption() {
    if (readonly || closed) return
    emitOptions([...options, { id: generateBlockId(), text: '', votes: [] }])
  }
  function removeOption(optId: string) {
    if (readonly || closed || options.length <= 2) return
    emitOptions(options.filter((o) => o.id !== optId))
  }
  function toggleVote(optId: string) {
    if (readonly || closed) return
    const voter = resolveVoterId()
    const multi = allowMultiple
    emitOptions(options.map((o) => {
      const votes = [...(o.votes ?? [])]
      const has = votes.includes(voter)
      if (o.id === optId) {
        if (has) return { ...o, votes: votes.filter((v) => v !== voter) }
        return { ...o, votes: [...votes, voter] }
      }
      if (!multi && votes.includes(voter)) return { ...o, votes: votes.filter((v) => v !== voter) }
      return o
    }))
    onselect?.(); onfocus?.()
  }
  function onQuestionKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onexitbelow?.() }
  }
  function setAllowMultiple(value: boolean) {
    onpatch?.({ pollAllowMultiple: value })
  }
  function setClosed(value: boolean) {
    onpatch?.({ pollClosed: value })
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="epb" class:epb--selected={selected} class:epb--closed={closed} onclick={() => onselect?.()} role="presentation">
  <div class="epb-header">
    <BarChart3 class="epb-header__icon" size={18} strokeWidth={2} />
    <span class="epb-header__label">Poll</span>
    {#if totalVotes > 0}<span class="epb-header__count">{totalVotes} vote{totalVotes === 1 ? '' : 's'}</span>{/if}
    {#if closed}<span class="epb-header__badge">Closed</span>{/if}
  </div>
  <input class="epb-question" type="text" value={question} {readonly} placeholder="Ask a question…" onclick={(e) => e.stopPropagation()} onfocus={() => { onfocus?.(); onselect?.() }} oninput={onQuestionInput} onkeydown={onQuestionKeydown} />
  <div class="epb-options">
    {#each options as opt (opt.id)}
      <div class="epb-option" class:epb-option--voted={hasVoted(opt)}>
        <button type="button" class="epb-option__vote" disabled={readonly || closed} aria-pressed={hasVoted(opt)} title={hasVoted(opt) ? 'Remove vote' : 'Vote'} onclick={(e) => { e.stopPropagation(); toggleVote(opt.id) }}>
          <span class="epb-option__radio" class:epb-option__radio--on={hasVoted(opt)} class:epb-option__radio--multi={allowMultiple}></span>
        </button>
        <div class="epb-option__main">
          <input class="epb-option__text" type="text" value={opt.text} readonly={readonly || closed} placeholder="Option" onclick={(e) => e.stopPropagation()} onfocus={() => onselect?.()} oninput={(e) => onOptionText(opt.id, e)} />
          <div class="epb-option__bar-track" aria-hidden="true"><div class="epb-option__bar-fill" style:width="{percent(opt)}%"></div></div>
        </div>
        <span class="epb-option__pct">{percent(opt)}%</span>
        <span class="epb-option__votes">{opt.votes?.length ?? 0}</span>
        {#if !readonly && !closed && options.length > 2}
          <button type="button" class="epb-option__remove" title="Remove option" aria-label="Remove option" onclick={(e) => { e.stopPropagation(); removeOption(opt.id) }}><Trash2 size={14} strokeWidth={2} /></button>
        {/if}
      </div>
    {/each}
  </div>
  {#if !readonly}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="epb-footer" role="presentation" onclick={(e) => e.stopPropagation()}>
      {#if !closed}
        <button type="button" class="epb-footer__btn" onclick={addOption}><Plus size={14} strokeWidth={2} /> Add option</button>
      {/if}
      <label class="epb-footer__check">
        <input type="checkbox" checked={allowMultiple} disabled={closed} onchange={(e) => setAllowMultiple((e.target as HTMLInputElement).checked)} />
        Multiple choice
      </label>
      <button type="button" class="epb-footer__btn epb-footer__btn--muted" onclick={() => setClosed(!closed)}>{closed ? 'Reopen poll' : 'Close poll'}</button>
    </div>
  {/if}
</div>

<style>

.epb {
  margin: 4px 0;
  padding: 14px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 12px;
  background: var(--xpe-background, #fff);
  color: var(--xpe-foreground, #37352f);
  transition: border-color 0.12s, box-shadow 0.12s;
}

.epb--selected {
  border-color: var(--xpe-primary, #2383e2);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--xpe-primary, #2383e2) 35%, transparent);
}

.epb--closed {
  opacity: 0.92;
}

.epb-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--xpe-muted-foreground, #9b9a97);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.epb-header__icon {
  flex-shrink: 0;
  color: var(--xpe-primary, #2383e2);
}

.epb-header__label {
  color: var(--xpe-foreground, #37352f);
}

.epb-header__count {
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}

.epb-header__badge {
  margin-inline-start: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--xpe-muted, #f7f6f3);
  color: var(--xpe-muted-foreground, #9b9a97);
  font-size: 11px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}

.epb-question {
  display: block;
  width: 100%;
  margin: 0 0 12px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--xpe-foreground, #37352f);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  outline: none;
}

.epb-question::placeholder {
  color: var(--xpe-muted-foreground, #9b9a97);
  font-weight: 500;
}

.epb-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.epb-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.epb-option__vote {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}

.epb-option__vote:disabled {
  cursor: default;
  opacity: 0.7;
}

.epb-option__radio {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--xpe-border, #d1d5db);
  border-radius: 50%;
  background: var(--xpe-background, #fff);
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
}

.epb-option__radio--multi {
  border-radius: 4px;
}

.epb-option__radio--on {
  border-color: var(--xpe-primary, #2383e2);
  background: var(--xpe-primary, #2383e2);
  box-shadow: inset 0 0 0 3px var(--xpe-background, #fff);
}

.epb-option__radio--multi.epb-option__radio--on {
  box-shadow: inset 0 0 0 2px var(--xpe-background, #fff);
}

.epb-option__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.epb-option__text {
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 8px;
  background: var(--xpe-muted, #f7f6f3);
  color: var(--xpe-foreground, #37352f);
  font: inherit;
  font-size: 14px;
  outline: none;
}

.epb-option__text:focus {
  border-color: var(--xpe-primary, #2383e2);
  background: var(--xpe-background, #fff);
}

.epb-option__text::placeholder {
  color: var(--xpe-muted-foreground, #9b9a97);
}

.epb-option__bar-track {
  height: 4px;
  border-radius: 999px;
  background: var(--xpe-border, #e9e9e7);
  overflow: hidden;
}

.epb-option__bar-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--xpe-primary, #2383e2);
  transition: width 0.2s ease;
}

.epb-option__pct,
.epb-option__votes {
  flex-shrink: 0;
  min-width: 2.2em;
  font-size: 12px;
  font-weight: 600;
  color: var(--xpe-muted-foreground, #9b9a97);
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.epb-option__remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--xpe-muted-foreground, #9b9a97);
  cursor: pointer;
}

.epb-option__remove:hover {
  background: var(--xpe-hover, #f1f1ef);
  color: var(--xpe-foreground, #37352f);
}

.epb-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--xpe-border, #e9e9e7);
}

.epb-footer__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--xpe-border, #e9e9e7);
  border-radius: 8px;
  background: var(--xpe-background, #fff);
  color: var(--xpe-foreground, #37352f);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.epb-footer__btn:hover {
  background: var(--xpe-hover, #f1f1ef);
}

.epb-footer__btn--muted {
  color: var(--xpe-muted-foreground, #9b9a97);
}

.epb-footer__check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--xpe-muted-foreground, #9b9a97);
  cursor: pointer;
  user-select: none;
}

.epb-footer__check input {
  accent-color: var(--xpe-primary, #2383e2);
}

</style>
