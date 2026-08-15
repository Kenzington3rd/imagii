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

// Only the ffmpeg child is faked. `cancelActiveConvert` and
// `ConvertCancelledError` stay REAL, so the `instanceof` discrimination under
// test is the shipped one rather than a test double's shape.
type ConvertOutcome = 'ok' | 'cancelled' | 'crash'
let convertOutcome: ConvertOutcome = 'ok'

vi.mock('../ffmpeg/convert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ffmpeg/convert')>()
  return {
    ...actual,
    convertToMp4: async (_input: string, mp4Path: string): Promise<void> => {
      // Every branch writes SOMETHING first: real ffmpeg has already put
      // bytes at the user's chosen path by the time it is killed, and that
      // stranded file is the point of the test.
      writeFileSync(mp4Path, convertOutcome === 'ok' ? 'full-mp4-bytes' : 'partial')
      if (convertOutcome === 'cancelled') throw new actual.ConvertCancelledError()
      if (convertOutcome === 'crash') {
        throw new Error('convert-to-mp4 exit 1: Invalid data found when processing input')
      }
    }
  }
})

const { cancelRecordingConvert, registerRecordingIpc } = await import('./recording')
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

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-rec-cancel-'))
  convertOutcome = 'ok'
  saveDialogResult = { canceled: true }
  fakeWin.webContents.send.mockClear()
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

  it('a genuine convert failure still rejects, with its error text intact', async () => {
    const outPath = path.join(TMP, 'broken.mp4')
    convertOutcome = 'crash'
    const { id, result, error } = await recordAndFinalize(outPath)

    // The discrimination proof: same rejected convert, opposite outcome.
    expect(result).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toContain('convert-to-mp4 exit 1')
    expect(error?.message).toContain('Invalid data found when processing input')
    expect(existsSync(tempPathFor(id))).toBe(false)
    // Pinned, not fixed: a crashed convert still strands its partial output.
    // T-44 covers the deliberate discard; the crash path has no ticket yet,
    // so a future fix that reaps it fails here and gets read.
    expect(existsSync(outPath)).toBe(true)
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
