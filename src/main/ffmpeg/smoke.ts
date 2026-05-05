import { spawn } from 'node:child_process'
import { ffmpegPath, ffprobePath } from './paths'

export interface SmokeResult {
  ffmpegOk: boolean
  ffprobeOk: boolean
  ffmpegVersion?: string
  ffprobeVersion?: string
  error?: string
}

function runVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-version'])
    let out = ''
    p.stdout.on('data', (b) => (out += String(b)))
    p.stderr.on('data', (b) => (out += String(b)))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve(out.split('\n')[0] ?? '')
      else reject(new Error(`exit ${code}`))
    })
  })
}

export async function smokeTestFfmpeg(): Promise<SmokeResult> {
  try {
    const ffmpegVersion = await runVersion(ffmpegPath)
    const ffprobeVersion = await runVersion(ffprobePath)
    return { ffmpegOk: true, ffprobeOk: true, ffmpegVersion, ffprobeVersion }
  } catch (err) {
    return {
      ffmpegOk: false,
      ffprobeOk: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
