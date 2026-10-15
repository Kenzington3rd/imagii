import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { resolveExportPreset } from './presets'
import { buildVideoFilter, buildAudioSpeedFilter } from './filters'
import { probeVideo } from './probe'
import { cancelledOr, killAsCancelled } from './cancelMark'
import { CancelLatch, type LatchRun } from './cancelLatch'
import { discardPartialOutput } from './partialOutput'
import { ensureOutputDir, nextFreePath } from './outputPath'
import { clipSpeed } from '../../shared/clip'
import type { ExportJobSpec, ExportProgress, ExportResult } from '../../shared/clip'

export type ProgressListener = (p: ExportProgress) => void

const activeJobs = new Map<string, ChildProcess>()
// T-98: a run per job (its probe is a pre-spawn await a Cancel must reach) and
// one per batch (the instant between one job and the next).
const latch = new CancelLatch()

/**
 * The run a batch holds open for as long as it works. `video:exportBatch` asks
 * it before every job, so a Cancel that lands between two jobs — when no child
 * is alive to kill — still stops the jobs that have not started.
 */
export function beginExportBatch(): LatchRun {
  return latch.begin()
}

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
  const run = latch.begin(job.jobId)
  try {
    return await encodeJob(job, onProgress, run)
  } finally {
    run.end()
  }
}

async function encodeJob(
  job: ExportJobSpec,
  onProgress: ProgressListener,
  run: LatchRun
): Promise<ExportResult> {
  // T-50: a job that carries a custom preset encodes at ITS geometry and
  // bitrates. The resolved preset is a full PlatformPreset, so every filter
  // and flag below reads it exactly as it read the platform row.
  const preset = resolveExportPreset(job.preset, job.customPreset)
  // T-98: the probe is where a Cancel pressed between two jobs lands.
  const probe = await run.guard(probeVideo(job.sourcePath))
  const source = { width: probe.width, height: probe.height, colorSpace: probe.colorSpace }
  const filterChain = buildVideoFilter(job.clip, preset, source, job.watermark)
  const speed = clipSpeed(job.clip)
  // Progress is measured against OUTPUT time (ffmpeg's out_time), and a
  // 2x-speed clip produces half as much output — divide by the speed or
  // the bar stalls at 50% until the job completes (round 18).
  const clipDuration = Math.max(0.1, (job.clip.endSec - job.clip.startSec) / speed)

  const sourceBase = path.parse(job.sourcePath).name
  // The fallback name has to distinguish two custom presets sharing a base
  // platform, so it uses the preset's own name rather than `preset.id`.
  const presetTag = job.customPreset ? safeFileBase(job.customPreset.name) : preset.id
  const outputName =
    job.outputFilename && job.outputFilename.trim()
      ? job.outputFilename
      : `${safeFileBase(sourceBase)}_${safeFileBase(job.clip.name)}_${presetTag}.mp4`
  // T-106: the name the settings give is the name WANTED. A file already there is
  // somebody's earlier export, and this job writes beside it, not over it.
  // T-125 (10): the folder is there before the name is chosen (a remembered one may have been deleted or live on an unplugged drive).
  await run.guard(ensureOutputDir(job.outDir))
  const outputPath = await run.guard(nextFreePath(path.join(job.outDir, outputName)))

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
  let spawnedAt: number | null = null

  const finished = new Promise<ExportResult>((resolve, reject) => {
    // T-98: the last look before the child exists. A throw here rejects the job.
    run.check()
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    spawnedAt = Date.now()
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
      reject(cancelledOr(child, err))
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
        // T-84: a child the cancel functions below killed rejects with the
        // sentinel; one that died by itself keeps its exit-code error.
        reject(cancelledOr(child, new Error(`FFmpeg exit ${code}: ${stderrBuffer.trim().slice(-1000)}`)))
      }
    })
  })
  // T-100: the half-written file is this job's wreckage; earlier jobs' files stay.
  return finished.catch(async (err: unknown) => {
    await discardPartialOutput(outputPath, spawnedAt)
    throw err
  })
}

export function cancelAllExportJobs(): void {
  latch.cancelAll()
  for (const [, child] of activeJobs) killAsCancelled(child)
  activeJobs.clear()
}
