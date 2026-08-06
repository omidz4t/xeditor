/** Canonical inline page link stored in span marks (`marks.link`). */
export const PAGE_LINK_SCHEME = 'page:'

export function pageLinkMark(pageId: string): string {
  return `${PAGE_LINK_SCHEME}${pageId}`
}

export function pageLinkHash(pageId: string): string {
  return `#/page/${encodeURIComponent(pageId)}`
}

/** Parse a page id from a stored mark, hash, or href. */
export function parsePageLink(value: string | null | undefined): string | null {
  if (!value) return null

  if (value.startsWith(PAGE_LINK_SCHEME)) {
    const id = value.slice(PAGE_LINK_SCHEME.length).trim()
    return id || null
  }

  const hashMatch = value.match(/^#\/page\/([^/?#]+)/)
  if (hashMatch?.[1]) {
    return decodeURIComponent(hashMatch[1])
  }

  try {
    const url = new URL(value, 'https://page-link.invalid')
    const fromHash = url.hash.match(/^#\/page\/([^/?#]+)/)
    if (fromHash?.[1]) {
      return decodeURIComponent(fromHash[1])
    }
  } catch {
    // not a URL
  }

  return null
}

export function isPageLink(value: string | null | undefined): boolean {
  return parsePageLink(value) !== null
}