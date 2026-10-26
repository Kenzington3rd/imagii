import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, closeSync, writeFileSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { userFacingError } from '../../shared/userFacingError'

// Round 18 H1 — streaming save protocol coverage:
//   recording:begin / appendChunk / finalize / abandon.
// Follows the recordingCancel.test.ts pattern: mock the electron surface the
// module touches at import time, capture the registered handlers from the
// ipcMain.handle mock, and drive them directly. The convertToMp4:false path
// is used throughout so no ffmpeg child is ever spawned: since T-120 that path remuxes
// the take, and `remuxWebm` is stood in for by a plain copy (recordingCancel.test.ts
// drives the remux's own outcomes; Layer 5 runs the real binary).

let TMP = ''
const handlers = new Map<string, (...args: unknown[]) => unknown>()

// Mutable dialog/window state so each test controls the finalize branch.
const fakeWin = { webContents: { isDestroyed: () => false, send: vi.fn() } }
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: true }
// T-124 (3): a test can hold the save dialog open, which is the state "mid-finalize" is (the session is `closed`
// and still registered while the person reads the dialog).
let saveDialogGate: Promise<void> = Promise.resolve()
let saveDialogAsked = 0

// T-119 (1): the handler's WriteStream is built inside `recording:begin`, so the only way a test can
// reach the stream the REAL handler holds is to see it made. Everything else in `node:fs` is the real thing.
const madeStreams: WriteStream[] = []
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    createWriteStream: ((...args: Parameters<typeof real.createWriteStream>) => {
      const stream = real.createWriteStream(...args)
      madeStreams.push(stream)
      return stream
    }) as typeof real.createWriteStream
  }
})

vi.mock('../ffmpeg/convert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ffmpeg/convert')>()
  const { copyFile } = await import('node:fs/promises')
  return {
    ...actual,
    remuxWebm: async (_owner: string, input: string, output: string): Promise<void> => {
      await copyFile(input, output)
    }
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  desktopCapturer: { getSources: vi.fn() },
  dialog: {
    showSaveDialog: async () => {
      saveDialogAsked++
      await saveDialogGate
      return saveDialogResult
    }
  },
  BrowserWindow: {
    getFocusedWindow: () => fakeWin,
    getAllWindows: () => [fakeWin]
  },
  app: { getPath: () => TMP }
}))

const { registerRecordingIpc, RECORDING_EMPTY_MESSAGE, abandonAllRecordingStreams, abandonOpenRecordingSessions } = await import('./recording')
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

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-rec-stream-'))
  saveDialogResult = { canceled: true }
  saveDialogGate = Promise.resolve()
  saveDialogAsked = 0
  fakeWin.webContents.send.mockClear()
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

describe('recording streaming protocol', () => {
  it('begin returns a nanoid-alphabet session id and creates the temp file', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(existsSync(tempPathFor(id))).toBe(true)
    await invoke('recording:abandon', id)
  })

  it('begin/append/finalize happy path writes the chunks in append order', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('hello '))
    await invoke('recording:appendChunk', id, bytes('world'))

    const outPath = path.join(TMP, 'saved-take.webm')
    saveDialogResult = { canceled: false, filePath: outPath }
    const result = await invoke<{
      outputPath: string
      sizeBytes: number
      format: string
      durationMs: number
    } | null>('recording:finalize', id, {
      filename: 'take.webm',
      durationMs: 1234,
      convertToMp4: false
    })

    expect(result).not.toBeNull()
    expect(result?.outputPath).toBe(outPath)
    expect(result?.sizeBytes).toBe('hello world'.length)
    expect(result?.format).toBe('webm')
    expect(result?.durationMs).toBe(1234)
    expect(readFileSync(outPath, 'utf8')).toBe('hello world')
    // Temp file is reaped after promotion.
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('preserves byte order across many sequential appends', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    let expected = ''
    for (let i = 0; i < 25; i++) {
      const piece = `chunk-${i};`
      expected += piece
      await invoke('recording:appendChunk', id, bytes(piece))
    }
    const outPath = path.join(TMP, 'ordered.webm')
    saveDialogResult = { canceled: false, filePath: outPath }
    await invoke('recording:finalize', id, { filename: 'x.webm', convertToMp4: false })
    expect(readFileSync(outPath, 'utf8')).toBe(expected)
  })

  it('append with a malformed id rejects', async () => {
    await expect(
      invoke('recording:appendChunk', '../escape', bytes('x'))
    ).rejects.toThrow(/malformed/)
  })

  it('append with an unknown (well-formed) id rejects', async () => {
    await expect(
      invoke('recording:appendChunk', 'zzzzzzzzzz', bytes('x'))
    ).rejects.toThrow(/unknown session/)
  })

  it('append with an empty chunk rejects', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:appendChunk', id, new ArrayBuffer(0))
    ).rejects.toThrow(/must not be empty/)
    await invoke('recording:abandon', id)
  })

  it('append with a non-buffer chunk rejects', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:appendChunk', id, 'not bytes')
    ).rejects.toThrow(/ArrayBuffer/)
    await invoke('recording:abandon', id)
  })

  it('append after finalize rejects and the temp file is reaped', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('data'))
    // Canceled dialog: finalize resolves null but the session is closed.
    saveDialogResult = { canceled: true }
    const result = await invoke('recording:finalize', id, {
      filename: 'take.webm',
      convertToMp4: false
    })
    expect(result).toBeNull()
    expect(existsSync(tempPathFor(id))).toBe(false)
    await expect(
      invoke('recording:appendChunk', id, bytes('straggler'))
    ).rejects.toThrow(/unknown session/)
  })

  it('finalize twice rejects the second call', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('data'))
    saveDialogResult = { canceled: true }
    await invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: false })
    await expect(
      invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: false })
    ).rejects.toThrow(/unknown session/)
  })

  it('finalize with zero appended bytes rejects and reaps the temp file', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: false })
    ).rejects.toThrow(/Nothing was recorded/)
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  // T-117 (4): the refusal reached the toast as "recording:finalize recording is empty" - a channel name
  // and a developer's phrase. It is a finished sentence now (tier 2 of userFacingError: one line, ends
  // like a sentence, no channel, nothing a known-cause pattern would rewrite), so the person reads it
  // exactly as written, after Electron has wrapped it the way it wraps every handler's throw.
  it('the empty-recording refusal is a finished sentence that userFacingError shows as written', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    const refusal = await invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: false }).then(
      () => null,
      (e: unknown) => e
    )
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toBe(RECORDING_EMPTY_MESSAGE)
    const wrapped = new Error(`Error invoking remote method 'recording:finalize': Error: ${(refusal as Error).message}`)
    const shown = userFacingError(wrapped, 'Saving the recording failed.').message
    expect(shown).toBe(RECORDING_EMPTY_MESSAGE)
    expect(shown).toMatch(/^Nothing was recorded/)
    expect(shown).not.toMatch(/recording:finalize|invoking|empty|remote/i)
    expect(shown.length).toBeLessThanOrEqual(240)
    expect(shown).toMatch(/\.$/)
  })

  it('finalize validates its spec', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:finalize', id, { filename: '', convertToMp4: false })
    ).rejects.toThrow(/filename/)
    await expect(
      invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: 'yes' })
    ).rejects.toThrow(/convertToMp4/)
    await expect(
      invoke('recording:finalize', '../nope', { filename: 'a.webm', convertToMp4: false })
    ).rejects.toThrow(/malformed/)
    await invoke('recording:abandon', id)
  })

  it('abandon removes the partial temp file and returns true, then false', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('partial data'))
    expect(existsSync(tempPathFor(id))).toBe(true)
    expect(await invoke('recording:abandon', id)).toBe(true)
    expect(existsSync(tempPathFor(id))).toBe(false)
    // Idempotent: the renderer calls abandon on already-reaped sessions.
    expect(await invoke('recording:abandon', id)).toBe(false)
  })

  it('append after abandon rejects', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('partial'))
    await invoke('recording:abandon', id)
    await expect(
      invoke('recording:appendChunk', id, bytes('more'))
    ).rejects.toThrow(/unknown session/)
  })

  it('abandon with a malformed id rejects', async () => {
    await expect(invoke('recording:abandon', '../etc/passwd')).rejects.toThrow(
      /malformed/
    )
  })
})

// T-119 (1): `recording:abandon` waited for a 'close' event on a stream that had ALREADY closed. A WriteStream
// auto-destroys after a write error (disk full, a vanished drive) and emits 'close' once; the renderer's own
// failure path (the append rejects, finalize throws, abandon runs) then arrived after that event and the
// handler never answered. The session was already out of `streamSessions`, so the quit sweep could not reap it
// either, and the partial webm outlived the "disk is full" toast. QA's repro, driven through the real handler:
// close the fd under the stream so the next append fails, let the stream finish dying, then abandon.
describe('recording:abandon on a stream that already auto-destroyed (T-119 item 1)', () => {
  const HUNG = 'abandon never answered'
  const answersWithin = <T>(work: Promise<T>, ms: number): Promise<T | typeof HUNG> =>
    Promise.race([work, new Promise<typeof HUNG>((resolve) => setTimeout(() => resolve(HUNG), ms))])

  async function dieOnAWriteError(): Promise<{ id: string; stream: WriteStream }> {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('before the failure'))
    const stream = madeStreams[madeStreams.length - 1]
    const fd = (stream as unknown as { fd?: number } | undefined)?.fd
    if (!stream || typeof fd !== 'number') throw new Error('the handler made no open stream')
    closeSync(fd)
    await expect(invoke('recording:appendChunk', id, bytes('after the fd went away'))).rejects.toThrow()
    return { id, stream }
  }

  it('answers, and the partial temp file is gone, when the stream has finished closing', async () => {
    const { id, stream } = await dieOnAWriteError()
    if (!stream.closed) await new Promise<void>((resolve) => stream.once('close', () => resolve()))
    // The state the hang needs: auto-destroyed AND the one 'close' event already emitted.
    expect(stream.destroyed).toBe(true)
    expect(stream.closed).toBe(true)
    expect(existsSync(tempPathFor(id))).toBe(true)

    expect(await answersWithin(invoke('recording:abandon', id), 1500)).toBe(true)
    expect(existsSync(tempPathFor(id))).toBe(false)
    // Idempotent afterwards, like every other abandon.
    expect(await invoke('recording:abandon', id)).toBe(false)
  })

  // Pending teardown, made deterministic: the stream is destroyed (an error, as a failed write destroys it) but
  // its fd close is held for 150 ms. Abandon must wait for that close, so the temp file is unlinked from a
  // closed fd (Windows refuses an unlink of an open file); skipping the wait on `destroyed` alone answers early.
  it('waits for a close that is still pending, then answers and removes the file', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('partial'))
    const stream = madeStreams[madeStreams.length - 1]
    if (!stream) throw new Error('the handler made no stream')
    const realDestroy = stream._destroy.bind(stream)
    stream._destroy = (err, cb) => {
      setTimeout(() => realDestroy(err, cb), 150)
    }
    stream.destroy(new Error('disk full'))
    expect(stream.destroyed).toBe(true)
    expect(stream.closed).toBe(false)

    expect(await answersWithin(invoke('recording:abandon', id), 1500)).toBe(true)
    expect(stream.closed).toBe(true)
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  // The handler's own bound: a close that never arrives (a hung drive) must not make abandon a promise that
  // never settles. 2 s in the handler; the test allows twice that.
  it('answers within its bound even when the stream never reports a close', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('partial'))
    const stream = madeStreams[madeStreams.length - 1]
    if (!stream) throw new Error('the handler made no stream')
    const realDestroy = stream._destroy.bind(stream)
    stream._destroy = () => {
      /* the close callback is never called */
    }
    stream.destroy(new Error('disk full'))
    expect(stream.closed).toBe(false)

    expect(await answersWithin(invoke('recording:abandon', id), 4000)).toBe(true)
    expect(existsSync(tempPathFor(id))).toBe(false)
    realDestroy(null, () => undefined) // release the fd the stand-in kept open
  }, 10_000)
})

// T-123 (6): the cap was check, then await, then insert. A burst of begins all read the same
// `streamSessions.size` before any of them had inserted, so twelve concurrent calls passed a cap
// that four sequential calls enforce. The slot is now reserved in the same synchronous step as
// the check and given back if the begin fails.
describe('recording:begin session cap under concurrency (T-123 (6))', () => {
  const MAX = 4
  afterEach(() => {
    abandonAllRecordingStreams()
  })
  const settle = (n: number): Promise<PromiseSettledResult<{ id: string }>[]> =>
    Promise.allSettled(Array.from({ length: n }, () => invoke<{ id: string }>('recording:begin')))

  it('sequential begins stop at the cap (the behavior concurrency has to match)', async () => {
    for (let i = 0; i < MAX; i++) await invoke('recording:begin')
    await expect(invoke('recording:begin')).rejects.toThrow(/too many open sessions/)
  })

  it('twelve begins at once open exactly the cap and refuse the rest', async () => {
    const results = await settle(12)
    const opened = results.filter((r) => r.status === 'fulfilled')
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(opened).toHaveLength(MAX)
    expect(refused).toHaveLength(12 - MAX)
    for (const r of refused) expect(String(r.reason)).toMatch(/too many open sessions/)
    // Four temp files, not twelve: a refused begin opened nothing.
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(path.join(TMP, 'recordings'))).toHaveLength(MAX)
  })

  it('a slot freed by abandon is usable again, once', async () => {
    const first = await settle(MAX)
    const ids = first.flatMap((r) => (r.status === 'fulfilled' ? [r.value.id] : []))
    expect(ids).toHaveLength(MAX)
    await invoke('recording:abandon', ids[0])
    const again = await settle(3)
    expect(again.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(again.filter((r) => r.status === 'rejected')).toHaveLength(2)
  })

  it('a begin that fails gives its slot back (a burst that all fail leaves the cap untouched)', async () => {
    // The recordings folder cannot be made: a FILE sits where it should be.
    writeFileSync(path.join(TMP, 'recordings'), 'not a folder')
    const failed = await settle(MAX + 2)
    expect(failed.every((r) => r.status === 'rejected')).toBe(true)
    // They all failed (the first MAX for the folder, the rest for the cap while those were in flight).
    // Each of the first MAX took a slot, so a begin that does not give it back leaves the cap full for
    // good: with the folder made, MAX begins must all open.
    rmSync(path.join(TMP, 'recordings'), { force: true })
    const after = await settle(MAX)
    expect(after.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX)
  })
})

// T-124 (3): the renderer-recovery reload (T-123 (15)) STRANDED recording sessions. A renderer that dies mid-take takes
// the only caller of `recording:appendChunk` / `finalize` / `abandon` with it, and the sessions it had open stay in
// the registry with their fds and their partial webm: executed, four crashes left four orphaned fds and webms and the
// next `recording:begin` was refused ("too many open sessions") until the app was restarted. The reload branch now
// abandons the sessions that are not yet `closed`; a session that IS closed is mid-finalize (the save dialog, the
// convert) and belongs to a handler that is still running.
describe('abandonOpenRecordingSessions: the reload after a crash frees what the dead renderer held (T-124 (3))', () => {
  const MAX = 4
  afterEach(() => {
    abandonAllRecordingStreams()
  })

  async function openTake(text: string): Promise<string> {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes(text))
    return id
  }

  it('abandons every open session: its temp file is gone and the cap is free again', async () => {
    const ids = []
    for (let i = 0; i < MAX; i++) ids.push(await openTake(`take ${i}`))
    for (const id of ids) expect(existsSync(tempPathFor(id)), id).toBe(true)
    // The symptom: the studio the reload lands in cannot start a take.
    await expect(invoke('recording:begin')).rejects.toThrow(/too many open sessions/)

    expect(await abandonOpenRecordingSessions()).toBe(MAX)

    for (const id of ids) expect(existsSync(tempPathFor(id)), id).toBe(false)
    const fresh = await invoke<{ id: string }>('recording:begin')
    expect(existsSync(tempPathFor(fresh.id))).toBe(true)
    // The ids are gone from the registry too: a late call from nobody is "unknown", not a write into a dead stream.
    await expect(invoke('recording:appendChunk', ids[0], bytes('late'))).rejects.toThrow(/unknown session/)
  })

  it('leaves a session that is mid-finalize alone, and reaps the open one beside it', async () => {
    const finalizing = await openTake('the take being saved')
    const stranded = await openTake('the take nobody will come back for')
    // Hold the save dialog: the session is `closed` and still registered, exactly as it is while a person reads it.
    let release: () => void = () => undefined
    saveDialogGate = new Promise<void>((resolve) => (release = resolve))
    const outPath = path.join(TMP, 'saved.webm')
    saveDialogResult = { canceled: false, filePath: outPath }
    const saving = invoke<{ outputPath: string } | null>('recording:finalize', finalizing, {
      filename: 'take.webm',
      convertToMp4: false
    })
    // Wait for the dialog to be asked: only then is the session mid-finalize.
    for (let i = 0; i < 200 && saveDialogAsked === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(saveDialogAsked).toBe(1)

    expect(await abandonOpenRecordingSessions()).toBe(1)
    expect(existsSync(tempPathFor(stranded))).toBe(false)
    expect(existsSync(tempPathFor(finalizing)), 'the take being saved is not touched').toBe(true)

    release()
    const result = await saving
    expect(result?.outputPath).toBe(outPath)
    expect(readFileSync(outPath, 'utf8')).toBe('the take being saved')
  })

  it('with nothing open it is a no-op that answers 0, and calling it twice is harmless', async () => {
    expect(await abandonOpenRecordingSessions()).toBe(0)
    const id = await openTake('x')
    expect(await abandonOpenRecordingSessions()).toBe(1)
    expect(await abandonOpenRecordingSessions()).toBe(0)
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('reaps a session whose stream already auto-destroyed (a failed write), without waiting on a close that has happened', async () => {
    const id = await openTake('before the failure')
    const stream = madeStreams[madeStreams.length - 1]
    const fd = (stream as unknown as { fd?: number } | undefined)?.fd
    if (!stream || typeof fd !== 'number') throw new Error('the handler made no open stream')
    closeSync(fd)
    await expect(invoke('recording:appendChunk', id, bytes('after the fd went away'))).rejects.toThrow()
    if (!stream.closed) await new Promise<void>((resolve) => stream.once('close', () => resolve()))
    const answered = await Promise.race([
      abandonOpenRecordingSessions(),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 1500))
    ])
    expect(answered).toBe(1)
    expect(existsSync(tempPathFor(id))).toBe(false)
  })
})

// T-128 (5): the QUIT's sweep had the opposite rule to the reload's above. `abandonAllRecordingStreams` unlinked every registered session's
// webm, including the one a finalize was saving: the take's only copy went while the person read the Save dialog (or while the convert
// ran, with its half-written mp4 left at the chosen name). It reaps what was still being recorded and leaves a closed session to the
// handler that owns it; recordingQuit.test.ts drives the convert's own end.
describe('abandonAllRecordingStreams: the quit sweep leaves the take that is being saved (T-128 (5))', () => {
  async function openTake(text: string): Promise<string> {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes(text))
    return id
  }

  it('reaps the take still being recorded, and leaves the one mid-finalize (the Save dialog is open) with its webm', async () => {
    const finalizing = await openTake('the take being saved')
    const recording = await openTake('the take still being recorded')
    let release: () => void = () => undefined
    saveDialogGate = new Promise<void>((resolve) => (release = resolve))
    const outPath = path.join(TMP, 'saved.webm')
    saveDialogResult = { canceled: false, filePath: outPath }
    const saving = invoke<{ outputPath: string } | null>('recording:finalize', finalizing, { filename: 'take.webm', convertToMp4: false })
    for (let i = 0; i < 200 && saveDialogAsked === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(saveDialogAsked).toBe(1)

    abandonAllRecordingStreams()

    expect(existsSync(tempPathFor(recording)), 'a recording that was still going has no one to save it: its partial is the sweep\'s').toBe(false)
    expect(readFileSync(tempPathFor(finalizing), 'utf8'), 'the take being saved is the only copy and is not').toBe('the take being saved')

    release()
    const result = await saving
    expect(result?.outputPath, 'and the save the sweep did not touch still finishes').toBe(outPath)
    expect(readFileSync(outPath, 'utf8')).toBe('the take being saved')
  })
})
