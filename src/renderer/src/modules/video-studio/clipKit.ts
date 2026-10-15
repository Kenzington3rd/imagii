import { clipForExport, clipSpeed, type Clip, type ExportJobSpec, type PlatformId, type WatermarkSpec } from '@shared/clip'
import { cropFrameSize } from '@shared/safeZone'
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
 * INIT-B (round 15): when the clip's picture is vertical (height > width), the
 * YouTube slot is a 1080x1920 Short instead of a 1920x1080 landscape — landscape
 * on vertical material wastes 75% of the frame. There is no separate
 * "youtube-short" preset, so it reuses the reels geometry and the file is
 * relabelled `_youtube_short`.
 *
 * T-112: "the clip's picture" is `cropFrameSize` — the manual crop when there is
 * one, else the whole source — the frame every export is cut from and every
 * verdict of the grid is about (T-83, T-97). This read the SOURCE, so a 16:9
 * recording cropped to 9:16 (the usual way a streamer makes a vertical clip)
 * never got its Short, and a portrait recording cropped to landscape got one it
 * did not want. A probe that reported no size is never vertical.
 */
function isVerticalFrame(source: KitSource, clip: Pick<Clip, 'cropRect'>): boolean {
  if (!(source.width > 0 && source.height > 0)) return false
  const frame = cropFrameSize(source.width, source.height, clip.cropRect)
  return frame.h > frame.w
}

/** The presets the kit really exports, in queue order, with the YouTube slot swapped when the clip's frame is vertical. */
export function kitEffectivePresets(source: KitSource, clip: Pick<Clip, 'cropRect'>): PlatformId[] {
  const vertical = isVerticalFrame(source, clip)
  return ALL_PLATFORM_IDS.map((p) => (p === 'youtube' && vertical ? 'reels' : p))
}

/**
 * How long a YouTube Short may be, in seconds (T-113): 3 minutes. The kit's YouTube slot
 * for a vertical clip is written with Reels' geometry (there is no separate preset), so
 * it was asked about as Reels — and when Reels' limit became its real 20 minutes
 * (T-112) the Short lost every length check: a 4-minute 9:16 clip kitted with no
 * question, for a platform that takes 3 minutes. The Short is its own slot with its own
 * limit; Reels stays 20 minutes.
 */
export const YOUTUBE_SHORT_LIMIT_SEC = 180

/** The swapped YouTube slot as the question names it: Reels' geometry, a Short's name and limit. */
const YOUTUBE_SHORT_INFO: PlatformInfo = {
  ...PLATFORM_INFO.reels,
  label: 'YouTube Short',
  durationHardLimit: YOUTUBE_SHORT_LIMIT_SEC
}

/**
 * The five slots the kit writes, in queue order, as the platforms the length question
 * is asked about (T-113). It is `kitEffectivePresets` with the swapped YouTube slot
 * named for what it is — a YouTube Short, not a second Reels.
 */
export function kitLimitTargets(source: KitSource, clip: Pick<Clip, 'cropRect'>): PlatformInfo[] {
  const vertical = isVerticalFrame(source, clip)
  return ALL_PLATFORM_IDS.map((p) => (p === 'youtube' && vertical ? YOUTUBE_SHORT_INFO : PLATFORM_INFO[p]))
}

/**
 * The names of the kit's two non-video files, both built on the sanitized clip name like
 * their siblings (`<name>_youtube.mp4`). T-114: the SRT was the one file named by the BARE
 * clip name, and a clip called Aux, Con, COM1 or lpt9 made `Aux.srt` a Windows device name
 * - the five videos and three thumbnails were written and then the path gate refused the
 * SRT, so the whole kit reported failure. A suffix is what makes any clip name a file name.
 */
export function kitSrtFilename(safeName: string): string {
  return `${safeName}_captions.srt`
}

/** `index` is 0-based; the file is numbered from 1. */
export function kitThumbFilename(safeName: string, index: number): string {
  return `${safeName}_thumb_${index + 1}.jpg`
}

/**
 * What `captions:writeKitSrt` is asked for the kit's SRT (T-113): the transcript is of the
 * whole recording, and the kit's video is ONE clip at ITS speed, so the request carries
 * the clip — its range and the speed it plays at (`clipSpeed`, so a stored 0 is 1x) —
 * and main writes the cues on that file's clock.
 */
export function buildKitSrtRequest(
  srtPath: string,
  dest: string,
  clip: Pick<Clip, 'startSec' | 'endSec' | 'speedMultiplier'>
): { srtPath: string; dest: string; startSec: number; endSec: number; speed: number } {
  return { srtPath, dest, startSec: clip.startSec, endSec: clip.endSec, speed: clipSpeed(clip) }
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
  const vertical = isVerticalFrame(source, clip)
  return ALL_PLATFORM_IDS.map((preset: PlatformId) => {
    const effectivePreset: PlatformId = preset === 'youtube' && vertical ? 'reels' : preset
    const filenameSuffix = preset === 'youtube' && vertical ? 'youtube_short' : preset
    return {
      jobId: newJobId(),
      sourcePath: source.filePath,
      outDir: kitDir,
      // T-113: the clip as it plays (a stored speed of 0 is 1x, as everywhere else).
      clip: { ...clipForExport(clip), selectedPresets: [effectivePreset] },
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
 * two of the kit's slots can name the same platform. Targets are platform ids or the
 * kit's own `PlatformInfo`s (`kitLimitTargets`, which names the Short).
 */
export function platformsOverLimit(
  clip: Pick<Clip, 'startSec' | 'endSec' | 'speedMultiplier'>,
  targets: ReadonlyArray<PlatformId | PlatformInfo>
): PlatformInfo[] {
  const durationSec = outputDurationSec(clip)
  // T-113: by name, not by id — the Short and Reels share an id (the Short IS Reels' geometry)
  // and are two different questions.
  const seen = new Set<string>()
  const over: PlatformInfo[] = []
  for (const target of targets) {
    const info = typeof target === 'string' ? PLATFORM_INFO[target] : target
    if (seen.has(info.label)) continue
    seen.add(info.label)
    if (durationSec > info.durationHardLimit) over.push(info)
  }
  return over
}

/** "YouTube Short — the typical 3-minute limit": one row of the kit's long-clip question. */
export function describeKitLimit(info: PlatformInfo): string {
  return `${info.label} — the typical ${spanAdjective(info.durationHardLimit)} limit`
}

/**
 * What the kit's button says while the platform exports run (T-112): the version in
 * progress out of the set. `done` is how many jobs have finished; it never reads past
 * the last one.
 */
export function kitExportLabel(done: number, total: number): string {
  return `Exporting platform version ${Math.min(done + 1, total)} of ${total}…`
}

/**
 * What a canceled kit says (T-113). With files finished it points at the folder that holds
 * them; with none (`landed` is 0) the folder was removed with nothing in it, and
 * "files already finished are in your folder" would send the person looking for a folder
 * that is gone.
 */
export function kitCanceledMessage(landed: number): string {
  return landed > 0 ? 'Clip Kit canceled. Files already finished are in your folder.' : 'Clip Kit canceled.'
}

/** The same for the three thumbnail frames that follow. `index` is zero-based. */
export function kitThumbLabel(index: number, total: number): string {
  return `Extracting thumbnail ${Math.min(index + 1, total)} of ${total}…`
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
