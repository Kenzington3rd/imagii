/**
 * Reading a number out of a box someone is TYPING in (T-123 (3), (4)).
 *
 * A controlled number input that rewrites its own value on every keystroke (`Number(typed) || 360`,
 * `value={n.toFixed(2)}`) cannot be typed into: the box is emptied to retype it, the empty box reads as
 * "no number" and snaps to the default, and the digits then append to it ("600" became 360600). `DraftField`
 * keeps what is typed to itself until typing ends; these three pure functions are the judgments it asks
 * of a site: is what is typed usable already (so the store may follow it), and what does a commit store.
 */

/** The number typed, or null for an empty box or text that is not a finite number. */
export function typedNumber(typed: string): number | null {
  if (typed.trim() === '') return null
  const n = Number(typed)
  return Number.isFinite(n) ? n : null
}

/**
 * Is `typed` already a usable value: a number inside `[min, max]` (a whole one when `integer`)? A live-committing
 * box follows the store as soon as this is true, so "6" on its way to "600" is never judged.
 */
export function isTypedInRange(typed: string, min: number, max = Infinity, integer = true): boolean {
  const n = typedNumber(typed)
  if (n === null) return false
  if (integer && !Number.isInteger(n)) return false
  return n >= min && n <= max
}

/**
 * What a commit (blur or Enter) stores: the typed number clamped into `[min, max]` (rounded when `integer`), or null
 * for an empty box or text that is not a number - the caller keeps what it had, and the box shows it again.
 */
export function clampTyped(typed: string, min: number, max = Infinity, integer = true): number | null {
  const n = typedNumber(typed)
  if (n === null) return null
  const whole = integer ? Math.round(n) : n
  return Math.min(max, Math.max(min, whole))
}
