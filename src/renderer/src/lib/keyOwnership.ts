/**
 * Which focused control owns a key, so a window-level or column-level shortcut knows when to stand down
 * (T-123 (2)).
 *
 * Every guard used to stand down for ANY `INPUT`. After a checkbox was ticked or a slider dragged the browser
 * leaves that control focused, so Ctrl+Z, `?`, the canvas tool keys, Delete and the Player's keys all went dead
 * for as long as it stayed there: against the shortcut overlay's and the hint lines' own promises. A checkbox
 * has no use for Ctrl+Z and a slider none for `R`; only a TEXT field owns every key. The questions are two,
 * and the answers are here once:
 *
 *  - `isTextEntryTarget`: is it a field the person is typing in? It owns every key.
 *  - `controlOwnsKey`: is it a control with ONE native meaning for this key? A range keeps the arrows, Home and
 *    End; a checkbox, a radio and a button keep Space (it is how a keyboard user presses them).
 *
 * A `<select>` is neither: it owns the letters (type-ahead), and each site that has to stand down for it says so.
 * Pure and DOM-free: tag names and input types are strings, so the node-env unit test drives all of it.
 */

/**
 * Input types whose RELEASE is the end of a gesture: a slider let go, a box ticked, a colour picked. Anything
 * else - and anything unrecognized, which is also what the DOM reports for a missing `type` - is text entry,
 * where the release is a caret being placed and the edit is still going. (Lifted from `videoStore`, which
 * reads it for `endsGestureOnPointerUp`; the same list answers "is this a text field?" for the shortcuts.)
 */
export const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'range',
  'checkbox',
  'radio',
  'color',
  'button',
  'submit',
  'reset',
  'image',
  'file'
])

/** The type of an `<input>` target, or null for anything else (a missing type reads as 'text' in the DOM). */
export function inputTypeOf(target: EventTarget | null | undefined): string | null {
  return typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement ? target.type : null
}

/**
 * A field the person types in: a `<textarea>`, or an `<input>` of any type that takes text (text, number, search,
 * email, password, date...). Not a checkbox, radio, range, colour, button or file input, and not a `<select>`.
 */
export function isTextEntryTarget(tagName: string, inputType?: string | null): boolean {
  const tag = tagName.toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  return !NON_TEXT_INPUT_TYPES.has((inputType ?? 'text').toLowerCase())
}

/** The keys a focused range slider moves itself with. */
const RANGE_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End'
])

/**
 * Does a focused NON-text control have a native meaning for `key`? A range owns the arrows, Home and End; a
 * checkbox, a radio and a button own Space. Every other key - Delete, Ctrl+Z, `?`, I, O, the comma and the
 * period - means nothing to them, so a shortcut for it fires. (A text field is `isTextEntryTarget`'s, and
 * owns everything.)
 */
export function controlOwnsKey(tagName: string, inputType: string | null | undefined, key: string): boolean {
  const tag = tagName.toUpperCase()
  if (tag === 'BUTTON') return key === ' '
  if (tag !== 'INPUT') return false
  const type = (inputType ?? 'text').toLowerCase()
  if (type === 'range') return RANGE_KEYS.has(key)
  if (type === 'checkbox' || type === 'radio') return key === ' '
  return false
}

/**
 * Does the focused element own `key`, so a shortcut for it stands down? The one answer the Player's column, the
 * Timeline's slider and Stream Graphics' tool keys ask: a text field owns every key, a `<select>` owns every key
 * (the letters are its type-ahead, and an arrow changes its value), and a range, checkbox, radio or button owns
 * the single native key `controlOwnsKey` names. The caller passes `event.target`'s tag and (for an input) type.
 *
 * Not for Ctrl+Z or `?`: a select has no meaning for either, and the undo and the overlay keep answering from it
 * (T-120), so those two guards ask `isTextEntryTarget` alone.
 */
export function focusOwnsKey(tagName: string, inputType: string | null | undefined, key: string): boolean {
  return (
    isTextEntryTarget(tagName, inputType) ||
    tagName.toUpperCase() === 'SELECT' ||
    controlOwnsKey(tagName, inputType, key)
  )
}

/**
 * Is a modifier held that makes this keypress a CHORD rather than the bare letter? Ctrl, Meta (Cmd) or Alt. Shift is
 * not one: `R` and `r` are the same shortcut. Ctrl+R (reload), Ctrl+O (open), Ctrl+L, Ctrl+P (print) and Alt+Left (back)
 * belong to the window or the browser, and a bare-letter shortcut - Stream Graphics' tool keys, the Timeline's and the
 * Player's I and O - stands down for all of them (T-124 (29)). Accepts a DOM or a React keyboard event.
 *
 * simplification: AltGr is Ctrl+Alt on Windows, so a layout that types a letter through it also reads as a chord and
 * the shortcut stands down; none of the shortcuts' letters is reached that way on the layouts imagii is used with.
 * Upgrade path: read `getModifierState('AltGraph')` here if one is.
 */
export function hasChordModifier(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}
