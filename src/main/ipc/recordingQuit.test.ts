import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { drainRuns, openRunCount } from '../ffmpeg/cancelLatch'

/**
 * T-128 (5), T-127 (3)'s "not covered": a quit in the middle of a recording's SAVE.
 *
 * The convert (or, with Convert off, the remux) is killed by the quit sweep, and what is left depends on who waits for the cleanup that
 * follows the kill. Before this, nobody did, and the sweep after it (`abandonAllRecordingStreams`) removed the temp webm - the ONLY
 * copy of the take - while the half-written mp4 stayed at the name the person had chosen: executed in the built app by the sweep-17
 * reviewer, both a window X and `app.quit()` in the middle of a convert. The contract now, over the REAL convert module (only the ffmpeg
 * child is a stand-in) and the real latch:
 *   - the save is a run from the chosen name until the temp take is dealt with, so the quit's wait covers the cleanup;
 *   - a QUIT removes the half-written output and keeps the raw take; a Discard removes both (that is what the person asked for);
 *   - a Save dialog nobody has answered is not work: no run, and the sweep leaves the closed session's take alone.
 */
let TMP = ''
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const fakeWin = { webContents: { isDestroyed: () => false, send: vi.fn() } }
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: true }
let saveDialogGate: Promise<void> = Promise.resolve()
let saveDialogAsked = 0
/** Removing the output or the temp take takes this long (a slow disk, an antivirus scan): the quit must wait for it. */
let slowUnlinkMs = 0

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
  BrowserWindow: { getFocusedWindow: () => fakeWin, getAllWindows: () => [fakeWin] },
  app: { getPath: () => TMP }
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    unlink: async (file: Parameters<typeof real.unlink>[0]) => {
      if (slowUnlinkMs > 0 && /\.(mp4|webm)$/.test(String(file))) await new Promise((resolve) => setTimeout(resolve, slowUnlinkMs))
      return real.unlink(file)
    }
  }
})

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* convert.ts sets utf8 on both pipes */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  signals: string[] = []
  kill(signal: string): boolean {
    this.signals.push(signal)
    // A real ffmpeg closes a few ms after the signal.
    setTimeout(() => this.emit('close', null, 'SIGKILL'), 5)
    return true
  }
}
const spawned: Array<{ args: string[]; child: FakeChild }> = []
/** What ffmpeg does when it OPENS its output: bytes at the name, long before the moov atom. */
let finishWith: 'hold' | 'ok' = 'hold'

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new FakeChild()
    spawned.push({ args, child })
    writeFileSync(args[args.length - 1] as string, 'half-written output')
    if (finishWith === 'ok') setImmediate(() => child.emit('close', 0, null))
    return child
  }
}))

const { registerRecordingIpc, abandonAllRecordingStreams, cancelRecordingConvert } = await import('./recording')
const { cancelAllConverts } = await import('../ffmpeg/convert')
registerRecordingIpc()

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(handler({}, ...args)) as Promise<T>
}
const tempPathFor = (id: string): string => path.join(TMP, 'recordings', `${id}.webm`)
const TAKE = 'the raw take: the only copy of the recording'

/** Record a take and start saving it to `outPath`; resolves with the session id and the pending save. */
async function startSave(outPath: string, convertToMp4: boolean): Promise<{ id: string; saving: Promise<unknown> }> {
  const { id } = await invoke<{ id: string }>('recording:begin')
  await invoke('recording:appendChunk', id, new TextEncoder().encode(TAKE))
  saveDialogResult = { canceled: false, filePath: outPath }
  const saving = invoke('recording:finalize', id, { filename: 'take', durationMs: 8000, convertToMp4 }).then(
    (value) => value,
    (err: unknown) => err
  )
  return { id, saving }
}
/** The file the Nth spawned ffmpeg (0-based) was told to write: since T-140 (1) a partial beside the name the person chose in the Save dialog. */
const outputOf = (i: number): string => (spawned[i]?.args ?? []).slice(-1)[0] as string
async function untilSpawned(n: number): Promise<void> {
  for (let i = 0; i < 400 && spawned.length < n; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(spawned.length, 'the ffmpeg child was started').toBeGreaterThanOrEqual(n)
}

vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-rec-quit-'))
  spawned.length = 0
  finishWith = 'hold'
  slowUnlinkMs = 0
  saveDialogResult = { canceled: true }
  saveDialogGate = Promise.resolve()
  saveDialogAsked = 0
  cancelAllConverts()
})
afterEach(() => {
  abandonAllRecordingStreams()
  rmSync(TMP, { recursive: true, force: true })
})

describe('a quit in the middle of the MP4 convert (T-128 (5))', () => {
  it('waits for the cleanup: the half-written mp4 is gone, the raw take is kept, and nothing of it is lost', async () => {
    const outPath = path.join(TMP, 'take.mp4')
    const { id, saving } = await startSave(outPath, true)
    await untilSpawned(1)
    // T-140 (1): ffmpeg opens a PARTIAL beside the chosen name; the chosen name itself is not touched while it writes.
    const partial = outputOf(0)
    expect(existsSync(partial), 'ffmpeg has opened its output').toBe(true)
    expect(existsSync(outPath), 'and the chosen name is not it').toBe(false)
    expect(openRunCount(), 'the save is a run the quit can wait for').toBe(1)
    slowUnlinkMs = 150

    // What the before-quit handler does: kill everything, then wait (bounded) for the cleanup the kill starts.
    cancelAllConverts()
    await expect(drainRuns(3000)).resolves.toBe('drained')

    expect(existsSync(partial), 'the half-written mp4 is gone before the quit is released').toBe(false)
    expect(existsSync(outPath), 'no half-written mp4 at the final name').toBe(false)
    expect(readFileSync(tempPathFor(id), 'utf8'), 'the raw take survived the quit').toBe(TAKE)
    expect(await saving, 'and the save ended as a discard-shaped null, not an error').toBeNull()
    // The sweep that follows the wait finds nothing of the take to delete.
    abandonAllRecordingStreams()
    expect(existsSync(tempPathFor(id)), 'the sweep after the wait leaves it').toBe(true)
    expect(openRunCount()).toBe(0)
  })

  it('the webm branch (Convert off, the remux) is the same: the partial webm goes, the raw take stays', async () => {
    const outPath = path.join(TMP, 'take.webm')
    const { id, saving } = await startSave(outPath, false)
    await untilSpawned(1)
    expect(spawned[0]?.args).toContain('copy')
    slowUnlinkMs = 150
    cancelAllConverts()
    await expect(drainRuns(3000)).resolves.toBe('drained')
    expect(existsSync(outputOf(0)), 'the partial webm is gone before the quit is released').toBe(false)
    expect(existsSync(outPath), 'no half-written webm at the chosen name').toBe(false)
    expect(readFileSync(tempPathFor(id), 'utf8')).toBe(TAKE)
    expect(await saving).toBeNull()
  })

  it('a Discard is not a quit: the person threw the take away, so the partial AND the raw take go', async () => {
    const outPath = path.join(TMP, 'take.mp4')
    const { id, saving } = await startSave(outPath, true)
    await untilSpawned(1)
    expect(cancelRecordingConvert(id), 'the Discard found the convert').toBe(true)
    expect(await saving).toBeNull()
    expect(existsSync(outPath)).toBe(false)
    expect(existsSync(tempPathFor(id)), 'Discard recording means the take is gone').toBe(false)
    expect(openRunCount()).toBe(0)
  })
})

describe('what the quit does not wait for, and what it leaves alone (T-128 (5))', () => {
  it('a Save dialog nobody has answered is not a run: the wait is immediate, and the sweep leaves the closed session\'s take', async () => {
    let release: () => void = () => undefined
    saveDialogGate = new Promise<void>((resolve) => (release = resolve))
    const { id, saving } = await startSave(path.join(TMP, 'later.mp4'), true)
    for (let i = 0; i < 200 && saveDialogAsked === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(saveDialogAsked).toBe(1)
    expect(openRunCount(), 'nothing is being worked on while the dialog is open').toBe(0)
    await expect(drainRuns(2000)).resolves.toBe('drained')

    abandonAllRecordingStreams()
    expect(readFileSync(tempPathFor(id), 'utf8'), 'the take being saved is not the sweep\'s to delete').toBe(TAKE)

    saveDialogResult = { canceled: true }
    release()
    expect(await saving, 'the dialog\'s own Cancel still discards the take, as it says it does').toBeNull()
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('the control: a save that finishes ends its run and leaves the finished mp4 (and not the temp take)', async () => {
    finishWith = 'ok'
    const outPath = path.join(TMP, 'done.mp4')
    const { id, saving } = await startSave(outPath, true)
    const result = (await saving) as { outputPath: string; format: string }
    expect(result).toMatchObject({ outputPath: outPath, format: 'mp4' })
    expect(readFileSync(outPath, 'utf8')).toBe('half-written output') // the stand-in's bytes; the real convert's are Layer 2/5's
    expect(existsSync(tempPathFor(id))).toBe(false)
    expect(openRunCount()).toBe(0)
    expect(readdirSync(path.join(TMP, 'recordings'))).toEqual([])
  })
})

// T-137 (2): leaving Record during a save returned an idle Record over a convert main was still running, a second take was recorded, and its
// "Discard recording" called `cancelConverts('recording')`, which cancelled EVERY recording-owner convert: the first take's save saw a cancel that was not
// the quit's, kept nothing, and unlinked its raw webm (the only copy). A Discard is aimed at one take now. Over the real convert module and the real
// handlers; only the ffmpeg child is a stand-in.
describe('a Discard cancels its own take and no other (T-137 (2))', () => {
  /** Two takes saving at once: the first has been converting for a while, the second has just started. `mp4`: Convert to MP4 (the convert), else the WebM copy (the remux). */
  async function twoTakesSaving(mp4 = true): Promise<{
    first: { id: string; saving: Promise<unknown>; out: string }
    second: { id: string; saving: Promise<unknown>; out: string }
  }> {
    const ext = mp4 ? 'mp4' : 'webm'
    const firstOut = path.join(TMP, `first.${ext}`)
    const first = await startSave(firstOut, mp4)
    await untilSpawned(1)
    const secondOut = path.join(TMP, `second.${ext}`)
    const second = await startSave(secondOut, mp4)
    await untilSpawned(2)
    expect(openRunCount(), 'both saves are runs').toBe(2)
    return { first: { ...first, out: firstOut }, second: { ...second, out: secondOut } }
  }

  it.each([
    ['converting to MP4', true],
    ['saving a WebM (the remux)', false]
  ])('discarding the second take leaves the first take %s, its output in place and its raw take on disk - and it finishes as a success', async (_label, mp4) => {
    const { first, second } = await twoTakesSaving(mp4)

    expect(cancelRecordingConvert(second.id), 'the Discard found the second take\'s convert').toBe(true)
    expect(await second.saving, 'the second take was discarded: null, as a Discard answers').toBeNull()
    expect(existsSync(second.out), 'its half-written mp4 is gone').toBe(false)
    expect(existsSync(tempPathFor(second.id)), 'and the take the person threw away').toBe(false)

    // The first take, which nobody discarded.
    expect(spawned[0]?.child.signals, 'its ffmpeg was not signalled').toEqual([])
    expect(spawned[1]?.child.signals).toEqual(['SIGKILL'])
    expect(existsSync(outputOf(0)), 'its output is still being written (a partial beside the chosen name, T-140 (1))').toBe(true)
    expect(readFileSync(tempPathFor(first.id), 'utf8'), 'its raw take is the only copy, and it is still there').toBe(TAKE)
    expect(openRunCount(), 'its save is still a run').toBe(1)

    spawned[0]?.child.emit('close', 0, null)
    const result = (await first.saving) as { outputPath: string; format: string }
    expect(result, 'it saved').toMatchObject({ outputPath: first.out, format: mp4 ? 'mp4' : 'webm' })
    expect(existsSync(first.out)).toBe(true)
    expect(existsSync(tempPathFor(first.id)), 'and its temp take is reaped after a SUCCESS, as always').toBe(false)
    expect(openRunCount()).toBe(0)
  })

  it('the channel is aimed at one take: with no id, or an id that is not a take\'s, it is refused or finds nothing, and no other take\'s convert is touched', async () => {
    const { first, second } = await twoTakesSaving()

    await expect(invoke('recording:cancelSave'), 'a Discard with no id').rejects.toThrow(/cancelSave id/)
    await expect(invoke('recording:cancelSave', '../../etc'), 'an id that is not a nanoid').rejects.toThrow(/cancelSave id malformed/)
    expect(await invoke<boolean>('recording:cancelSave', 'aTakeNobodyHas'), 'a well-formed id that names no take').toBe(false)
    expect(spawned.map((s) => s.child.signals), 'nothing was signalled').toEqual([[], []])

    expect(await invoke<boolean>('recording:cancelSave', second.id)).toBe(true)
    expect(await second.saving).toBeNull()
    expect(spawned.map((s) => s.child.signals), 'only the named take\'s child was').toEqual([[], ['SIGKILL']])

    spawned[0]?.child.emit('close', 0, null)
    expect(await first.saving).toMatchObject({ outputPath: first.out })
  })

  it('a quit that follows a Discard still keeps the take it ends: the discarded one is gone, the other\'s raw take survives the sweep', async () => {
    const { first, second } = await twoTakesSaving()
    expect(cancelRecordingConvert(second.id)).toBe(true)
    expect(await second.saving).toBeNull()

    cancelAllConverts()
    await expect(drainRuns(3000)).resolves.toBe('drained')
    expect(await first.saving, 'the quit ended the first take\'s save').toBeNull()
    expect(existsSync(first.out), 'no half-written mp4').toBe(false)
    expect(readFileSync(tempPathFor(first.id), 'utf8'), 'the quit keeps the raw take').toBe(TAKE)
    expect(existsSync(tempPathFor(second.id)), 'the Discard did not').toBe(false)
  })
})
