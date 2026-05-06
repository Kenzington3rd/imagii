import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { PLATFORM_PRESETS } from './presets'
import { buildVideoFilter, buildAudioSpeedFilter } from './filters'
import { probeVideo } from './probe'
import type { ExportJobSpec, ExportProgress, ExportResult } from '../../shared/clip'

export type ProgressListener = (p: ExportProgress) => void

const activeJobs = new Map<string, ChildProcess>()

function safeFileBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'clip'
}

function durationFromTimemark(timemark: string): number {
  // HH:MM:SS.ms
  const m = timemark.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export async function runExportJob(
  job: ExportJobSpec,
  onProgress: ProgressListener
): Promise<ExportResult> {
  const preset = PLATFORM_PRESETS[job.preset]
  const probe = await probeVideo(job.sourcePath)
  const source = { width: probe.width, height: probe.height }
  const filterChain = buildVideoFilter(job.clip, preset, source, job.watermark)
  const clipDuration = Math.max(0.1, job.clip.endSec - job.clip.startSec)

  const sourceBase = path.parse(job.sourcePath).name
  const outputName =
    job.outputFilename && job.outputFilename.trim()
      ? job.outputFilename
      : `${safeFileBase(sourceBase)}_${safeFileBase(job.clip.name)}_${preset.id}.mp4`
  const outputPath = path.join(job.outDir, outputName)

  const speed =
    job.clip.speedMultiplier && job.clip.speedMultiplier > 0 ? job.clip.speedMultiplier : 1
  const audioSpeed = buildAudioSpeedFilter(speed)

  const args: string[] = [
    '-y',
    '-ss',
    job.clip.startSec.toFixed(3),
    '-to',
    job.clip.endSec.toFixed(3),
    '-i',
    job.sourcePath,
    '-vf',
    filterChain
  ]
  if (audioSpeed) args.push('-af', audioSpeed)
  args.push(
    '-c:v',
    preset.videoCodec,
    '-preset',
    'medium',
    '-pix_fmt',
    preset.pixFmt,
    '-b:v',
    preset.videoBitrate,
    '-r',
    String(preset.fps),
    '-c:a',
    preset.audioCodec,
    '-b:a',
    preset.audioBitrate,
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath
  )

  const startedAt = Date.now()

  return new Promise<ExportResult>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    activeJobs.set(job.jobId, child)

    let stderrBuffer = ''
    let lastEmitted = 0

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const lines = chunk.split(/\r?\n/)
      let timemark: string | undefined
      let fps: number | undefined
      for (const line of lines) {
        const [key, value] = line.split('=')
        if (!key || value === undefined) continue
        if (key === 'out_time') timemark = value
        else if (key === 'fps') {
          const n = Number(value)
          if (Number.isFinite(n)) fps = n
        }
      }
      if (timemark) {
        const elapsed = durationFromTimemark(timemark)
        const percent = clipDuration > 0 ? Math.min(100, (elapsed / clipDuration) * 100) : 0
        if (percent - lastEmitted > 0.5 || percent === 100) {
          lastEmitted = percent
          onProgress({ jobId: job.jobId, percent, fps, timemark })
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
      if (stderrBuffer.length > 16384) stderrBuffer = stderrBuffer.slice(-16384)
    })

    child.on('error', (err) => {
      activeJobs.delete(job.jobId)
      reject(err)
    })

    child.on('close', (code) => {
      activeJobs.delete(job.jobId)
      if (code === 0) {
        onProgress({ jobId: job.jobId, percent: 100 })
        resolve({
          jobId: job.jobId,
          outputPath,
          durationMs: Date.now() - startedAt
        })
      } else {
        reject(new Error(`FFmpeg exit ${code}: ${stderrBuffer.trim().slice(-1000)}`))
      }
    })
  })
}

export function cancelExportJob(jobId: string): boolean {
  const child = activeJobs.get(jobId)
  if (!child) return false
  child.kill('SIGKILL')
  activeJobs.delete(jobId)
  return true
}

export function cancelAllExportJobs(): void {
  for (const [, child] of activeJobs) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  activeJobs.clear()
}
