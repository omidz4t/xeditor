import { writable, get } from 'svelte/store'

const commentsOpen = writable(false)

export function useCommentsPanel() {
  function setCommentsOpen(open: boolean) {
    commentsOpen.set(!!open)
  }

  function toggleCommentsOpen() {
    commentsOpen.update((open) => !open)
  }

  return {
    commentsOpen,
    setCommentsOpen,
    toggleCommentsOpen,
    getCommentsOpen: () => get(commentsOpen),
  }
}
