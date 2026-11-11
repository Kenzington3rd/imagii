import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, unlink } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { ffmpegPath, ffprobePath } from './paths'
import { EVEN_PICTURE } from './filters'
import { CancelLatch, type LatchRun } from './cancelLatch'
import { CancelledError } from '../../shared/cancel'
import { burnInPercent } from '../../shared/captions'
import { fitFileName } from '../../shared/filename'

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
  /**
   * T-128 (5): true when the app is QUITTING (`cancelAllConverts`, the before-quit sweep), false when a person pressed Discard. The two
   * end the same child the same way, and a save's cleanup has to tell them apart: a discard throws the take away (that is what the person
   * asked), a quit must not - the raw take is the only copy, and the person asked to close a window, not to lose a recording.
   */
  constructor(readonly byQuit = false) {
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
 *
 * T-137 (2): and a recording's owner is its TAKE (`recordingOwner(takeId)`), not "recording". One owner for every take meant a Discard
 * pressed on a second take cancelled the FIRST take's save too (`cancelConverts('recording')` swept every recording-owner convert), and the first
 * take's save, seeing a cancel that was not the quit's, threw its raw webm away - the only copy of a recording the person never discarded. The
 * type has no owner-wide recording cancel: a Discard names the take it is for, and only that take's convert is aimed at.
 */
export type ConvertOwner = 'import' | `recording:${string}`

/** The owner of one take's save: the main-process session id the renderer holds for it (`recording:begin`'s answer). */
export function recordingOwner(takeId: string): ConvertOwner {
  return `recording:${takeId}`
}

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
  /** Set with `cancelled`: the kill was the quit sweep's (T-128 (5)). */
  byQuit: boolean
}

const activeConverts = new Set<ActiveConvert>()

/**
 * T-128 (5), T-127 (3)'s "not covered": a convert is a RUN, like every other runner (`cancelLatch.ts`), for as long as it and the cleanup
 * of what it was writing take. `before-quit` kills the child and then waits (bounded) for every run to END; a convert was invisible to that
 * wait, so a quit in the middle of the recording's save left its half-written mp4 at the name the person chose in the Save dialog (and the
 * raw take beside it), and one in the middle of an import left its transcode in %TEMP%. The caller that owns the cleanup opens the run
 * (`beginConvertRun` for the recording's save, `convertForImport` for itself) and ends it AFTER that cleanup; the cancel functions below mark
 * the runs they are aimed at, by owner. The child registry above still does the killing.
 */
// T-141 (5): the latch throws the convert's own sentinel, told whether the sweep alone cancelled the run. A cancel that lands after the child has exited (the swap
// asks the run, T-140 (1)) has no child to reject with `ConvertCancelledError(byQuit)`, and the plain sentinel it threw instead did not say who asked.
const convertLatch = new CancelLatch((byAll) => new ConvertCancelledError(byAll))

/** A run for the recording's save (`promoteTempWebm`): from the chosen output name until the temp take is removed. */
export function beginConvertRun(owner: ConvertOwner): LatchRun {
  return convertLatch.begin(owner)
}

/**
 * T-154 (8): the size every frame of the output is held to. A MediaRecorder screen take whose window is resized mid-take changes the picture's
 * size; ffmpeg re-initialises its graph at the change and scales every later frame to the FIRST size with no aspect handling, so a 1280x720
 * take that became 1000x1000 converted (exit 0) to 1280x720 with the square half stretched. `width`/`height` are the first video stream's own,
 * rounded down to even (libx264 + yuv420p refuse an odd edge, T-114).
 *
 * `null` is "do not fit": the caller keeps the plain even crop it always had. That is the answer for anything this fit would CHANGE on a
 * constant-size file, because the importer shares the argv and its picture must stay what it was:
 *   - a rotated stream (a phone clip's display matrix): ffmpeg auto-rotates, so the frames are the probed size turned on its side and a fit to
 *     the coded size would letterbox every frame;
 *   - a non-square pixel aspect (an anamorphic file): `setsar=1` would rewrite the shape the file declares;
 *   - anything but exactly one video stream (a cover picture beside the video): ffmpeg picks the stream with the most pixels, not the first.
 * simplification: those three keep the old behaviour, so a mid-stream resize inside such a file is still stretched. A screen or webcam webm is
 * none of them; handle rotation (swap W and H) and the stream choice if an imported file ever needs it.
 */
export interface HeldSize {
  width: number
  height: number
}

interface ProbedVideoStream {
  width?: unknown
  height?: unknown
  sample_aspect_ratio?: unknown
  tags?: { rotate?: unknown }
  side_data_list?: Array<{ rotation?: unknown }>
}

export function heldSizeOf(probed: unknown): HeldSize | null {
  const streams = (probed as { streams?: ProbedVideoStream[] } | null)?.streams
  if (!Array.isArray(streams) || streams.length !== 1) return null
  const v = streams[0]!
  const evenDown = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.floor(n / 2) * 2 : 0)
  const width = evenDown(v.width)
  const height = evenDown(v.height)
  if (width < 2 || height < 2) return null
  const turned = (r: unknown): boolean => r !== undefined && r !== null && Number(r) % 360 !== 0
  if (turned(v.tags?.rotate) || (v.side_data_list ?? []).some((d) => turned(d.rotation))) return null
  const sar = typeof v.sample_aspect_ratio === 'string' ? v.sample_aspect_ratio : '1:1'
  if (!['1:1', '0:1', 'N/A'].includes(sar)) return null
  return { width, height }
}

/**
 * The `-vf` chain of the convert. Without a held size it is the even crop alone (EVEN_PICTURE). With one, every frame is cropped even, then fit
 * INSIDE W x H with its aspect kept (`force_divisible_by` keeps the fitted size even), centred on black, at a square pixel: a frame already
 * W x H passes through scale and pad untouched, so a constant-size file is the picture it always was.
 */
export function convertFilter(held: HeldSize | null): string {
  if (!held) return EVEN_PICTURE
  const { width: w, height: h } = held
  return (
    `${EVEN_PICTURE},scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  )
}

/**
 * The size to hold the convert's frames to, from a probe of the input's first video stream (ffprobe's stream width/height is the first frame's
 * size for a MediaRecorder webm). The probe is a child of the convert like the encode is - registered under `owner`, so Discard and the quit
 * sweep reach it and the same sentinel comes back. A probe that fails for any other reason answers `null`: a convert must not newly fail
 * because a size could not be read.
 */
function probeHeldSize(owner: ConvertOwner, inputPath: string): Promise<HeldSize | null> {
  return new Promise<HeldSize | null>((resolve, reject) => {
    const child = spawn(
      ffprobePath,
      [
        '-v', 'error',
        '-select_streams', 'v',
        // `stream_side_data_list` is the section name every ffprobe knows (the bundled build is a 4.0 one, which rejects `stream_side_data`
        // and prints the whole display matrix; the `rotation` key is in it on that build and on 6 and 7).
        '-show_entries', 'stream=width,height,sample_aspect_ratio:stream_tags=rotate:stream_side_data_list',
        '-of', 'json',
        inputPath
      ],
      { windowsHide: true }
    )
    const active: ActiveConvert = { child, owner, cancelled: false, byQuit: false }
    activeConverts.add(active)
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c: string) => {
      if (stdout.length < 65536) stdout += c
    })
    child.stderr.on('data', () => undefined)
    const settle = (held: HeldSize | null): void => {
      activeConverts.delete(active)
      if (active.cancelled) reject(new ConvertCancelledError(active.byQuit))
      else resolve(held)
    }
    child.on('error', () => settle(null))
    child.on('close', (code) => {
      if (code !== 0) return settle(null)
      try {
        settle(heldSizeOf(JSON.parse(stdout)))
      } catch {
        settle(null)
      }
    })
  })
}

/**
 * `durationSec` is the length of the output, when the caller knows it (the recording knows
 * how long it recorded; an importer's container has not been probed): ffmpeg's `out_time`
 * over it is the percent. Without it progress still ticks, with no percent.
 */
export async function convertToMp4(
  owner: ConvertOwner,
  inputPath: string,
  mp4Path: string,
  onProgress: (p: ConvertProgress) => void,
  durationSec?: number
): Promise<void> {
  const held = await probeHeldSize(owner, inputPath)
  return runConvertChild(
    owner,
    [
      '-y',
      '-i',
      inputPath,
      // T-114: libx264 + yuv420p refuse an odd edge (exit 187), and a screen recording's
      // VP8/VP9 webm is where one comes from. recording.ts unlinks the temp webm when this
      // convert fails, so an odd take was LOST here.
      // T-154 (8): and every frame is held to the take's first size (`convertFilter`), so a window
      // resized mid-take is letterboxed, not stretched.
      '-vf',
      convertFilter(held),
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
    const active: ActiveConvert = { child, owner, cancelled: false, byQuit: false }
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
      reject(active.cancelled ? new ConvertCancelledError(active.byQuit) : err)
    })
    child.on('close', (code, signal) => {
      activeConverts.delete(active)
      // A cancel we asked for wins over whatever exit code the kill
      // produced — SIGKILL mid-encode looks exactly like a crash otherwise.
      if (active.cancelled) reject(new ConvertCancelledError(active.byQuit))
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
  const run = convertLatch.begin('import')
  try {
    const dir = path.join(tmpdir(), 'imagii-import')
    await run.guard(mkdir(dir, { recursive: true }))
    const base = path.basename(inputPath, path.extname(inputPath))
    // T-183 (2): the source's name is the person's (a VOD title), and the copy adds 13 characters to it.
    const tail = `-${nanoid(8)}.mp4`
    const mp4Path = path.join(dir, `${fitFileName(base, tail)}${tail}`)
    try {
      await convertToMp4('import', inputPath, mp4Path, onProgress)
    } catch (err) {
      // T-128 (5): a transcode that stops (a quit, a crash, a source ffmpeg cannot read) leaves an mp4 with no moov atom at the working-copy
      // name. Nothing can play it and the next launch's sweep was the only thing that would ever remove it.
      await unlink(mp4Path).catch(() => undefined)
      throw err
    }
    return mp4Path
  } finally {
    run.end()
  }
}

function cancelWhere(match: (active: ActiveConvert) => boolean, byQuit = false): boolean {
  let killed = false
  for (const active of activeConverts) {
    if (!match(active)) continue
    // T-142: the entry STAYS until the child closes (its close/error handler deletes it), so a second cancel finds it and says who asked, as the
    // latch's `mark()` does (cancelLatch.ts): the quit's sweep alone makes a cancel the quit's, and a Discard before or after it takes that back -
    // the name wins in either order. This used to stamp `byQuit` and delete the entry, so a Discard that landed after the sweep found nothing and
    // the take it threw away was kept. Only the FIRST cancel kills and answers true: a second finds a child already on its way out.
    const first = !active.cancelled
    active.byQuit = first ? byQuit : active.byQuit && byQuit
    // Flag first, kill second: the close handler reads the flag, and a
    // SIGKILL mid-encode is indistinguishable from a crash without it.
    active.cancelled = true
    if (!first) continue
    try {
      active.child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    killed = true
  }
  return killed
}

/**
 * Abort the in-flight converts started by `owner`, and only those. Returns
 * true when there was something to cancel - a live child killed, or an open run marked. Used by the recorder's "Discard
 * recording" path, with that TAKE's owner (T-137 (2)). Each cancelled convert's
 * promise rejects with `ConvertCancelledError` rather than an exit-code error,
 * so callers can tell a deliberate discard from a real failure (T-44).
 */
export function cancelConverts(owner: ConvertOwner): boolean {
  // T-158 (2): the latch's answer counts. A save whose child has exited (the fallback copy after a failed remux, the swap's rename retries) is still an
  // OPEN run, now marked: it ends as the discard, so "there was something to cancel" is true and the renderer must keep saying "Discarding...".
  const marked = convertLatch.cancel(owner)
  return cancelWhere((active) => active.owner === owner) || marked
}

/**
 * Abort every in-flight convert whoever started it. This is the before-quit
 * contract — no child of ours outlives the app — and the only cancel that is
 * allowed to reach another owner's work.
 */
export function cancelAllConverts(): boolean {
  convertLatch.cancelAll()
  return cancelWhere(() => true, true)
}
