import type { Clip, ExportJobSpec, PlatformId, WatermarkSpec } from '@shared/clip'
import {
  ALL_PLATFORM_IDS,
  PLATFORM_INFO,
  outputDurationSec,
  spanAdjective,
  type PlatformInfo
} from './presets'

/**
 * The pure half of Clip Kit: what it queues, and what it warns about first.
 *
 * Kept out of ClipKitButton so the exact jobs the button hands to main can be
 * driven through the real export runner in the Layer 5 suite (T-85: the kit's
 * watermark is an ffmpeg-bound value, and a string-shape test of the filter
 * says nothing about the spec the kit actually builds).
 */

/** What the kit needs to know about the loaded video. */
export interface KitSource {
  filePath: string
  width: number
  height: number
}

/**
 * INIT-B (round 15): when the source is vertical (height > width), the YouTube
 * slot is a 1080x1920 Short instead of a 1920x1080 landscape — landscape on
 * vertical material wastes 75% of the frame. There is no separate
 * "youtube-short" preset, so it reuses the reels geometry and the file is
 * relabelled `_youtube_short`.
 */
function isVerticalSource(source: KitSource): boolean {
  return source.height > source.width
}

/** The presets the kit really exports, in queue order, with the YouTube slot swapped on a vertical source. */
export function kitEffectivePresets(source: KitSource): PlatformId[] {
  const vertical = isVerticalSource(source)
  return ALL_PLATFORM_IDS.map((p) => (p === 'youtube' && vertical ? 'reels' : p))
}

/**
 * One export job per platform slot for `clip`, written into `kitDir`.
 *
 * `watermark` is whatever the caller resolved (T-85: the one the user saved,
 * read where the Export panel reads it — see `buildWatermark`); it rides on
 * EVERY job, because a kit where one platform's file is marked and another's is
 * not is not a kit.
 */
export function buildKitQueue(args: {
  source: KitSource
  clip: Clip
  kitDir: string
  /** The sanitized clip name the files are named after. */
  safeName: string
  watermark: WatermarkSpec | null
  newJobId: () => string
}): ExportJobSpec[] {
  const { source, clip, kitDir, safeName, watermark, newJobId } = args
  const vertical = isVerticalSource(source)
  return ALL_PLATFORM_IDS.map((preset: PlatformId) => {
    const effectivePreset: PlatformId = preset === 'youtube' && vertical ? 'reels' : preset
    const filenameSuffix = preset === 'youtube' && vertical ? 'youtube_short' : preset
    return {
      jobId: newJobId(),
      sourcePath: source.filePath,
      outDir: kitDir,
      clip: { ...clip, selectedPresets: [effectivePreset] },
      preset: effectivePreset,
      watermark,
      outputFilename: `${safeName}_${filenameSuffix}.mp4`
    }
  })
}

/**
 * T-85 — the kit's one question. Which of the kit's platforms does `clip` run
 * past the TYPICAL upload limit of?
 *
 * The same limits, the same word, AND the same length the export grid uses for
 * its red "Too long" (`evaluateSuccess`, T-83): the clip's length at its speed
 * (`outputDurationSec`, T-97) — a 6-minute range at 2x is a 3-minute file and
 * must not be told it is long for Reels. An account's real cap depends on the
 * account, so this is advice, never "will be rejected". Deduplicated, because
 * a vertical source's YouTube slot IS the Reels preset.
 */
export function platformsOverLimit(
  clip: Pick<Clip, 'startSec' | 'endSec' | 'speedMultiplier'>,
  presets: readonly PlatformId[]
): PlatformInfo[] {
  const durationSec = outputDurationSec(clip)
  const seen = new Set<PlatformId>()
  const over: PlatformInfo[] = []
  for (const id of presets) {
    if (seen.has(id)) continue
    seen.add(id)
    const info = PLATFORM_INFO[id]
    if (durationSec > info.durationHardLimit) over.push(info)
  }
  return over
}

/** "Reels — the typical 3-minute limit": one row of the kit's long-clip question. */
export function describeKitLimit(info: PlatformInfo): string {
  return `${info.label} — the typical ${spanAdjective(info.durationHardLimit)} limit`
}

/** A clip's length as m:ss (h:mm:ss from an hour), for the question's first sentence. */
export function formatClipLength(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
