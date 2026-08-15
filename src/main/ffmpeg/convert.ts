import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { ffmpegPath } from './paths'

/**
 * Transcode any ffmpeg-readable container to a preview-safe mp4
 * (h264 + aac, faststart). Generalized (round 20) from the recording
 * flow's webm->mp4 converter so imported stream-dump containers
 * (flv/ts/m2ts/wmv/mpg/3gp — see shared/mediaFormats.ts) get the same
 * treatment: Chromium's <video> element can't play them, ffmpeg can.
 *
 * simplification: always a full transcode. Sources that are already
 * h264/aac (some flv/ts) could be remuxed with -c copy in seconds; add
 * that fast path with a codec probe when big-VOD conversion time
 * becomes a real complaint.
 */

export interface ConvertProgress {
  percent: number
}

/**
 * Rejection reason for a convert that `cancelActiveConvert` killed — the
 * user pressing "Discard recording", or the before-quit sweep. T-44: a
 * SIGKILL we asked for is not a crash, and the difference has to be made
 * here, at the point of origin. Callers string-matching ffmpeg's exit
 * message would be guessing; this is the fact.
 */
export class ConvertCancelledError extends Error {
  constructor() {
    super('convert cancelled')
    this.name = 'ConvertCancelledError'
  }
}

// Single in-flight registry, same M10 discipline as every other spawn
// site: before-quit and explicit cancel must be able to kill the child
// so no orphaned ffmpeg.exe survives the app. The `cancelled` flag rides
// along with the child so the close handler still sees it after the slot
// has been cleared.
interface ActiveConvert {
  child: ChildProcess
  cancelled: boolean
}

let activeConvert: ActiveConvert | null = null

export function convertToMp4(
  inputPath: string,
  mp4Path: string,
  onProgress: (p: ConvertProgress) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-y',
        '-i',
        inputPath,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        '-nostats',
        mp4Path
      ],
      { windowsHide: true }
    )
    const active: ActiveConvert = { child, cancelled: false }
    activeConvert = active
    let stderr = ''
    let durationSec = 0
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const [k, v] = line.split('=')
        if (k === 'out_time' && v) {
          const m = v.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
          if (m) {
            const elapsed = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
            // No prior probe of duration — emit a coarse 1% per second so the
            // UI knows something is happening. The renderer caps the bar.
            durationSec = elapsed
            onProgress({ percent: Math.min(99, durationSec * 2) })
          }
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    child.on('error', (err) => {
      activeConvert = null
      reject(active.cancelled ? new ConvertCancelledError() : err)
    })
    child.on('close', (code, signal) => {
      activeConvert = null
      // A cancel we asked for wins over whatever exit code the kill
      // produced — SIGKILL mid-encode looks exactly like a crash otherwise.
      if (active.cancelled) reject(new ConvertCancelledError())
      else if (code === 0) resolve()
      else
        reject(
          new Error(
            `convert-to-mp4 exit ${code ?? `signal ${signal ?? 'unknown'}`}: ${stderr.slice(-500)}`
          )
        )
    })
  })
}

/**
 * Produce a working-copy mp4 for an imported non-native container.
 * Output lands in the imagii-import tempdir (pruned by tempCleanup on
 * startup alongside the other imagii temp families).
 */
export async function convertForImport(
  inputPath: string,
  onProgress: (p: ConvertProgress) => void = () => {}
): Promise<string> {
  const dir = path.join(tmpdir(), 'imagii-import')
  await mkdir(dir, { recursive: true })
  const base = path.basename(inputPath, path.extname(inputPath))
  const mp4Path = path.join(dir, `${base}-${nanoid(8)}.mp4`)
  await convertToMp4(inputPath, mp4Path, onProgress)
  return mp4Path
}

/**
 * Abort the in-flight conversion child if any. Returns true when there
 * was something to cancel. Used by the recorder's "Discard recording"
 * path and app-level before-quit cleanup. The convert's promise then
 * rejects with `ConvertCancelledError` rather than an exit-code error, so
 * callers can tell a deliberate discard from a real failure (T-44).
 */
export function cancelActiveConvert(): boolean {
  const active = activeConvert
  if (!active) return false
  active.cancelled = true
  try {
    active.child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
  activeConvert = null
  return true
}
