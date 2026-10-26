import { assertAlways } from './assert'
import type { CropRect } from './clip'
import { isValidTextOverlay } from './projectValidation'

/** Throws if `v` is not a non-empty string. */
export function assertNonEmptyString(v: unknown, name: string): asserts v is string {
  assertAlways(typeof name === 'string' && name.length > 0, 'validator name required')
  assertAlways(typeof v === 'string' && v.length > 0, `${name} must be a non-empty string`)
}

/** Throws if `v` is not a finite number ≥ 0. */
export function assertFiniteNonNeg(v: unknown, name: string): asserts v is number {
  assertAlways(typeof name === 'string' && name.length > 0, 'validator name required')
  assertAlways(typeof v === 'number' && Number.isFinite(v) && v >= 0, `${name} must be a finite number >= 0`)
}

/** Throws if `v` is not a finite number, optionally bounded by [lo, hi]. */
export function assertRange(v: unknown, lo: number, hi: number, name: string): asserts v is number {
  assertAlways(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi, `${name} bounds invalid`)
  assertAlways(typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi, `${name} must be in [${lo}, ${hi}]`)
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
  assertAlways(typeof name === 'string' && name.length > 0, 'validator name required')
  if (start === undefined && end === undefined) return
  assertAlways(
    start !== undefined && end !== undefined,
    `${name}: startSec and endSec must be given together`
  )
  assertFiniteNonNeg(start, `${name}.startSec`)
  assertFiniteNonNeg(end, `${name}.endSec`)
  assertAlways(end > start, `${name}: endSec must be greater than startSec`)
}

/** Throws if `v` is not one of `allowed`. */
export function assertEnum<T extends string>(v: unknown, allowed: readonly T[], name: string): asserts v is T {
  assertAlways(Array.isArray(allowed) && allowed.length > 0, `${name} allowed list required`)
  assertAlways(typeof v === 'string' && (allowed as readonly string[]).includes(v), `${name} must be one of ${allowed.join(', ')}`)
}

/** Throws if `v` is not a plain non-array object. */
export function assertPlainObject(v: unknown, name: string): asserts v is Record<string, unknown> {
  assertAlways(typeof name === 'string' && name.length > 0, 'validator name required')
  assertAlways(
    typeof v === 'object' && v !== null && !Array.isArray(v),
    `${name} must be a plain object`
  )
}

/** Throws if `v` is not an array, optionally with a max length. */
export function assertArray<T>(v: unknown, name: string, maxLen = 1_000_000): asserts v is T[] {
  assertAlways(typeof name === 'string' && name.length > 0, 'validator name required')
  assertAlways(Array.isArray(v), `${name} must be an array`)
  assertAlways(v.length <= maxLen, `${name} exceeds max length ${maxLen}`)
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
  assertAlways(typeof name === 'string' && name.length > 0, 'validator name required')
  if (v === null || v === undefined) return
  assertPlainObject(v, name)
  assertRange(v.x, 0, 1, `${name}.x`)
  assertRange(v.y, 0, 1, `${name}.y`)
  assertRange(v.w, Number.MIN_VALUE, 1 + CROP_SLACK, `${name}.w`)
  assertRange(v.h, Number.MIN_VALUE, 1 + CROP_SLACK, `${name}.h`)
  assertAlways((v.x as number) + (v.w as number) <= 1 + CROP_SLACK, `${name} extends past the right edge of the frame`)
  assertAlways((v.y as number) + (v.h as number) <= 1 + CROP_SLACK, `${name} extends past the bottom edge of the frame`)
}

/** The widest speed a clip may carry across the IPC bridge. The slider offers 0.25-4; the GIF panel's gate is the same 0.1-10. */
const SPEED_MIN = 0.1
const SPEED_MAX = 10

/**
 * Throws unless `v` is absent or a color grade the filter graph can apply (T-105):
 * four finite numbers, each inside what its ffmpeg filter accepts (`eq` takes
 * brightness -1..1 and saturation 0..3, `colorbalance` -1..1; contrast is held to
 * 0..4 because a negative one inverts the picture). The editor's sliders sit well
 * inside these (brightness ±0.5, contrast 0.5-1.5, saturation 0-2, temperature ±1).
 */
function assertOptionalColorGrade(v: unknown, name: string): void {
  if (v === null || v === undefined) return
  assertPlainObject(v, name)
  assertRange(v.brightness, -1, 1, `${name}.brightness`)
  assertRange(v.contrast, 0, 4, `${name}.contrast`)
  assertRange(v.saturation, 0, 3, `${name}.saturation`)
  assertRange(v.temperature, -1, 1, `${name}.temperature`)
}

/**
 * Throws unless the optional recipe fields of `v` — one compilation segment —
 * are what the filter graph can take (T-105): the crop (`assertOptionalCropRect`),
 * a speed, a color grade, the two effect flags, and the text overlays
 * (`isValidTextOverlay`, the gate whose fields reach `drawtext` raw). Compile used
 * to carry a range and a crop; it now carries the clip, and every new field is a
 * number or a string that becomes part of an ffmpeg filter string, so each is
 * checked where it enters. Absent (`null` / `undefined`) is "not set", as in the
 * builder.
 */
export function assertOptionalClipRecipe(v: Record<string, unknown>, name: string): void {
  assertAlways(typeof name === 'string' && name.length > 0, 'validator name required')
  assertOptionalCropRect(v.cropRect, `${name}.cropRect`)
  if (v.speedMultiplier !== null && v.speedMultiplier !== undefined) {
    assertRange(v.speedMultiplier, SPEED_MIN, SPEED_MAX, `${name}.speedMultiplier`)
  }
  assertOptionalColorGrade(v.colorGrade, `${name}.colorGrade`)
  for (const flag of ['autoZoom', 'hypeShake'] as const) {
    const on = v[flag]
    assertAlways(on === null || on === undefined || typeof on === 'boolean', `${name}.${flag} must be true or false`)
  }
  const overlays = v.textOverlays
  if (overlays !== null && overlays !== undefined) {
    assertArray(overlays, `${name}.textOverlays`, 1000)
    for (let i = 0; i < overlays.length; i++) {
      assertAlways(isValidTextOverlay(overlays[i]), `${name}.textOverlays[${i}] malformed`)
    }
  }
}
