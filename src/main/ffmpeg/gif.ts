import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { ffmpegPath } from './paths'

export interface GifJobSpec {
  jobId: string
  sourcePath: string
  outDir: string
  startSec: number
  endSec: number
  width: number
  fps: number
  speed: number
}

const activeJobs = new Map<string, ChildProcess>()

export async function runGifExport(spec: GifJobSpec): Promise<{ outputPath: string }> {
  const base = path.parse(spec.sourcePath).name
  const outputPath = path.join(
    spec.outDir,
    `${base}_${spec.width}px_${Math.round(spec.fps)}fps.gif`
  )

  const speedFilter = spec.speed === 1 ? '' : `setpts=PTS/${spec.speed},`
  const filter =
    `${speedFilter}fps=${spec.fps},scale=${spec.width}:-1:flags=lanczos,` +
    `split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`

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
      reject(e)
    })
    child.on('close', (code) => {
      activeJobs.delete(spec.jobId)
      if (code === 0) resolve()
      else reject(new Error(`gif exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  return { outputPath }
}

export function cancelGifJob(jobId: string): boolean {
  const child = activeJobs.get(jobId)
  if (!child) return false
  child.kill('SIGKILL')
  activeJobs.delete(jobId)
  return true
}
