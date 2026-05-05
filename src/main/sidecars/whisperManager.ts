import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { extractAudioFromVideo } from '../audio/extract'
import { ffmpegPath } from '../ffmpeg/paths'
import {
  captionsOutputDir,
  whisperExePath,
  whisperModelPath,
  modelsDir
} from './paths'
import type {
  CaptionsInstallStatus,
  CaptionSegment,
  CaptionsProgress,
  TranscribeRequest,
  TranscribeResult,
  BurnInRequest
} from '../../shared/captions'

export type CaptionsProgressListener = (p: CaptionsProgress) => void

export function getCaptionsStatus(): CaptionsInstallStatus {
  const exe = whisperExePath()
  const model = whisperModelPath()
  return {
    exeInstalled: exe.exists,
    exePath: exe.path,
    modelInstalled: model.exists,
    modelPath: model.path,
    modelsDir: modelsDir(),
    ready: exe.exists && model.exists
  }
}

function tsToSeconds(ts: string): number {
  const m = ts.match(/(\d+):(\d+):(\d+)[.,](\d+)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

function parseSrt(content: string): CaptionSegment[] {
  const blocks = content.split(/\r?\n\r?\n/)
  const segments: CaptionSegment[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) continue
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [from, to] = timeLine.split('-->').map((s) => s.trim())
    const textLines = lines.slice(lines.indexOf(timeLine) + 1)
    if (textLines.length === 0) continue
    segments.push({
      startSec: tsToSeconds(from),
      endSec: tsToSeconds(to),
      text: textLines.join('\n')
    })
  }
  return segments
}

export async function runTranscribe(
  req: TranscribeRequest,
  onProgress: CaptionsProgressListener
): Promise<TranscribeResult> {
  const status = getCaptionsStatus()
  if (!status.ready) throw new Error('Whisper not installed (see Captions setup)')
  const startedAt = Date.now()
  await mkdir(captionsOutputDir(), { recursive: true })

  onProgress({ jobId: req.jobId, phase: 'extracting', percent: 5 })
  const extracted = await extractAudioFromVideo(req.sourcePath)

  onProgress({ jobId: req.jobId, phase: 'transcribing', percent: 15 })

  const outputBase = path.join(
    captionsOutputDir(),
    `${path.parse(req.sourcePath).name}-${Date.now()}`
  )

  const args = [
    '-m',
    status.modelPath,
    '-f',
    extracted.wavPath,
    '-osrt',
    '-of',
    outputBase,
    '-l',
    req.language ?? 'en',
    '-pp'
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(status.exePath, args, { windowsHide: true })
    let stderr = ''
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      const m = chunk.match(/(\d+):(\d+):(\d+)[.,](\d+)/g)
      if (m && m.length > 0) {
        onProgress({
          jobId: req.jobId,
          phase: 'transcribing',
          percent: Math.min(95, 15 + Math.random() * 10),
          message: m[m.length - 1]
        })
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`whisper exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  await extracted.cleanup()

  onProgress({ jobId: req.jobId, phase: 'building-srt', percent: 95 })
  const srtPath = `${outputBase}.srt`
  if (!existsSync(srtPath)) {
    throw new Error(`Whisper did not produce ${srtPath}`)
  }
  const srtContent = await readFile(srtPath, 'utf8')
  const segments = parseSrt(srtContent)

  onProgress({ jobId: req.jobId, phase: 'done', percent: 100 })

  return {
    jobId: req.jobId,
    srtPath,
    segments,
    durationMs: Date.now() - startedAt
  }
}

export async function runBurnIn(
  req: BurnInRequest,
  onProgress: CaptionsProgressListener
): Promise<{ outputPath: string }> {
  onProgress({ jobId: req.jobId, phase: 'burning-in', percent: 5 })

  const escapedSrt = req.srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
  const fontSize = Math.max(16, Math.round(req.fontSizePct * 10))
  const filter = `subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=${fontSize},PrimaryColour=&Hffffff&,OutlineColour=&H80000000&,Outline=2,Shadow=0,Alignment=2,MarginV=40'`

  const args = [
    '-y',
    '-i',
    req.videoPath,
    '-vf',
    filter,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-progress',
    'pipe:1',
    '-nostats',
    req.outputPath
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const m = chunk.match(/out_time_ms=(\d+)/)
      if (m) {
        const ms = Number(m[1]) / 1000
        onProgress({
          jobId: req.jobId,
          phase: 'burning-in',
          percent: Math.min(99, 5 + (ms / 1000) * 0.5)
        })
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`burn-in exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  onProgress({ jobId: req.jobId, phase: 'done', percent: 100 })
  return { outputPath: req.outputPath }
}

export async function exportSrt(srtPath: string, destPath: string): Promise<void> {
  const content = await readFile(srtPath, 'utf8')
  await writeFile(destPath, content)
}
