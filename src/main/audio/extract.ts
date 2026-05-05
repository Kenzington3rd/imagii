import { spawn } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { ffmpegPath } from '../ffmpeg/paths'

export interface ExtractedAudio {
  wavPath: string
  cleanup: () => Promise<void>
}

export async function extractAudioFromVideo(videoPath: string): Promise<ExtractedAudio> {
  const dir = path.join(tmpdir(), 'imagii-audio')
  await mkdir(dir, { recursive: true })
  const wavPath = path.join(dir, `${nanoid(10)}.wav`)

  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      ffmpegPath,
      [
        '-y',
        '-i',
        videoPath,
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        wavPath
      ],
      { windowsHide: true }
    )
    let stderr = ''
    p.stderr.on('data', (b) => (stderr += String(b)))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`audio extract exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  return {
    wavPath,
    cleanup: async () => {
      const fs = await import('node:fs/promises')
      try {
        await fs.unlink(wavPath)
      } catch {
        /* noop */
      }
    }
  }
}
