import { assert } from './assert'

/** Throws if `v` is not a non-empty string. */
export function assertNonEmptyString(v: unknown, name: string): asserts v is string {
  assert(typeof name === 'string' && name.length > 0, 'validator name required')
  assert(typeof v === 'string' && v.length > 0, `${name} must be a non-empty string`)
}

/** Throws if `v` is not a finite number ≥ 0. */
export function assertFiniteNonNeg(v: unknown, name: string): asserts v is number {
  assert(typeof name === 'string' && name.length > 0, 'validator name required')
  assert(typeof v === 'number' && Number.isFinite(v) && v >= 0, `${name} must be a finite number >= 0`)
}

/** Throws if `v` is not a finite number, optionally bounded by [lo, hi]. */
export function assertRange(v: unknown, lo: number, hi: number, name: string): asserts v is number {
  assert(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi, `${name} bounds invalid`)
  assert(typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi, `${name} must be in [${lo}, ${hi}]`)
}

/**
 * Throws unless `start` and `end` are BOTH absent (an unranged request) or a
 * real range: finite numbers with 0 <= start < end. A half-given range, an
 * empty or inverted one, NaN, Infinity, null, or a numeric string are all
 * refused — the consumers turn these into ffmpeg `-ss`/`-to` and into a
 * subtitle shift, and a bad one used to degrade silently into a burn over
 * the WHOLE file.
 */
export function assertOptionalTimeRange(start: unknown, end: unknown, name: string): void {
  assert(typeof name === 'string' && name.length > 0, 'validator name required')
  if (start === undefined && end === undefined) return
  assert(
    start !== undefined && end !== undefined,
    `${name}: startSec and endSec must be given together`
  )
  assertFiniteNonNeg(start, `${name}.startSec`)
  assertFiniteNonNeg(end, `${name}.endSec`)
  assert(end > start, `${name}: endSec must be greater than startSec`)
}

/** Throws if `v` is not one of `allowed`. */
export function assertEnum<T extends string>(v: unknown, allowed: readonly T[], name: string): asserts v is T {
  assert(Array.isArray(allowed) && allowed.length > 0, `${name} allowed list required`)
  assert(typeof v === 'string' && (allowed as readonly string[]).includes(v), `${name} must be one of ${allowed.join(', ')}`)
}

/** Throws if `v` is not a plain non-array object. */
export function assertPlainObject(v: unknown, name: string): asserts v is Record<string, unknown> {
  assert(typeof name === 'string' && name.length > 0, 'validator name required')
  assert(
    typeof v === 'object' && v !== null && !Array.isArray(v),
    `${name} must be a plain object`
  )
}

/** Throws if `v` is not an array, optionally with a max length. */
export function assertArray<T>(v: unknown, name: string, maxLen = 1_000_000): asserts v is T[] {
  assert(typeof name === 'string' && name.length > 0, 'validator name required')
  assert(Array.isArray(v), `${name} must be an array`)
  assert(v.length <= maxLen, `${name} exceeds max length ${maxLen}`)
}
