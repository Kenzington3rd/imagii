import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { ffprobePath } from '../ffmpeg/paths'
import type { AudioProbe } from '../../shared/audio'

interface FfprobeStream {
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  codec_name?: string
  sample_rate?: string
  channels?: number
  bit_rate?: string
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
    const p = spawn(ffprobePath, args)
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
  if (!audio) throw new Error('No audio stream found in file')

  // Bug-fix (audit round 7): a malformed or partial ffprobe response can
  // produce an audio stream object with no `duration` field in `format`.
  // The prior code silently coerced this to `0`, which produced confusing
  // 0:00 → 0:00 clip ranges downstream instead of a clean error message.
  // Refuse the probe if duration is missing or non-positive — the user
  // will see a clearer "failed to probe" toast.
  const duration = Number(data.format?.duration ?? 0)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('ffprobe returned no usable duration for the audio stream')
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
    sampleRate: Number(audio.sample_rate ?? 0),
    channels: audio.channels ?? 0,
    codec: audio.codec_name ?? 'unknown',
    bitrate: Number(data.format?.bit_rate ?? audio.bit_rate ?? 0),
    format: data.format?.format_name ?? 'unknown',
    sizeBytes
  }
}
