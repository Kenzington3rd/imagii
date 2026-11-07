import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-128 (6), T-110 (ad) - `video:deleteCustomPreset` refuses an id outside the nanoid alphabet AT THE HANDLER, before the store is asked.
 *
 * `audio:deletePreset` got this gate in T-117 (1): the id becomes `<userData>/export-presets/<id>.json` and is unlinked, and a handler
 * that only checked "non-empty string" left the whole defense to the store. The store (`customPresets.ts`) does check, so a traversal
 * never reached `unlink` - but the sibling channel holds the line in two places, and this one held it in one. `customPresets.test.ts`
 * holds the store; this holds the handler, with the store wrapped in a spy so a green run can only mean the HANDLER refused (the store's
 * own guard would otherwise answer first and hide a missing one).
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
let userData = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: {},
  shell: {},
  app: { getPath: () => userData }
}))

const storeDelete = vi.fn()
vi.mock('../customPresets', async (importOriginal) => {
  const real = await importOriginal<typeof import('../customPresets')>()
  storeDelete.mockImplementation(real.deleteCustomPreset)
  return { ...real, deleteCustomPreset: (...a: Parameters<typeof real.deleteCustomPreset>) => storeDelete(...a) }
})

const { registerVideoIpc } = await import('./video')

// async so a handler that throws synchronously still reaches the test as a rejection, the way Electron hands it on.
async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`${channel} was not registered`)
  return h({ sender: { isDestroyed: () => false, send: vi.fn() } }, ...args)
}

beforeEach(() => {
  userData = mkdtempSync(path.join(tmpdir(), 'imagii-custompresetids-'))
  storeDelete.mockClear()
  handlers.clear()
  registerVideoIpc()
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('video:deleteCustomPreset holds the id to the nanoid alphabet (T-128 (6))', () => {
  it('a traversal id is refused before the store is asked, and the file it aimed at survives', async () => {
    mkdirSync(path.join(userData, 'export-presets'), { recursive: true })
    const victim = path.join(userData, 'config.json')
    writeFileSync(victim, 'USER DATA - not a preset', 'utf8')
    // The id really does resolve onto the victim: the green run is a refusal, not a miss.
    expect(path.resolve(userData, 'export-presets', '../config.json')).toBe(victim)

    const outcome = await call('video:deleteCustomPreset', '../config').then(
      () => null,
      (e: unknown) => e
    )

    expect(readFileSync(victim, 'utf8')).toBe('USER DATA - not a preset')
    expect(outcome, 'the handler refused, plainly').toBeInstanceOf(Error)
    expect((outcome as Error).message).toMatch(/preset id must match nanoid alphabet/)
    expect(storeDelete, 'and it refused before the store was asked').not.toHaveBeenCalled()
  })

  it.each([
    ['a nested traversal', 'sub/../../config'],
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a space', 'has space'],
    ['an extension', 'x.json'],
    ['a bare ..', '..'],
    ['a trailing newline', 'abc\n']
  ])('refuses %s, and the store is never asked', async (_label, id) => {
    await expect(call('video:deleteCustomPreset', id)).rejects.toThrow(/nanoid alphabet/)
    expect(storeDelete).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['a number', 42],
    ['undefined', undefined],
    ['null', null]
  ])('refuses an id that is %s (the check that was already here)', async (_label, id) => {
    await expect(call('video:deleteCustomPreset', id)).rejects.toThrow()
    expect(storeDelete).not.toHaveBeenCalled()
  })

  it('an id saveCustomPreset minted still deletes its file through the handler', async () => {
    const saved = (await call('video:saveCustomPreset', {
      name: '4K square',
      width: 2160,
      height: 2160,
      fps: 60,
      videoBitrate: '20M',
      audioBitrate: '192k',
      basePlatformId: 'youtube'
    })) as { id: string }
    const file = path.join(userData, 'export-presets', `${saved.id}.json`)
    expect(existsSync(file)).toBe(true)
    await call('video:deleteCustomPreset', saved.id)
    expect(storeDelete).toHaveBeenCalledWith(saved.id)
    expect(existsSync(file)).toBe(false)
  })
})
