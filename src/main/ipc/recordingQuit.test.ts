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
    expect(existsSync(outPath), 'ffmpeg has opened its output at the chosen name').toBe(true)
    expect(openRunCount(), 'the save is a run the quit can wait for').toBe(1)
    slowUnlinkMs = 150

    // What the before-quit handler does: kill everything, then wait (bounded) for the cleanup the kill starts.
    cancelAllConverts()
    await expect(drainRuns(3000)).resolves.toBe('drained')

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
    expect(existsSync(outPath), 'no half-written webm at the chosen name').toBe(false)
    expect(readFileSync(tempPathFor(id), 'utf8')).toBe(TAKE)
    expect(await saving).toBeNull()
  })

  it('a Discard is not a quit: the person threw the take away, so the partial AND the raw take go', async () => {
    const outPath = path.join(TMP, 'take.mp4')
    const { id, saving } = await startSave(outPath, true)
    await untilSpawned(1)
    expect(cancelRecordingConvert(), 'the Discard found the convert').toBe(true)
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
