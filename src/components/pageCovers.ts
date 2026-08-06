/**
 * Page cover presets: solid/gradient colors + simple CSS patterns.
 * Stored as `color:<id>` or `pattern:<id>` on PageRecord.cover.
 */

export type CoverKind = 'color' | 'pattern'

export type CoverPreset = {
  id: string
  kind: CoverKind
  label: string
  /** CSS background value for the cover band. */
  background: string
  /** Small swatch preview (can be simpler than full cover). */
  swatch?: string
}

export const COVER_COLORS: CoverPreset[] = [
  {
    id: 'color:slate',
    kind: 'color',
    label: 'Slate',
    background: 'linear-gradient(135deg, #64748b 0%, #334155 100%)',
  },
  {
    id: 'color:blue',
    kind: 'color',
    label: 'Blue',
    background: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
  },
  {
    id: 'color:sky',
    kind: 'color',
    label: 'Sky',
    background: 'linear-gradient(135deg, #7dd3fc 0%, #0ea5e9 100%)',
  },
  {
    id: 'color:teal',
    kind: 'color',
    label: 'Teal',
    background: 'linear-gradient(135deg, #5eead4 0%, #0d9488 100%)',
  },
  {
    id: 'color:green',
    kind: 'color',
    label: 'Green',
    background: 'linear-gradient(135deg, #86efac 0%, #16a34a 100%)',
  },
  {
    id: 'color:yellow',
    kind: 'color',
    label: 'Yellow',
    background: 'linear-gradient(135deg, #fde047 0%, #eab308 100%)',
  },
  {
    id: 'color:orange',
    kind: 'color',
    label: 'Orange',
    background: 'linear-gradient(135deg, #fdba74 0%, #ea580c 100%)',
  },
  {
    id: 'color:red',
    kind: 'color',
    label: 'Red',
    background: 'linear-gradient(135deg, #fca5a5 0%, #dc2626 100%)',
  },
  {
    id: 'color:pink',
    kind: 'color',
    label: 'Pink',
    background: 'linear-gradient(135deg, #f9a8d4 0%, #db2777 100%)',
  },
  {
    id: 'color:purple',
    kind: 'color',
    label: 'Purple',
    background: 'linear-gradient(135deg, #c4b5fd 0%, #7c3aed 100%)',
  },
  {
    id: 'color:indigo',
    kind: 'color',
    label: 'Indigo',
    background: 'linear-gradient(135deg, #a5b4fc 0%, #4f46e5 100%)',
  },
  {
    id: 'color:warm',
    kind: 'color',
    label: 'Warm dusk',
    background: 'linear-gradient(120deg, #f97316 0%, #a855f7 50%, #3b82f6 100%)',
  },
]

/** Simple repeating patterns layered on soft base colors. */
export const COVER_PATTERNS: CoverPreset[] = [
  {
    id: 'pattern:dots',
    kind: 'pattern',
    label: 'Dots',
    background: `
      radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.35) 1.2px, transparent 0) 0 0 / 16px 16px,
      linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)
    `,
  },
  {
    id: 'pattern:grid',
    kind: 'pattern',
    label: 'Grid',
    background: `
      linear-gradient(rgb(255 255 255 / 0.12) 1px, transparent 1px) 0 0 / 20px 20px,
      linear-gradient(90deg, rgb(255 255 255 / 0.12) 1px, transparent 1px) 0 0 / 20px 20px,
      linear-gradient(160deg, #312e81 0%, #1e1b4b 100%)
    `,
  },
  {
    id: 'pattern:stripes',
    kind: 'pattern',
    label: 'Stripes',
    background: `
      repeating-linear-gradient(
        -45deg,
        rgb(255 255 255 / 0.1) 0 10px,
        transparent 10px 20px
      ),
      linear-gradient(135deg, #0f766e 0%, #134e4a 100%)
    `,
  },
  {
    id: 'pattern:diagonal',
    kind: 'pattern',
    label: 'Diagonal',
    background: `
      repeating-linear-gradient(
        45deg,
        transparent,
        transparent 12px,
        rgb(255 255 255 / 0.08) 12px,
        rgb(255 255 255 / 0.08) 24px
      ),
      linear-gradient(120deg, #7c2d12 0%, #9a3412 40%, #c2410c 100%)
    `,
  },
  {
    id: 'pattern:waves',
    kind: 'pattern',
    label: 'Waves',
    background: `
      radial-gradient(ellipse 120% 40% at 50% 0%, rgb(255 255 255 / 0.18), transparent 55%),
      radial-gradient(ellipse 100% 50% at 20% 80%, rgb(56 189 248 / 0.35), transparent 50%),
      radial-gradient(ellipse 90% 45% at 80% 70%, rgb(99 102 241 / 0.35), transparent 50%),
      linear-gradient(180deg, #0c4a6e 0%, #082f49 100%)
    `,
  },
  {
    id: 'pattern:checks',
    kind: 'pattern',
    label: 'Checks',
    background: `
      linear-gradient(45deg, rgb(255 255 255 / 0.08) 25%, transparent 25%) 0 0 / 24px 24px,
      linear-gradient(-45deg, rgb(255 255 255 / 0.08) 25%, transparent 25%) 0 0 / 24px 24px,
      linear-gradient(45deg, transparent 75%, rgb(255 255 255 / 0.08) 75%) 0 0 / 24px 24px,
      linear-gradient(-45deg, transparent 75%, rgb(255 255 255 / 0.08) 75%) 0 0 / 24px 24px,
      linear-gradient(135deg, #3f3f46 0%, #18181b 100%)
    `,
  },
  {
    id: 'pattern:noise',
    kind: 'pattern',
    label: 'Soft mesh',
    background: `
      radial-gradient(at 20% 30%, rgb(244 114 182 / 0.45) 0, transparent 45%),
      radial-gradient(at 80% 20%, rgb(96 165 250 / 0.4) 0, transparent 40%),
      radial-gradient(at 50% 80%, rgb(52 211 153 / 0.35) 0, transparent 45%),
      linear-gradient(160deg, #1f2937 0%, #111827 100%)
    `,
  },
  {
    id: 'pattern:horizon',
    kind: 'pattern',
    label: 'Horizon',
    background: `
      linear-gradient(180deg,
        #0ea5e9 0%,
        #38bdf8 28%,
        #fde68a 55%,
        #fb923c 78%,
        #9f1239 100%
      )
    `,
  },
]

export const ALL_COVERS: CoverPreset[] = [...COVER_COLORS, ...COVER_PATTERNS]

export function findCoverPreset(coverId?: string | null): CoverPreset | null {
  if (!coverId?.trim()) return null
  return ALL_COVERS.find((c) => c.id === coverId) ?? null
}

export function coverBackgroundStyle(coverId?: string | null): Record<string, string> {
  const preset = findCoverPreset(coverId)
  if (!preset) return {}
  return {
    background: preset.background.replace(/\s+/g, ' ').trim(),
  }
}
