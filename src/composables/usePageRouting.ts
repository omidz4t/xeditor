export function pageLinkHash(pageId: string): string {
  return `#/page/${encodeURIComponent(pageId)}`
}

export function pageIdFromHash(hash = window.location.hash): string | null {
  const match = hash.match(/^#\/page\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export type PageNavigateOptions = {
  /**
   * When true (browser back/forward), restore the last scroll offset for that
   * page. Forward navigation should leave this false so the page opens at top.
   */
  restoreScroll?: boolean
}

type PageRoutingOptions = {
  getCurrentPageId: () => string
  navigate: (pageId: string, options?: PageNavigateOptions) => void
}

export function createPageRouting(options: PageRoutingOptions) {
  let suppressHistory = false

  function pushPageUrl(pageId: string, replace = false) {
    const hash = pageLinkHash(pageId)
    if (window.location.hash === hash) return

    const state = { pageId }
    if (replace) {
      window.history.replaceState(state, '', hash)
    } else {
      window.history.pushState(state, '', hash)
    }
  }

  function onPopState(event: PopStateEvent) {
    const pageId = (event.state as { pageId?: string } | null)?.pageId
      ?? pageIdFromHash(window.location.hash)

    if (!pageId || pageId === options.getCurrentPageId()) return

    suppressHistory = true
    // History back/forward: restore prior scroll for that page.
    options.navigate(pageId, { restoreScroll: true })
    suppressHistory = false
  }

  function noteNavigation(pageId: string, replace = false) {
    if (suppressHistory) return
    pushPageUrl(pageId, replace)
  }

  function readInitialPageId(fallbackPageId: string) {
    return pageIdFromHash(window.location.hash) ?? fallbackPageId
  }

  function install() {
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }

  return {
    install,
    noteNavigation,
    pushPageUrl,
    readInitialPageId,
  }
}