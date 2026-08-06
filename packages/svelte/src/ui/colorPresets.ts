import type { TableBorderStyleKind, TableBorderWidth } from '@xproeditor/core'

/** Default document text (clears the color mark when chosen). */
export const DEFAULT_TEXT_COLOR = '#37352f'

/** Predefined text colors only — no free-form picker. */
export const TEXT_COLOR_PRESETS = [
  '#37352f',
  '#eb5757',
  '#e67e22',
  '#dfab01',
  '#4dab9a',
  '#2383e2',
  '#9065b0',
  '#ff7369',
  '#9b9a97',
  '#ffffff',
]

/** Predefined highlight colors only — no free-form picker. */
export const HIGHLIGHT_PRESETS = [
  '#fdecc8',
  '#f5e0e9',
  '#e8deee',
  '#d3e5ef',
  '#dbeddb',
  '#f4dfeb',
  '#ffe2dd',
  '#e3e2e0',
]

export const TABLE_BG_PRESETS = [
  '#f8fafc',
  '#fef9c3',
  '#ffedd5',
  '#dcfce7',
  '#dbeafe',
  '#ede9fe',
  '#fce7f3',
  '#f3f4f6',
  '#ffffff',
]

export const TABLE_BORDER_PRESETS = [
  '#e5e7eb',
  '#9ca3af',
  '#4b5563',
  '#ef4444',
  '#6366f1',
  '#22c55e',
]

export const TABLE_BORDER_WIDTHS: TableBorderWidth[] = [0, 1, 2, 3, 4]

export const TABLE_BORDER_STYLES: TableBorderStyleKind[] = ['solid', 'dashed', 'dotted', 'none']
