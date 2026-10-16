import { clipSpeed } from '../../shared/clip'
import type { Clip, ClipRecipe, CropRect, TextOverlay, WatermarkSpec, ColorGrade } from '../../shared/clip'
import type { PlatformPreset } from './presets'
import type { OverlayFont } from '../../shared/textOverlay'

export interface SourceDimensions {
  width: number
  height: number
  /**
   * The source video stream's probed `color_space` (T-118), when it has one - 'bt709' for
   * OBS's default, 'bt470bg' / 'smpte170m' for bt601, absent when the stream is untagged.
   * It is not a dimension; it rides here because every caller that has the source's size
   * got it from the same probe, and the temperature stage is the one graph stage that needs
   * to know it. Only `colorGradeFilter` reads it.
   */
  colorSpace?: string | null
}

/**
 * What a filter graph reads of a clip (T-105): where it starts in the source (the
 * overlays' clock) and its recipe. A platform export hands over a whole `Clip`;
 * a compilation segment hands over the same fields, so the two cannot be built
 * by two different graphs.
 */
export type FilterClip = Pick<Clip, 'startSec'> & ClipRecipe

/**
 * What a filter graph reads of the OUTPUT: its size, its shape and its frame
 * rate. A platform preset is one; a compilation is another (its size, 16:9, 30).
 */
export type FilterFrame = Pick<PlatformPreset, 'width' | 'height' | 'aspectRatio' | 'fps'>

/**
 * M4 fix (round 15): force an integer to the nearest even value, rounding
 * down. yuv420p chroma subsampling requires even W/H/X/Y in crop filters,
 * and libx264 in strict mode refuses odd dimensions outright. Math.round
 * + raw value let an odd result through before — e.g. a 1081-px crop
 * height failed at runtime far from the source-of-truth here.
 *
 * Implementation: `n & ~1` clears the low bit. For negatives this rounds
 * toward -∞ (-1 → -2), which is fine for the only consumer that sees a
 * negative (the Math.max(0, …) clamp below) — and exported for tests.
 */
export function even(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.trunc(n) & ~1
}

/**
 * The even-size stage every libx264 + yuv420p command that takes a picture it did not
 * make puts at the HEAD of its `-vf` chain (T-113, T-114): width and height trimmed DOWN
 * to a multiple of 2. The encoder refuses an odd edge outright ("width not divisible by 2",
 * exit 187), and a VP8/VP9 screen recording is where an odd size comes from. An even
 * picture passes through it untouched. Ahead of any cut or caption stage so they see the
 * size the encoder will get. The commands: the audio re-attach, the MP4 convert, the
 * caption burn-in and the picture-in-picture base. (A platform export, a compilation
 * segment and a reframe end in their own `scale` to an even size - the reframe a `crop` and
 * then a `scale`.)
 *
 * A CROP, not a scale (T-115): the stage exists for window captures, whose text is one-pixel
 * strokes, and `scale` from 321 to 320 resamples the picture to lose one pixel (bicubic, the
 * sample position drifting across the frame). Only the four corners stay hard (the first and
 * last 15 percent or so of each edge); every edge is soft at its middle and the center is a
 * flat gray. Measured on a 1-pixel checkerboard, about half the pixels (48 percent) landed in
 * the mid-gray band strictly between 80 and 175 (the "soft" band of media.spec.ts' `hardness`,
 * whose bounds are exclusive) and almost none were still pure black or white. A crop is a
 * one-pixel trim at the right and bottom edge (crop's default x and y center the window, and
 * half a pixel truncates to 0) and every surviving pixel is exactly what it was.
 */
export const EVEN_PICTURE = 'crop=trunc(iw/2)*2:trunc(ih/2)*2'

/**
 * What each character a user can type becomes inside `text='…'`, so that
 * drawtext draws it verbatim. T-111: ffmpeg reads that text THREE times, and
 * the old one-level escape was right for none of them.
 *
 *   1. The filtergraph parser (`av_get_token`, terminators `[],;`): outside
 *      quotes `\x` is `x`, inside quotes everything is literal until the next
 *      `'` — and the quotes themselves are removed.
 *   2. The option parser (`av_get_token`, terminator `:`): the same rules again,
 *      on what is left. The quotes are gone by now, so `\x` is `x` and a bare
 *      `'` opens a quote.
 *   3. drawtext's own expansion of the value: `\x` is `x`, and `%{…}` is a
 *      function call.
 *
 * Because the first pass is inside quotes, every `\` this table writes reaches
 * the second pass untouched, which is why the escapes are the second pass's:
 *
 *   `\`  -> four backslashes. Pass 2 halves them, pass 3 halves them again.
 *   `%`  -> `\\%`. Pass 2 leaves `\%`, pass 3 reads it as a literal percent. A
 *           bare `%` was read as the start of a `%{…}` expansion and the whole
 *           overlay silently drew nothing ("Sale 50% off").
 *   `:`  -> `\:`. Pass 2 would otherwise end the option here.
 *   `'`  -> `\'\''`. A `'` inside the quotes would end them in pass 1 (the old
 *           `\'` did exactly that: the quote closed, `enable='between(t,0.000`
 *           lost its commas, and the export died with "No such filter:
 *           '0.000'"). So the quote is closed after a literal backslash, escaped
 *           outside (pass 1 turns `\'` into `'`, leaving `\'` for pass 2), and
 *           reopened.
 *
 * A newline stays a real newline: pass 3 draws a real line break and has no
 * `\n` escape (the old `\n` drew the letter n). Pass 2 trims whitespace at the
 * ends of a value, so a space or tab at either end is backslash-escaped, and a
 * newline there is dropped — drawtext 6.1 draws NOTHING for a text whose first
 * or last line is empty, which is a worse answer than a line less of blank.
 *
 * Verified against ffmpeg 6.1.1 (the shipped win32 build's major) by comparing
 * the frame drawn from this escape with the frame drawn from the same raw text
 * through `textfile=` + `expansion=none`: pixel-identical for each case in
 * filters.test.ts. Every escape lives in one pass over the string so one
 * replacement can never be escaped by the next.
 */
const DRAWTEXT_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\\\\\',
  '%': '\\\\%',
  ':': '\\:',
  "'": "\\'\\''"
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/[\\%:']/g, (c) => DRAWTEXT_ESCAPES[c] ?? c)
    .replace(/^[ \t]+|[ \t]+$/g, (ws) => ws.replace(/./g, '\\$&'))
}

export const __testing__ = { escapeDrawtext, safeOverlaySize, safeOverlayColor }

/**
 * The user's manual crop as an even-pixel rectangle of the source, always INSIDE it.
 *
 * T-123 (13): the stored rect is `offsetWidth / pictureWidth`, and a browser rounds a box to whole pixels (800 px in a
 * 799.5 px parent is 1.000625), so `assertOptionalCropRect` lets a rect overshoot by up to `CROP_SLACK` (1%) rather
 * than refuse a crop the editor itself drew. Scaled and even-rounded without a clamp that was `crop=3842:2160:0:0`
 * on a 3840 px source, and ffmpeg refused the whole export ("Invalid too big or non positive size") with no output.
 * The size is clamped AFTER scaling to pixels (to what is left of the frame past the offset) and BEFORE `even()`, and
 * the offset leaves room for the 2 px minimum, so `x + w <= width` and `y + h <= height` whatever got through.
 */
export function manualCropRegion(
  crop: CropRect,
  source: SourceDimensions
): { w: number; h: number; x: number; y: number } {
  // M4 fix (round 15): force every crop dimension to an even integer so
  // yuv420p subsampling and libx264 strict-mode both accept the output.
  const x = Math.min(Math.max(0, even(crop.x * source.width)), Math.max(0, even(source.width) - 2))
  const y = Math.min(Math.max(0, even(crop.y * source.height)), Math.max(0, even(source.height) - 2))
  return {
    w: Math.max(2, even(Math.min(crop.w * source.width, source.width - x))),
    h: Math.max(2, even(Math.min(crop.h * source.height, source.height - y))),
    x,
    y
  }
}

/** Which side of the frame a Reframe strip is taken from (the Reframe panel's three buttons). */
export type StripPosition = 'left' | 'center' | 'right'

/**
 * The Reframe strip (T-125 (9)): the aspect stage of a Reframe, a crop of `frame` to `targetAspect` at the SIDE the person
 * picked rather than the middle. It is the one stage of a Reframe that is not `autoCropForAspect`'s centered cut, and
 * `cropToFrame` swaps it in for that cut when it is given a position, so the rest of the picture (speed, the clip's crop, shake,
 * scale, grade, zoom, text) is `buildVideoFilter`'s own and cannot be a subset of it.
 *
 * Always emitted, even when the frame is already the target's shape (the cut is then the identity): a Reframe has always written
 * its strip stage, and with it every number in the stage is an even integer (yuv420p). The strip is `left` 15% of the way across
 * the margin, `right` 85%, `center` the middle; a frame narrower than the target is cut on its height, centered.
 */
export function stripCrop(frame: SourceDimensions, targetAspect: number, position: StripPosition): string {
  let cropW: number
  let cropH: number
  if (frame.width / frame.height > targetAspect) {
    cropH = even(frame.height)
    cropW = even(cropH * targetAspect)
  } else {
    cropW = even(frame.width)
    cropH = even(cropW / targetAspect)
  }
  const margin = frame.width - cropW
  // M4 fix (round 15): an even offset, or yuv420p shifts the chroma plane and ffmpeg refuses the encode.
  const offset = position === 'left' ? margin * 0.15 : position === 'right' ? margin * 0.85 : margin / 2
  const cropX = Math.max(0, even(offset))
  const cropY = Math.max(0, even((frame.height - cropH) / 2))
  return `crop=${cropW}:${cropH}:${cropX}:${cropY}`
}

/**
 * The centered crop that brings `source` (the frame in front of this stage:
 * the whole video, or the user's manual crop of it — T-83) to `targetAspect`,
 * or '' when it is already there.
 */
function autoCropForAspect(
  source: SourceDimensions,
  targetAspect: number
): string {
  const sourceAspect = source.width / source.height
  if (Math.abs(sourceAspect - targetAspect) < 0.01) return ''
  // M4 fix (round 15): even() at every assignment site. Source dims are
  // also forced even since libx264 won't accept odd input either.
  const evenSourceW = even(source.width)
  const evenSourceH = even(source.height)
  if (sourceAspect > targetAspect) {
    const cropW = even(source.height * targetAspect)
    const cropX = Math.max(0, even((source.width - cropW) / 2))
    return `crop=${cropW}:${evenSourceH}:${cropX}:0`
  }
  const cropH = even(source.width / targetAspect)
  const cropY = Math.max(0, even((source.height - cropH) / 2))
  return `crop=${evenSourceW}:${cropH}:0:${cropY}`
}

/**
 * The crop-is-the-new-frame stages (T-83, T-96): the filters that take
 * `source` to the frame an output is made from. ONE implementation, three
 * callers — a platform export (`buildVideoFilter`, below), a compilation
 * segment (`buildSegmentFilter`, concat.ts) and a GIF (`buildGifFilter`,
 * gif.ts) — so "what a manual crop means" cannot be decided three ways, which
 * is how Compile and GIF came to ignore it (the same family as T-82's
 * `keepExpression`).
 *
 * Chain: the user's crop (when `cropRect` is set), then — when `targetAspect`
 * is given — a centered cut of THAT frame to the output's shape. The crop says
 * what the content is; the output then takes a cut of it to reach its own
 * shape, so the `scale` that follows only ever resizes and never changes the
 * aspect. With no crop the whole source is the frame (the same call, one
 * fewer stage), so the no-crop path and the cropped one are one code path.
 * `targetAspect: null` is "keep the crop's own shape" — what a GIF does, since
 * its height follows its width.
 *
 * Every crop dimension and offset is an even integer (yuv420p, libx264), and a
 * frame that is already the target's shape adds no second stage.
 */
export function cropToFrame(
  cropRect: CropRect | null | undefined,
  source: SourceDimensions,
  targetAspect: number | null,
  /** A Reframe's side (T-125 (9)): the cut to the output's shape is the strip at that side (`stripCrop`), not the centered cut. */
  position?: StripPosition
): string[] {
  const stages: string[] = []
  let frame = source
  if (cropRect) {
    const region = manualCropRegion(cropRect, source)
    stages.push(`crop=${region.w}:${region.h}:${region.x}:${region.y}`)
    frame = { width: region.w, height: region.h }
  }
  if (targetAspect !== null) {
    const cut = position ? stripCrop(frame, targetAspect, position) : autoCropForAspect(frame, targetAspect)
    if (cut) stages.push(cut)
  }
  return stages
}

function scaleFilter(preset: FilterFrame): string {
  // T-65: `setsar=1` is load-bearing, not decoration — same rule T-12 fixed
  // in runReframe and concat.ts already carried. `scale` preserves the
  // SOURCE display aspect, and `autoCropForAspect` above can only snap to
  // even pixels (1080x606 for a 16:9 target off a 1080x1920 source is
  // 1.782:1, not 1.778:1). Without this, ffmpeg banks that ~0.25% as
  // SAR 405:404, and every player stretches the "1920x1080" upload back to
  // 1.782:1. Every crop-then-scale graph in this app ends in setsar=1.
  return `scale=${preset.width}:${preset.height}:flags=lanczos,setsar=1`
}

/** Allowed hex-color form for an overlay (`#RRGGBB` or `RRGGBB`). */
const OVERLAY_COLOR_RE = /^#?[0-9A-Fa-f]{6}$/
const OVERLAY_SIZE_MIN = 8
const OVERLAY_SIZE_MAX = 512
const OVERLAY_SIZE_FALLBACK = 48

/**
 * Coerce an overlay font size to a clamped finite integer. A malicious
 * project file can carry `sizePx: NaN` or an injection string — never
 * interpolate it raw into the filter graph.
 */
function safeOverlaySize(sizePx: unknown): number {
  if (typeof sizePx !== 'number' || !Number.isFinite(sizePx)) {
    return OVERLAY_SIZE_FALLBACK
  }
  const clamped = Math.min(OVERLAY_SIZE_MAX, Math.max(OVERLAY_SIZE_MIN, sizePx))
  return Math.round(clamped)
}

/**
 * Validate an overlay color. Returns the original value when it is a
 * well-formed hex color (preserving FFmpeg's existing accepted behavior),
 * otherwise falls back to a safe default. Defends against a `colorHex`
 * crafted to inject FFmpeg filter directives (e.g. `white,movie=...`).
 */
function safeOverlayColor(colorHex: unknown): string {
  if (typeof colorHex === 'string' && OVERLAY_COLOR_RE.test(colorHex)) {
    return colorHex
  }
  return 'white'
}

/**
 * TWO TIMEBASES, ONE FIELD (T-74) — the seam where a stored overlay time
 * becomes a filter-graph time.
 *
 * `overlay.startSec` / `overlay.endSec` are SOURCE-absolute seconds. That is
 * what `TextOverlayEditor` shows in its Time fields, what it defaults a new
 * overlay to (`clip.startSec` -> `clip.endSec`), and what every saved
 * project on disk already holds — so the storage stays absolute and the
 * conversion happens here instead.
 *
 * `drawtext`'s `enable` expression is evaluated against the frame's own PTS
 * as it arrives at this filter, and two things ahead of it move that clock:
 *
 *   - `runExportJob` passes `-ss` BEFORE `-i` (input seeking), so the first
 *     frame of the clip reaches the graph at t=0, not at `clip.startSec`;
 *   - `setpts=PTS/speed`, which `buildVideoFilter` puts at the head of the
 *     chain whenever the clip is sped up or slowed down.
 *
 * Hence `t_graph = (t_source - clip.startSec) / speed`. Emitting the raw
 * source-absolute numbers — what this did before T-74 — showed the overlay
 * `clip.startSec` seconds late, and not at all once the clip started later
 * than it was long. Only a clip starting at 0.00 ever behaved as promised.
 *
 * Deliberately unclamped: an overlay window that opens before the clip maps
 * to a negative start, and `between()` simply matches from t=0 — the visible
 * half of the window, which is the right answer. One that closes before the
 * clip maps to two negatives and never matches, which is also right.
 */
function graphSeconds(sourceSec: number, clipStartSec: number, speed: number): number {
  return (sourceSec - clipStartSec) / speed
}

/**
 * PER-PLATFORM CAVEAT (drawtext — this filter and `watermarkFilter` below,
 * the app's only two users of it): ffmpeg-static ships binaries from
 * DIFFERENT upstream builders per platform, exactly as the mpegts note in
 * shared/mediaFormats.ts describes. The linux x64 binary (johnvansickle
 * 7.0.2-static) has NO `drawtext` filter — any export carrying a text
 * overlay or a watermark dies at graph init with "No such filter:
 * 'drawtext'". Its `-buildconf` lists libfreetype but not libharfbuzz (the
 * distro's 6.1.1, which has the filter, has both); it is the libass
 * `subtitles` path that is present. The win32 x64 binary (gyan.dev 6.1.1),
 * the one that ships in the product, has the filter.
 *
 * Consequence: these two features work in the shipped Windows app and
 * cannot run at all in linux dev runs, so their PIXELS are only assertable
 * on win32. Layer 5 gates that coverage by platform (the T-51 block in
 * tests/integration/media.spec.ts) and the release workflow — windows-
 * latest — runs `npm run test:media` so it actually executes; a linux pin
 * in the same block fails if ffmpeg-static ever gains the filter, which is
 * what forces the gate to be lifted instead of left to rot.
 *
 * The hardcoded C:/Windows font paths below are the second half of the same
 * Windows-only assumption (known-and-accepted in LESSONS_LEARNED): bundle a
 * font before any cross-platform build.
 */
/**
 * The font file for each typeface the editor offers (T-114). `drawtext` takes a FILE, never a
 * name, and the file is printed into the filter graph - so the stored `overlay.font` is only
 * ever a KEY into this literal table, and what is printed is the table's value. Anything that
 * is not an own key (an older project, a hand-edited file, a string built to break out of the
 * `fontfile='...'` option) is Arial. The standard Windows file names; the win32 preflight in
 * the Layer 5 drawtext block checks they exist on the machine that runs the release.
 */
const OVERLAY_FONT_FILES: Readonly<Record<OverlayFont, string>> = {
  Arial: 'arial.ttf',
  Impact: 'impact.ttf',
  Verdana: 'verdana.ttf',
  Georgia: 'georgia.ttf',
  'Courier New': 'cour.ttf',
  'Comic Sans MS': 'comic.ttf'
}

function overlayFontPath(font: unknown): string {
  // `hasOwnProperty`, not `in` or a bare index: "constructor" and "__proto__" are not fonts.
  const known =
    typeof font === 'string' && Object.prototype.hasOwnProperty.call(OVERLAY_FONT_FILES, font)
  const file = known ? OVERLAY_FONT_FILES[font as OverlayFont] : OVERLAY_FONT_FILES.Arial
  return `C\\:/Windows/Fonts/${file}`
}

function drawTextFilter(
  overlay: TextOverlay,
  preset: FilterFrame,
  clipStartSec: number,
  speed: number
): string {
  const fontPath = overlayFontPath(overlay.font)
  const x = Math.round(overlay.x * preset.width)
  const y = Math.round(overlay.y * preset.height)
  const text = escapeDrawtext(overlay.text)
  const fontSize = safeOverlaySize(overlay.sizePx)
  const fontColor = safeOverlayColor(overlay.colorHex)
  const from = graphSeconds(overlay.startSec, clipStartSec, speed).toFixed(3)
  const to = graphSeconds(overlay.endSec, clipStartSec, speed).toFixed(3)
  return `drawtext=fontfile='${fontPath}':text='${text}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}:enable='between(t,${from},${to})'`
}

function colorGradeFilter(g: ColorGrade, source: SourceDimensions): string | null {
  const parts: string[] = []
  const eqParts: string[] = []
  if (g.brightness !== 0) eqParts.push(`brightness=${g.brightness.toFixed(3)}`)
  if (g.contrast !== 1) eqParts.push(`contrast=${g.contrast.toFixed(3)}`)
  if (g.saturation !== 1) eqParts.push(`saturation=${g.saturation.toFixed(3)}`)
  if (eqParts.length) parts.push(`eq=${eqParts.join(':')}`)
  if (g.temperature !== 0) {
    // Warm raises red and lowers blue, cool the reverse (a little harder on the
    // side that is being added). T-109: this used to set the SHADOWS only (`rs`,
    // `bs`), and colorbalance's shadows band is gone by about 0x50 — a mid-gray
    // frame moved ~2 levels at the slider's end, so "Temperature" changed the dark
    // corners of a picture and nothing else. The mid-tones (`rm`, `bm`) and the
    // highlights (`rh`, `bh`) now take the same sign at a fraction of the shadows'
    // strength: the shadows keep their old look, the mid-tones get a quarter (it
    // fills the gap between the two bands, which a gradient would show as a seam)
    // and the highlights half, which is what carries a mid-gray frame (a cast of
    // about +36 red, -27 blue at the end of the slider) without the heavy cast the
    // shadows alone could take. The values stay inside colorbalance's -1..1.
    const t = g.temperature
    const red = t > 0 ? t * 0.4 : t * 0.3
    const blue = t > 0 ? -t * 0.3 : -t * 0.4
    const f = (v: number): string => v.toFixed(3)
    parts.push(
      `colorbalance=rs=${f(red)}:bs=${f(blue)}:rm=${f(red * 0.25)}:bm=${f(blue * 0.25)}:rh=${f(red * 0.5)}:bh=${f(blue * 0.5)}`
    )
    // T-118: colorbalance is an RGB filter, so the frame goes YUV -> RGB -> YUV around it. On
    // the shipped win32 ffmpeg (6.1.1) the way back uses the bt601 matrix and the output frame
    // is tagged color_space=unknown, so a bt709-tagged source (OBS's default) was encoded in
    // the wrong matrix while every player reads the file as bt709: saturated colors shifted
    // (SMPTE green (0,157,0) came out (0,130,0) in the suite's runners) and the tag was gone.
    // 7.0.2 preserves both. Converting back explicitly puts the matrix right (measured on 6.1.1:
    // the pixels return to within 3 levels of the ungraded control, on the suite's own fixture).
    // `scale` does not re-tag the frame on 6.1.1 (it does on 7.0.2), so `setparams` writes the tag
    // back: without it the file still says color_space=unknown there, which is the stripped tag
    // this stage exists to put back.
    //
    // T-120: the two tokens do different jobs.
    // `setparams` alone puts back the TAG and, because the conversion to YUV that follows reads the tag,
    // the pixels too (measured on 6.1.1, a cast of 0.01 through a 1080p export against the ungraded control,
    // on the suite's T-118 bands fixture: a graded bt709 source with the retag only reads within 3 levels,
    // worst band red 199,42,42 against 202,45,45, and the shipped `scale` plus retag reads the same; the same
    // bands made in the bt2020 matrix and tagged bt2020nc, a hand fixture that is not in the suite, read
    // within 4, red 200,43,40 against 202,45,44). What it cannot survive is a stage that drops the tag again,
    // and Auto Zoom's `zoompan` is one: a frame still in RGB when it gets there is converted afterwards as
    // an untagged one (bt601), SMPTE green (0,133,0) against the control's (0,157,0) with the retag only,
    // (0,155,0) with the `scale`, which has already made the frame bt709 YUV and which zoompan passes
    // through. That is the `scale`'s job and why bt709 keeps it; the Layer 5 case "a bt709 source ... with a
    // grade AND Auto Zoom on" is the one that tests it (red on 6.1.1 with the scale dropped, green on 7.0.2
    // either way, by design).
    //
    // T-119: a bt601-TAGGED source (smpte170m, bt470bg: OBS's Rec.601 profile, SD captures) lost
    // its tag the same way (smpte170m in, `unknown` out), and every built-in preset is at least 1280 px on its long side,
    // where a player that guesses reads an untagged file as bt709. Its pixels are fine: swscale
    // reads and writes bt601 by default, so for bt601 the round trip is symmetric (measured on
    // 6.1.1: the tag restored, pixels within 3 levels of the ungraded control on the suite's own
    // fixture, the same 3 the bt709 cases read; a one-off hand fixture read 1). So it
    // gets the TAG alone and no `scale`: the bt709 recipe on a bt601 source moves the pixels (the
    // suite's green band came out (11,184,3) against the control's (0,158,0)). The tag is printed
    // from the matched literal, never from the probe's string.
    //
    // Everything else gets nothing. UNTAGGED is skipped for the same symmetry, not because "players
    // assume bt601" (at HD they guess bt709): ffmpeg reads an untagged frame as bt601 and writes
    // bt601 back, so the picture comes out as it went in and there was no tag to lose. `unknown`
    // is untagged. Any OTHER tag, e.g. bt2020nc, is not covered, and that is the ledger's residual, not this
    // stage's. Its upgrade is the same pair: a retag alone restores a graded bt2020nc source's tag and pixels
    // on 6.1.1 as it does bt709's (measured), and `scale=out_color_matrix=bt2020` ahead of it is what survives
    // an Auto Zoom. The constant is `bt2020`: the bundled 7.0.2 refuses `bt2020nc` (and `bt470bg`) as an
    // out_color_matrix value ("Undefined constant"), while `bt2020` is accepted by both majors.
    const tag = source.colorSpace
    if (tag === 'bt709') parts.push('scale=out_color_matrix=bt709', 'setparams=colorspace=bt709')
    else if (tag === 'smpte170m' || tag === 'bt470bg') parts.push(`setparams=colorspace=${tag}`)
  }
  return parts.length > 0 ? parts.join(',') : null
}

function autoZoomFilter(preset: FilterFrame): string {
  // Subtle 1.05× zoom that pulses gently — purely a streamer aesthetic.
  //
  // Round 18: two bugs fixed here, both caught by the real-ffmpeg
  // integration layer. (1) zoompan's expression evaluator has no `t`
  // variable — the correct name is `time` — so every autoZoom export
  // failed with an encoder error. (2) `s` was hardcoded to hd1080,
  // which would have resized portrait (TikTok/Reels) output back to
  // 1920x1080 landscape. zoompan defaults its output size to hd720
  // when `s` is omitted, so it must always be set to the preset dims.
  //
  // T-105: (3) zoompan ignores its input's timestamps. It emits `d` frames per
  // input frame and stamps them at its OWN `fps` (default 25), so a 30 fps clip
  // came out 20% long and a 60 fps one 140% long — with the sound left at the
  // clip's real length, and every overlay window after it running on the wrong
  // clock. `fps=N` ahead of it makes the input exactly N frames a second (it
  // resamples by timestamp, so a sped-up clip is honored) and `:fps=N` stamps
  // the output at the same N, one frame in, one frame out; N is the rate the
  // encoder writes (`-r`), so the final rate change is a no-op.
  //
  // T-109: (4) zoompan's `x` and `y` default to 0, so the window it crops out
  // starts at the top-left corner of the frame and the picture grew out of that
  // corner — a centered subject drifted ~24 px right and ~13 px down by 1.4 s in a
  // 1280x720 frame, a streamer's face walking toward the bottom-right. The window
  // is `iw/zoom` wide, so centering it is `iw/2 - iw/zoom/2` (and the same for
  // height): the standard form, and the zoom is then about the middle.
  return `fps=${preset.fps},zoompan=z='1.0+0.05*abs(sin(time*0.6))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${preset.width}x${preset.height}:fps=${preset.fps}`
}

function hypeShakeFilter(): string {
  // Mild jitter (~3 px) that activates briefly. Cheap approximation of a hype-shake.
  return `crop=iw-6:ih-6:'3+3*sin(2*PI*t*8)':'3+3*cos(2*PI*t*9)'`
}

/**
 * The watermark graph. Subject to the PER-PLATFORM CAVEAT on
 * `drawTextFilter` above: this string only renders on win32, and its pixels
 * are pinned by the win32-gated T-51 tests in the Layer 5 suite (all four
 * corners, against a control render of the same source).
 */
function watermarkFilter(spec: WatermarkSpec, preset: FilterFrame): string {
  const fontPath = 'C\\:/Windows/Fonts/arialbd.ttf'
  const fontSize = Math.max(12, Math.round((spec.fontSizePct / 100) * preset.height))
  const text = escapeDrawtext(spec.text)
  const padding = 20
  let x: string
  let y: string
  switch (spec.position) {
    case 'top-left':
      x = `${padding}`
      y = `${padding}`
      break
    case 'top-right':
      x = `w-tw-${padding}`
      y = `${padding}`
      break
    case 'bottom-left':
      x = `${padding}`
      y = `h-th-${padding}`
      break
    case 'bottom-right':
    default:
      x = `w-tw-${padding}`
      y = `h-th-${padding}`
      break
  }
  const alpha = Math.max(0, Math.min(1, spec.opacity)).toFixed(2)
  return `drawtext=fontfile='${fontPath}':text='${text}':fontsize=${fontSize}:fontcolor=white@${alpha}:x=${x}:y=${y}:box=1:boxcolor=black@${(Number(alpha) * 0.4).toFixed(2)}:boxborderw=8`
}

/**
 * The ONE filter graph for a clip's picture (T-105). A platform export builds it
 * from the platform's preset; a compilation segment builds it from the
 * compilation's own frame (`buildSegmentFilter`, concat.ts) — same crop, speed,
 * shake, grade, zoom and overlays, in the same order, so a clip cannot compile
 * differently from how it exports. Its sound is `buildAudioSpeedFilter`'s.
 */
export function buildVideoFilter(
  clip: FilterClip,
  preset: FilterFrame,
  source: SourceDimensions,
  watermark?: WatermarkSpec | null,
  /**
   * A Reframe's side (T-125 (9)): the ONE stage that differs. Everything else a Reframe makes - the clip's speed, crop, shake,
   * scale, grade, zoom and text - is this function's, at the 9:16 frame; only the centered cut to that shape becomes the strip at
   * the chosen side. (Reframe had been a subset of this builder since T-124 (16), which kept the speed and the crop and
   * dropped the rest.)
   */
  position?: StripPosition
): string {
  const parts: string[] = []
  const speed = clipSpeed(clip)
  if (speed !== 1) parts.push(`setpts=PTS/${speed.toFixed(4)}`)
  // T-126 (21): the picture is made CFR at the preset's rate HERE, right after the retime (so the resample honors the speed - the
  // reasoning `autoZoomFilter` records) and ahead of everything that costs per frame. `-r N` alone is the encoder's rate, and the
  // output vsync it sets drops a frame only once the output runs more than 1.1 frames ahead: a 60 / 59.94 / 50 / 120 / 48 fps
  // recording (OBS's usual) or a 30 fps clip at 1.25x / 2x left the picture ~2 output frames late against its sound (+67 ms
  // measured at 60 -> 30 fps: 302 frames and the flash at 5.0667 s, where this gives 300 and 5.000 s; the beep at 5.013 s in
  // both). The Auto Zoom path, which carries this stage already, measured 0 ms. `-r` stays: it pins the muxer's rate and is a
  // no-op on a stream that is already constant. One place covers the export, the reframe and the compilation segment.
  parts.push(`fps=${preset.fps}`)
  // T-83 — the manual crop is the new SOURCE FRAME, not the final picture
  // (see `cropToFrame` for the chain and why). Before this, a manual crop
  // skipped the aspect step and `scale` forced the preset's exact WxH on
  // whatever shape the user had drawn: a 4:3 crop exported to Reels came out
  // 2.4x too tall, on every ticked platform at once.
  parts.push(...cropToFrame(clip.cropRect, source, preset.aspectRatio, position))
  if (clip.hypeShake) parts.push(hypeShakeFilter())
  parts.push(scaleFilter(preset))
  if (clip.colorGrade) {
    const cg = colorGradeFilter(clip.colorGrade, source)
    if (cg) parts.push(cg)
  }
  if (clip.autoZoom) parts.push(autoZoomFilter(preset))
  for (const overlay of clip.textOverlays) {
    // `speed` is passed because `setpts` above already divided the graph's
    // clock by it — see the timebase note on drawTextFilter.
    parts.push(drawTextFilter(overlay, preset, clip.startSec, speed))
  }
  if (watermark && watermark.text.trim()) {
    parts.push(watermarkFilter(watermark, preset))
  }
  return parts.join(',')
}

/**
 * The audio half of a clip's speed (T-105): the `atempo` chain that follows
 * `setpts=PTS/speed` on the picture, or '' at 1x. Pitch is kept, so a sped-up
 * burst is shorter and not higher. One `atempo` covers 0.5-2.0; a factor outside
 * that is chained (4x = 2 x 2, 0.25x = 0.5 x 0.5). Shared by a platform export
 * and a compilation segment.
 */
export function buildAudioSpeedFilter(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0 || speed === 1) return ''
  // atempo accepts 0.5-2.0; chain for larger ratios
  const chain: string[] = []
  let remaining = speed
  while (remaining > 2) {
    chain.push('atempo=2')
    remaining /= 2
  }
  while (remaining < 0.5) {
    chain.push('atempo=0.5')
    remaining /= 0.5
  }
  if (Math.abs(remaining - 1) > 0.001) {
    chain.push(`atempo=${remaining.toFixed(4)}`)
  }
  return chain.join(',')
}
