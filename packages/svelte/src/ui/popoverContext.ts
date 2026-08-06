export interface PopoverContext {
  /** Reactive open flag — always read `ctx.open` (it's $state on this object). */
  open: boolean
  setOpen: (value: boolean) => void
  triggerEl: { current: HTMLElement | null }
}

export const popoverContextKey = Symbol('xpe-popover')
