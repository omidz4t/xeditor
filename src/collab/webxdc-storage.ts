/**
 * Helpers for durable WebXDC mock storage.
 * Dev mock persists status history in IndexedDB (see src/dev/webxdc-mock-idb.js),
 * never localStorage.
 */

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; code?: number; message?: string }
  if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) return true
  const msg = String(e.message ?? '')
  return /quota|exceeded the quota|storage/i.test(msg)
}

type MockWebxdc = {
  __clearMockUpdates?: () => void | Promise<void>
}

function mockApi(): MockWebxdc | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { webxdc?: MockWebxdc }).webxdc ?? null
}

/** Clear mock status history (IndexedDB). No-op on real hosts. */
export async function clearMockXdcUpdates(): Promise<void> {
  const api = mockApi()
  if (api?.__clearMockUpdates) {
    try {
      await api.__clearMockUpdates()
      return
    } catch {
      // fall through
    }
  }
  // Legacy localStorage key from the old stock mock — purge if present.
  try {
    localStorage.removeItem('__xdcUpdatesKey__')
    localStorage.removeItem('__xdcEphemeralUpdateKey__')
  } catch {
    // ignore
  }
}

/** @deprecated use clearMockXdcUpdates — kept for call sites that expect sync void */
export function compactMockXdcUpdates(_keep?: number): boolean {
  void clearMockXdcUpdates()
  return true
}

/** No proactive size check needed with IndexedDB; kept as a no-op hook. */
export function maybeCompactMockXdcUpdates(): void {
  // Drop any leftover localStorage mock payload from older sessions.
  try {
    if (localStorage.getItem('__xdcUpdatesKey__')) {
      localStorage.removeItem('__xdcUpdatesKey__')
      localStorage.removeItem('__xdcEphemeralUpdateKey__')
    }
  } catch {
    // ignore
  }
}

export function estimateMockUpdatesSize(): number {
  return 0
}
