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
  BurnInRequest,
  CaptionStyle
} from '../../shared/captions'
import { DEFAULT_CAPTION_STYLE } from '../../shared/captions'
import { assert } from '../../shared/assert'

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

/**
 * Parse SRT-style timestamps. Supports the standard 3-digit fractional form
 * ("00:00:01,500") AND any variable-length fractional ("00:00:01,5",
 * "00:00:01,50", "00:00:01,1234") — Whisper and other tools occasionally
 * emit non-3-digit fractions and the original Number(m[4]) / 1000 was
 * silently wrong by orders of magnitude. parseFloat('0.' + frac) restores
 * the value regardless of digit count.
 */
export function tsToSeconds(ts: string): number {
  const m = ts.match(/(\d+):(\d+):(\d+)[.,](\d+)/)
  if (!m) return 0
  const h = m[1]
  const min = m[2]
  const s = m[3]
  const frac = m[4]
  if (!h || !min || !s || !frac) return 0
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + parseFloat('0.' + frac)
}

function parseSrt(content: string): CaptionSegment[] {
  const blocks = content.split(/\r?\n\r?\n/)
  const segments: CaptionSegment[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) continue
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const parts = timeLine.split('-->').map((str) => str.trim())
    const from = parts[0]
    const to = parts[1]
    if (!from || !to) continue
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

/**
 * Hex `#RRGGBB` → ASS `&HbbggrrAA&` (alpha bytes prepended; bytes are
 * little-endian BGR plus a 2-byte alpha at the front for 0=opaque).
 * libass uses 0=opaque so we always emit "00" in the alpha slot.
 */
function hexToAssColor(hex: string): string {
  // assert keeps the helper's preconditions auditable per Power-of-Ten rule 5
  assert(/^#?[0-9a-fA-F]{6}$/.test(hex), `caption color must be #RRGGBB hex, got ${hex}`)
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)
  return `&H00${b}${g}${r}&`.toLowerCase().replace('&h', '&H')
}

function alignmentForPosition(position: CaptionStyle['position']): number {
  // libass numpad-style alignment (1..9). 2=bottom-center, 5=middle-center, 8=top-center.
  switch (position) {
    case 'top':
      return 8
    case 'middle':
      return 5
    case 'bottom':
      return 2
  }
}

function buildForceStyle(style: CaptionStyle, legacyFontSizePct: number): string {
  // The legacy fontSizePct path scaled by 10 to get a pixel size; preserve
  // that semantics when a fresh style isn't provided so old callers still work.
  const fontSize =
    style.fontSize > 0
      ? Math.max(16, Math.min(96, Math.round(style.fontSize)))
      : Math.max(16, Math.round(legacyFontSizePct * 10))
  const primary = hexToAssColor(style.primaryColor)
  const outline = hexToAssColor(style.outlineColor)
  const alignment = alignmentForPosition(style.position)
  const marginV = style.position === 'middle' ? 0 : 40
  return [
    `FontName=Arial`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${primary}`,
    `OutlineColour=${outline}`,
    `Outline=2`,
    `Shadow=0`,
    `Alignment=${alignment}`,
    `MarginV=${marginV}`
  ].join(',')
}

export async function runBurnIn(
  req: BurnInRequest,
  onProgress: CaptionsProgressListener
): Promise<{ outputPath: string }> {
  onProgress({ jobId: req.jobId, phase: 'burning-in', percent: 5 })

  const escapedSrt = req.srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
  const style = req.style ?? DEFAULT_CAPTION_STYLE
  const forceStyle = buildForceStyle(style, req.fontSizePct)
  const filter = `subtitles='${escapedSrt}':force_style='${forceStyle}'`

  // Phase 3.1: when the renderer asks to burn over a trimmed range, use
  // -ss/-to on the input so the output covers only that span. Same trick
  // runReframe uses; the input stream is seekable so this is fast and
  // accurate to the keyframe.
  const args: string[] = ['-y']
  if (
    req.startSec !== undefined &&
    req.endSec !== undefined &&
    req.endSec > req.startSec
  ) {
    args.push('-ss', req.startSec.toFixed(3), '-to', req.endSec.toFixed(3))
  }
  args.push(
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
  )

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

// Test-only export of internal helpers; prefer this over a separate file
// since the helpers are tightly tied to the burn-in implementation.
export const __testing__ = { hexToAssColor, alignmentForPosition, buildForceStyle }
