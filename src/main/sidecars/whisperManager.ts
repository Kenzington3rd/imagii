import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile, readFile, rename, unlink, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { net } from 'electron'
import { extractAudioFromVideo } from '../audio/extract'
import { ffmpegPath } from '../ffmpeg/paths'
import { probeVideo } from '../ffmpeg/probe'
import { EVEN_PICTURE } from '../ffmpeg/filters'
import { cancelledOr, killAsCancelled } from '../ffmpeg/cancelMark'
import { CancelLatch, type LatchRun } from '../ffmpeg/cancelLatch'
import { discardPartialOutput } from '../ffmpeg/partialOutput'
import { BURN_IN_NO_PICTURE_MESSAGE, FFMPEG_EMPTY_OUTPUT, PictureFrames, wroteNoPicture } from '../ffmpeg/noPicture'
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
  ModelInstallProgress,
  TranscribeRequest,
  TranscribeResult,
  BurnInRequest,
  CaptionStyle
} from '../../shared/captions'
import {
  ASS_PLAY_RES_Y,
  DEFAULT_CAPTION_STYLE,
  TRANSCRIPTION_AUDIO,
  WHISPER_MODEL_FILENAME,
  WHISPER_MODEL_MAX_BYTES,
  WHISPER_MODEL_MIN_BYTES,
  WHISPER_MODEL_SHA256,
  WHISPER_MODEL_URL,
  burnInLengthSec,
  burnInPercent,
  captionPlayResY,
  isUsableFrame,
  escapeSubtitlesPath,
  shiftedSrtPath,
  shiftSrtToRange,
  tsToSeconds
} from '../../shared/captions'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { assertAlways } from '../../shared/assert'
import { CANCELLED_MESSAGE } from '../../shared/cancel'

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

// Concurrency guard for transcription — same pattern as installInProgress.
// Two rapid concurrent transcribes would each spawn whisper.exe (heavy
// CPU contention) AND would each extract a separate WAV from the source.
// The earlier-finishing run's SRT result gets overwritten in renderer
// state when the second finishes; the first SRT becomes an orphan in
// captionsOutputDir.
let transcribeInProgress = false

// M3 fix (round 15): register transcribe + burn-in children so the renderer's
// cancel path AND the app-level before-quit can SIGKILL them. Mirrors
// ffmpeg/export.ts activeJobs pattern.
const activeTranscribe = new Map<string, ChildProcess>()
const activeBurnIn = new Map<string, ChildProcess>()
// T-98: the Cancel button appears with the first progress event, a few awaits
// (the SRT read, the shifted copy's write) before the child exists.
const burnLatch = new CancelLatch()
// T-108: the same for transcription. Its first child is the audio extraction (a
// long source takes a while) and the engine only starts after it, so most of a
// transcription is spent before the engine exists; a Cancel in that wait must
// still stop the job. `activeTranscribe` holds whichever of the two is running.
const transcribeLatch = new CancelLatch()

export function cancelTranscribe(jobId?: string): boolean {
  if (jobId) {
    const marked = transcribeLatch.cancel(jobId)
    const child = activeTranscribe.get(jobId)
    if (!child) return marked
    killAsCancelled(child)
    activeTranscribe.delete(jobId)
    return true
  }
  let any = transcribeLatch.cancelAll()
  for (const [, child] of activeTranscribe) {
    killAsCancelled(child)
    any = true
  }
  activeTranscribe.clear()
  return any
}

export function cancelBurnIn(jobId?: string): boolean {
  if (jobId) {
    const marked = burnLatch.cancel(jobId)
    const child = activeBurnIn.get(jobId)
    if (!child) return marked
    killAsCancelled(child)
    activeBurnIn.delete(jobId)
    return true
  }
  let any = burnLatch.cancelAll()
  for (const [, child] of activeBurnIn) {
    killAsCancelled(child)
    any = true
  }
  activeBurnIn.clear()
  return any
}

/** Test-only access to the concurrency flag. */
export const __whisperTranscribeTesting__ = {
  isTranscribeInProgress: (): boolean => transcribeInProgress,
  setTranscribeInProgressForTest: (value: boolean): void => {
    transcribeInProgress = value
  }
}

export async function runTranscribe(
  req: TranscribeRequest,
  onProgress: CaptionsProgressListener
): Promise<TranscribeResult> {
  // Synchronous claim before any await — JS single-threaded guarantee.
  // Lessons: see "claim flag must be set synchronously" entry in
  // docs/LESSONS_LEARNED.md (2026-05-09).
  if (transcribeInProgress) {
    throw new Error('A transcription is already running. Wait for it to finish, then try again.')
  }
  transcribeInProgress = true
  try {
    return await runTranscribeBody(req, onProgress)
  } finally {
    transcribeInProgress = false
  }
}

async function runTranscribeBody(
  req: TranscribeRequest,
  onProgress: CaptionsProgressListener
): Promise<TranscribeResult> {
  const status = getCaptionsStatus()
  if (!status.ready) throw new Error('Whisper not installed (see Captions setup)')
  const run = transcribeLatch.begin(req.jobId)
  try {
    return await transcribeUnderRun(req, onProgress, status, run)
  } finally {
    run.end()
  }
}

async function transcribeUnderRun(
  req: TranscribeRequest,
  onProgress: CaptionsProgressListener,
  status: CaptionsInstallStatus,
  run: LatchRun
): Promise<TranscribeResult> {
  const startedAt = Date.now()
  await run.guard(mkdir(captionsOutputDir(), { recursive: true }))

  // T-89: no `percent` on the phases whose length main cannot know. The
  // transcribe phase used to send `15 + Math.random() * 10` — a number that
  // jittered between 15 and 25 for as long as the engine ran — and extraction
  // and the SRT write a fixed 5 and 95 that measured nothing either. An absent
  // percent is the indeterminate bar in the panel; only `done` is a fact.
  onProgress({ jobId: req.jobId, phase: 'extracting' })
  // T-108: extraction is the first child, and it is registered so a Cancel kills it
  // (a long VOD takes a while). A Cancel that landed before the child existed
  // (the mkdir above) kills it the moment it does.
  const extraction = extractAudioFromVideo(
    req.sourcePath,
    (child) => {
      activeTranscribe.set(req.jobId, child)
      try {
        run.check()
      } catch {
        killAsCancelled(child)
        // T-111: this child arrives AFTER the Cancel ended the wait below, whose
        // `finally` already cleared the entry — so the line above has just put a
        // dead job's child back, where a later cancel would find it, report a
        // cancel of something that is not running, and the map would hold it.
        activeTranscribe.delete(req.jobId)
      }
    },
    TRANSCRIPTION_AUDIO
  )
  let extracted: Awaited<typeof extraction>
  try {
    extracted = await run.guard(extraction)
  } catch (err) {
    // The wait ended on a Cancel while the extraction may still be finishing: a WAV
    // that arrives after nobody wants it is removed (a killed one removes itself).
    void extraction.then((e) => e.cleanup(), () => undefined)
    throw err
  } finally {
    activeTranscribe.delete(req.jobId)
  }

  // Bug fix: try/finally ensures the temp WAV is deleted on every exit
  // path. Previously, a Whisper failure (non-zero exit, missing SRT,
  // throw) would leak the WAV file — for a long VOD that's 100+ MB
  // per failed run accumulating in %TEMP%.
  try {
    onProgress({ jobId: req.jobId, phase: 'transcribing' })

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
      run.check()
      const child = spawn(status.exePath, args, { windowsHide: true })
      activeTranscribe.set(req.jobId, child)
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      // Round 18: progress parsing is per-chunk — the old `stdout +=` here
      // accumulated the entire transcription output of a multi-hour VOD
      // without ever reading it back. Pure unbounded memory growth.
      child.stdout.on('data', (chunk: string) => {
        const m = chunk.match(/(\d+):(\d+):(\d+)[.,](\d+)/g)
        if (m && m.length > 0) {
          onProgress({
            jobId: req.jobId,
            phase: 'transcribing',
            message: m[m.length - 1]
          })
        }
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
        // Round 16's 16KB cap, applied to the transcribe path too (round 18).
        if (stderr.length > 16384) stderr = stderr.slice(-16384)
      })
      child.on('error', (err) => {
        activeTranscribe.delete(req.jobId)
        reject(cancelledOr(child, err))
      })
      child.on('close', (code) => {
        activeTranscribe.delete(req.jobId)
        if (code === 0) resolve()
        else reject(cancelledOr(child, new Error(`whisper exit ${code}: ${stderr.slice(-500)}`)))
      })
    })

    onProgress({ jobId: req.jobId, phase: 'building-srt' })
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
  } finally {
    // Cleanup never throws (extract.ts wraps in try/catch already).
    await extracted.cleanup()
  }
}

/**
 * Hex `#RRGGBB` → ASS `&HbbggrrAA&` (alpha bytes prepended; bytes are
 * little-endian BGR plus a 2-byte alpha at the front for 0=opaque).
 * libass uses 0=opaque so we always emit "00" in the alpha slot.
 */
function hexToAssColor(hex: string): string {
  // T-114: assertAlways, not assert() - this is the only check between a style a renderer
  // sent and `force_style='PrimaryColour=...'`, and assert() logs and continues under
  // NODE_ENV=production. (The IPC gate refuses first; this is the runner's own line.)
  assertAlways(/^#?[0-9a-fA-F]{6}$/.test(hex), `caption color must be #RRGGBB hex, got ${hex}`)
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)
  return `&H00${b}${g}${r}&`.toLowerCase().replace('&h', '&H')
}

function alignmentForPosition(position: CaptionStyle['position']): number {
  // libass INTERNAL alignment, not the numpad values an .ass style block
  // takes: force_style writes this number straight through, skipping the
  // numpad conversion the v4+ style parser applies. The representation is
  // HALIGN_LEFT/CENTRE/RIGHT = 1/2/3 OR-ed with VALIGN_SUB/TOP/CENTER =
  // 0/4/8, so centred is 2 | 0 = 2 (bottom), 2 | 4 = 6 (top), 2 | 8 = 10
  // (middle). Round 21 shipped the numpad values (8/5/2) here, which made
  // top render left+middle and middle render left+top. T-11.
  switch (position) {
    case 'top':
      return 6
    case 'middle':
      return 10
    case 'bottom':
      return 2
  }
}

/**
 * `frame` is the picture the burn is drawn on, when known (T-111). libass sizes a
 * `FontSize` by frame HEIGHT, so on a frame narrower than 16:9 the style also
 * carries a `PlayResY` (see `captionPlayResY`) that brings the text to the size it
 * has on a 16:9 frame of the same width, and a `MarginV` scaled with it so the
 * caption sits the same fraction of the way up the frame as before. On 16:9 and
 * wider, and when the frame is unknown, the string is exactly what it always was.
 */
function buildForceStyle(
  style: CaptionStyle,
  legacyFontSizePct: number,
  frame?: { width: number; height: number }
): string {
  // The legacy fontSizePct path scaled by 10 to get a pixel size; preserve
  // that semantics when a fresh style isn't provided so old callers still work.
  const fontSize =
    style.fontSize > 0
      ? Math.max(16, Math.min(96, Math.round(style.fontSize)))
      : Math.max(16, Math.round(legacyFontSizePct * 10))
  const primary = hexToAssColor(style.primaryColor)
  const outline = hexToAssColor(style.outlineColor)
  const alignment = alignmentForPosition(style.position)
  const baseMarginV = style.position === 'middle' ? 0 : 40
  // T-113: a probe can answer with a frame of 0, which `captionBasisPx` refuses; that is
  // "no frame known" (landscape), never a reason to refuse the burn.
  const playResY = isUsableFrame(frame) ? captionPlayResY(frame.width, frame.height) : null
  const marginV = playResY === null ? baseMarginV : Math.round((baseMarginV * playResY) / ASS_PLAY_RES_Y)
  return [
    `FontName=Arial`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${primary}`,
    `OutlineColour=${outline}`,
    `Outline=2`,
    `Shadow=0`,
    `Alignment=${alignment}`,
    `MarginV=${marginV}`,
    ...(playResY === null ? [] : [`PlayResY=${playResY}`])
  ].join(',')
}

export async function runBurnIn(
  req: BurnInRequest,
  onProgress: CaptionsProgressListener
): Promise<{ outputPath: string; captioned: boolean }> {
  // T-113: no number yet. The length of the output is not known until the video is probed
  // (below), and a determinate 0% sent first stood forever when the probe failed and the
  // length was unknowable — an honest bar is indeterminate until main can measure.
  onProgress({ jobId: req.jobId, phase: 'burning-in' })

  const style = req.style ?? DEFAULT_CAPTION_STYLE

  // Phase 3.1: when the renderer asks to burn over a trimmed range, use
  // -ss/-to on the input so the output covers only that span. Same trick
  // runReframe uses; the input stream is seekable so this is fast and
  // accurate to the keyframe.
  const range =
    req.startSec !== undefined && req.endSec !== undefined && req.endSec > req.startSec
      ? { startSec: req.startSec, endSec: req.endSec }
      : null

  // TWO TIMEBASES, ONE FILE (T-81 — the same bug class as T-74; see the
  // 2026-08-26 "TWO TIMEBASES, ONE FIELD" entry in docs/LESSONS_LEARNED.md).
  //
  // The SRT is on the SOURCE clock: Whisper timestamps the whole video, and
  // the Captions panel lists its cues that way. `-ss` BEFORE `-i` (input
  // seeking, below) resets the filter graph's clock instead, so the clip's
  // first frame reaches `subtitles=` at t=0. Handing that filter the whole
  // SRT captioned a clip cut from minute 40 with the stream's first minutes
  // (and with nothing at all once startSec outgrew the clip's own length).
  // The bug is invisible at startSec 0, where both clocks read the same
  // number, which is where every burn-in test was written.
  //
  // So the conversion happens here, at the one place that sees both clocks:
  // a ranged burn gets a sibling temp SRT rewritten onto the clip clock
  // (shifted by -startSec, clipped to the range; see shiftSrtToRange), and
  // `-ss`/`-to` stay before `-i`. The alternative — `-copyts` plus an
  // output-side seek — keeps the source clock but makes ffmpeg decode
  // everything from the top of the file to reach minute 40. Unlike T-74 the
  // stored field is not reinterpreted: the SRT on disk (and what Save .srt
  // exports) stays source-absolute.
  const run = burnLatch.begin(req.jobId)
  let tempSrt: string | null = null
  let spawnedAt: number | null = null
  // Whether the written file carries any caption — false is the cue-less
  // window below. The renderer says so instead of toasting "Captions burned in"
  // over a clip with none (T-89).
  let captioned = true
  try {
    // The SRT the `subtitles` stage reads; null = no subtitle stage.
    let burnSrt: string | null = range ? null : req.srtPath
    if (range) {
      const shifted = shiftSrtToRange(
        await readFile(req.srtPath, 'utf8'),
        range.startSec,
        range.endSec
      )
      // An empty result is a real answer — nobody speaks in this span — and
      // ffmpeg's `subtitles` cannot open a cue-less file ("Unable to open"),
      // so that window burns with no subtitle stage at all: the clip,
      // uncaptioned, exactly what a startSec-0 range with no cue in it has
      // always produced.
      if (shifted !== '') {
        tempSrt = shiftedSrtPath(req.srtPath, randomUUID())
        await writeFile(tempSrt, shifted, 'utf8')
        burnSrt = tempSrt
      } else {
        captioned = false
      }
    }

    // T-111: the picture the captions are drawn on (their size follows its shape)
    // and how long it runs (the bar). Both are enhancements, never a reason to
    // refuse a burn ffmpeg could do, so a probe that fails leaves the burn sized as
    // a landscape frame with an indeterminate bar. A Cancel ends the wait at once.
    // simplification: the probe reports the CODED size, so a phone clip stored
    // landscape and tagged "rotated" is sized as landscape; the rotation-aware probe
    // is T-110(h)'s.
    const probe = await run.guard(probeVideo(req.videoPath).catch(() => null))
    const forceStyle = buildForceStyle(
      style,
      req.fontSizePct,
      probe ? { width: probe.width, height: probe.height } : undefined
    )
    const lengthSec = burnInLengthSec(probe ? probe.duration : null, range)
    // The length is known, so the bar can be a real one: it starts at 0 — nothing is encoded
    // yet, which is true (T-111: it was 5, then `5 + 0.5 per second encoded`).
    if (lengthSec !== null) onProgress({ jobId: req.jobId, phase: 'burning-in', percent: 0 })

    // Round 18: full two-level escaping, unquoted. The old single-quoted form
    // broke on any SRT path containing an apostrophe (source filenames flow
    // into the SRT name untouched), killing the burn-in with a parse error.
    //
    // T-114: the chain always opens with the even-size stage - libx264 + yuv420p die at
    // exit 187 on an odd edge - and when there is no subtitle stage (a window with no cue
    // in it) the stage is the whole chain. The join is a comma at the filtergraph level;
    // the commas inside `force_style='...'` are quoted and never reach it.
    const filter =
      burnSrt === null
        ? EVEN_PICTURE
        : `${EVEN_PICTURE},subtitles=${escapeSubtitlesPath(burnSrt)}:force_style='${forceStyle}'`

    const args: string[] = ['-y']
    if (range) {
      args.push('-ss', range.startSec.toFixed(3), '-to', range.endSec.toFixed(3))
    }
    args.push(
      '-i',
      req.videoPath,
      '-vf',
      filter,
      // T-121: keep each frame at its own time, as the convert does (T-120). A Record WebM saved with Convert
      // to MP4 off is remuxed, and a remux cannot give a MediaRecorder file a frame rate: its container reads
      // 1000/1 (the clock ticks in milliseconds), and the mp4 muxer's default is a CONSTANT rate, so this
      // re-encode wrote one frame per millisecond (2987 frames for a 3 s take, "More than 1000 frames
      // duplicated", minutes for a long one). A source with a steady rate is unchanged.
      '-fps_mode',
      'vfr',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      // B6 fix (round 15): the user-facing burn-in MP4 also needs faststart so
      // web players can seek without buffering the moov atom from the tail.
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      req.outputPath
    )

    await new Promise<void>((resolve, reject) => {
      run.check()
      const child = spawn(ffmpegPath, args, { windowsHide: true })
      spawnedAt = Date.now()
      activeBurnIn.set(req.jobId, child)
      let stderr = ''
      let lastEmitted = lengthSec === null ? -1 : 0
      // T-133 (4): exit 0 does not say a picture was written (see ffmpeg/noPicture.ts). A range past the PICTURE exits 0 having written an
      // audio-only mp4 (stderr silent, the last progress block says frame=0) or a stream-less stub ("Output file is empty"); the burn-in
      // was the one ranged video writer that resolved on the exit code alone.
      const frames = new PictureFrames()
      let sawEmptyOutput = false
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        frames.feed(chunk)
        // `-progress`: a block of key=value lines every half second or so, the last
        // of which is `out_time=HH:MM:SS.ffffff` — the export runner's own signal.
        const marks = chunk.match(/out_time=(\d+:\d+:\d+[.,]\d+)/g)
        const last = marks?.[marks.length - 1]
        if (!last) return
        const percent = burnInPercent(tsToSeconds(last), lengthSec)
        if (percent !== undefined && percent - lastEmitted >= 0.5) {
          lastEmitted = percent
          onProgress({ jobId: req.jobId, phase: 'burning-in', percent })
        }
      })
      child.stderr.setEncoding('utf8')
      // B5 fix (round 16): bound the stderr accumulator at 16KB so an
      // hour-long burn-in at verbose ffmpeg log levels can't accumulate tens
      // of MB. Matches every other ffmpeg spawn in the codebase.
      child.stderr.on('data', (c: string) => {
        stderr += c
        sawEmptyOutput ||= FFMPEG_EMPTY_OUTPUT.test(stderr)
        if (stderr.length > 16384) stderr = stderr.slice(-16384)
      })
      child.on('error', (err) => {
        activeBurnIn.delete(req.jobId)
        reject(cancelledOr(child, err))
      })
      child.on('close', (code) => {
        activeBurnIn.delete(req.jobId)
        if (code === 0 && wroteNoPicture(sawEmptyOutput, frames)) reject(new Error(BURN_IN_NO_PICTURE_MESSAGE))
        else if (code === 0) resolve()
        else reject(cancelledOr(child, new Error(`burn-in exit ${code}: ${stderr.slice(-500)}`)))
      })
    }).catch(async (err: unknown) => {
      // T-100: a burn that stopped halfway is not the captioned video (T-133 (4): nor is an audio-only file or a stub).
      await discardPartialOutput(req.outputPath, spawnedAt)
      throw err
    })
  } finally {
    run.end()
    // Success, ffmpeg failure, or cancel (SIGKILL rejects the promise above):
    // the shifted copy is a means, never an output.
    if (tempSrt) await unlink(tempSrt).catch(() => {})
  }

  onProgress({ jobId: req.jobId, phase: 'done', percent: 100 })
  return { outputPath: req.outputPath, captioned }
}

export async function exportSrt(srtPath: string, destPath: string): Promise<void> {
  const content = await readFile(srtPath, 'utf8')
  await writeFile(destPath, content)
}

/**
 * Phase 4E: download the canonical Whisper model file (~141 MB) from
 * Hugging Face into userData/models/. Streams to a `.partial` temp file,
 * sanity-checks size, then atomically renames to the final path. Caller
 * receives progress events including byte counts so the UI can render
 * an accurate progress bar.
 *
 * Whisper executable install is *not* automated in this round — the
 * binary lives in github releases as a per-platform ZIP and requires
 * extraction logic. Only the model file is automated here, since it's
 * the larger of the two friction points (141 MB download vs. ~5 MB exe).
 *
 * Network errors / wrong-size responses cause the partial file to be
 * deleted and an error returned to the caller. Never overwrites an
 * existing valid model file silently.
 */
export type ModelInstallProgressListener = (p: ModelInstallProgress) => void

/**
 * Tech-debt fix: cancellation. We track the active request handle so the
 * renderer can call cancelWhisperModelInstall() to abort an in-flight
 * download mid-stream. Canceling deletes the .partial file so the next
 * install attempt starts clean.
 *
 * Bug-fix (regression audit 2026-05-09): there are async pauses between
 * function entry and `activeInstall = me`. Two concurrent installs could
 * both pass the "is null?" check before either claimed the slot, then
 * race writes to the same .partial path. Added a synchronous
 * `installInProgress` flag claimed at function entry — JS is single-
 * threaded so a flag set before any await is atomic. The flag is the
 * concurrency gate; activeInstall remains the cancel handle.
 */
interface ActiveInstall {
  request: ReturnType<typeof net.request>
  partialPath: string
  cancelled: boolean
}
let activeInstall: ActiveInstall | null = null
let installInProgress = false

export function cancelWhisperModelInstall(): boolean {
  if (!activeInstall) return false
  activeInstall.cancelled = true
  try {
    activeInstall.request.abort()
  } catch {
    /* already done */
  }
  return true
}

/** Test-only helpers for the concurrency guard. */
export const __whisperInstallTesting__ = {
  isInstallInProgress: (): boolean => installInProgress,
  setInstallInProgressForTest: (value: boolean): void => {
    installInProgress = value
  }
}

export async function installWhisperModel(
  onProgress: ModelInstallProgressListener
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  // Concurrency gate (claim synchronously, BEFORE any await). Two rapid
  // calls would otherwise both pass an `activeInstall === null` check and
  // race writes to the same .partial path.
  if (installInProgress) {
    return { ok: false, reason: 'A model download is already running. Wait for it to finish, then try again.' }
  }
  installInProgress = true

  try {
    return await runInstall(onProgress)
  } finally {
    installInProgress = false
  }
}

async function runInstall(
  onProgress: ModelInstallProgressListener
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const finalPath = path.join(modelsDir(), WHISPER_MODEL_FILENAME)
  const partialPath = `${finalPath}.partial`

  // Refuse to clobber an existing valid model file.
  if (existsSync(finalPath)) {
    try {
      const s = await stat(finalPath)
      if (s.size >= WHISPER_MODEL_MIN_BYTES && s.size <= WHISPER_MODEL_MAX_BYTES) {
        onProgress({ phase: 'done', percent: 100, message: 'Model already installed' })
        return { ok: true, path: finalPath }
      }
    } catch {
      // fall through to download
    }
  }

  await mkdir(modelsDir(), { recursive: true })
  // Clean up any prior interrupted download.
  if (existsSync(partialPath)) {
    try {
      await unlink(partialPath)
    } catch {
      /* ignore */
    }
  }

  onProgress({ phase: 'starting', percent: 0, message: 'Connecting to Hugging Face…' })

  return new Promise((resolve) => {
    const request = net.request(WHISPER_MODEL_URL)
    const me: ActiveInstall = { request, partialPath, cancelled: false }
    activeInstall = me
    // Bug fix: with three event sources (response, request, abort) any
    // of which can fire — sometimes overlapping (a network failure
    // mid-stream triggers both response.on('error') and the outer
    // request.on('error')) — we need a settle-once guard. Without it,
    // resolve() could be called twice and the partial cleanup could
    // race against itself.
    let settled = false
    function settle(value: { ok: true; path: string } | { ok: false; reason: string }): void {
      if (settled) return
      settled = true
      if (activeInstall === me) activeInstall = null
      resolve(value)
    }
    async function cleanupPartial(): Promise<void> {
      try {
        if (existsSync(partialPath)) await unlink(partialPath)
      } catch {
        /* ignore */
      }
    }
    // Hoisted so the request-level 'error'/'abort' handlers can destroy the
    // write stream before cleanupPartial() unlinks partialPath. On Windows,
    // unlinking a file whose fd is still open throws EBUSY and the file leaks.
    let out: import('node:fs').WriteStream | null = null
    request.on('response', (response) => {
      const status = response.statusCode
      if (status < 200 || status >= 300) {
        onProgress({ phase: 'failed', message: `Server returned HTTP ${status}` })
        settle({ ok: false, reason: `HTTP ${status}` })
        return
      }
      const totalHeader = response.headers['content-length']
      const totalBytes =
        Array.isArray(totalHeader) && totalHeader[0]
          ? Number(totalHeader[0])
          : typeof totalHeader === 'string'
            ? Number(totalHeader)
            : 0
      let bytesDownloaded = 0
      // `out` (hoisted) lets the request-level error/abort handlers close the
      // stream; `stream` is the same instance as a non-null local for the
      // response.* closures below.
      const stream = createWriteStream(partialPath)
      out = stream
      // A write stream that emits 'error' (e.g. ENOSPC on a near-full
      // disk during the 141 MB download) throws an uncaught exception
      // with no listener — crashing the whole main process. Settle the
      // install cleanly instead.
      stream.on('error', (err: Error) => {
        stream.destroy()
        void cleanupPartial()
        onProgress({ phase: 'failed', message: err.message })
        settle({ ok: false, reason: err.message })
      })
      response.on('data', (chunk: Buffer) => {
        if (me.cancelled || settled) return
        bytesDownloaded += chunk.length
        stream.write(chunk)
        const percent =
          totalBytes > 0 ? Math.min(99, (bytesDownloaded / totalBytes) * 100) : 0
        onProgress({
          phase: 'downloading',
          bytesDownloaded,
          totalBytes,
          percent
        })
      })
      response.on('end', () => {
        stream.end()
        stream.on('finish', () => {
          if (settled) return
          if (me.cancelled) {
            void cleanupPartial().then(() => {
              onProgress({ phase: 'failed', message: 'Download canceled' })
              settle({ ok: false, reason: CANCELLED_MESSAGE })
            })
            return
          }
          void verifyAndFinalize(partialPath, finalPath, onProgress).then(settle)
        })
      })
      response.on('error', (err: Error) => {
        stream.destroy()
        void cleanupPartial()
        onProgress({ phase: 'failed', message: err.message })
        settle({ ok: false, reason: err.message })
      })
    })
    request.on('error', (err: Error) => {
      const reason = me.cancelled ? CANCELLED_MESSAGE : err.message
      out?.destroy()
      void cleanupPartial()
      onProgress({
        phase: 'failed',
        message: me.cancelled ? 'Download canceled' : err.message
      })
      settle({ ok: false, reason })
    })
    request.on('abort', () => {
      out?.destroy()
      void cleanupPartial().then(() => {
        onProgress({ phase: 'failed', message: 'Download canceled' })
        settle({ ok: false, reason: CANCELLED_MESSAGE })
      })
    })
    request.end()
  })
}

/**
 * INIT-C (round 15): compute the SHA-256 of a file on disk via a streamed
 * read so a ~141 MB model file doesn't have to materialize in memory.
 * Returns the hex digest or rejects on read error.
 */
async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function verifyAndFinalize(
  partialPath: string,
  finalPath: string,
  onProgress: ModelInstallProgressListener
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  onProgress({ phase: 'verifying', percent: 99, message: 'Verifying file size…' })
  let size = 0
  try {
    const s = await stat(partialPath)
    size = s.size
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'stat failed'
    }
  }
  if (size < WHISPER_MODEL_MIN_BYTES || size > WHISPER_MODEL_MAX_BYTES) {
    try {
      await unlink(partialPath)
    } catch {
      /* ignore */
    }
    const reason = `Downloaded file size ${size} is outside expected range [${WHISPER_MODEL_MIN_BYTES}, ${WHISPER_MODEL_MAX_BYTES}]`
    onProgress({ phase: 'failed', message: reason })
    return { ok: false, reason }
  }

  // INIT-C (round 15): SHA-256 the downloaded artifact and compare against
  // the pinned digest before promoting it to the final path. Defends
  // against a compromised mirror or undetected network corruption.
  onProgress({ phase: 'verifying', percent: 99, message: 'Verifying SHA-256…' })
  let digest: string
  try {
    digest = await sha256OfFile(partialPath)
  } catch (err) {
    try {
      await unlink(partialPath)
    } catch {
      /* ignore */
    }
    const reason = err instanceof Error ? err.message : 'sha256 read failed'
    onProgress({ phase: 'failed', message: reason })
    return { ok: false, reason }
  }
  if (digest.toLowerCase() !== WHISPER_MODEL_SHA256.toLowerCase()) {
    try {
      await unlink(partialPath)
    } catch {
      /* ignore */
    }
    const reason = `SHA-256 mismatch: expected ${WHISPER_MODEL_SHA256} got ${digest}`
    onProgress({ phase: 'failed', message: 'Model SHA-256 mismatch — refusing to install' })
    return { ok: false, reason }
  }

  try {
    await rename(partialPath, finalPath)
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'rename failed'
    }
  }
  onProgress({
    phase: 'done',
    percent: 100,
    bytesDownloaded: size,
    totalBytes: size,
    message: 'Model installed'
  })
  return { ok: true, path: finalPath }
}

// Test-only export of internal helpers; prefer this over a separate file
// since the helpers are tightly tied to the burn-in implementation.
export const __testing__ = { hexToAssColor, alignmentForPosition, buildForceStyle }
