import { ipcMain, desktopCapturer, dialog, BrowserWindow, app } from 'electron'
import { writeFile, mkdir, unlink } from 'node:fs/promises'
import { existsSync, createWriteStream, unlinkSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import {
  convertToMp4,
  cancelConverts,
  ConvertCancelledError,
  ConvertFailedError
} from '../ffmpeg/convert'
import type {
  RecordingFinalizeSpec,
  RecordingResult,
  RecordingSource,
  RecordingSpec
} from '../../shared/workspace'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertPlainObject
} from '../../shared/validators'
import { assert } from '../../shared/assert'

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
// legacy `recording:save`; abandon(id) reaps the partial temp file.
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

// Same alphabet gate as video.ts SAFE_JOB_ID_RE (round 17 B2): session ids
// are minted here with nanoid and echoed back by the renderer, so anything
// outside the nanoid alphabet is a forged/corrupt id.
const SAFE_SESSION_ID_RE = /^[A-Za-z0-9_-]+$/

// One live recording per window is the app's model; a small cap keeps a
// buggy/compromised renderer from opening unbounded write streams.
const MAX_STREAM_SESSIONS = 4

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
  for (const [, session] of streamSessions) {
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
  streamSessions.clear()
}

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
    'try again, or untick "Convert to MP4 after recording" to keep the WebM.'
  )
}

/**
 * Shared tail of both save paths: given a fully-written temp .webm, show
 * the save dialog, convert/copy to the chosen location, and reap the temp
 * file no matter which branch ran. Extracted verbatim from the legacy
 * `recording:save` handler (round 15 M1 leak guard preserved) so the
 * streaming `recording:finalize` produces byte-identical behavior.
 */
async function promoteTempWebm(
  win: BrowserWindow,
  tempPath: string,
  spec: RecordingFinalizeSpec
): Promise<RecordingResult | null> {
  try {
    const baseName = spec.filename.replace(/\.(webm|mp4)$/i, '')
    const targetExt = spec.convertToMp4 ? 'mp4' : 'webm'

    const result = await dialog.showSaveDialog(win, {
      title: 'Save recording',
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
    if (spec.convertToMp4) {
      try {
        await convertToMp4('recording', tempPath, outputPath, (info) => {
          win.webContents.send('recording:progress', info)
        })
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
        if (err instanceof ConvertCancelledError) return null
        console.error('[recording] convert failed:', err)
        throw new Error(recordingConvertFailureMessage(err))
      }
    } else {
      const fs = await import('node:fs/promises')
      await fs.copyFile(tempPath, outputPath)
    }

    const sizeBytes = existsSync(outputPath)
      ? (await (await import('node:fs/promises')).stat(outputPath)).size
      : 0

    return {
      outputPath,
      sizeBytes,
      format: spec.convertToMp4 ? 'mp4' : 'webm',
      durationMs: spec.durationMs ?? 0
    }
  } finally {
    // Cleanup is best-effort and idempotent. Ignore ENOENT since some
    // branches already removed the temp file (e.g. successful path).
    try {
      await unlink(tempPath)
    } catch {
      /* ignore */
    }
  }
}

// M6 fix (round 15) / round 20: the conversion child lives in
// ffmpeg/convert.ts now (generalized so imported flv/ts/wmv containers
// use the same transcode). T-60: cancellation is keyed on the owner that
// started the convert, so "Discard recording" reaches the recording's own
// child and never an import transcode. before-quit still takes them all
// (cancelAllConverts, wired in main/index.ts).

export type RecordingProgressListener = (info: {
  percent: number
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

  ipcMain.handle(
    'recording:save',
    async (_e, spec: RecordingSpec): Promise<RecordingResult | null> => {
      assertPlainObject(spec, 'recording:save spec')
      assertNonEmptyString(spec.filename, 'spec.filename')
      assert(
        spec.webmBytes instanceof ArrayBuffer || ArrayBuffer.isView(spec.webmBytes),
        'spec.webmBytes must be an ArrayBuffer or typed array'
      )
      const byteLen =
        spec.webmBytes instanceof ArrayBuffer
          ? spec.webmBytes.byteLength
          : (spec.webmBytes as ArrayBufferView).byteLength
      assert(byteLen > 0, 'spec.webmBytes must not be empty')
      if (spec.durationMs !== undefined) {
        assertFiniteNonNeg(spec.durationMs, 'spec.durationMs')
      }
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null

      await mkdir(recordingsDir(), { recursive: true })
      const tempName = `${nanoid(10)}.webm`
      const tempPath = path.join(recordingsDir(), tempName)
      const webmBuffer = Buffer.from(spec.webmBytes)
      await writeFile(tempPath, webmBuffer)

      // M1 fix (round 15): promoteTempWebm wraps everything after the temp
      // write in try/finally so the WebM is always reaped, regardless of
      // which branch threw (dialog explosion, conversion failure, cancel).
      // Round 18 H1: body extracted into promoteTempWebm, shared with the
      // streaming recording:finalize path.
      return promoteTempWebm(win, tempPath, {
        filename: spec.filename,
        durationMs: spec.durationMs,
        convertToMp4: spec.convertToMp4
      })
    }
  )

  // -------------------------------------------------------------------
  // Round 18 H1: streaming save protocol — see the comment block above
  // RecordingStreamSession for the why. The legacy recording:save stays
  // registered for compatibility.
  // -------------------------------------------------------------------
  ipcMain.handle('recording:begin', async (): Promise<{ id: string }> => {
    assert(
      streamSessions.size < MAX_STREAM_SESSIONS,
      'recording:begin too many open sessions'
    )
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
  })

  ipcMain.handle(
    'recording:appendChunk',
    async (_e, id: string, chunk: ArrayBuffer): Promise<void> => {
      assertNonEmptyString(id, 'recording:appendChunk id')
      assert(SAFE_SESSION_ID_RE.test(id), 'recording:appendChunk id malformed')
      assert(
        chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk),
        'recording:appendChunk chunk must be an ArrayBuffer or typed array'
      )
      const session = streamSessions.get(id)
      // Plain throws (not assert) for session state: assert() only warns in
      // production, and continuing here would write into a dead stream.
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
      assert(buf.byteLength > 0, 'recording:appendChunk chunk must not be empty')
      assert(buf.byteLength <= MAX_CHUNK_BYTES, 'recording:appendChunk chunk too large')
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
      assert(SAFE_SESSION_ID_RE.test(id), 'recording:finalize id malformed')
      assertPlainObject(spec, 'recording:finalize spec')
      assertNonEmptyString(spec.filename, 'spec.filename')
      assert(typeof spec.convertToMp4 === 'boolean', 'spec.convertToMp4 must be a boolean')
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
      try {
        await new Promise<void>((resolve, reject) => {
          session.stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
        })
        if (session.error) throw session.error
        if (session.bytesWritten === 0) {
          throw new Error('recording:finalize recording is empty')
        }
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        if (!win) return null
        return await promoteTempWebm(win, session.tempPath, spec)
      } finally {
        streamSessions.delete(id)
        // promoteTempWebm reaps the temp on the paths that reach it; this
        // covers the ones that don't (empty recording, no window, stream
        // error). Second unlink no-ops with ENOENT.
        try {
          await unlink(session.tempPath)
        } catch {
          /* ignore */
        }
      }
    }
  )

  ipcMain.handle('recording:abandon', async (_e, id: string): Promise<boolean> => {
    assertNonEmptyString(id, 'recording:abandon id')
    assert(SAFE_SESSION_ID_RE.test(id), 'recording:abandon id malformed')
    const session = streamSessions.get(id)
    // Idempotent by design: the renderer calls abandon on every failure
    // path, including ones where finalize already reaped the session.
    if (!session) return false
    session.closed = true
    streamSessions.delete(id)
    // destroy() discards buffered writes — this is the throw-away path, and
    // the file must be closed before unlink can succeed on Windows.
    await new Promise<void>((resolve) => {
      session.stream.once('close', () => resolve())
      session.stream.destroy()
    })
    try {
      await unlink(session.tempPath)
    } catch {
      /* already gone */
    }
    return true
  })

  // M6 fix (round 15): renderer-callable cancel for the save phase.
  ipcMain.handle('recording:cancelSave', async (): Promise<boolean> => {
    return cancelRecordingConvert()
  })
}
