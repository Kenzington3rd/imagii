import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-126 (10) - `settings:get` on a folder key never waits on a path that does not answer, and four panels reading one key are one stat.
 *
 * The REAL handler over the REAL store (settingsFolders.test.ts' technique), with `node:fs/promises`' `stat` held open for one path
 * to stand in for an unreachable share. The missing-folder filter itself (a folder that is gone reads as nothing) is
 * settingsFolders.test.ts, unchanged.
 */
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'imagii-settings-deadline-'))
const HUNG = path.join(SCRATCH, 'unreachable-share')
const HERE = path.join(SCRATCH, 'Clips')
mkdirSync(HERE, { recursive: true })
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
const statCalls: string[] = []
const parked: Array<() => void> = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
    on: vi.fn()
  },
  app: { getVersion: () => 'test', quit: vi.fn() }
}))
vi.mock('electron-store', async (importOriginal) => {
  const real = await importOriginal<{ default: new (options: Record<string, unknown>) => object }>()
  const Real = real.default
  class Sandboxed extends Real {
    constructor(options: Record<string, unknown>) {
      super({ ...options, cwd: SCRATCH })
    }
  }
  return { default: Sandboxed }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    stat: (p: string, ...rest: unknown[]) => {
      statCalls.push(p)
      // The unreachable share: the stat does not come back until the test lets it go (a libuv thread parked on it).
      if (p === HUNG) return new Promise((resolve) => parked.push(() => resolve({ isDirectory: () => false })))
      return (real.stat as (p: string, ...r: unknown[]) => Promise<unknown>)(p, ...rest)
    }
  }
})

const { registerSettingsIpc } = await import('./settings')
const { FOLDER_CHECK_DEADLINE_MS } = await import('../ffmpeg/outputPath')

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  statCalls.length = 0
  registerSettingsIpc()
})
afterEach(async () => {
  vi.useRealTimers()
  // Let the parked stat go, so the next test is not reading over a hang this one left in flight.
  parked.splice(0).forEach((release) => release())
  await new Promise((resolve) => setImmediate(resolve))
})
afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

describe('settings:get on a folder key (T-126 (10))', () => {
  it('a path that never answers reads as the stored value once the deadline passes, not as nothing and not never', async () => {
    await invoke('settings:set', 'video.lastOutputDir', HUNG)
    vi.useFakeTimers()
    const read = invoke('settings:get', 'video.lastOutputDir')
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS + 1)
    expect(await read, 'can\'t tell, so the stored folder is answered (ensureOutputDir guards the real write)').toBe(HUNG)
  })

  it('four panels reading one key at once are one stat of its path', async () => {
    await invoke('settings:set', 'video.lastOutputDir', HERE)
    const answers = await Promise.all(Array.from({ length: 4 }, () => invoke('settings:get', 'video.lastOutputDir')))
    expect(answers).toEqual([HERE, HERE, HERE, HERE])
    expect(statCalls.filter((p) => p === HERE), 'four reads, one stat').toHaveLength(1)
  })

  it('the same holds over a hang: four reads, one parked stat, and all four answered at the deadline', async () => {
    await invoke('settings:set', 'video.lastOutputDir', HUNG)
    vi.useFakeTimers()
    const reads = Array.from({ length: 4 }, () => invoke('settings:get', 'video.lastOutputDir'))
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS + 1)
    expect(await Promise.all(reads)).toEqual([HUNG, HUNG, HUNG, HUNG])
    expect(statCalls.filter((p) => p === HUNG), 'one thread parked, not four').toHaveLength(1)
  })

  it('a folder that is gone is still hidden (the T-125 (10) filter holds)', async () => {
    await invoke('settings:set', 'export.lastOutputDir', path.join(SCRATCH, 'deleted-last-week'))
    expect(await invoke('settings:get', 'export.lastOutputDir')).toBeUndefined()
  })

  it('a key that is not a folder key is never stat\'d', async () => {
    await invoke('settings:set', 'streamerHandle', HUNG)
    expect(await invoke('settings:get', 'streamerHandle')).toBe(HUNG)
    expect(statCalls).toEqual([])
    await invoke('settings:set', 'streamerHandle', undefined)
  })
})

/**
 * T-175 (2) - `settings:folderOfFilePresent`: is the FOLDER of this file there? The importers drop a Recent entry whose file failed to open as "can't find" only when it
 * is; an unplugged drive takes its folder with it and the entry stays. The same stat and deadline as the remembered-folder read (`folderVerdict`): a stat that has not
 * answered by the deadline is "not there" (keep the entry), and a path that is not a safe absolute one answers false without a stat and without throwing.
 */
describe('settings:folderOfFilePresent (T-175 (2))', () => {
  const NOT_A_FOLDER = path.join(SCRATCH, 'a-file.txt')
  writeFileSync(NOT_A_FOLDER, 'x')

  it('is registered beside settings:get', () => {
    expect(handlers.has('settings:folderOfFilePresent')).toBe(true)
  })

  it('a file in a folder that is there: true (the file itself need not exist - it is the folder that is asked)', async () => {
    expect(await invoke('settings:folderOfFilePresent', path.join(HERE, 'stream-vod.mp4'))).toBe(true)
    expect(statCalls).toContain(HERE)
  })

  it('a file whose folder is gone (a drive that is not connected): false', async () => {
    expect(await invoke('settings:folderOfFilePresent', path.join(SCRATCH, 'unplugged-drive', 'Captures', 'vod.mp4'))).toBe(false)
  })

  it('a file whose "folder" is a file: false', async () => {
    expect(await invoke('settings:folderOfFilePresent', path.join(NOT_A_FOLDER, 'vod.mp4'))).toBe(false)
  })

  it('a path that is not a safe absolute one, or not a string: false, with no stat and no throw', async () => {
    for (const bad of ['vod.mp4', './Clips/vod.mp4', '../Clips/vod.mp4', `${HERE}/../Clips/vod.mp4`, '', undefined, null, 42, { path: HERE }]) {
      expect(await invoke('settings:folderOfFilePresent', bad), String(bad)).toBe(false)
    }
    expect(statCalls).toEqual([])
  })

  it('a folder whose stat never answers is false at the deadline - "can\'t tell" keeps the entry', async () => {
    vi.useFakeTimers()
    const asked = invoke('settings:folderOfFilePresent', path.join(HUNG, 'vod.mp4'))
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS + 1)
    expect(await asked).toBe(false)
    expect(statCalls.filter((p) => p === HUNG)).toHaveLength(1)
  })
})
