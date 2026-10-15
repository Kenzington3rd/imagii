import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-125 (10) - a REMEMBERED output folder that is no longer there is ignored where it is read.
 *
 * `video.lastOutputDir`, `export.lastOutputDir` and `clipKit.lastOutputDir` are paths the person chose last week. The folder may
 * have been deleted or renamed, or live on a drive that is not plugged in, and the stored path is still a well-formed absolute
 * one: the panels seeded their button with it, wrote into it, and the failure blamed "a file imagii needs" - after a Compile had
 * already burned its whole segment encode. USER_GUIDE says a folder that is no longer a usable path is ignored. The read in main
 * (`settings:get`) answers `undefined` for a remembered folder that does not exist as a folder, for every consumer at once, and
 * leaves the stored value alone (the drive may be plugged back in; the next folder written replaces it).
 *
 * The REAL handlers run over the REAL store against a real file in a temp folder (settingsClear.test.ts' technique).
 */
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'imagii-settings-folders-'))
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()

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

const { registerSettingsIpc } = await import('./settings')

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return handler({}, ...args)
}
const onDisk = (): Record<string, Record<string, unknown>> => {
  const file = path.join(SCRATCH, 'config.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, unknown>>) : {}
}

const HERE = path.join(SCRATCH, 'Clips')
const GONE = path.join(SCRATCH, 'deleted-last-week')
const A_FILE = path.join(SCRATCH, 'a-file.txt')
mkdirSync(HERE, { recursive: true })
writeFileSync(A_FILE, 'x')

beforeEach(() => {
  registerSettingsIpc()
})
afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

const FOLDER_KEYS = [
  ['video.lastOutputDir', 'video'],
  ['export.lastOutputDir', 'export'],
  ['clipKit.lastOutputDir', 'clipKit']
] as const

describe.each(FOLDER_KEYS)('settings:get %s (T-125 (10))', (key, group) => {
  it('a folder that is there is answered as it was stored', async () => {
    await invoke('settings:set', key, HERE)
    expect(await invoke('settings:get', key)).toBe(HERE)
  })

  it('a folder that was deleted is ignored: the read answers nothing, and the stored value is left as it was', async () => {
    await invoke('settings:set', key, GONE)
    expect(await invoke('settings:get', key)).toBeUndefined()
    expect(onDisk()[group]?.lastOutputDir, 'not erased: the drive may come back').toBe(GONE)
  })

  it('a path to a file is not a folder', async () => {
    await invoke('settings:set', key, A_FILE)
    expect(await invoke('settings:get', key)).toBeUndefined()
  })

  it('a folder that comes back (the drive is plugged in again) is answered again', async () => {
    const later = path.join(SCRATCH, `replugged-${group}`)
    await invoke('settings:set', key, later)
    expect(await invoke('settings:get', key)).toBeUndefined()
    mkdirSync(later)
    expect(await invoke('settings:get', key)).toBe(later)
  })

  it('nothing stored is nothing answered', async () => {
    await invoke('settings:set', key, undefined)
    expect(await invoke('settings:get', key)).toBeUndefined()
  })
})

describe('every other setting is read exactly as before (T-125 (10))', () => {
  it('a string that looks like a missing path is still just a string under a key that is not a folder', async () => {
    await invoke('settings:set', 'streamerHandle', GONE)
    expect(await invoke('settings:get', 'streamerHandle')).toBe(GONE)
    await invoke('settings:set', 'streamerHandle', undefined)
  })

  it('the key allowlist still refuses an unknown key', async () => {
    await expect(Promise.resolve().then(() => invoke('settings:get', 'video.lastOutputDirs'))).rejects.toThrow(/not recognized/)
  })
})
