import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { probeVideo } from './probe'
import {
  buildAudioSpeedFilter,
  buildVideoFilter,
  even,
  type FilterClip,
  type FilterFrame,
  type SourceDimensions,
  type StripPosition
} from './filters'
import type { ReframePhase } from '../../shared/reframe'
import { clipSpeed, type ClipRecipe } from '../../shared/clip'
import { cancelledOr, killAsCancelled } from './cancelMark'
import { CancelLatch, type LatchRun } from './cancelLatch'
import { discardPartialOutput } from './partialOutput'
import { ensureOutputDir, nextFreePath } from './outputPath'

export type ReframePosition = StripPosition

/** The rate a Reframe writes (`-r`), and the frame rate its graph is built for (Auto Zoom's `fps`). */
export const REFRAME_FPS = 30

/**
 * The clip's recipe (T-124 (16), T-125 (9)): every field that decides how it LOOKS and sounds, from the same type Compile carries
 * (`CompileSegment`), because a vertical file that is not the clip the person built is the wrong-file class of T-96 and T-105.
 */
export interface ReframeJobSpec extends Partial<ClipRecipe> {
  jobId: string
  sourcePath: string
  /** The name WANTED (T-106): a file already there is not replaced — the result's
   *  `outputPath` is the one actually written (`name (2).mp4`, ...). */
  outputPath: string
  position: ReframePosition
  startSec: number
  endSec: number
  outputWidth: number
  outputHeight: number
  // From `ClipRecipe`, all optional: `cropRect` (T-124 (16): the 9:16 strip is cut from THAT frame, as a GIF and a compilation take
  // the crop, T-96), `speedMultiplier` (a missing, 0, negative or non-number speed is 1x: `clipSpeed`), and, since T-125 (9),
  // `textOverlays` (on the SOURCE clock: `startSec` rebases them), `colorGrade`, `autoZoom` and `hypeShake`.
}

export interface ReframeProgress {
  jobId: string
  /** `starting` is the panel's own; main emits the other three. */
  phase: Exclude<ReframePhase, 'starting'>
  /** Only when main KNOWS how far along the work is (T-89): rendering's encoded time
   *  over the clip's length, and `done`. Checking the source is of unknown length, so
   *  that phase sends none and the panel draws an indeterminate bar. */
  percent?: number
}

const activeJobs = new Map<string, ChildProcess>()
// T-98: Reframe probes the source before it spawns; a Cancel in that wait finds
// no child, so the run is what it marks.
const latch = new CancelLatch()

// B1 fix (round 16): mirror cancelAllConcatJobs so before-quit can hard-kill
// any in-flight reframe encode. Pre-16, a long reframe survived app quit and
// kept ffmpeg.exe on the CPU after the app icon was gone.
export function cancelAllReframeJobs(): void {
  latch.cancelAll()
  for (const [, child] of activeJobs) killAsCancelled(child)
  activeJobs.clear()
}

// Round 17 B1: per-job cancel for the renderer's panel-level Cancel button.
// Returns true when there was a matching in-flight reframe to kill.
export function cancelReframeJob(jobId: string): boolean {
  const marked = latch.cancel(jobId)
  const child = activeJobs.get(jobId)
  if (!child) return marked
  killAsCancelled(child)
  activeJobs.delete(jobId)
  return true
}

function durationFromTimemark(t: string): number {
  const m = t.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * The filter graph for one reframe (T-125 (9)): the clip's picture, built by `buildVideoFilter` at the 9:16 frame, with the strip of
 * the side the person picked in place of the centered cut to that shape.
 *
 * T-124 (16) gave Reframe the clip's speed and crop and said the grade stayed out "matching Compile". Compile does not leave it out:
 * `buildSegmentFilter` hands the clip's whole recipe to `buildVideoFilter` (T-105), and the lesson of that round is the shared builder
 * with a different frame, never a second builder with a subset. So a Reframe is the same call with the 9:16 frame and the strip:
 * speed (`setpts`), the clip's crop (the NEW source frame, T-83: the strip's size and the side's offset are worked out from its
 * dimensions, so "Left" is the left of what the person cropped), Hype Shake, the scale and `setsar=1` (square pixels, an even size),
 * the grade (with the source's color space, T-118), Auto Zoom and the text overlays. With no recipe at all it is the graph it always
 * was, byte for byte (`reframe.test.ts` holds that). The sound is `buildAudioSpeedFilter`'s; the range is read from the SOURCE
 * (`-ss`/`-to` ahead of `-i`), so the overlays' clock is the clip's and `startSec` rebases the stored source-absolute seconds.
 */
export function buildReframeGraph(
  spec: Pick<ReframeJobSpec, 'position' | 'outputWidth' | 'outputHeight' | 'startSec' | keyof ClipRecipe>,
  source: SourceDimensions
): { filter: string; audioFilter: string } {
  // Round 18: force the scale target even - an odd outputWidth/outputHeight from a future caller would make yuv420p+libx264 reject
  // the encode (the UI hardcodes 1080x1920 today). The ASPECT is the one that was asked for.
  const frame: FilterFrame = {
    width: Math.max(2, even(spec.outputWidth)),
    height: Math.max(2, even(spec.outputHeight)),
    aspectRatio: spec.outputWidth / spec.outputHeight,
    fps: REFRAME_FPS
  }
  const clip: FilterClip = {
    startSec: spec.startSec,
    cropRect: spec.cropRect ?? null,
    textOverlays: spec.textOverlays ?? [],
    speedMultiplier: spec.speedMultiplier,
    colorGrade: spec.colorGrade,
    autoZoom: spec.autoZoom,
    hypeShake: spec.hypeShake
  }
  return {
    filter: buildVideoFilter(clip, frame, source, null, spec.position),
    audioFilter: buildAudioSpeedFilter(clipSpeed(spec))
  }
}

export async function runReframe(
  spec: ReframeJobSpec,
  onProgress: (p: ReframeProgress) => void
): Promise<{ outputPath: string; durationMs: number }> {
  const run = latch.begin(spec.jobId)
  try {
    return await reframeClip(spec, onProgress, run)
  } finally {
    run.end()
  }
}

async function reframeClip(
  spec: ReframeJobSpec,
  onProgress: (p: ReframeProgress) => void,
  run: LatchRun
): Promise<{ outputPath: string; durationMs: number }> {
  const startedAt = Date.now()
  onProgress({ jobId: spec.jobId, phase: 'analyzing' })

  const probe = await run.guard(probeVideo(spec.sourcePath))
  // T-125 (10): the folder is there before the name is chosen.
  await run.guard(ensureOutputDir(path.dirname(spec.outputPath)))
  const outputPath = await run.guard(nextFreePath(spec.outputPath))
  const { filter, audioFilter } = buildReframeGraph(spec, { width: probe.width, height: probe.height, colorSpace: probe.colorSpace })
  const speed = clipSpeed(spec)

  const args = [
    '-y',
    '-ss',
    spec.startSec.toFixed(3),
    '-to',
    spec.endSec.toFixed(3),
    '-i',
    spec.sourcePath,
    '-vf',
    filter,
    // T-124 (16): the sound goes through the clip's speed too (an `atempo` chain, pitch kept), only when there is one to apply.
    ...(audioFilter ? ['-af', audioFilter] : []),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '6M',
    '-r',
    String(REFRAME_FPS),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath
  ]

  // The length of what is WRITTEN: the range at the clip's speed (the progress bar's denominator).
  const totalDuration = Math.max(0.1, (spec.endSec - spec.startSec) / speed)
  onProgress({ jobId: spec.jobId, phase: 'rendering', percent: 0 })

  let spawnedAt: number | null = null
  await new Promise<void>((resolve, reject) => {
    run.check()
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    spawnedAt = Date.now()
    activeJobs.set(spec.jobId, child)
    let stderr = ''
    let lastEmitted = 0

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const lines = chunk.split(/\r?\n/)
      let timemark: string | undefined
      for (const line of lines) {
        const [k, v] = line.split('=')
        if (k === 'out_time' && v !== undefined) timemark = v
      }
      if (timemark) {
        const elapsed = durationFromTimemark(timemark)
        const percent = Math.min(100, (elapsed / totalDuration) * 100)
        if (percent - lastEmitted > 1 || percent === 100) {
          lastEmitted = percent
          onProgress({ jobId: spec.jobId, phase: 'rendering', percent })
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })

    child.on('error', (e) => {
      activeJobs.delete(spec.jobId)
      reject(cancelledOr(child, e))
    })
    child.on('close', (code) => {
      activeJobs.delete(spec.jobId)
      if (code === 0) {
        onProgress({ jobId: spec.jobId, phase: 'done', percent: 100 })
        resolve()
      } else {
        reject(cancelledOr(child, new Error(`reframe exit ${code}: ${stderr.slice(-500)}`)))
      }
    })
  }).catch(async (err: unknown) => {
    // T-100: a vertical clip with no moov atom is this job's wreckage, not a result.
    await discardPartialOutput(outputPath, spawnedAt)
    throw err
  })

  return { outputPath, durationMs: Date.now() - startedAt }
}
