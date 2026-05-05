import type { Clip, CropRect, TextOverlay, WatermarkSpec } from '../../shared/clip'
import type { PlatformPreset } from './presets'

export interface SourceDimensions {
  width: number
  height: number
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
}

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
  if (clip.cropRect) {
    parts.push(cropToFilter(clip.cropRect, source))
  } else {
    const auto = autoCropForAspect(source, preset.aspectRatio)
    if (auto) parts.push(auto)
  }
  parts.push(scaleFilter(preset))
  for (const overlay of clip.textOverlays) {
    parts.push(drawTextFilter(overlay, preset))
  }
  if (watermark && watermark.text.trim()) {
    parts.push(watermarkFilter(watermark, preset))
  }
  return parts.join(',')
}
