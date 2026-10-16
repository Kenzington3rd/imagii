import { spawn } from 'node:child_process'
import { ffprobePath } from './paths'

export interface ProbeResult {
  duration: number
  width: number
  height: number
  /** 0 when the file does not say (see `probedFps`). */
  fps: number
  videoCodec: string
  audioCodec: string | null
  bitrate: number
  sizeBytes: number
  /**
   * The video stream's `color_space` as ffprobe prints it ('bt709', 'bt470bg', 'smpte170m', ...).
   * Absent when the stream is untagged (ffprobe prints nothing or 'unknown'). T-118: a bt709
   * source needs the temperature grade to convert back to bt709.
   */
  colorSpace?: string
}

interface FfprobeStream {
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  color_space?: string
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

/**
 * The ceiling above which a probed "frame rate" is not one (T-120): 240 fps, the same ceiling the export
 * gates hold a preset to (`ipc/video.ts`). A Matroska file stamps its packets in milliseconds, and one that
 * declares no rate of its own (every MediaRecorder webm, including the copy of it that Record saves with
 * Convert off) reads `r_frame_rate` 1000/1: that is the clock's resolution, and the Timeline's frame step
 * (`,` and `.`) was 1 ms on it.
 */
export const MAX_PLAUSIBLE_FPS = 240

/**
 * The frame rate of a probed video stream, or 0 when the file does not say one: `avg_frame_rate` first,
 * `r_frame_rate` if that is absent, and nothing at all above `MAX_PLAUSIBLE_FPS`. 0 is the "unknown" the
 * callers already handle (the Timeline and the Player step at 30 fps, `formatFps` prints 30).
 */
export function probedFps(avgRate: string | undefined, realRate: string | undefined): number {
  const fps = parseFps(avgRate) || parseFps(realRate)
  return fps > MAX_PLAUSIBLE_FPS ? 0 : fps
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
    const p = spawn(ffprobePath, args, { windowsHide: true })
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
        // T-08 (round 22): ffprobe's `tty` demuxer registers the `.txt`
        // extension and hands back a synthetic 640x400 pal8 stream in the
        // `ansi` (ASCII/ANSI art) decoder for ANY text file — exit 0, a
        // real duration, every check below satisfied. A streamer's notes
        // file therefore imported as a video with a full export panel
        // behind it. `ansi` is only ever produced by that demuxer, so
        // refusing it here — the one place drop, picker, and recent-files
        // all pass through — is the whole floor.
        if (video.codec_name === 'ansi') {
          reject(
            new Error('This file is text, not a video — pick a video file such as MP4, MOV, or MKV.')
          )
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
        const fps = probedFps(video.avg_frame_rate, video.r_frame_rate)
        resolve({
          duration,
          width: video.width ?? 0,
          height: video.height ?? 0,
          fps,
          videoCodec: video.codec_name ?? 'unknown',
          audioCodec: audio?.codec_name ?? null,
          bitrate: Number(data.format?.bit_rate ?? 0),
          sizeBytes: Number(data.format?.size ?? 0),
          // 'unknown' is ffprobe saying "no tag", the same as the key being absent.
          ...(video.color_space && video.color_space !== 'unknown' ? { colorSpace: video.color_space } : {})
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}
