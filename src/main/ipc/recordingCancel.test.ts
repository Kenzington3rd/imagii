import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
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

const fakeWin = { webContents: { isDestroyed: () => false, send: vi.fn() } }
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: true }
// T-88: every options object the save dialog was opened with, so the title the
// user reads can be asserted without an OS dialog.
let saveDialogOptions: Array<{ title?: string; defaultPath?: string }> = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  desktopCapturer: { getSources: vi.fn() },
  dialog: {
    showSaveDialog: async (_win: unknown, options: { title?: string; defaultPath?: string }) => {
      saveDialogOptions.push(options)
      return saveDialogResult
    }
  },
  BrowserWindow: {
    getFocusedWindow: () => fakeWin,
    getAllWindows: () => [fakeWin]
  },
  app: { getPath: () => TMP }
}))

// Only the ffmpeg child is faked. `cancelConverts`, `ConvertCancelledError`
// and `ConvertFailedError` stay REAL, so the `instanceof` discrimination
// under test is the shipped one rather than a test double's shape.
// 'discarded-after-exit': the convert finished, and the Discard (or the quit) is recorded on the save's run between the exit and the swap (T-140 (1)).
type ConvertOutcome = 'ok' | 'cancelled' | 'crash' | 'discarded-after-exit'
let convertOutcome: ConvertOutcome = 'ok'
// T-120: the WebM branch's remux - what it was asked to copy where, and how it ends.
let remuxOutcome: ConvertOutcome = 'ok'
let remuxCalls: Array<{ input: string; output: string }> = []
// T-115: what the handler handed the convert - the progress callback and the length of the take.
let lastConvert: {
  onProgress?: (p: { percent?: number }) => void
  durationSec?: number
} | null = null

vi.mock('../ffmpeg/convert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ffmpeg/convert')>()
  return {
    ...actual,
    // T-120: the WebM branch's packet copy. Like the convert, it writes SOMETHING first (a half-written
    // output is what a kill leaves), and what it does after is the test's choice.
    remuxWebm: async (_owner: string, input: string, webmPath: string): Promise<void> => {
      remuxCalls.push({ input, output: webmPath })
      writeFileSync(webmPath, remuxOutcome === 'ok' || remuxOutcome === 'discarded-after-exit' ? 'remuxed-webm-bytes' : 'partial')
      if (remuxOutcome === 'cancelled') throw new actual.ConvertCancelledError()
      if (remuxOutcome === 'discarded-after-exit') actual.cancelConverts(_owner as import('../ffmpeg/convert').ConvertOwner)
      if (remuxOutcome === 'crash') throw new actual.ConvertFailedError(1, null, 'Invalid data found')
    },
    convertToMp4: async (
      _owner: string,
      _input: string,
      mp4Path: string,
      onProgress?: (p: { percent?: number }) => void,
      durationSec?: number
    ): Promise<void> => {
      lastConvert = { onProgress, durationSec }
      // Every branch writes SOMETHING first: real ffmpeg has already put
      // bytes at the user's chosen path by the time it is killed, and that
      // stranded file is the point of the test.
      writeFileSync(mp4Path, convertOutcome === 'ok' || convertOutcome === 'discarded-after-exit' ? 'full-mp4-bytes' : 'partial')
      if (convertOutcome === 'cancelled') throw new actual.ConvertCancelledError()
      if (convertOutcome === 'discarded-after-exit') actual.cancelConverts(_owner as import('../ffmpeg/convert').ConvertOwner)
      if (convertOutcome === 'crash') {
        // The real rejection shape, so the friendly copy under test is built
        // from the same fields ffmpeg's close handler fills in.
        throw new actual.ConvertFailedError(1, null, 'Invalid data found when processing input')
      }
    }
  }
})

// T-140 (1): the WebM branch's fallback is a plain copy of the take; a test can make it fail part-way (a full drive) to see what the chosen path holds then.
let copyHook: ((real: typeof import('node:fs/promises'), src: string, dst: string) => Promise<void>) | null = null
// T-140 (1): and the swap onto the chosen path can be refused the way Windows refuses it while the file is open in another app (Linux cannot be made to).
let renameHook: ((real: typeof import('node:fs/promises'), from: string, to: string) => Promise<void>) | null = null
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    copyFile: async (src: string, dst: string) => (copyHook ? copyHook(real, src, dst) : real.copyFile(src, dst)),
    rename: async (from: string, to: string) => (renameHook ? renameHook(real, from, to) : real.rename(from, to))
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
  remuxOutcome = 'ok'
  copyHook = null
  renameHook = null
  remuxCalls = []
  lastConvert = null
  saveDialogResult = { canceled: true }
  saveDialogOptions = []
  fakeWin.webContents.send.mockClear()
  mainLog.mockClear()
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

describe('cancelRecordingConvert', () => {
  it('returns false when there is no in-flight conversion', () => {
    expect(cancelRecordingConvert('take-a')).toBe(false)
  })

  it('is idempotent', () => {
    expect(cancelRecordingConvert('take-a')).toBe(false)
    expect(cancelRecordingConvert('take-a')).toBe(false)
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
    // T-116: a box is checked and unchecked, never ticked (BRANDING_GUIDE, "Voice"); the label is quoted exactly.
    expect(msg).toContain('uncheck "Convert to MP4 after recording" to keep the WebM.')
    expect(msg).not.toMatch(/tick/i)
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

describe('the save dialog says what Cancel does (T-88)', () => {
  // The dialog was titled "Save recording" while its Cancel button threw the
  // take away — the stream is closed and the temp file reaped the moment the
  // dialog returns without a path. The OS chrome is untestable, but the options
  // object it is opened with is not: this is the deepest layer that reaches it.
  it('titles the dialog so that Cancel reads as discarding the take', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('webm chunk'))
    await invoke('recording:finalize', id, { filename: 'take.mp4', convertToMp4: true })

    expect(saveDialogOptions).toHaveLength(1)
    expect(saveDialogOptions[0]?.title).toBe('Save recording (Cancel discards it)')
  })

  it('says the same for a WebM save — Cancel discards that take too', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('webm chunk'))
    await invoke('recording:finalize', id, { filename: 'take.webm', convertToMp4: false })

    expect(saveDialogOptions[0]?.title).toMatch(/Cancel discards it/)
    expect(saveDialogOptions[0]?.defaultPath).toMatch(/\.webm$/)
  })

  it('and the claim is true: Cancel in the dialog resolves null and reaps the take', async () => {
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

describe('recording:finalize hands the convert the length of the take (T-115)', () => {
  // The bar used to be `encoded seconds x 2`, because the convert was never told how long the take
  // was. promoteTempWebm holds the recorder's own duration; the convert's percent is the encode
  // position over it. (convertCancel.test.ts drives the percent; Layer 5 runs the real binary.)
  async function finalizeWith(spec: Record<string, unknown>): Promise<void> {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('webm chunk'))
    saveDialogResult = { canceled: false, filePath: path.join(TMP, 'len.mp4') }
    await invoke('recording:finalize', id, { filename: 'take.mp4', convertToMp4: true, ...spec })
  }

  it('passes spec.durationMs down as seconds', async () => {
    await finalizeWith({ durationMs: 8000 })
    expect(lastConvert?.durationSec).toBe(8)
    await finalizeWith({ durationMs: 93_500 })
    expect(lastConvert?.durationSec).toBe(93.5)
  })

  it.each([
    ['no duration', {}],
    ['a duration of 0', { durationMs: 0 }]
  ])('passes none for %s, so the bar is indeterminate and nothing is invented', async (_label, spec) => {
    await finalizeWith(spec)
    expect(lastConvert).not.toBeNull()
    expect(lastConvert?.durationSec).toBeUndefined()
  })

  it('forwards the convert\'s progress to the window as it came, a percent or none', async () => {
    await finalizeWith({ durationMs: 8000 })
    lastConvert?.onProgress?.({ percent: 25 })
    lastConvert?.onProgress?.({})
    expect(fakeWin.webContents.send.mock.calls).toEqual([
      ['recording:progress', { percent: 25 }],
      ['recording:progress', {}]
    ])
  })
})

describe('recording:finalize with Convert off saves a WebM whose header is repaired (T-120)', () => {
  // A MediaRecorder webm is streamed, so its header has no duration and Video Studio's probe refuses it.
  // The save used to be a plain copyFile of that file; it is now a packet copy into a fresh file
  // (`remuxWebm`), with the same discard and cleanup the MP4 convert has. (Layer 5 runs the real binary
  // on a MediaRecorder-shaped file and probes what it writes.)
  async function recordAndSaveWebm(
    outPath: string
  ): Promise<{ id: string; result: unknown; error: Error | null }> {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('streamed webm'))
    saveDialogResult = { canceled: false, filePath: outPath }
    try {
      const result = await invoke('recording:finalize', id, {
        filename: 'take.webm',
        durationMs: 5000,
        convertToMp4: false
      })
      return { id, result, error: null }
    } catch (err) {
      return { id, result: undefined, error: err as Error }
    }
  }

  it('hands the remux the temp take and the chosen path, and reports the file it wrote', async () => {
    const outPath = path.join(TMP, 'kept.webm')
    const { id, result, error } = await recordAndSaveWebm(outPath)

    expect(error).toBeNull()
    expect(remuxCalls).toHaveLength(1)
    expect(remuxCalls[0]?.input).toBe(tempPathFor(id))
    // T-140 (1): ffmpeg is handed a partial beside the chosen path (`.webm` last: the same muxer), which is swapped in once it is whole.
    expect(remuxCalls[0]?.output).toMatch(/\/kept\.[0-9a-f]{8}\.partial\.webm$/)
    expect(readFileSync(outPath, 'utf8')).toBe('remuxed-webm-bytes')
    expect(result).toMatchObject({
      outputPath: outPath,
      format: 'webm',
      durationMs: 5000,
      sizeBytes: 'remuxed-webm-bytes'.length
    })
    // The temp take is reaped as on every other branch.
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('a Discard during the remux is a discard: null, the half-written webm and the temp are gone', async () => {
    remuxOutcome = 'cancelled'
    const outPath = path.join(TMP, 'discarded.webm')
    const { id, result, error } = await recordAndSaveWebm(outPath)

    expect(error).toBeNull()
    expect(result).toBeNull()
    expect(existsSync(outPath)).toBe(false)
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('a remux that fails does not lose the take: it is saved as recorded, and the failure is logged', async () => {
    remuxOutcome = 'crash'
    const outPath = path.join(TMP, 'fallback.webm')
    const { id, result, error } = await recordAndSaveWebm(outPath)

    expect(error).toBeNull()
    // The partial the remux left is replaced by the temp take's own bytes.
    expect(readFileSync(outPath, 'utf8')).toBe('streamed webm')
    expect(result).toMatchObject({ outputPath: outPath, format: 'webm', sizeBytes: 'streamed webm'.length })
    expect(existsSync(tempPathFor(id))).toBe(false)
    expect(mainLog).toHaveBeenCalledTimes(1)
    const [prefix, logged] = mainLog.mock.calls[0] as [string, Error]
    expect(prefix).toContain('remux failed')
    expect(logged.message).toContain('Invalid data found')
  })

  it('the MP4 branch does not remux, and the WebM branch does not convert', async () => {
    await recordAndFinalize(path.join(TMP, 'only-convert.mp4'))
    expect(remuxCalls).toEqual([])
    expect(lastConvert).not.toBeNull()

    lastConvert = null
    await recordAndSaveWebm(path.join(TMP, 'only-remux.webm'))
    expect(remuxCalls).toHaveLength(1)
    expect(lastConvert).toBeNull()
  })
})

// T-140 (1) - the file the person named in the Save dialog is the OLD file until a whole new one is swapped in.
//
// The convert, the remux and the fallback copy used to write straight to the chosen path, and a failure or a Discard unlinked it first
// (`unlink(outputPath)`, unconditionally): a Save over an earlier take at the same name, then a Discard, a crash or a full drive, left neither file.
// The mocks below write wherever they are handed (as ffmpeg does), so a runner that wrote the chosen path would show as a changed or missing file.
describe('recording:finalize writes beside the chosen path and swaps a whole file in (T-140 (1))', () => {
  const EARLIER = 'the earlier recording, at the name the person picked again'
  const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
  /** The folder the saves go to, by name: a partial would be one. */
  const folder = (): string[] => readdirSync(TMP).filter((f) => f !== 'recordings').sort()

  async function recordAndSave(outPath: string, mp4: boolean): Promise<{ id: string; result: unknown; error: Error | null }> {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('streamed webm'))
    saveDialogResult = { canceled: false, filePath: outPath }
    try {
      const result = await invoke('recording:finalize', id, { filename: mp4 ? 'take.mp4' : 'take.webm', durationMs: 5000, convertToMp4: mp4 })
      return { id, result, error: null }
    } catch (err) {
      return { id, result: undefined, error: err as Error }
    }
  }

  describe.each([
    ['MP4', true, 'mp4'],
    ['WebM', false, 'webm']
  ] as const)('the %s save', (_label, mp4, ext) => {
    const seeded = (): { out: string; before: string } => {
      const out = path.join(TMP, `take.${ext}`)
      writeFileSync(out, EARLIER)
      return { out, before: sha(out) }
    }
    const outcome = (o: ConvertOutcome): void => {
      if (mp4) convertOutcome = o
      else remuxOutcome = o
    }

    it('a Discard that kills the run leaves the earlier file byte for byte, and no partial', async () => {
      const { out, before } = seeded()
      outcome('cancelled')
      const { id, result, error } = await recordAndSave(out, mp4)
      expect(error).toBeNull()
      expect(result, 'a discard: null').toBeNull()
      expect(sha(out)).toBe(before)
      expect(folder()).toEqual([`take.${ext}`])
      expect(existsSync(tempPathFor(id)), 'the take the person threw away is gone').toBe(false)
    })

    it('a crash leaves the earlier file byte for byte, and no partial', async () => {
      const { out, before } = seeded()
      outcome('crash')
      if (!mp4) {
        // The remux crash falls back to the plain copy; make that fail too (a drive that ran out of room half-way).
        copyHook = async (real, _src, dst) => {
          await real.writeFile(dst, 'half of the take')
          throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
        }
      }
      const { error } = await recordAndSave(out, mp4)
      expect(error, 'a real failure still fails').toBeInstanceOf(Error)
      expect(sha(out)).toBe(before)
      expect(folder()).toEqual([`take.${ext}`])
    })

    it('a run that finishes replaces it with the whole new file, and leaves no partial', async () => {
      const { out } = seeded()
      outcome('ok')
      const { error, result } = await recordAndSave(out, mp4)
      expect(error).toBeNull()
      expect(readFileSync(out, 'utf8'), 'the new file, the old bytes gone').toBe(mp4 ? 'full-mp4-bytes' : 'remuxed-webm-bytes')
      expect(result).toMatchObject({ outputPath: out, format: ext })
      expect(folder()).toEqual([`take.${ext}`])
    })

    it('a Discard recorded after the run exited 0 and before the swap wins: the earlier file stays, the finished file is dropped, and the raw take is kept', async () => {
      const { out, before } = seeded()
      outcome('discarded-after-exit')
      const { id, result, error } = await recordAndSave(out, mp4)
      expect(error).toBeNull()
      expect(result).toBeNull()
      expect(sha(out)).toBe(before)
      expect(folder()).toEqual([`take.${ext}`])
      // The run's latch does not say who asked (a Discard, or the quit), and the raw take is the only copy of the recording: it is kept, and the launch
      // sweep reaps it with the rest of recordings/.
      expect(existsSync(tempPathFor(id))).toBe(true)
    })
  })

  it('the WebM fallback: a remux that fails is replaced by a copy of the take, written beside and swapped in - the earlier file is never unlinked first', async () => {
    const out = path.join(TMP, 'fallback.webm')
    writeFileSync(out, EARLIER)
    const before = sha(out)
    remuxOutcome = 'crash'
    let atCopy: { chosen: string; folder: string[] } | null = null
    copyHook = async (real, src, dst) => {
      // The moment the copy starts: the chosen path still holds the earlier file, and the copy is going to a partial beside it.
      atCopy = { chosen: sha(out), folder: folder() }
      expect(dst).toMatch(/\/fallback\.[0-9a-f]{8}\.partial\.webm$/)
      await real.copyFile(src, dst)
    }
    const { error } = await recordAndSave(out, false)
    expect(error).toBeNull()
    expect((atCopy as unknown as { chosen: string }).chosen, 'untouched when the copy began').toBe(before)
    expect(readFileSync(out, 'utf8'), 'and now the take as recorded').toBe('streamed webm')
    expect(folder()).toEqual(['fallback.webm'])
  })

  it('a swap the disk refuses is not blamed on the convert: the disk\'s own error goes up, the folder at the path is untouched, and no partial is left', async () => {
    const out = path.join(TMP, 'is-a-folder.mp4')
    mkdirSync(out)
    writeFileSync(path.join(out, 'inside.txt'), 'somebody\'s')
    convertOutcome = 'ok'
    const { error } = await recordAndSave(out, true)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message, 'not "Converting the recording to MP4 failed"').not.toContain('Converting the recording')
    expect((error as NodeJS.ErrnoException).syscall).toBe('rename')
    expect(readFileSync(path.join(out, 'inside.txt'), 'utf8')).toBe('somebody\'s')
    expect(folder()).toEqual(['is-a-folder.mp4'])
  })
})

// T-140 (1): the person saves over a take that is still open in a player. Windows refuses the swap onto a file held without FILE_SHARE_DELETE for as long
// as it is held; before T-140 the convert opened the chosen path itself and failed within a second, now the take has been converted and a refusal here would
// throw the whole save away. It is saved BESIDE the file that cannot be replaced, and the result says where, so the studio's toast and its two buttons
// (Show in folder, Edit in Video Studio) are about the file that exists.
describe('recording:finalize when the file that was named is open in another app (T-140 (1))', () => {
  const EARLIER = 'the earlier recording, open in a player'
  const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
  const folder = (): string[] => readdirSync(TMP).filter((f) => f !== 'recordings').sort()
  const lockOnto = (target: string, refusals = Number.POSITIVE_INFINITY): void => {
    let refused = 0
    renameHook = async (real, from, to) => {
      if (to === target && refused < refusals) {
        refused += 1
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM', syscall: 'rename' })
      }
      return real.rename(from, to)
    }
  }
  async function save(outPath: string, mp4: boolean): Promise<{ id: string; result: Record<string, unknown> | null; error: Error | null }> {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('streamed webm'))
    saveDialogResult = { canceled: false, filePath: outPath }
    try {
      const result = await invoke<Record<string, unknown> | null>('recording:finalize', id, { filename: mp4 ? 'take.mp4' : 'take.webm', durationMs: 5000, convertToMp4: mp4 })
      return { id, result, error: null }
    } catch (err) {
      return { id, result: null, error: err as Error }
    }
  }

  describe.each([
    ['the MP4 convert', true, 'mp4', 'full-mp4-bytes'],
    ['the WebM remux', false, 'webm', 'remuxed-webm-bytes'],
    ['the WebM fallback copy (the remux failed)', false, 'webm', 'streamed webm']
  ] as const)('%s', (label, mp4, ext, written) => {
    const arrange = (): { out: string; before: string } => {
      const out = path.join(TMP, `take.${ext}`)
      writeFileSync(out, EARLIER)
      if (label.includes('fallback')) remuxOutcome = 'crash'
      return { out, before: sha(out) }
    }

    it('lands beside it as "take (2)", answers that path and the one that was chosen, and the earlier file is byte for byte what it was', async () => {
      const { out, before } = arrange()
      lockOnto(out)
      const { id, result, error } = await save(out, mp4)
      expect(error).toBeNull()
      const beside = path.join(TMP, `take (2).${ext}`)
      expect(result).toMatchObject({ outputPath: beside, requestedPath: out, format: ext })
      expect(result?.sizeBytes, 'the size of the file that exists').toBe(Buffer.byteLength(written))
      expect(sha(out)).toBe(before)
      expect(readFileSync(beside, 'utf8')).toBe(written)
      expect(folder(), 'no partial').toEqual([`take (2).${ext}`, `take.${ext}`])
      expect(existsSync(tempPathFor(id)), 'the raw take is reaped: the save succeeded').toBe(false)
    })

    it('a refusal that lifts lands on the chosen path, with no second copy and no "requestedPath" to explain', async () => {
      const { out } = arrange()
      lockOnto(out, 2)
      const { error, result } = await save(out, mp4)
      expect(error).toBeNull()
      expect(result).toMatchObject({ outputPath: out })
      expect(result).not.toHaveProperty('requestedPath')
      expect(readFileSync(out, 'utf8')).toBe(written)
      expect(folder()).toEqual([`take.${ext}`])
    })
  })

  it('a name nothing is at is not "open in another app": a swap the disk refuses there still fails, in the disk\'s words, and saves nothing', async () => {
    const out = path.join(TMP, 'brand-new.mp4')
    // Refused for exactly the budget (six tries), then let through: a redirect would land the take and this row would see it.
    lockOnto(out, 6)
    const { error, result } = await save(out, true)
    expect(result).toBeNull()
    expect((error as NodeJS.ErrnoException).code).toBe('EPERM')
    expect((error as NodeJS.ErrnoException).syscall).toBe('rename')
    expect(folder(), 'no "brand-new (2)", no partial').toEqual([])
  })
})
