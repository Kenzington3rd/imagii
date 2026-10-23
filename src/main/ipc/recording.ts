import { ipcMain, desktopCapturer, dialog, BrowserWindow, app } from 'electron'
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises'
import { existsSync, createWriteStream, unlinkSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import {
  beginConvertRun,
  convertToMp4,
  remuxWebm,
  cancelConverts,
  ConvertCancelledError,
  ConvertFailedError
} from '../ffmpeg/convert'
import type { LatchRun } from '../ffmpeg/cancelLatch'
import type {
  RecordingFinalizeSpec,
  RecordingResult,
  RecordingSource
} from '../../shared/workspace'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertPlainObject
} from '../../shared/validators'
import { assertAlways } from '../../shared/assert'
import { SAFE_ID_RE } from '../../shared/pathSafety'
import { sendIfAlive } from '../sendIfAlive'

function recordingsDir(): string {
  return path.join(app.getPath('userData'), 'recordings')
}

// Round 18 H1: streaming save path. The renderer used to buffer every
// MediaRecorder chunk in memory, then ship ONE giant ArrayBuffer across
// `ipcRenderer.invoke` (structured clone = full copy) which main copied
// AGAIN into a Buffer before writing. A 45-minute stream recording is
// hundreds of MB to GBs — three simultaneous full copies risked OOM and a
// multi-second UI freeze. The streaming protocol appends each ~1 s chunk
// to a temp .webm as it arrives, so peak memory is one chunk, not the
// whole recording.
//
// Protocol: begin → { id } opens a write stream on a temp file under the
// same recordings dir the buffered path uses; appendChunk(id, bytes)
// appends in call order (the renderer serializes its sends, and a single
// WriteStream preserves write ordering anyway); finalize(id, spec) closes
// the stream then runs the SAME save-dialog + convert/copy logic as the
// buffered save it replaced (deleted, T-101); abandon(id) reaps the partial
// temp file.
interface RecordingStreamSession {
  tempPath: string
  stream: WriteStream
  bytesWritten: number
  /** First async stream error, surfaced on the next append/finalize. */
  error: Error | null
  /** Set when finalize/abandon starts — later appends must reject. */
  closed: boolean
}

const streamSessions = new Map<string, RecordingStreamSession>()

// One live recording per window is the app's model; a small cap keeps a
// buggy/compromised renderer from opening unbounded write streams.
const MAX_STREAM_SESSIONS = 4

// Begins that have passed the cap and not yet inserted their session (T-123 (6)). The cap was
// read, then `mkdir` and the stream's `open` were awaited, then the session was inserted: twelve
// concurrent calls all read the same size and all passed a cap four sequential calls enforce. A
// begin now takes its slot in the same synchronous step as the check and gives it back in a
// `finally`, which runs in the same step as the insert (or after the failure), so
// `streamSessions.size + beginsInFlight` is never short of what the handler has promised.
let beginsInFlight = 0

// How long abandon waits for the stream's fd to close before it unlinks anyway
// (T-119). A close that was already pending always lands in milliseconds; this
// only bounds a drive that has stopped answering.
// simplification: a fixed 2 s. A drive that takes longer to let go of the fd gets an
// unlink Windows refuses (the catch below swallows it), and the partial webm then stays
// in <userData>/recordings until the next launch's tempCleanup, which sweeps files older
// than 6 h. Upgrade: keep the close listener and unlink when it fires, however late.
const ABANDON_CLOSE_WAIT_MS = 2000

// Sanity ceiling per append. MediaRecorder timeslice chunks are a few MB
// at most; anything near this is a renderer bug, not a recording.
const MAX_CHUNK_BYTES = 64 * 1024 * 1024

function toBuffer(chunk: ArrayBuffer | ArrayBufferView): Buffer {
  return chunk instanceof ArrayBuffer
    ? Buffer.from(chunk)
    : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
}

/**
 * Round 18: before-quit sweep for the streaming path — destroy any open
 * write stream and unlink its partial temp file so a quit mid-recording
 * (or a renderer crash that orphaned a session) doesn't leave multi-GB
 * .webm partials accumulating under userData/recordings. Same contract
 * as the cancelAll* family in main/index.ts's before-quit hook.
 */
export function abandonAllRecordingStreams(): void {
  for (const [id, session] of streamSessions) {
    // T-128 (5): a CLOSED session is mid-finalize (the Save dialog, the convert), owned by a handler that is still running and reaps it
    // itself (`abandonOpenRecordingSessions` has said so since T-124). Its temp webm is the ONLY copy of the take: this sweep unlinked it
    // while the half-written mp4 stayed at the name the person chose, so a quit in the middle of a save lost the recording. What the
    // sweep owns is the take that was still being RECORDED - its partial webm is nobody's.
    if (session.closed) continue
    streamSessions.delete(id)
    try {
      session.closed = true
      session.stream.destroy()
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(session.tempPath)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Throws away one session: its stream is closed and its partial temp file removed. The body of
 * `recording:abandon`, and of `abandonOpenRecordingSessions` below.
 */
async function abandonSession(id: string): Promise<boolean> {
  const session = streamSessions.get(id)
  // Idempotent by design: the renderer calls abandon on every failure
  // path, including ones where finalize already reaped the session.
  if (!session) return false
  session.closed = true
  streamSessions.delete(id)
  // T-119: a WriteStream that failed a write has already auto-destroyed and
  // emitted its one 'close' — the renderer's own failure path (append
  // rejects, finalize throws, abandon runs) arrives after that, and waiting
  // for the event again never ends. So: wait only for a close that has not
  // happened yet, and never past ABANDON_CLOSE_WAIT_MS. The session is out
  // of `streamSessions` already, so nothing else would reap the file.
  const { stream } = session
  try {
    if (!stream.closed) {
      // destroy() discards buffered writes — this is the throw-away path,
      // and the file must be closed before unlink can succeed on Windows.
      await new Promise<void>((resolve) => {
        const bound = setTimeout(resolve, ABANDON_CLOSE_WAIT_MS)
        stream.once('close', () => {
          clearTimeout(bound)
          resolve()
        })
        stream.destroy()
      })
    }
  } finally {
    try {
      await unlink(session.tempPath)
    } catch {
      /* already gone */
    }
  }
  return true
}

/**
 * T-124 (3): abandon the sessions a renderer that died left open. The crash-recovery reload (T-123 (15)) brings the
 * window back to Home, and the dead page was the only caller of `appendChunk`, `finalize` and `abandon`: its
 * sessions kept their fds and their partial webm, and four crashes filled the cap, so the next `recording:begin`
 * was refused until the app was restarted. A session that is already `closed` is mid-finalize (the save dialog,
 * the convert), owned by a handler that is still running and will reap it itself, so it is left alone. Answers how
 * many it abandoned.
 */
export async function abandonOpenRecordingSessions(): Promise<number> {
  const open = [...streamSessions].filter(([, session]) => !session.closed).map(([id]) => id)
  await Promise.all(open.map((id) => abandonSession(id)))
  return open.length
}

/**
 * T-117: what the user is told when a take holds no data at all (Stop pressed before the first chunk
 * arrived, or a capture that produced nothing). It used to be "recording:finalize recording is empty",
 * which reached the toast as a channel name and a developer's phrase. A finished sentence, so
 * `userFacingError` shows it as written: what happened and what to do, no channel, no path.
 */
export const RECORDING_EMPTY_MESSAGE = 'Nothing was recorded, so there is nothing to save. Start the recording again.'

/**
 * T-59: what the user is told when the convert crashes. Everything ffmpeg
 * says about itself — the argv, the stderr tail, the words "convert-to-mp4"
 * — is main-process detail; what crosses the IPC is the studio's own
 * sentence, naming what failed, what happened to the take, and the one
 * setting that gets them a file anyway ("Convert to MP4 after recording" in
 * the Record panel). The exit code rides along because it is the one piece
 * of ffmpeg vocabulary worth a bug report.
 */
export function recordingConvertFailureMessage(err: unknown): string {
  const detail =
    err instanceof ConvertFailedError
      ? err.code !== null
        ? ` (ffmpeg exit code ${err.code})`
        : err.signal !== null
          ? ` (ffmpeg stopped on ${err.signal})`
          : ''
      : ''
  return (
    `Converting the recording to MP4 failed${detail}. Nothing was saved — ` +
    'try again, or uncheck "Convert to MP4 after recording" to keep the WebM.'
  )
}

/**
 * T-120: write the take to `outputPath` as a WebM that opens in Video Studio. MediaRecorder streams its
 * webm, so the file it wrote has no duration in its header and `probeVideo` refuses it (a take saved with
 * Convert off could only be reopened by re-exporting it as MP4 from some other program). A packet copy
 * into a fresh file (`remuxWebm`) writes the duration and the seek index; nothing is re-encoded.
 * The remux only repairs the header, so it is never a reason to lose the take: any failure except the
 * person's own Discard falls back to the plain copy this branch always made, and says so in the log.
 * ffprobe still reads the saved file's container rate as 1000/1 (the muxer writes it from the stream's
 * millisecond clock and no ffmpeg option changes that for a stream copy), which is why `probeVideo`
 * treats a rate above 240 as unknown.
 */
async function saveWebm(tempPath: string, outputPath: string): Promise<void> {
  try {
    await remuxWebm('recording', tempPath, outputPath)
  } catch (err) {
    if (err instanceof ConvertCancelledError) throw err
    console.error('[recording] remux failed, saving the take as recorded:', err)
    try {
      await unlink(outputPath)
    } catch {
      /* ffmpeg never created it */
    }
    await copyFile(tempPath, outputPath)
  }
}

/**
 * Given a fully-written temp .webm, show the save dialog, convert/copy to the
 * chosen location, and reap the temp file no matter which branch ran (the
 * round 15 M1 leak guard). It was the shared tail of two save paths until
 * T-101 deleted the buffered one; `recording:finalize` is the only caller now.
 */
async function promoteTempWebm(
  win: BrowserWindow,
  tempPath: string,
  spec: RecordingFinalizeSpec
): Promise<RecordingResult | null> {
  // The WebContents, taken while the window is certainly alive (the caller just asked for it): a
  // destroyed BrowserWindow throws on `.webContents` itself, the WebContents only answers
  // `isDestroyed()` (T-123 (1)).
  const sender = win.webContents
  // T-128 (5): the save is a run from the moment there is a name to write to until the temp take is gone, so `before-quit` (which kills the
  // convert and then waits for every run to end) waits for the reaping below. Opened AFTER the Save dialog: a dialog nobody has answered
  // is not work, and a quit with one open should not wait on it.
  let run: LatchRun | undefined
  // T-128 (5): true when the save ended because the APP is quitting - the raw take is then kept (see the catches below).
  let keepTake = false
  try {
    const baseName = spec.filename.replace(/\.(webm|mp4)$/i, '')
    const targetExt = spec.convertToMp4 ? 'mp4' : 'webm'

    // T-88: Cancel here throws the take away (the stream is already closed and
    // the temp file is reaped below) — the title says so, because "Save
    // recording" with a Cancel button reads as "not now", not "gone".
    const result = await dialog.showSaveDialog(win, {
      title: 'Save recording (Cancel discards it)',
      defaultPath: `${baseName}.${targetExt}`,
      filters: [
        spec.convertToMp4
          ? { name: 'MP4 video', extensions: ['mp4'] }
          : { name: 'WebM video', extensions: ['webm'] }
      ]
    })
    if (result.canceled || !result.filePath) {
      return null
    }

    const outputPath = result.filePath
    run = beginConvertRun('recording')
    if (spec.convertToMp4) {
      try {
        // T-115: the length of the take is what turns ffmpeg's position into a percent. The
        // recorder's own clock is the only length there is (a MediaRecorder webm has no duration
        // in its header); without one the bar is indeterminate rather than guessed.
        const takeSec =
          spec.durationMs !== undefined && spec.durationMs > 0 ? spec.durationMs / 1000 : undefined
        await convertToMp4(
          'recording',
          tempPath,
          outputPath,
          (info) => {
            sendIfAlive(sender, 'recording:progress', info)
          },
          takeSec
        )
      } catch (err) {
        // T-44: "Discard recording" kills the convert child, and the kill
        // used to travel up as a rejected IPC — the user asked to throw the
        // take away and got a SIGKILL crash report, plus a half-written
        // .mp4 left at the name they picked in the save dialog (ffmpeg
        // never reached the moov atom, so no player can open it). A
        // deliberate cancel reaps that output and returns the same "nothing
        // was saved" null the cancelled save dialog returns, which the
        // renderer already renders as the calm "Recording discarded."
        // Everything else is a real failure and still throws.
        //
        // T-59: and a crash is not a reason to keep the wreckage. ffmpeg
        // dies with the same half-written mp4 at the same chosen path
        // whether we asked it to stop or not — unplayable either way — so
        // the reaping is common to both branches. What differs is the
        // answer: a crash still fails, in a sentence the user can act on.
        // The raw exit code and stderr stay in the main-process log, where
        // a bug report can find them; the toast gets the plain-language
        // version (raw IPC text reaching the user is the T-30 disease).
        try {
          await unlink(outputPath)
        } catch {
          /* never created, or already gone */
        }
        if (err instanceof ConvertCancelledError) {
          // A Discard throws the take away; a quit does not (T-128 (5)): the half-written mp4 above is gone either way, but the webm in
          // userData is the only copy of what was recorded, and the person asked to close the window.
          keepTake = err.byQuit
          return null
        }
        console.error('[recording] convert failed:', err)
        throw new Error(recordingConvertFailureMessage(err))
      }
    } else {
      try {
        await saveWebm(tempPath, outputPath)
      } catch (err) {
        // The same discard the convert honors: "Discard recording" killed the remux, and the
        // half-written webm at the chosen name is not a take anyone can open.
        if (err instanceof ConvertCancelledError) {
          try {
            await unlink(outputPath)
          } catch {
            /* never created, or already gone */
          }
          keepTake = err.byQuit
          return null
        }
        throw err
      }
    }

    const sizeBytes = existsSync(outputPath) ? (await stat(outputPath)).size : 0

    return {
      outputPath,
      sizeBytes,
      format: spec.convertToMp4 ? 'mp4' : 'webm',
      durationMs: spec.durationMs ?? 0
    }
  } finally {
    // Cleanup is best-effort and idempotent. Ignore ENOENT since some
    // branches already removed the temp file (e.g. successful path).
    // A save the quit ended keeps the raw take (T-128 (5)); the launch sweep reaps it with the rest of recordings/ in time.
    if (!keepTake) {
      try {
        await unlink(tempPath)
      } catch {
        /* ignore */
      }
    }
    // The last thing the save does (T-128 (5)): after the half-written output (the catch above) and the temp take.
    if (run) run.end()
  }
}

// M6 fix (round 15) / round 20: the conversion child lives in
// ffmpeg/convert.ts now (generalized so imported flv/ts/wmv containers
// use the same transcode). T-60: cancellation is keyed on the owner that
// started the convert, so "Discard recording" reaches the recording's own
// child and never an import transcode. before-quit still takes them all
// (cancelAllConverts, wired in main/index.ts).

export type RecordingProgressListener = (info: {
  percent?: number
  message?: string
}) => void

/**
 * Abort the recording's in-flight conversion child if any. Returns true
 * when there was something to cancel. Scoped to the recording (T-60): an
 * import transcode running at the same time is not this button's business.
 */
export function cancelRecordingConvert(): boolean {
  return cancelConverts('recording')
}

export function registerRecordingIpc(): void {
  ipcMain.handle('recording:listSources', async (): Promise<RecordingSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      type: s.id.startsWith('screen') ? 'screen' : 'window'
    }))
  })

  // -------------------------------------------------------------------
  // Round 18 H1: streaming save protocol — see the comment block above
  // RecordingStreamSession for the why. T-101 deleted the buffered
  // `recording:save` it replaced: nothing in the renderer called it, and an
  // IPC that takes a whole recording as one ArrayBuffer is the memory cliff
  // the streaming protocol exists to avoid.
  // -------------------------------------------------------------------
  ipcMain.handle('recording:begin', async (): Promise<{ id: string }> => {
    assertAlways(
      streamSessions.size + beginsInFlight < MAX_STREAM_SESSIONS,
      'recording:begin too many open sessions'
    )
    beginsInFlight++
    try {
      await mkdir(recordingsDir(), { recursive: true })
      const id = nanoid(10)
      const tempPath = path.join(recordingsDir(), `${id}.webm`)
      const stream = createWriteStream(tempPath, { flags: 'w' })
      // Resolve only once the fd is actually open: begin succeeding means
      // the temp file exists and is writable, so open-time errors (EACCES,
      // full disk) surface here instead of at the first append.
      await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve())
        stream.once('error', (err) => {
          stream.destroy()
          reject(err)
        })
      })
      const session: RecordingStreamSession = {
        tempPath,
        stream,
        bytesWritten: 0,
        error: null,
        closed: false
      }
      // Without a listener, an async fs error ('error' event) would crash
      // the main process. Park it; the next append/finalize surfaces it.
      stream.on('error', (err) => {
        if (!session.error) session.error = err
      })
      streamSessions.set(id, session)
      return { id }
    } finally {
      beginsInFlight--
    }
  })

  ipcMain.handle(
    'recording:appendChunk',
    async (_e, id: string, chunk: ArrayBuffer): Promise<void> => {
      assertNonEmptyString(id, 'recording:appendChunk id')
      // Session ids are minted here with nanoid and echoed back by the renderer (round 17 B2), so anything outside the nanoid
      // alphabet - the one shared SAFE_ID_RE, as for video.ts's job ids (T-128 (6)) - is a forged or corrupt id.
      assertAlways(SAFE_ID_RE.test(id), 'recording:appendChunk id malformed')
      assertAlways(
        chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk),
        'recording:appendChunk chunk must be an ArrayBuffer or typed array'
      )
      const session = streamSessions.get(id)
      // Session state throws plainly with its own message: it is not a payload
      // check, and continuing here would write into a dead stream.
      if (!session) {
        throw new Error(
          'recording:appendChunk unknown session (already finalized or abandoned?)'
        )
      }
      if (session.closed) {
        throw new Error('recording:appendChunk after finalize/abandon')
      }
      if (session.error) throw session.error
      const buf = toBuffer(chunk)
      assertAlways(buf.byteLength > 0, 'recording:appendChunk chunk must not be empty')
      assertAlways(buf.byteLength <= MAX_CHUNK_BYTES, 'recording:appendChunk chunk too large')
      await new Promise<void>((resolve, reject) => {
        session.stream.write(buf, (err) => (err ? reject(err) : resolve()))
      })
      session.bytesWritten += buf.byteLength
    }
  )

  ipcMain.handle(
    'recording:finalize',
    async (_e, id: string, spec: RecordingFinalizeSpec): Promise<RecordingResult | null> => {
      assertNonEmptyString(id, 'recording:finalize id')
      assertAlways(SAFE_ID_RE.test(id), 'recording:finalize id malformed')
      assertPlainObject(spec, 'recording:finalize spec')
      assertNonEmptyString(spec.filename, 'spec.filename')
      assertAlways(typeof spec.convertToMp4 === 'boolean', 'spec.convertToMp4 must be a boolean')
      if (spec.durationMs !== undefined) {
        assertFiniteNonNeg(spec.durationMs, 'spec.durationMs')
      }
      const session = streamSessions.get(id)
      if (!session) {
        throw new Error('recording:finalize unknown session')
      }
      if (session.closed) {
        throw new Error('recording:finalize called twice')
      }
      // Gate further appends immediately — a straggler arriving while the
      // save dialog is up must reject, not corrupt the file.
      session.closed = true
      // promoteTempWebm reaps (or, on a quit, deliberately keeps) the temp take itself; the finally below is for the paths that never reach it.
      let reachedSave = false
      try {
        await new Promise<void>((resolve, reject) => {
          session.stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
        })
        if (session.error) throw session.error
        if (session.bytesWritten === 0) {
          throw new Error(RECORDING_EMPTY_MESSAGE)
        }
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        if (!win) return null
        reachedSave = true
        return await promoteTempWebm(win, session.tempPath, spec)
      } finally {
        streamSessions.delete(id)
        // promoteTempWebm reaps the temp on the paths that reach it; this
        // covers the ones that don't (empty recording, no window, stream
        // error). T-128 (5): and only those - a second unlink after a save the
        // quit ended would take the one copy of the take that save kept.
        if (!reachedSave) {
          try {
            await unlink(session.tempPath)
          } catch {
            /* ignore */
          }
        }
      }
    }
  )

  ipcMain.handle('recording:abandon', async (_e, id: string): Promise<boolean> => {
    assertNonEmptyString(id, 'recording:abandon id')
    assertAlways(SAFE_ID_RE.test(id), 'recording:abandon id malformed')
    return abandonSession(id)
  })

  // M6 fix (round 15): renderer-callable cancel for the save phase.
  ipcMain.handle('recording:cancelSave', async (): Promise<boolean> => {
    return cancelRecordingConvert()
  })
}
