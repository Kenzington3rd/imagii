import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { cropToFrame, type SourceDimensions } from './filters'
import { probeVideo } from './probe'
import { cancelledOr, killAsCancelled } from './cancelMark'
import { CancelLatch, type LatchRun } from './cancelLatch'
import { finishPartial, partialPathFor } from './partialOutput'
import { ensureOutputDir, nextFreePath } from './outputPath'
import { assertDefined } from '../../shared/assert'
import type { CropRect } from '../../shared/clip'

export interface GifJobSpec {
  jobId: string
  sourcePath: string
  outDir: string
  startSec: number
  endSec: number
  width: number
  fps: number
  speed: number
  /** The clip's manual crop (T-96): the GIF is made from that rectangle. */
  cropRect?: CropRect | null
  /**
   * The name of the file the person opened, without its extension, already safe to put in a file name (the handler sanitizes it;
   * T-124 (17)). A converted import is played from a working copy with a nanoid in its name, and the GIF was named for that copy.
   * Missing means the source path's own name.
   */
  sourceName?: string
}

/**
 * The GIF's whole filter graph. The clip's crop comes FIRST (`cropToFrame`,
 * the chain a platform export uses, T-83/T-96) so the frame rate, the scale and
 * the palette are all computed on the picture the user chose; with
 * `targetAspect` null the GIF keeps the crop's own shape and `scale=W:-1`
 * derives its height. `source` is required only when there is a crop (a crop
 * is a fraction of the frame), and an uncropped GIF's graph is byte-for-byte
 * what it was.
 */
export function buildGifFilter(
  spec: Pick<GifJobSpec, 'width' | 'fps' | 'speed' | 'cropRect'>,
  source?: SourceDimensions
): string {
  const chain: string[] = []
  if (spec.speed !== 1) chain.push(`setpts=PTS/${spec.speed}`)
  if (spec.cropRect) {
    chain.push(...cropToFrame(spec.cropRect, assertDefined(source, 'source dimensions'), null))
  }
  chain.push(`fps=${spec.fps}`, `scale=${spec.width}:-1:flags=lanczos`)
  return (
    `${chain.join(',')},split[s0][s1];[s0]palettegen=stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=bayer:bayer_scale=5`
  )
}

const activeJobs = new Map<string, ChildProcess>()
// T-98: a cropped GIF probes the source before it spawns; a Cancel in that wait
// finds no child to kill, so the run is what it marks.
const latch = new CancelLatch()

export async function runGifExport(spec: GifJobSpec): Promise<{ outputPath: string }> {
  const run = latch.begin(spec.jobId)
  try {
    return await makeGif(spec, run)
  } finally {
    run.end()
  }
}

async function makeGif(spec: GifJobSpec, run: LatchRun): Promise<{ outputPath: string }> {
  const base = spec.sourceName ?? path.parse(spec.sourcePath).name

  // Only a crop needs the frame's pixels; an uncropped GIF starts no extra process.
  const probe = spec.cropRect ? await run.guard(probeVideo(spec.sourcePath)) : null
  const filter = buildGifFilter(spec, probe ? { width: probe.width, height: probe.height } : undefined)
  // T-106: `<source>_<width>px_<fps>fps.gif` is the name WANTED; the next GIF with
  // the same settings (a different part of the clip, a different crop) writes
  // beside the last one instead of over it.
  // T-125 (10): the folder is there before the name is chosen.
  await run.guard(ensureOutputDir(spec.outDir))
  const wanted = await run.guard(
    nextFreePath(path.join(spec.outDir, `${base}_${spec.width}px_${Math.round(spec.fps)}fps.gif`))
  )
  // T-140 (1): written to a partial beside the name chosen, swapped in only when whole (`partialOutput.ts`).
  const partial = partialPathFor(wanted)

  const args = [
    '-y',
    '-ss',
    spec.startSec.toFixed(3),
    '-to',
    spec.endSec.toFixed(3),
    '-i',
    spec.sourcePath,
    '-filter_complex',
    filter,
    '-loop',
    '0',
    partial
  ]

  const made = new Promise<void>((resolve, reject) => {
    run.check()
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    activeJobs.set(spec.jobId, child)
    let stderr = ''
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
      if (code === 0) resolve()
      else reject(cancelledOr(child, new Error(`gif exit ${code}: ${stderr.slice(-500)}`)))
    })
  })
  // T-100: a GIF with no trailer opens in nothing; it is never swapped in.
  const { outputPath } = await finishPartial(made, { run, partial, target: wanted, mode: 'beside' })

  return { outputPath }
}

export function cancelGifJob(jobId: string): boolean {
  const marked = latch.cancel(jobId)
  const child = activeJobs.get(jobId)
  if (!child) return marked
  killAsCancelled(child)
  activeJobs.delete(jobId)
  return true
}

// B2 fix (round 16): kill all in-flight gif jobs on app quit so an orphan
// ffmpeg.exe can't keep encoding palette+gif after the window is gone.
export function cancelAllGifJobs(): void {
  latch.cancelAll()
  for (const [, child] of activeJobs) killAsCancelled(child)
  activeJobs.clear()
}
