import type { Clip, CropRect, TextOverlay, WatermarkSpec, ColorGrade } from '../../shared/clip'
import type { PlatformPreset } from './presets'

export interface SourceDimensions {
  width: number
  height: number
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

export const __testing__ = { escapeDrawtext }

function cropToFilter(crop: CropRect, source: SourceDimensions): string {
  const w = Math.max(2, Math.round(crop.w * source.width))
  const h = Math.max(2, Math.round(crop.h * source.height))
  const x = Math.max(0, Math.round(crop.x * source.width))
  const y = Math.max(0, Math.round(crop.y * source.height))
  return `crop=${w}:${h}:${x}:${y}`
}

function autoCropForAspect(
  source: SourceDimensions,
  targetAspect: number
): string {
  const sourceAspect = source.width / source.height
  if (Math.abs(sourceAspect - targetAspect) < 0.01) return ''
  if (sourceAspect > targetAspect) {
    const cropW = Math.round(source.height * targetAspect)
    const cropX = Math.max(0, Math.round((source.width - cropW) / 2))
    return `crop=${cropW}:${source.height}:${cropX}:0`
  }
  const cropH = Math.round(source.width / targetAspect)
  const cropY = Math.max(0, Math.round((source.height - cropH) / 2))
  return `crop=${source.width}:${cropH}:0:${cropY}`
}

function scaleFilter(preset: PlatformPreset): string {
  return `scale=${preset.width}:${preset.height}:flags=lanczos`
}

function drawTextFilter(overlay: TextOverlay, preset: PlatformPreset): string {
  const fontPath = 'C\\:/Windows/Fonts/arial.ttf'
  const x = Math.round(overlay.x * preset.width)
  const y = Math.round(overlay.y * preset.height)
  const text = escapeDrawtext(overlay.text)
  const between = `between(t,${overlay.startSec.toFixed(3)},${overlay.endSec.toFixed(3)})`
  return `drawtext=fontfile='${fontPath}':text='${text}':fontsize=${overlay.sizePx}:fontcolor=${overlay.colorHex}:x=${x}:y=${y}:enable='${between}'`
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
