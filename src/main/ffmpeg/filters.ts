import type { Clip, CropRect, TextOverlay, WatermarkSpec, ColorGrade } from '../../shared/clip'
import type { PlatformPreset } from './presets'

export interface SourceDimensions {
  width: number
  height: number
}

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
 * Escape arbitrary user text for FFmpeg's drawtext filter param.
 * Handles the well-known offenders (backslash, single-quote, colon,
 * percent) plus newlines / carriage returns — without the newline
 * handling, a multiline text overlay (or a watermark someone pasted
 * with embedded newlines) breaks the filter graph and the entire
 * export fails. We normalize to FFmpeg's `\n` escape sequence.
 *
 * Order matters: escape backslash FIRST so we don't double-escape
 * the `\\` we introduce for other replacements.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')
}

export const __testing__ = { escapeDrawtext, safeOverlaySize, safeOverlayColor }

function cropToFilter(crop: CropRect, source: SourceDimensions): string {
  // M4 fix (round 15): force every crop dimension to an even integer so
  // yuv420p subsampling and libx264 strict-mode both accept the output.
  const w = Math.max(2, even(crop.w * source.width))
  const h = Math.max(2, even(crop.h * source.height))
  const x = Math.max(0, even(crop.x * source.width))
  const y = Math.max(0, even(crop.y * source.height))
  return `crop=${w}:${h}:${x}:${y}`
}

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

function scaleFilter(preset: PlatformPreset): string {
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
 * PER-PLATFORM CAVEAT (drawtext — this filter and `watermarkFilter` below,
 * the app's only two users of it): ffmpeg-static ships binaries from
 * DIFFERENT upstream builders per platform, exactly as the mpegts note in
 * shared/mediaFormats.ts describes. The linux x64 binary (johnvansickle
 * 7.0.2-static) is compiled without libfreetype and therefore has NO
 * `drawtext` filter — any export carrying a text overlay or a watermark
 * dies at graph init with "No such filter: 'drawtext'". The win32 x64
 * binary (gyan.dev 6.1.1), the one that ships in the product, has it.
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
function drawTextFilter(overlay: TextOverlay, preset: PlatformPreset): string {
  const fontPath = 'C\\:/Windows/Fonts/arial.ttf'
  const x = Math.round(overlay.x * preset.width)
  const y = Math.round(overlay.y * preset.height)
  const text = escapeDrawtext(overlay.text)
  const fontSize = safeOverlaySize(overlay.sizePx)
  const fontColor = safeOverlayColor(overlay.colorHex)
  const between = `between(t,${overlay.startSec.toFixed(3)},${overlay.endSec.toFixed(3)})`
  return `drawtext=fontfile='${fontPath}':text='${text}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}:enable='${between}'`
}

function colorGradeFilter(g: ColorGrade): string | null {
  const parts: string[] = []
  const eqParts: string[] = []
  if (g.brightness !== 0) eqParts.push(`brightness=${g.brightness.toFixed(3)}`)
  if (g.contrast !== 1) eqParts.push(`contrast=${g.contrast.toFixed(3)}`)
  if (g.saturation !== 1) eqParts.push(`saturation=${g.saturation.toFixed(3)}`)
  if (eqParts.length) parts.push(`eq=${eqParts.join(':')}`)
  if (g.temperature !== 0) {
    const t = g.temperature
    if (t > 0) {
      parts.push(`colorbalance=rs=${(t * 0.4).toFixed(3)}:bs=${(-t * 0.3).toFixed(3)}`)
    } else {
      parts.push(`colorbalance=rs=${(t * 0.3).toFixed(3)}:bs=${(-t * 0.4).toFixed(3)}`)
    }
  }
  return parts.length > 0 ? parts.join(',') : null
}

function autoZoomFilter(preset: PlatformPreset): string {
  // Subtle 1.05× zoom that pulses gently — purely a streamer aesthetic.
  //
  // Round 18: two bugs fixed here, both caught by the real-ffmpeg
  // integration layer. (1) zoompan's expression evaluator has no `t`
  // variable — the correct name is `time` — so every autoZoom export
  // failed with an encoder error. (2) `s` was hardcoded to hd1080,
  // which would have resized portrait (TikTok/Reels) output back to
  // 1920x1080 landscape. zoompan defaults its output size to hd720
  // when `s` is omitted, so it must always be set to the preset dims.
  return `zoompan=z='1.0+0.05*abs(sin(time*0.6))':d=1:s=${preset.width}x${preset.height}`
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
function watermarkFilter(spec: WatermarkSpec, preset: PlatformPreset): string {
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

export function buildVideoFilter(
  clip: Clip,
  preset: PlatformPreset,
  source: SourceDimensions,
  watermark?: WatermarkSpec | null
): string {
  const parts: string[] = []
  const speed = clip.speedMultiplier && clip.speedMultiplier > 0 ? clip.speedMultiplier : 1
  if (speed !== 1) parts.push(`setpts=PTS/${speed.toFixed(4)}`)
  if (clip.cropRect) {
    parts.push(cropToFilter(clip.cropRect, source))
  } else {
    const auto = autoCropForAspect(source, preset.aspectRatio)
    if (auto) parts.push(auto)
  }
  if (clip.hypeShake) parts.push(hypeShakeFilter())
  parts.push(scaleFilter(preset))
  if (clip.colorGrade) {
    const cg = colorGradeFilter(clip.colorGrade)
    if (cg) parts.push(cg)
  }
  if (clip.autoZoom) parts.push(autoZoomFilter(preset))
  for (const overlay of clip.textOverlays) {
    parts.push(drawTextFilter(overlay, preset))
  }
  if (watermark && watermark.text.trim()) {
    parts.push(watermarkFilter(watermark, preset))
  }
  return parts.join(',')
}

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
