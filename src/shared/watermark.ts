import type { WatermarkSpec } from './clip'

/**
 * The four corners a watermark can sit in, in the order the picker offers
 * them. T-49: the list is also the guard for the stored value — a corner read
 * back off disk is only applied if it is still one of these.
 */
export const WATERMARK_POSITIONS: ReadonlyArray<WatermarkSpec['position']> = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left'
]

export const DEFAULT_WATERMARK_POSITION: WatermarkSpec['position'] = 'bottom-right'

/** The Export panel's input is capped at this; a hand-edited settings file is too. */
export const WATERMARK_MAX_LENGTH = 40

/** The look every watermark imagii stamps has: the Export panel's, and the kit's. */
export const WATERMARK_OPACITY = 0.85
export const WATERMARK_FONT_SIZE_PCT = 3.5

/** Is this stored value one of the corners the picker offers? */
export function isWatermarkPosition(value: unknown): value is WatermarkSpec['position'] {
  return WATERMARK_POSITIONS.some((p) => p === value)
}

/**
 * T-85 — the one place a handle and a corner become a `WatermarkSpec`.
 *
 * Two callers build the spec: the Export panel from what is typed in its
 * field, and Clip Kit from what an earlier export SAVED (`streamerHandle`,
 * `watermarkPosition`). Clip Kit used to pass `watermark: null` and ignore
 * both, so the panel next door stamped a clip and the kit made from the same
 * clip did not. A spec built here cannot drift between them.
 *
 * Both inputs are untrusted — the saved ones came off disk — so a blank or
 * non-string handle is no watermark, an overlong one is cut to what the input
 * allows, and an unrecognised corner falls back to the default rather than
 * reaching the filter graph.
 */
export function buildWatermark(text: unknown, position: unknown): WatermarkSpec | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim().slice(0, WATERMARK_MAX_LENGTH).trim()
  if (trimmed.length === 0) return null
  return {
    text: trimmed,
    position: isWatermarkPosition(position) ? position : DEFAULT_WATERMARK_POSITION,
    opacity: WATERMARK_OPACITY,
    fontSizePct: WATERMARK_FONT_SIZE_PCT
  }
}
