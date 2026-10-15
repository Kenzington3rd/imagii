import type { TextOverlay } from './clip'
import { OVERLAY_SIZE_MAX, OVERLAY_SIZE_MIN } from './projectValidation'
import { resolveOverlayColor } from './overlayColors'
import { formatClock } from './clockTime'

/**
 * The text overlay's door (T-113).
 *
 * The overlay gates (`isValidTextOverlay`, so Export, Compile, Save project and a
 * project's restore) take a `#RRGGBB` color and nothing else: the color is printed
 * into the `drawtext` filter, so a name like `white,movie=...` is exactly the
 * string a crafted project would use to inject a filter. That stays true. What was
 * wrong is that the editor's own default ("white") and its own placeholder ("white
 * or #ffcc00") invited a name the gates refuse, so the untouched overlay failed
 * every export. A name is turned into its hex HERE, when the overlay is stored
 * (`videoStore.addTextOverlay` / `updateTextOverlay` run `normalizeOverlayPatch`),
 * which keeps the gates hex-only and makes the invitation honest.
 */

/** What the editor says when the Color box holds something imagii cannot draw. */
export const OVERLAY_COLOR_REFUSAL = "imagii doesn't know that color. Use a name like white or a code like #ffcc00."

/**
 * T-125 (23): what the Source time boxes say when they cannot read what was typed. The boxes take seconds ("90.5") or a clock time
 * the way a stream's own timestamps are written ("1:30", "2:47:13"), so a text box can no longer rely on the browser to refuse a letter.
 */
export const OVERLAY_TIME_REFUSAL = 'imagii could not read that time. Use seconds like 90.5, or a time like 1:30 or 2:47:13.'

/** The ONE boundary between the two forms: one hour, decided on the rounded hundredths (3599.996 is a whole hour). */
const inClockForm = (seconds: number): boolean => Math.round(seconds * 100) >= 360000

/**
 * T-126 (5): a time in the source as the Source time boxes show it AT REST. Below an hour it stays the seconds the card says
 * ("12.50"); from one hour up it is the clock the Timeline above it reads ("1:40:43.50"). A three-hour VOD's "10038.00" beside a
 * Timeline that said 2:47:18 made a person convert in their head, and typing "2:47:18" rewrote itself to seconds the moment the box
 * was left. `parseClock` reads both back, so what is shown is what can be typed. Decided on the rounded value, so 3599.996 (which
 * rounds to a whole hour) is not a "3600.00" that the clock form would have called 59:59.99.
 */
export function overlayTimeText(seconds: number, clock: boolean = inClockForm(seconds)): string {
  return clock ? clockWithHundredths(Math.round(seconds * 100)) : seconds.toFixed(2)
}

/**
 * T-127 (7): the Source time ROW, start and end together. Each box used to pick its own form, so a window from 59:50 to 1:00:10 read
 * "3590.00 -> 1:00:10.00 s": two languages in one row, and a trailing "s" on a value that is a clock. The PAIR decides: when either is
 * one hour or more, both boxes show the clock (the boundary is `overlayTimeText`'s, not a second copy of it), and the "s" unit
 * belongs only to the seconds form (`clock` false).
 */
export function overlayTimePair(startSec: number, endSec: number): { start: string; end: string; clock: boolean } {
  const clock = inClockForm(startSec) || inClockForm(endSec)
  return { start: overlayTimeText(startSec, clock), end: overlayTimeText(endSec, clock), clock }
}

/** "1:40:43.50" from a whole number of hundredths: the h:mm:ss part is `formatClock`'s, the fraction is exact (a float's `.57` is .5699999). */
function clockWithHundredths(hundredths: number): string {
  return `${formatClock(Math.floor(hundredths / 100))}.${String(hundredths % 100).padStart(2, '0')}`
}

/**
 * The typefaces the editor's Font box offers, in the order it lists them (T-114). The names
 * are what is STORED in `overlay.font`; main maps each to a fixed font file
 * (`overlayFontPath`, filters.ts), keyed by this union so a font added here without a file
 * fails the typecheck. A stored name that is not one of these (an older project, a
 * hand-edited one) is Arial at export - the string itself never reaches the filter.
 */
export const OVERLAY_FONTS = ['Arial', 'Impact', 'Verdana', 'Georgia', 'Courier New', 'Comic Sans MS'] as const
export type OverlayFont = (typeof OVERLAY_FONTS)[number]

/** The color a new overlay starts with. A hex, because the gates take nothing else. */
const DEFAULT_OVERLAY_COLOR = '#ffffff'
const DEFAULT_OVERLAY_SIZE = 48

/** A size the gate takes: a whole number of pixels from 8 to 512. Not-a-number is the smallest. */
export function clampOverlaySize(n: number): number {
  if (Number.isNaN(n)) return OVERLAY_SIZE_MIN
  return Math.min(OVERLAY_SIZE_MAX, Math.max(OVERLAY_SIZE_MIN, Math.round(n)))
}

/** What "+ Add text" stores, untouched: a new overlay across the clip's range. */
export function newTextOverlay(startSec: number, endSec: number): Omit<TextOverlay, 'id'> {
  return {
    text: 'Your text here',
    font: OVERLAY_FONTS[0],
    sizePx: DEFAULT_OVERLAY_SIZE,
    colorHex: DEFAULT_OVERLAY_COLOR,
    x: 0.1,
    y: 0.85,
    startSec,
    endSec
  }
}

/**
 * Makes a patch to an overlay safe to store: a color name becomes its hex, a size
 * is clamped to the gate's range. A color that is neither a name nor a hex, and a
 * size that is not a number, are LEFT OUT of the patch — the overlay keeps the
 * value it has (the editor has already said why, so nothing is lost silently). The
 * `Partial<TextOverlay>` in and out lets the store run every write through it.
 */
export function normalizeOverlayPatch(patch: Partial<TextOverlay>): Partial<TextOverlay> {
  const out: Partial<TextOverlay> = { ...patch }
  if (out.colorHex !== undefined) {
    const hex = typeof out.colorHex === 'string' ? resolveOverlayColor(out.colorHex) : null
    if (hex === null) delete out.colorHex
    else out.colorHex = hex
  }
  if (out.sizePx !== undefined) {
    if (typeof out.sizePx === 'number' && !Number.isNaN(out.sizePx)) out.sizePx = clampOverlaySize(out.sizePx)
    else delete out.sizePx
  }
  return out
}

/**
 * T-124 (18): the sentence the overlay editor shows when an overlay's window never meets the selected clip, or null when it
 * does. The Time boxes are seconds in the SOURCE video (they default to the clip's own range), and `buildVideoFilter` maps them
 * onto the clip's clock: a window that closes before the clip opens, or opens after it closes, maps to a `between()` that
 * matches no frame, so the export finishes cleanly with the text missing and nothing says why. The windows are half-open
 * `[start, end)` against the clip's `[start, end)`, so one that only touches the clip at an edge shows nothing either, and a
 * window of no length can never be on screen (T-125 (14): and says so in its own sentence, since "its times fall outside the clip" is
 * false for one inside it). A clip whose range is not a range is not judged (the clip list refuses those).
 */
export function overlayOutsideClipMessage(
  overlay: Pick<TextOverlay, 'startSec' | 'endSec'>,
  clip: { startSec: number; endSec: number }
): string | null {
  if (!Number.isFinite(clip.startSec) || !Number.isFinite(clip.endSec) || clip.endSec <= clip.startSec) return null
  // T-125 (14): a window of no length (the editor clamps an end that is before the start TO the start) is never on screen wherever it
  // sits, and the sentence about the clip would be false for one that is inside it.
  if (overlay.startSec === overlay.endSec) return "This text won't show in the export: its start and end are the same, so it never shows."
  const from = Math.max(overlay.startSec, clip.startSec)
  const to = Math.min(overlay.endSec, clip.endSec)
  if (from < to) return null
  // T-126 (5): the clip's range reads the way the Timeline beside it does once the video is an hour long ("1:40:43.50 to 1:41:43.50
  // of the video"), both ends in the same form (the clock has no unit to append; the seconds form says "s"). T-127 (7): the boxes
  // above it decide per PAIR now, by the same function, so the card never speaks two forms at once.
  const pair = overlayTimePair(clip.startSec, clip.endSec)
  const range = pair.clock ? `${pair.start} to ${pair.end}` : `${pair.start} to ${pair.end} s`
  return `This text won't show in the export: its times fall outside the clip, which runs from ${range} of the video.`
}
