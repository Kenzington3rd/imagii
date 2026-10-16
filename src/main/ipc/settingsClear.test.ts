import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-119 (13) - a setting can be cleared, so a blank watermark export forgets the handle and the corner.
 *
 * The guide says Clip Kit stamps "the watermark you last exported with". The Export panel wrote the handle
 * and the corner only when there was a handle, so an export with the field blank left the last handle on
 * disk and the kit stamped it. The panel now sends `undefined` for both keys, and the store has to take it:
 * electron-store refuses `undefined` from `set` ("Use `delete()` to clear values"), so `setSetting` deletes.
 *
 * This runs the REAL `settings:set` / `settings:get` handlers over the REAL store against a real file in a
 * temp folder: only electron, and the folder electron-store would have chosen, are stood in for.
 */
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'imagii-settings-clear-'))
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
  // electron-store picks `app.getPath('userData')`; the same class, pointed at the temp folder.
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
const onDisk = (): Record<string, unknown> => {
  const file = path.join(SCRATCH, 'config.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {}
}

beforeEach(() => {
  registerSettingsIpc()
})
afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

describe('settings:set with undefined clears the key (T-119)', () => {
  it('a saved handle and corner are gone, in memory and in the file, after the clear', async () => {
    await invoke('settings:set', 'streamerHandle', '@kit_unit')
    await invoke('settings:set', 'watermarkPosition', 'top-left')
    expect(await invoke('settings:get', 'streamerHandle')).toBe('@kit_unit')
    expect(onDisk().streamerHandle).toBe('@kit_unit')
    expect(onDisk().watermarkPosition).toBe('top-left')

    await invoke('settings:set', 'streamerHandle', undefined)
    await invoke('settings:set', 'watermarkPosition', undefined)

    expect(await invoke('settings:get', 'streamerHandle')).toBeUndefined()
    expect(await invoke('settings:get', 'watermarkPosition')).toBeUndefined()
    expect('streamerHandle' in onDisk()).toBe(false)
    expect('watermarkPosition' in onDisk()).toBe(false)
  })

  it('clearing a key that was never saved is not an error', async () => {
    await expect(invoke('settings:set', 'streamerHandle', undefined)).resolves.toBeUndefined()
    await expect(invoke('settings:set', 'streamerHandle', undefined)).resolves.toBeUndefined()
  })

  it('clears only the key it was given', async () => {
    await invoke('settings:set', 'streamerHandle', '@kept')
    await invoke('settings:set', 'filenameTemplate', '{clip}')
    await invoke('settings:set', 'streamerHandle', undefined)
    expect(await invoke('settings:get', 'filenameTemplate')).toBe('{clip}')
    expect(onDisk().filenameTemplate).toBe('{clip}')
  })

  it('every other value is still stored and still judged by the schema (null is not a clear)', async () => {
    await invoke('settings:set', 'streamerHandle', '@again')
    expect(await invoke('settings:get', 'streamerHandle')).toBe('@again')
    await expect(invoke('settings:set', 'watermarkPosition', 'middle')).rejects.toThrow()
    // `null` is not "clear": the string schema still refuses it, as it did before this change.
    await expect(invoke('settings:set', 'streamerHandle', null)).rejects.toThrow()
    expect(await invoke('settings:get', 'streamerHandle')).toBe('@again')
  })

  it('a key main does not know is still refused, even to clear', async () => {
    await expect(invoke('settings:set', 'notARealKey', undefined)).rejects.toThrow(/not recognized/)
  })
})

/**
 * T-120 (7) - the schema judges the dotted keys.
 *
 * Conf nests a dotted key: `record.convertToMp4` is `{ record: { convertToMp4 } }` on disk. The schema had
 * flat properties named `'record.convertToMp4'` and so on, which match nothing in that layout, so the eleven
 * dotted keys were unchecked while `streamerHandle` beside them was (a 100-character handle was refused,
 * `record.convertToMp4 = 'yes'` and a non-array `recentFiles.video` were stored). These are the expediter's
 * replication shapes, driven through the real handlers and the real store.
 */
describe('the schema judges the dotted keys, not just the flat ones (T-120)', () => {
  const refused: Array<[string, unknown]> = [
    ['record.convertToMp4', 'yes'],
    ['record.convertToMp4', 1],
    ['record.webcamCorner', 'middle'],
    ['recentFiles.video', 'not-a-list'],
    ['recentFiles.audio', { 0: 'a' }],
    ['recentFiles.image', [1, 2]],
    ['recentFiles.video', Array.from({ length: 51 }, (_, i) => `/v/${i}.mp4`)],
    ['tutorialSeen.video', 'yes'],
    ['tutorialSeen.audio', 1],
    ['tutorialSeen.image', null],
    ['tutorialSeen.ai', {}],
    ['export.lastOutputDir', 5],
    ['clipKit.lastOutputDir', ['/x']],
    ['video.lastOutputDir', 5],
    // The flat ones keep being judged, as before.
    ['streamerHandle', 'x'.repeat(100)],
    ['watermarkPosition', 'middle']
  ]

  it.each(refused)('%s = %j is refused, and what was stored stays', async (key, value) => {
    await expect(invoke('settings:set', key, value)).rejects.toThrow(/Config schema violation/)
    // Nothing of the refused value reached memory or the file: the stored leaf, found by walking the dotted
    // path through the nested file, is not what was refused.
    expect(JSON.stringify(await invoke('settings:get', key)) ?? '').not.toBe(JSON.stringify(value))
    const leaf = key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], onDisk())
    expect(JSON.stringify(leaf) ?? '').not.toBe(JSON.stringify(value))
  })

  it('what the app really writes is accepted, read back through the dotted key, and sits NESTED on disk', async () => {
    await invoke('settings:set', 'record.convertToMp4', false)
    await invoke('settings:set', 'record.webcamCorner', 'top-left')
    await invoke('settings:set', 'recentFiles.video', ['/v/a.mp4', '/v/b.mp4'])
    await invoke('settings:set', 'tutorialSeen.video', true)
    // T-125 (10): a remembered folder is read back only if it is a folder that is THERE, so these are real ones.
    const out = (name: string): string => {
      const dir = path.join(SCRATCH, 'out', name)
      mkdirSync(dir, { recursive: true })
      return dir
    }
    const [exportsDir, kitsDir, sideDir] = [out('exports'), out('kits'), out('side')] as [string, string, string]
    await invoke('settings:set', 'export.lastOutputDir', exportsDir)
    await invoke('settings:set', 'clipKit.lastOutputDir', kitsDir)
    await invoke('settings:set', 'video.lastOutputDir', sideDir)
    expect(await invoke('settings:get', 'record.convertToMp4')).toBe(false)
    expect(await invoke('settings:get', 'recentFiles.video')).toEqual(['/v/a.mp4', '/v/b.mp4'])
    expect(await invoke('settings:get', 'clipKit.lastOutputDir')).toBe(kitsDir)
    expect(await invoke('settings:get', 'video.lastOutputDir')).toBe(sideDir)
    const disk = onDisk() as Record<string, Record<string, unknown>>
    expect(disk.record).toEqual({ convertToMp4: false, webcamCorner: 'top-left' })
    expect(disk.recentFiles?.video).toEqual(['/v/a.mp4', '/v/b.mp4'])
    expect(disk.tutorialSeen).toEqual({ video: true })
    expect(disk.export).toEqual({ lastOutputDir: exportsDir })
    expect(disk.clipKit).toEqual({ lastOutputDir: kitsDir })
    expect(disk.video).toEqual({ lastOutputDir: sideDir })
    // No dotted property name anywhere in the file: it is the same layout the app always wrote.
    expect(Object.keys(onDisk()).filter((k) => k.includes('.'))).toEqual([])
  })

  it('the ends of the range are accepted: an empty list, fifty recent files, both corners of a boolean', async () => {
    await invoke('settings:set', 'recentFiles.audio', [])
    await invoke('settings:set', 'recentFiles.image', Array.from({ length: 50 }, (_, i) => `/i/${i}.png`))
    await invoke('settings:set', 'record.convertToMp4', true)
    await invoke('settings:set', 'record.convertToMp4', false)
    expect(await invoke('settings:get', 'recentFiles.image')).toHaveLength(50)
    expect(await invoke('settings:get', 'recentFiles.audio')).toEqual([])
  })

  it('a refused write to one dotted key leaves its siblings alone', async () => {
    await invoke('settings:set', 'record.webcamCorner', 'bottom-left')
    await expect(invoke('settings:set', 'record.convertToMp4', 'yes')).rejects.toThrow(/Config schema violation/)
    expect(await invoke('settings:get', 'record.webcamCorner')).toBe('bottom-left')
  })

  it('a dotted key clears like a flat one (undefined deletes just that leaf)', async () => {
    await invoke('settings:set', 'record.webcamCorner', 'top-right')
    await invoke('settings:set', 'record.convertToMp4', true)
    await invoke('settings:set', 'record.webcamCorner', undefined)
    expect(await invoke('settings:get', 'record.webcamCorner')).toBeUndefined()
    expect(await invoke('settings:get', 'record.convertToMp4')).toBe(true)
    expect((onDisk() as { record?: Record<string, unknown> }).record).toEqual({ convertToMp4: true })
  })
})
