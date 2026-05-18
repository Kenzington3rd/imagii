import { spawn } from 'node:child_process'
import { ffprobePath } from './paths'

export interface ProbeResult {
  duration: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  bitrate: number
  sizeBytes: number
}

interface FfprobeStream {
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
}

interface FfprobeFormat {
  duration?: string
  bit_rate?: string
  size?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0
  const [num, den] = rate.split('/').map(Number)
  if (!num || !den) return 0
  return num / den
}

export function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath
    ]
    const p = spawn(ffprobePath, args)
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (b) => (stdout += String(b)))
    p.stderr.on('data', (b) => (stderr += String(b)))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit ${code}: ${stderr.trim()}`))
        return
      }
      try {
        const data = JSON.parse(stdout) as FfprobeOutput
        const video = data.streams?.find((s) => s.codec_type === 'video')
        const audio = data.streams?.find((s) => s.codec_type === 'audio')
        if (!video) {
          reject(new Error('No video stream found in file'))
          return
        }
        // A malformed/partial ffprobe response can carry a video stream
        // but no `format.duration`. The prior code coerced this to `0`,
        // which flowed into makeDefaultClip(0, 1) → a silent 0:00→0:00
        // clip. Refuse the probe so the user sees a clear error.
        // (Mirrors the round-7 fix in main/audio/probe.ts.)
        const duration = Number(data.format?.duration ?? 0)
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new Error('ffprobe returned no usable duration for the video'))
          return
        }
        const fps = parseFps(video.avg_frame_rate) || parseFps(video.r_frame_rate)
        resolve({
          duration,
          width: video.width ?? 0,
          height: video.height ?? 0,
          fps,
          videoCodec: video.codec_name ?? 'unknown',
          audioCodec: audio?.codec_name ?? null,
          bitrate: Number(data.format?.bit_rate ?? 0),
          sizeBytes: Number(data.format?.size ?? 0)
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}
