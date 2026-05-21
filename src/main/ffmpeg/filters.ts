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
  return `scale=${preset.width}:${preset.height}:flags=lanczos`
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

function autoZoomFilter(): string {
  // Subtle 1.05× zoom that pulses gently — purely a streamer aesthetic.
  return `zoompan=z='1.0+0.05*abs(sin(t*0.6))':d=1:s=hd1080`
}

function hypeShakeFilter(): string {
  // Mild jitter (~3 px) that activates briefly. Cheap approximation of a hype-shake.
  return `crop=iw-6:ih-6:'3+3*sin(2*PI*t*8)':'3+3*cos(2*PI*t*9)'`
}

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
  if (clip.autoZoom) parts.push(autoZoomFilter())
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
