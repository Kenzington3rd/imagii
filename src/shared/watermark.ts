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

/**
 * Where a watermark sits (T-130 (an)): the margins between it and its corner, in pixels of the OUTPUT frame.
 *
 * `WATERMARK_EDGE_PX` is the flat margin every watermark had (20 px), and still has on a landscape frame and from the sides of every frame.
 *
 * `VERTICAL_WATERMARK_INSET` is the ONE pair that replaces it at the top and bottom of a 9:16 (or taller) frame, as shares of the frame's
 * HEIGHT so a 720x1280 file and a 2160x3840 one have the same proportions. A vertical video is played full-screen under the platform's own
 * interface: Reels, TikTok and Shorts each lay a header over the top and the caption (account name, description, sound) over the bottom, and
 * a watermark at 20 px sat under both. The figures are the platforms' published safe-zone guides at 1080x1920, which are approximate and
 * which the platforms move, so the pair is chosen to clear the deepest of the three at each edge:
 *   - `top: 0.15` = 288 px, for a header of about 130-150 px on TikTok, about 250 on Reels and up to about 290 on Shorts.
 *   - `bottom: 0.25` = 480 px, for a caption and navigation rail of about 480 px on TikTok, 400-480 on Shorts and about 420 on a Reel with its
 *     caption collapsed. (Instagram advises a deeper 35% for text that must stay readable with the caption OPEN; a small watermark would then
 *     sit a third of the way up the frame, so it keeps to what a collapsed caption leaves.)
 * The inset is where the TEXT sits; its 8 px box border extends 8 px beyond it. The side rail of action buttons (like, comment, share) is in
 * the right 120-140 px and is NOT cleared: that is a horizontal inset, which this pair is not, and a handle that must not share the column
 * with the rail belongs in a left corner.
 */
export const WATERMARK_EDGE_PX = 20
export const VERTICAL_WATERMARK_INSET = { top: 0.15, bottom: 0.25 } as const

/**
 * Is this frame 9:16 or taller? The shape decides, not the platform's name: a custom 1280x720 preset built on Reels is landscape, and a
 * custom 720x1280 built on YouTube is vertical. A 2% tolerance keeps the even-snapped 1080x1918 of an odd-sided size vertical; 4:5 (the
 * feed shape, which has no full-screen caption rail), square and every landscape shape are not. A frame with no usable size is not.
 */
export function isVerticalFrame(frame: { width: number; height: number }): boolean {
  if (!(frame.width > 0 && frame.height > 0 && Number.isFinite(frame.width) && Number.isFinite(frame.height))) return false
  return frame.width / frame.height <= (9 / 16) * 1.02
}

/** The top and bottom margins of a watermark in `frame`, in pixels (the sides are `WATERMARK_EDGE_PX` whatever the shape). */
export function watermarkInset(frame: { width: number; height: number }): { top: number; bottom: number } {
  if (!isVerticalFrame(frame)) return { top: WATERMARK_EDGE_PX, bottom: WATERMARK_EDGE_PX }
  return {
    top: Math.round(frame.height * VERTICAL_WATERMARK_INSET.top),
    bottom: Math.round(frame.height * VERTICAL_WATERMARK_INSET.bottom)
  }
}

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
 * allows, and an unrecognized corner falls back to the default rather than
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
