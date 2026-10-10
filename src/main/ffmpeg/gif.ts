import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { cropToFrame, type SourceDimensions } from './filters'
import { probeVideo } from './probe'
import { cancelledOr, killAsCancelled } from './cancelMark'
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

export async function runGifExport(spec: GifJobSpec): Promise<{ outputPath: string }> {
  const base = path.parse(spec.sourcePath).name
  const outputPath = path.join(
    spec.outDir,
    `${base}_${spec.width}px_${Math.round(spec.fps)}fps.gif`
  )

  // Only a crop needs the frame's pixels; an uncropped GIF starts no extra process.
  const probe = spec.cropRect ? await probeVideo(spec.sourcePath) : null
  const filter = buildGifFilter(spec, probe ? { width: probe.width, height: probe.height } : undefined)

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
    outputPath
  ]

  await new Promise<void>((resolve, reject) => {
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

  return { outputPath }
}

export function cancelGifJob(jobId: string): boolean {
  const child = activeJobs.get(jobId)
  if (!child) return false
  killAsCancelled(child)
  activeJobs.delete(jobId)
  return true
}

// B2 fix (round 16): kill all in-flight gif jobs on app quit so an orphan
// ffmpeg.exe can't keep encoding palette+gif after the window is gone.
export function cancelAllGifJobs(): void {
  for (const [, child] of activeJobs) killAsCancelled(child)
  activeJobs.clear()
}
