import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { probeVideo } from './probe'

export type ReframePosition = 'left' | 'center' | 'right' | 'smart'

export interface ReframeJobSpec {
  jobId: string
  sourcePath: string
  outputPath: string
  position: ReframePosition
  startSec: number
  endSec: number
  outputWidth: number
  outputHeight: number
}

export interface ReframeProgress {
  jobId: string
  phase: 'analyzing' | 'rendering' | 'done'
  percent: number
}

const activeJobs = new Map<string, ChildProcess>()

function durationFromTimemark(t: string): number {
  const m = t.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function computeCropOffset(
  position: ReframePosition,
  sourceWidth: number,
  cropWidth: number
): number {
  const margin = sourceWidth - cropWidth
  switch (position) {
    case 'left':
      return Math.max(0, Math.round(margin * 0.15))
    case 'right':
      return Math.max(0, Math.round(margin * 0.85))
    case 'center':
    case 'smart':
    default:
      return Math.max(0, Math.round(margin / 2))
  }
}

export async function runReframe(
  spec: ReframeJobSpec,
  onProgress: (p: ReframeProgress) => void
): Promise<{ outputPath: string; durationMs: number }> {
  const startedAt = Date.now()
  onProgress({ jobId: spec.jobId, phase: 'analyzing', percent: 0 })

  const probe = await probeVideo(spec.sourcePath)
  const sourceW = probe.width
  const sourceH = probe.height
  const targetAspect = spec.outputWidth / spec.outputHeight

  let cropW: number
  let cropH: number
  if (sourceW / sourceH > targetAspect) {
    cropH = sourceH
    cropW = Math.round(cropH * targetAspect)
  } else {
    cropW = sourceW
    cropH = Math.round(cropW / targetAspect)
  }
  const cropX = computeCropOffset(spec.position, sourceW, cropW)
  const cropY = Math.max(0, Math.round((sourceH - cropH) / 2))

  const filter = `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${spec.outputWidth}:${spec.outputHeight}:flags=lanczos`

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
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '6M',
    '-r',
    '30',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    spec.outputPath
  ]

  const totalDuration = Math.max(0.1, spec.endSec - spec.startSec)
  onProgress({ jobId: spec.jobId, phase: 'rendering', percent: 0 })

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
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
      reject(e)
    })
    child.on('close', (code) => {
      activeJobs.delete(spec.jobId)
      if (code === 0) {
        onProgress({ jobId: spec.jobId, phase: 'done', percent: 100 })
        resolve()
      } else {
        reject(new Error(`reframe exit ${code}: ${stderr.slice(-500)}`))
      }
    })
  })

  return { outputPath: spec.outputPath, durationMs: Date.now() - startedAt }
}
