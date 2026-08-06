/**
 * Layout-independent keyboard helpers.
 *
 * On non-Latin layouts (e.g. Farsi), `event.key` is the produced character
 * (ش for physical A) while `event.code` stays `KeyA`. Prefer `code` for
 * Ctrl/Cmd shortcuts so they match QWERTY positions in every locale.
 */

export function hasMod(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey
}

/** True when the event is the physical letter key (A–Z), any keyboard layout. */
export function isLetterKey(event: KeyboardEvent, letter: string): boolean {
  const L = letter.toLowerCase()
  if (L.length !== 1 || L < 'a' || L > 'z') return false
  if (event.code === `Key${L.toUpperCase()}`) return true
  // Latin `key` for synthetic events / some platforms
  return event.key.toLowerCase() === L
}

/**
 * Ctrl/Cmd + letter shortcut.
 * @param shift — `true` require Shift, `false` forbid Shift, omit = either
 */
export function isModLetter(
  event: KeyboardEvent,
  letter: string,
  options: { shift?: boolean; allowAlt?: boolean } = {},
): boolean {
  if (!hasMod(event)) return false
  if (!options.allowAlt && event.altKey) return false
  if (options.shift === true && !event.shiftKey) return false
  if (options.shift === false && event.shiftKey) return false
  return isLetterKey(event, letter)
}
