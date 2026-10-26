import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { ffprobePath } from '../ffmpeg/paths'
import { NO_AUDIO_STREAM_MESSAGE, NoUsableDurationError, type AudioProbe } from '../../shared/audio'

interface FfprobeStream {
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  codec_name?: string
  sample_rate?: string
  channels?: number
  bit_rate?: string
  /** `attached_pic` is 1 for cover art, which ffprobe reports as a video stream. */
  disposition?: { attached_pic?: number }
}

interface FfprobeFormat {
  duration?: string
  bit_rate?: string
  format_name?: string
  size?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

export async function probeAudio(filePath: string): Promise<AudioProbe> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]
  const data = await new Promise<FfprobeOutput>((resolve, reject) => {
    const p = spawn(ffprobePath, args, { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => (out += String(b)))
    p.stderr.on('data', (b) => (err += String(b)))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit ${code}: ${err.trim()}`))
        return
      }
      try {
        resolve(JSON.parse(out) as FfprobeOutput)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })

  const audio = data.streams?.find((s) => s.codec_type === 'audio')
  if (!audio) throw new Error(NO_AUDIO_STREAM_MESSAGE)

  // Bug-fix (audit round 7): a malformed or partial ffprobe response can
  // produce an audio stream object with no `duration` field in `format`.
  // The prior code silently coerced this to `0`, which produced confusing
  // 0:00 → 0:00 clip ranges downstream instead of a clean error message.
  // Refuse the probe if duration is missing or non-positive — the user
  // will see a clearer "failed to probe" toast.
  //
  // T-126 (7): a picture is a video stream that is not cover art. T-127 (10): read BEFORE the duration is judged, because the
  // streams were read either way, and a refusal for the missing length used to throw that answer away (a durationless audio-only
  // WebM was then classified by its extension).
  const hasVideo = (data.streams ?? []).some((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const duration = Number(data.format?.duration ?? 0)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new NoUsableDurationError(hasVideo)
  }

  let sizeBytes = Number(data.format?.size ?? 0)
  if (!sizeBytes) {
    try {
      const s = await stat(filePath)
      sizeBytes = s.size
    } catch {
      sizeBytes = 0
    }
  }

  return {
    duration,
    hasVideo,
    sampleRate: Number(audio.sample_rate ?? 0),
    channels: audio.channels ?? 0,
    codec: audio.codec_name ?? 'unknown',
    bitrate: Number(data.format?.bit_rate ?? audio.bit_rate ?? 0),
    format: data.format?.format_name ?? 'unknown',
    sizeBytes
  }
}
