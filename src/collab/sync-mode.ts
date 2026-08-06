/** Shared collaboration transport for this webxdc instance (chat-wide). */
export type CollabSyncMode = 'realtime' | 'chat' | 'local'

const VALID_MODES = new Set<CollabSyncMode>(['realtime', 'chat', 'local'])

/** Payload field carried on silent webxdc status updates. */
export const COLLAB_MODE_PAYLOAD_KEY = 'collabMode' as const

const LOCAL_CACHE_KEY = 'xeditor-collab-mode'

export function isCollabSyncMode(value: unknown): value is CollabSyncMode {
  return typeof value === 'string' && VALID_MODES.has(value as CollabSyncMode)
}

export function collabModeLabel(mode: CollabSyncMode): string {
  switch (mode) {
    case 'realtime':
      return 'Realtime only'
    case 'chat':
      return 'Chat + live'
    case 'local':
      return 'Local only'
  }
}

export function collabModeDescription(mode: CollabSyncMode): string {
  switch (mode) {
    case 'realtime':
      return 'Live sync while people have the app open. No chat or email status updates — nothing is stored in chat history.'
    case 'chat':
      return 'Batched durable saves to chat history (status updates), plus live sync and presence while peers have the app open.'
    case 'local':
      return 'This device only. No sync and no chat/email updates.'
  }
}

/** Best-effort cache so reopening does not flash the setup UI while updates load. */
export function readCachedCollabMode(): CollabSyncMode | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY)
    return isCollabSyncMode(raw) ? raw : null
  } catch {
    return null
  }
}

export function writeCachedCollabMode(mode: CollabSyncMode): void {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, mode)
  } catch {
    // ignore quota / private mode
  }
}

export function extractCollabModeFromPayload(payload: unknown): CollabSyncMode | null {
  if (!payload || typeof payload !== 'object') return null
  const mode = (payload as Record<string, unknown>)[COLLAB_MODE_PAYLOAD_KEY]
  return isCollabSyncMode(mode) ? mode : null
}
