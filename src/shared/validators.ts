import { assert } from './assert'
import type { CropRect } from './clip'

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

/**
 * The most a stored crop may overshoot the frame, as a fraction of it. The
 * editor writes `offsetWidth / pictureWidth`, and a browser rounds those box
 * sizes to whole pixels, so a crop dragged to the frame's edge can read a hair
 * over 1; a bound of exactly 1 would refuse a crop the editor itself drew.
 */
const CROP_SLACK = 0.01

/**
 * Throws unless `v` is absent (`null` / `undefined`: no crop) or a crop
 * rectangle as the editor stores it — `x`, `y`, `w`, `h` as finite FRACTIONS of
 * the source frame, with a positive size that lies inside it (T-96). The
 * Compile and GIF handlers check it at the IPC boundary: the numbers become
 * `crop=` arguments in an ffmpeg filter string, so a string, `NaN` or a
 * thousand-times-the-frame rectangle from a hostile renderer or a hand-edited
 * project must never get that far.
 */
export function assertOptionalCropRect(
  v: unknown,
  name: string
): asserts v is CropRect | null | undefined {
  assert(typeof name === 'string' && name.length > 0, 'validator name required')
  if (v === null || v === undefined) return
  assertPlainObject(v, name)
  assertRange(v.x, 0, 1, `${name}.x`)
  assertRange(v.y, 0, 1, `${name}.y`)
  assertRange(v.w, Number.MIN_VALUE, 1 + CROP_SLACK, `${name}.w`)
  assertRange(v.h, Number.MIN_VALUE, 1 + CROP_SLACK, `${name}.h`)
  assert((v.x as number) + (v.w as number) <= 1 + CROP_SLACK, `${name} extends past the right edge of the frame`)
  assert((v.y as number) + (v.h as number) <= 1 + CROP_SLACK, `${name} extends past the bottom edge of the frame`)
}
