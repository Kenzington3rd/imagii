import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

// Round 17 phase-6: cover the recording cancel single-slot exported from
// ipc/recording.ts (round 15 M6).
//
// T-44 extends it to the branch the single slot exists FOR: what the save
// path does once the convert child has been killed. A deliberate discard and
// a crashed ffmpeg both arrive here as a rejected convert, and the two have
// to end differently — the discard reaps the half-written .mp4 at the user's
// chosen path and reports "nothing was saved" (null, which the renderer
// renders as the calm "Recording discarded."), while a real failure keeps its
// error text and travels up. Harness is recordingStream.test.ts's: mock the
// electron surface at import time, capture the handlers off the ipcMain.handle
// mock, and drive them directly.

let TMP = ''
const handlers = new Map<string, (...args: unknown[]) => unknown>()

const fakeWin = { webContents: { send: vi.fn() } }
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: true }

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showSaveDialog: async () => saveDialogResult },
  BrowserWindow: {
    getFocusedWindow: () => fakeWin,
    getAllWindows: () => [fakeWin]
  },
  app: { getPath: () => TMP }
}))

// Only the ffmpeg child is faked. `cancelConverts`, `ConvertCancelledError`
// and `ConvertFailedError` stay REAL, so the `instanceof` discrimination
// under test is the shipped one rather than a test double's shape.
type ConvertOutcome = 'ok' | 'cancelled' | 'crash'
let convertOutcome: ConvertOutcome = 'ok'

vi.mock('../ffmpeg/convert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ffmpeg/convert')>()
  return {
    ...actual,
    convertToMp4: async (
      _owner: string,
      _input: string,
      mp4Path: string
    ): Promise<void> => {
      // Every branch writes SOMETHING first: real ffmpeg has already put
      // bytes at the user's chosen path by the time it is killed, and that
      // stranded file is the point of the test.
      writeFileSync(mp4Path, convertOutcome === 'ok' ? 'full-mp4-bytes' : 'partial')
      if (convertOutcome === 'cancelled') throw new actual.ConvertCancelledError()
      if (convertOutcome === 'crash') {
        // The real rejection shape, so the friendly copy under test is built
        // from the same fields ffmpeg's close handler fills in.
        throw new actual.ConvertFailedError(1, null, 'Invalid data found when processing input')
      }
    }
  }
})

const { cancelRecordingConvert, registerRecordingIpc, recordingConvertFailureMessage } =
  await import('./recording')
const { ConvertFailedError } = await import('../ffmpeg/convert')
registerRecordingIpc()

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(handler({}, ...args)) as Promise<T>
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function tempPathFor(id: string): string {
  return path.join(TMP, 'recordings', `${id}.webm`)
}

/** Record a take and finalize it as MP4 into `outPath`. */
async function recordAndFinalize(
  outPath: string
): Promise<{ id: string; result: unknown; error: Error | null }> {
  const { id } = await invoke<{ id: string }>('recording:begin')
  await invoke('recording:appendChunk', id, bytes('webm chunk'))
  saveDialogResult = { canceled: false, filePath: outPath }
  try {
    const result = await invoke('recording:finalize', id, {
      filename: 'take.mp4',
      durationMs: 8000,
      convertToMp4: true
    })
    return { id, result, error: null }
  } catch (err) {
    return { id, result: undefined, error: err as Error }
  }
}

// The crash branch logs ffmpeg's real message for the bug report that will
// need it; captured rather than printed so the suite output stays readable,
// and asserted below so "log it in main" is a covered promise and not a
// comment.
const mainLog = vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-rec-cancel-'))
  convertOutcome = 'ok'
  saveDialogResult = { canceled: true }
  fakeWin.webContents.send.mockClear()
  mainLog.mockClear()
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

describe('cancelRecordingConvert', () => {
  it('returns false when there is no in-flight conversion', () => {
    expect(cancelRecordingConvert()).toBe(false)
  })

  it('is idempotent', () => {
    expect(cancelRecordingConvert()).toBe(false)
    expect(cancelRecordingConvert()).toBe(false)
  })
})

describe('recording:finalize — a discard is not a crash (T-44)', () => {
  it('converts and returns the saved file when nothing interrupts it', async () => {
    const outPath = path.join(TMP, 'kept.mp4')
    convertOutcome = 'ok'
    const { id, result, error } = await recordAndFinalize(outPath)

    expect(error).toBeNull()
    expect(result).toMatchObject({ outputPath: outPath, format: 'mp4', durationMs: 8000 })
    expect(existsSync(outPath)).toBe(true)
    expect(readFileSync(outPath, 'utf8')).toBe('full-mp4-bytes')
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('a cancelled convert resolves as a discard and reaps the half-written mp4', async () => {
    const outPath = path.join(TMP, 'discarded.mp4')
    convertOutcome = 'cancelled'
    const { id, result, error } = await recordAndFinalize(outPath)

    // No rejection: the renderer's error toast is never reached, and the
    // null is the same "nothing was saved" answer the cancelled save dialog
    // gives — the one that already prints "Recording discarded."
    expect(error).toBeNull()
    expect(result).toBeNull()
    // The partial output ffmpeg left at the user's chosen path is GONE. It
    // was killed before the moov atom, so no player could ever open it.
    expect(existsSync(outPath)).toBe(false)
    // And the streaming temp file is reaped as always.
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('a genuine convert failure still rejects — and now reaps its partial output too (T-59)', async () => {
    const outPath = path.join(TMP, 'broken.mp4')
    convertOutcome = 'crash'
    const { id, result, error } = await recordAndFinalize(outPath)

    // The discrimination proof: same rejected convert, opposite outcome.
    expect(result).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
    expect(existsSync(tempPathFor(id))).toBe(false)

    // WAS PINNED, NOW FIXED (T-59). This assertion used to read
    // `toBe(true)`: a crashed convert stranded the half-written .mp4 at the
    // name the user picked in the save dialog. ffmpeg died before the moov
    // atom either way, so the crash left exactly the same unplayable file
    // the deliberate discard did — the only difference being that nobody
    // had written the ticket yet.
    expect(existsSync(outPath)).toBe(false)

    // And the failure crosses the IPC in the studio's own words. The old
    // message was ffmpeg's ("convert-to-mp4 exit 1: Invalid data found when
    // processing input"), which the renderer toasted verbatim behind
    // Electron's "Error invoking remote method 'recording:finalize'"
    // preamble — the T-30 disease.
    expect(error?.message).toContain('Converting the recording to MP4 failed')
    expect(error?.message).toContain('ffmpeg exit code 1')
    expect(error?.message).toContain('Nothing was saved')
    expect(error?.message).not.toContain('convert-to-mp4 exit')
    expect(error?.message).not.toContain('Invalid data found when processing input')

    // The detail is not lost, it is filed: main logs what ffmpeg said so a
    // bug report has something to quote.
    expect(mainLog).toHaveBeenCalledTimes(1)
    const [prefix, logged] = mainLog.mock.calls[0] as [string, Error]
    expect(prefix).toContain('convert failed')
    expect(logged.message).toContain('Invalid data found when processing input')
  })

  it('the crash message is discriminated from the discard: one fails, one does not', async () => {
    // Round-21 discrimination, run as one test so the two outcomes are read
    // side by side: the SAME rejected convert, told apart only by the
    // sentinel class, ends in a friendly error or in a calm null.
    convertOutcome = 'crash'
    const crashed = await recordAndFinalize(path.join(TMP, 'crash-side.mp4'))
    convertOutcome = 'cancelled'
    const discarded = await recordAndFinalize(path.join(TMP, 'discard-side.mp4'))

    expect(crashed.error?.message).toMatch(/^Converting the recording to MP4 failed/)
    expect(discarded.error).toBeNull()
    expect(discarded.result).toBeNull()
    // Neither outcome leaves a file behind at the user's chosen path.
    expect(existsSync(path.join(TMP, 'crash-side.mp4'))).toBe(false)
    expect(existsSync(path.join(TMP, 'discard-side.mp4'))).toBe(false)
  })

  it('cancelling the save dialog reaps nothing but the temp file', async () => {
    // The pre-existing discard path, asserted alongside its new sibling so
    // the two calm outcomes stay the same shape.
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('webm chunk'))
    saveDialogResult = { canceled: true }
    const result = await invoke('recording:finalize', id, {
      filename: 'take.mp4',
      convertToMp4: true
    })
    expect(result).toBeNull()
    expect(existsSync(tempPathFor(id))).toBe(false)
  })
})

describe('recordingConvertFailureMessage — what the user is told (T-59)', () => {
  it('names the exit code, what happened to the take, and the way out', () => {
    const msg = recordingConvertFailureMessage(
      new ConvertFailedError(1, null, 'x264 [error]: baseline profile doesn\'t support 4:4:4')
    )
    expect(msg).toContain('Converting the recording to MP4 failed')
    expect(msg).toContain('ffmpeg exit code 1')
    expect(msg).toContain('Nothing was saved')
    // The setting named in the copy is the one on the Record panel, so the
    // advice is followable rather than decorative.
    expect(msg).toContain('Convert to MP4 after recording')
  })

  it('names the signal when the child died without an exit code', () => {
    const msg = recordingConvertFailureMessage(new ConvertFailedError(null, 'SIGSEGV', 'boom'))
    expect(msg).toContain('ffmpeg stopped on SIGSEGV')
    expect(msg).not.toContain('exit code')
  })

  it('still says something useful for a failure that is not ffmpeg exiting', () => {
    // A spawn error (ffmpeg binary missing) carries no code and no signal.
    const msg = recordingConvertFailureMessage(new Error('spawn ENOENT'))
    expect(msg).toContain('Converting the recording to MP4 failed.')
    expect(msg).not.toContain('ENOENT')
    expect(msg).not.toContain('undefined')
    expect(msg).not.toContain('null')
  })

  it('never leaks ffmpeg vocabulary into the sentence', () => {
    for (const err of [
      new ConvertFailedError(1, null, 'Invalid data found when processing input'),
      new ConvertFailedError(null, 'SIGKILL', 'frame= 120 fps= 30 q=28.0 size= 256kB'),
      new Error('convert-to-mp4 exit 69: /tmp/imagii-import/x.mp4: Permission denied')
    ]) {
      const msg = recordingConvertFailureMessage(err)
      expect(msg).not.toContain('convert-to-mp4')
      expect(msg).not.toContain('frame=')
      expect(msg).not.toContain('Invalid data found')
      expect(msg).not.toContain('/tmp/')
      expect(msg).not.toContain('libx264')
    }
  })
})
