export interface TabsContext {
  get active(): string
  set active(value: string)
  setActive: (value: string) => void
}

export const tabsContextKey = Symbol('xpe-tabs')
