import type { PlatformId } from '@shared/clip'

export interface PlatformInfo {
  id: PlatformId
  label: string
  width: number
  height: number
  aspectRatio: number
  durationSweetSpot: { min: number; max: number }
  durationHardLimit: number
}

export const PLATFORM_INFO: Record<PlatformId, PlatformInfo> = {
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    width: 1920,
    height: 1080,
    aspectRatio: 16 / 9,
    durationSweetSpot: { min: 60, max: 600 },
    durationHardLimit: 12 * 60 * 60
  },
  reels: {
    id: 'reels',
    label: 'Reels',
    width: 1080,
    height: 1920,
    aspectRatio: 9 / 16,
    durationSweetSpot: { min: 15, max: 60 },
    durationHardLimit: 90
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    width: 1080,
    height: 1920,
    aspectRatio: 9 / 16,
    durationSweetSpot: { min: 21, max: 34 },
    durationHardLimit: 600
  },
  twitter: {
    id: 'twitter',
    label: 'X / Twitter',
    width: 1280,
    height: 720,
    aspectRatio: 16 / 9,
    durationSweetSpot: { min: 5, max: 90 },
    durationHardLimit: 140
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    width: 1280,
    height: 720,
    aspectRatio: 16 / 9,
    durationSweetSpot: { min: 15, max: 240 },
    durationHardLimit: 240 * 60
  }
}

export const ALL_PLATFORM_IDS: PlatformId[] = [
  'youtube',
  'reels',
  'tiktok',
  'twitter',
  'facebook'
]

export type SuccessLevel = 'green' | 'yellow' | 'red'

export interface SuccessReason {
  level: SuccessLevel
  reasons: string[]
}

export function evaluateSuccess(
  platform: PlatformInfo,
  clipDuration: number,
  sourceWidth: number,
  sourceHeight: number,
  cropAspect: number | null
): SuccessReason {
  const reasons: string[] = []
  let level: SuccessLevel = 'green'

  const sourceAspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1
  const effectiveAspect = cropAspect ?? sourceAspect

  if (clipDuration > platform.durationHardLimit) {
    reasons.push(`Over ${platform.label} hard limit (${platform.durationHardLimit}s)`)
    level = 'red'
  } else if (clipDuration < platform.durationSweetSpot.min) {
    reasons.push(`Under ${platform.label} sweet spot (${platform.durationSweetSpot.min}s+)`)
    if (level === 'green') level = 'yellow'
  } else if (clipDuration > platform.durationSweetSpot.max) {
    reasons.push(`Over ${platform.label} sweet spot (${platform.durationSweetSpot.max}s)`)
    if (level === 'green') level = 'yellow'
  }

  const aspectDiff = Math.abs(effectiveAspect - platform.aspectRatio) / platform.aspectRatio
  if (aspectDiff > 0.5) {
    reasons.push('Aspect ratio mismatch — heavy crop needed')
    level = 'red'
  } else if (aspectDiff > 0.05) {
    reasons.push('Aspect ratio off — minor crop')
    if (level === 'green') level = 'yellow'
  }

  if (sourceWidth < platform.width || sourceHeight < platform.height) {
    reasons.push('Source resolution lower than target — will upscale')
    if (level === 'green') level = 'yellow'
  }

  if (reasons.length === 0) reasons.push('Looks great for this platform')
  return { level, reasons }
}
