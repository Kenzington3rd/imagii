import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { ffmpegPath } from './paths'
import { EVEN_PICTURE } from './filters'
import { CancelledError } from '../../shared/cancel'
import { burnInPercent } from '../../shared/captions'

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
  /**
   * 0-99, and present only when the length of the output is known (T-115). Absent means
   * "working, no measurement": the renderer draws an indeterminate bar. A progress number
   * is a measurement or it is not there (STYLE_GUIDE).
   */
  percent?: number
}

/**
 * Rejection reason for a convert that `cancelConverts` / `cancelAllConverts`
 * killed — the user pressing "Discard recording", or the before-quit sweep.
 * T-44: a SIGKILL we asked for is not a crash, and the difference has to be
 * made here, at the point of origin. Callers string-matching ffmpeg's exit
 * message would be guessing; this is the fact.
 */
export class ConvertCancelledError extends CancelledError {
  constructor() {
    super()
    // T-84: same sentinel message as every other cancellable runner
    // (shared/cancel.ts) — the class stays so recording.ts can tell a
    // discarded take from any other cancel by `instanceof`.
    this.name = 'ConvertCancelledError'
  }
}

/**
 * A convert nobody asked to stop that stopped anyway — ffmpeg exited
 * non-zero or died on a signal. The message keeps the exit code and the
 * stderr tail for the main-process log; `code` and `signal` are carried as
 * fields so the caller that has to tell the user what happened can say it
 * in their language without parsing ffmpeg's sentence back out of a string
 * (T-59, the same reason ConvertCancelledError exists at all).
 */
export class ConvertFailedError extends Error {
  constructor(
    readonly code: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderrTail: string
  ) {
    super(`convert-to-mp4 exit ${code ?? `signal ${signal ?? 'unknown'}`}: ${stderrTail}`)
    this.name = 'ConvertFailedError'
  }
}

/**
 * Who started a convert. Cancellation is scoped by owner (T-60): "Discard
 * recording" cancels the recording's convert and nothing else, so an import
 * transcode running in the same session finishes. Before T-60 there was one
 * global slot, so whichever child was in it got the SIGKILL — the user
 * discarding a take killed the flv they had just dropped on the importer,
 * and starting a second convert made the first one uncancellable (its
 * registration was overwritten, so before-quit could not reap it either).
 */
export type ConvertOwner = 'recording' | 'import'

// One entry per in-flight child, and the entry IS the job's handle: it
// carries the owner that cancellation is keyed on and the `cancelled` flag,
// which rides along with the child so the close handler still reads it after
// the entry has left the registry. Same M10 discipline as every other spawn
// site (before-quit must be able to kill every child so no orphaned
// ffmpeg.exe survives the app), now per-job like ffmpeg/concat.ts's map.
interface ActiveConvert {
  child: ChildProcess
  owner: ConvertOwner
  cancelled: boolean
}

const activeConverts = new Set<ActiveConvert>()

/**
 * `durationSec` is the length of the output, when the caller knows it (the recording knows
 * how long it recorded; an importer's container has not been probed): ffmpeg's `out_time`
 * over it is the percent. Without it progress still ticks, with no percent.
 */
export function convertToMp4(
  owner: ConvertOwner,
  inputPath: string,
  mp4Path: string,
  onProgress: (p: ConvertProgress) => void,
  durationSec?: number
): Promise<void> {
  return runConvertChild(
    owner,
    [
      '-y',
      '-i',
      inputPath,
      // T-114: libx264 + yuv420p refuse an odd edge (exit 187), and a screen recording's
      // VP8/VP9 webm is where one comes from. recording.ts unlinks the temp webm when this
      // convert fails, so an odd take was LOST here.
      '-vf',
      EVEN_PICTURE,
      // T-120: keep each frame at its own time. A MediaRecorder webm declares no frame rate (ffprobe
      // reads its container rate as 1000/1: its clock ticks in milliseconds) and the mp4 muxer's
      // default is a CONSTANT rate, so the convert wrote one frame per millisecond. QA measured a 9.6 s
      // take as 9575 frames at 1000 fps, 1m56s to write, and a file Video Studio stepped through 1 ms at
      // a time; with `vfr` it was 277 frames in 13 s. The suite's MediaRecorder-shaped fixture (3 s)
      // reads 2980 frames in 2.2 s without it and 90 in 0.19 s with it. A source that already has a
      // steady rate is unchanged: the importer shares this argv, and Layer 5 holds an flv, a wmv and
      // an mpg at 25 fps to exactly 50 frames in 2 s (the default wrote 51 for the flv and the wmv, and 50 for the mpg).
      '-fps_mode',
      'vfr',
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
    onProgress,
    durationSec
  )
}

/**
 * T-120: save a recording as WebM by copying its packets into a fresh file (no re-encode).
 * MediaRecorder streams its webm, so the header it wrote has no duration: ffprobe prints
 * `duration=N/A`, `probeVideo` refuses the file, and a take saved with Convert off could not be
 * opened in Video Studio. Rewriting the container (`-c copy`) fills the duration and the seek
 * index in. It is the same child the MP4 convert is: registered under `owner`, so "Discard
 * recording" and the before-quit sweep reach it, and a kill is the same sentinel.
 */
export function remuxWebm(owner: ConvertOwner, inputPath: string, webmPath: string): Promise<void> {
  return runConvertChild(owner, ['-y', '-i', inputPath, '-c', 'copy', webmPath], () => undefined)
}

function runConvertChild(
  owner: ConvertOwner,
  args: string[],
  onProgress: (p: ConvertProgress) => void,
  durationSec?: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    const active: ActiveConvert = { child, owner, cancelled: false }
    activeConverts.add(active)
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const [k, v] = line.split('=')
        if (k === 'out_time' && v) {
          const m = v.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
          if (m) {
            const elapsed = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
            // T-115: the encode position over the length of the output, 0-99 - the burn-in's
            // mapping (T-111), so the two bars cannot disagree about what a percent is. This was
            // `elapsed * 2` under a comment that said 1% per second: a 5-minute take sat at 99%
            // from 50 seconds in, beside an enabled Discard. No length, no percent.
            const percent = burnInPercent(elapsed, durationSec ?? null)
            onProgress(percent === undefined ? {} : { percent })
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
      activeConverts.delete(active)
      reject(active.cancelled ? new ConvertCancelledError() : err)
    })
    child.on('close', (code, signal) => {
      activeConverts.delete(active)
      // A cancel we asked for wins over whatever exit code the kill
      // produced — SIGKILL mid-encode looks exactly like a crash otherwise.
      if (active.cancelled) reject(new ConvertCancelledError())
      else if (code === 0) resolve()
      else reject(new ConvertFailedError(code, signal, stderr.slice(-500)))
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
  await convertToMp4('import', inputPath, mp4Path, onProgress)
  return mp4Path
}

function cancelWhere(match: (active: ActiveConvert) => boolean): boolean {
  let killed = false
  for (const active of activeConverts) {
    if (!match(active)) continue
    // Flag first, kill second: the close handler reads the flag, and a
    // SIGKILL mid-encode is indistinguishable from a crash without it.
    active.cancelled = true
    try {
      active.child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    activeConverts.delete(active)
    killed = true
  }
  return killed
}

/**
 * Abort the in-flight converts started by `owner`, and only those. Returns
 * true when there was something to cancel. Used by the recorder's "Discard
 * recording" path. Each cancelled convert's promise rejects with
 * `ConvertCancelledError` rather than an exit-code error, so callers can
 * tell a deliberate discard from a real failure (T-44).
 */
export function cancelConverts(owner: ConvertOwner): boolean {
  return cancelWhere((active) => active.owner === owner)
}

/**
 * Abort every in-flight convert whoever started it. This is the before-quit
 * contract — no child of ours outlives the app — and the only cancel that is
 * allowed to reach another owner's work.
 */
export function cancelAllConverts(): boolean {
  return cancelWhere(() => true)
}
