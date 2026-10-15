import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
