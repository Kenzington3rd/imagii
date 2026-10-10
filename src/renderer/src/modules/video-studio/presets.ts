import type { Clip, PlatformId } from '@shared/clip'
import type { CustomPreset } from '@shared/customPresets'
import { cropFrameSize } from '@shared/safeZone'

export interface PlatformInfo {
  id: PlatformId
  label: string
  width: number
  height: number
  /** The frame rate the export is encoded at — shown on the grid, because
   *  every export used to run at 30 fps and nothing said so (T-92). Mirrors
   *  main's table; `presetTablesInSync.test.ts` holds the two together. */
  fps: number
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
    fps: 30,
    aspectRatio: 16 / 9,
    durationSweetSpot: { min: 60, max: 600 },
    durationHardLimit: 12 * 60 * 60
  },
  reels: {
    id: 'reels',
    label: 'Reels',
    width: 1080,
    height: 1920,
    fps: 30,
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
    fps: 30,
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
    fps: 30,
    aspectRatio: 16 / 9,
    // INIT-B (round 15): free tier caps at 2:20 (140 s); Premium subscribers
    // upload longer. Setting the hard limit at 140 s red-flagged Premium
    // users on perfectly valid uploads. Round 18: verified against
    // help.x.com/en/using-x/premium-longer-videos — Premium allows up to
    // 4 hours (web/iOS), not the 3 h round 15 recorded.
    durationSweetSpot: { min: 5, max: 140 },
    durationHardLimit: 4 * 60 * 60
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    width: 1280,
    height: 720,
    fps: 30,
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

/**
 * T-50 — a saved custom preset seen through the advisory table's own shape,
 * so the export grid, the success indicator and the safe-zone pre-flight all
 * treat it exactly like a platform preset.
 *
 * The renderer mirror of `resolveExportPreset` (src/main/ffmpeg/presets.ts):
 * geometry and aspect come from the custom preset, the duration advisories
 * from the platform it was built on. `id` stays the BASE platform id — it is
 * the `PlatformId` the export job carries — while `label` is the user's own
 * name, which is what the grid and the queue rows show.
 */
export function customPresetInfo(preset: CustomPreset): PlatformInfo {
  const base = PLATFORM_INFO[preset.basePlatformId]
  return {
    ...base,
    label: preset.name,
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    aspectRatio: preset.width / preset.height
  }
}

export type SuccessLevel = 'green' | 'yellow' | 'red'

export interface SuccessReason {
  level: SuccessLevel
  /** The word beside the dot. Green and yellow are "Great" and "OK"; a red
   *  one NAMES what is wrong ("Too long", "Wrong shape") instead of the old
   *  catch-all "Trim", which read as "shorten the clip" even when the problem
   *  was the picture's shape (T-83). */
  label: string
  /** Plain-language reasons, shown on screen under the label — not behind a
   *  hover (T-83). */
  reasons: string[]
}

/**
 * A duration as the adjective the reasons use ("the 10-minute sweet spot"):
 * seconds under a minute, minutes otherwise, a bare m:ss for a span that is
 * not a whole number of minutes (the typical 140 s X limit is "2:20"), and
 * hours only for the multi-hour caps, where "720-minute" would be absurd.
 */
export function spanAdjective(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}-second`
  if (sec % 60 !== 0) {
    const s = Math.round(sec % 60)
    return `${Math.floor(sec / 60)}:${String(s).padStart(2, '0')}`
  }
  const minutes = sec / 60
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

/** The parts of a clip an export is judged on: its range, its speed, its crop. */
export type JudgedClip = Pick<Clip, 'startSec' | 'endSec' | 'speedMultiplier' | 'cropRect'>

/**
 * How long the exported file runs (T-97): the clip's source range divided by
 * its speed. A 6-minute range at 2x is a 3-minute video, and 3 minutes is what
 * a platform's limit is a limit ON. The grid's verdict and Clip Kit's long-clip
 * question both read the clip's length through this, so neither can warn "too
 * long" at half of what the file will really be. The same speed rule
 * `buildVideoFilter` and `runExportJob` apply: a missing, zero, negative or
 * non-finite multiplier is 1x.
 */
export function outputDurationSec(
  clip: Pick<Clip, 'startSec' | 'endSec' | 'speedMultiplier'>
): number {
  const speed =
    typeof clip.speedMultiplier === 'number' && Number.isFinite(clip.speedMultiplier) && clip.speedMultiplier > 0
      ? clip.speedMultiplier
      : 1
  return Math.max(0, clip.endSec - clip.startSec) / speed
}

/**
 * How well a clip fits a platform, judged on what the export will really make:
 * the frame it STARTS from — the manual crop when the clip has one (the
 * pipeline cuts each platform's shape out of the crop, T-83), else the whole
 * source — and the length of the file it will write (T-97: at the clip's speed).
 * Both are read from the clip here, once, so a caller cannot hand this the
 * source's size or the source's seconds by mistake.
 *
 * Platform lengths are "typical" limits, never facts: an account's real cap
 * depends on the account, so a clip over one is told it is over the TYPICAL
 * limit, and the wording never claims the upload will be refused.
 */
export function evaluateSuccess(
  platform: PlatformInfo,
  clip: JudgedClip,
  sourceWidth: number,
  sourceHeight: number
): SuccessReason {
  const reasons: string[] = []
  const redLabels: string[] = []
  let level: SuccessLevel = 'green'

  const clipDuration = outputDurationSec(clip)
  // A probe that reported no size (cropFrameSize refuses it) is judged as it
  // always was: aspect 1, and smaller than every output.
  const frame =
    sourceWidth > 0 && sourceHeight > 0
      ? cropFrameSize(sourceWidth, sourceHeight, clip.cropRect)
      : { w: sourceWidth, h: sourceHeight }
  const effectiveAspect = frame.w > 0 && frame.h > 0 ? frame.w / frame.h : 1

  if (clipDuration > platform.durationHardLimit) {
    reasons.push(`Longer than the typical ${spanAdjective(platform.durationHardLimit)} limit`)
    redLabels.push('Too long')
    level = 'red'
  } else if (clipDuration < platform.durationSweetSpot.min) {
    reasons.push(`Under the ${spanAdjective(platform.durationSweetSpot.min)} sweet spot`)
    if (level === 'green') level = 'yellow'
  } else if (clipDuration > platform.durationSweetSpot.max) {
    // INIT-B (round 15): special-case X so Premium users see honest copy
    // instead of a red flag. The free tier's usual ceiling is 2:20; Premium
    // accounts go much longer.
    if (platform.id === 'twitter') {
      reasons.push(
        `Over the typical free-account limit of ${spanAdjective(platform.durationSweetSpot.max)} — longer videos need X Premium`
      )
    } else {
      reasons.push(`Over the ${spanAdjective(platform.durationSweetSpot.max)} sweet spot`)
    }
    if (level === 'green') level = 'yellow'
  }

  // The export cuts a centered strip of the frame to reach this shape, so the
  // honest number is how much of the frame's width (or height) survives.
  const aspectDiff = Math.abs(effectiveAspect - platform.aspectRatio) / platform.aspectRatio
  const keptPct = Math.round(
    (Math.min(effectiveAspect, platform.aspectRatio) /
      Math.max(effectiveAspect, platform.aspectRatio)) *
      100
  )
  const axis = effectiveAspect > platform.aspectRatio ? 'width' : 'height'
  if (aspectDiff > 0.5) {
    reasons.push(`Only the middle ${keptPct}% of the picture's ${axis} fits this shape`)
    redLabels.push('Wrong shape')
    level = 'red'
  } else if (aspectDiff > 0.05) {
    reasons.push(`${100 - keptPct}% of the picture's ${axis} is trimmed to fit this shape`)
    if (level === 'green') level = 'yellow'
  }

  // The FRAME, not the file (T-97): a quarter-frame crop of a 4K recording is
  // 1080p of picture, and exporting it at 1080p scales it up 2x. Whole pixels,
  // since a crop drawn as a fraction of the frame is rarely a whole number.
  if (Math.round(frame.w) < platform.width || Math.round(frame.h) < platform.height) {
    reasons.push('The picture is smaller than this output — it will be scaled up and look soft')
    if (level === 'green') level = 'yellow'
  }

  if (reasons.length === 0) reasons.push('Looks great for this platform')
  const label = level === 'green' ? 'Great' : level === 'yellow' ? 'OK' : redLabels.join(' · ')
  return { level, label, reasons }
}
