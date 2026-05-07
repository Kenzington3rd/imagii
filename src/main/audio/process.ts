import { spawn, type ChildProcess } from 'node:child_process'
import { ffmpegPath } from '../ffmpeg/paths'
import { buildChain, parseLoudnormJson, type LoudnormMeasurement } from './chain'
import { probeAudio } from './probe'
import type {
  AudioExportSpec,
  AudioJobProgress,
  AudioJobResult,
  AudioOutputFormat
} from '../../shared/audio'

export type AudioProgressListener = (p: AudioJobProgress) => void

const activeJobs = new Map<string, ChildProcess>()

function codecArgsFor(format: AudioOutputFormat, bitrate?: string): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', bitrate ?? '192k']
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '5']
    case 'aac':
      return ['-c:a', 'aac', '-b:a', bitrate ?? '192k']
  }
}

function durationFromTimemark(timemark: string): number {
  const m = timemark.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

async function runFfmpegJob(
  args: string[],
  jobId: string,
  totalDuration: number,
  pass: 'measure' | 'render' | 'mux',
  onProgress: AudioProgressListener,
  collectStderr = false
): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    activeJobs.set(jobId, child)
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
        const percent =
          totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0
        if (percent - lastEmitted > 1 || percent === 100) {
          lastEmitted = percent
          onProgress({ jobId, pass, percent, timemark })
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (collectStderr || stderr.length < 32768) stderr += chunk
      if (!collectStderr && stderr.length > 16384) stderr = stderr.slice(-16384)
    })

    child.on('error', (err) => {
      activeJobs.delete(jobId)
      reject(err)
    })
    child.on('close', (code) => {
      activeJobs.delete(jobId)
      if (code === 0) resolve({ stderr })
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.trim().slice(-1000)}`))
    })
  })
}

export async function runAudioExport(
  spec: AudioExportSpec,
  onProgress: AudioProgressListener
): Promise<AudioJobResult> {
  const startedAt = Date.now()
  const probe = await probeAudio(spec.sourcePath)

  let measurement: LoudnormMeasurement | undefined

  const chain = buildChain(spec.chain)

  if (chain.needsTwoPass && chain.filterPass1) {
    const args = [
      '-y',
      '-i',
      spec.sourcePath,
      '-af',
      chain.filterPass1,
      '-f',
      'null',
      '-progress',
      'pipe:1',
      '-nostats',
      '-'
    ]
    const { stderr } = await runFfmpegJob(args, spec.jobId, probe.duration, 'measure', onProgress, true)
    const parsed = parseLoudnormJson(stderr)
    if (parsed) measurement = parsed
  }

  const finalChain = buildChain(spec.chain, measurement)
  const secondary = spec.chain.secondaryTrack
  const args: string[] = ['-y', '-i', spec.sourcePath]
  if (secondary) {
    args.push('-i', secondary.filePath)
  }
  args.push('-vn')
  if (secondary) {
    const ducking = secondary.duckUnderPrimary
    const gainDb = secondary.gainDb
    // Match-loudness mode runs both tracks through single-pass loudnorm at the
    // same target before mixing — handy for co-host mics or game audio that
    // arrives at very different levels.
    const matchLoudness = secondary.matchLoudness === true
    const target = spec.chain.loudnormTargetLufs ?? -16
    const primaryStage = matchLoudness
      ? `${finalChain.filterPass2},loudnorm=I=${target}:TP=-1.5:LRA=11`
      : finalChain.filterPass2
    const secondaryGainOrLoud = matchLoudness
      ? `loudnorm=I=${target}:TP=-1.5:LRA=11`
      : `volume=${gainDb}dB`
    const filterGraph = ducking
      ? `[0:a]${primaryStage}[primary];` +
        `[1:a]${secondaryGainOrLoud}[secondary_pre];` +
        `[secondary_pre][primary]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[secondary_ducked];` +
        `[primary][secondary_ducked]amix=inputs=2:duration=longest:dropout_transition=0:weights='1 0.7'[mix]`
      : `[0:a]${primaryStage}[primary];` +
        `[1:a]${secondaryGainOrLoud}[secondary];` +
        `[primary][secondary]amix=inputs=2:duration=longest:dropout_transition=0:weights='1 1'[mix]`
    args.push('-filter_complex', filterGraph, '-map', '[mix]')
  } else {
    args.push('-af', finalChain.filterPass2)
  }
  args.push(
    ...codecArgsFor(spec.format, spec.bitrate),
    '-ar',
    '48000',
    '-progress',
    'pipe:1',
    '-nostats',
    spec.outputPath
  )
  await runFfmpegJob(args, spec.jobId, probe.duration, 'render', onProgress)
  onProgress({ jobId: spec.jobId, pass: 'render', percent: 100 })

  return {
    jobId: spec.jobId,
    outputPath: spec.outputPath,
    durationMs: Date.now() - startedAt
  }
}

export async function runAudioMux(
  jobId: string,
  videoPath: string,
  audioPath: string,
  outputPath: string,
  onProgress: AudioProgressListener
): Promise<AudioJobResult> {
  const startedAt = Date.now()
  const args = [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath
  ]
  await runFfmpegJob(args, jobId, 0, 'mux', onProgress)
  onProgress({ jobId, pass: 'mux', percent: 100 })
  return { jobId, outputPath, durationMs: Date.now() - startedAt }
}

export function cancelAudioJob(jobId: string): boolean {
  const child = activeJobs.get(jobId)
  if (!child) return false
  child.kill('SIGKILL')
  activeJobs.delete(jobId)
  return true
}
