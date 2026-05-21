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
    // B4 fix (round 15): Meta extended Reels to 3 minutes in 2024; sweet spot
    // bumped to 90 s to match the longer-form Reels norm.
    durationSweetSpot: { min: 15, max: 90 },
    durationHardLimit: 180
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    width: 1080,
    height: 1920,
    aspectRatio: 9 / 16,
    durationSweetSpot: { min: 21, max: 34 },
    // B3 fix (round 15): TikTok extended uploads to 60 minutes in late 2024.
    // The previous 10-minute cap red-flagged perfectly valid longer-form posts.
    durationHardLimit: 60 * 60
  },
  twitter: {
    id: 'twitter',
    label: 'X / Twitter',
    width: 1280,
    height: 720,
    aspectRatio: 16 / 9,
    // INIT-B (round 15): free tier caps at 2:20 (140 s); Premium subscribers
    // upload up to 3 hours. Setting the hard limit at 140 s red-flagged
    // Premium users on perfectly valid uploads. Move the cap to 3 h and
    // surface the free-tier cliff via the sweet-spot copy.
    durationSweetSpot: { min: 5, max: 140 },
    durationHardLimit: 3 * 60 * 60
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
    // INIT-B (round 15): special-case X so Premium users see honest copy
    // instead of a red flag. Free tier cliffs at 2:20; Premium up to 3 h.
    if (platform.id === 'twitter') {
      reasons.push('Free tier caps at 2:20; X Premium allows up to 3 h')
    } else {
      reasons.push(`Over ${platform.label} sweet spot (${platform.durationSweetSpot.max}s)`)
    }
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
