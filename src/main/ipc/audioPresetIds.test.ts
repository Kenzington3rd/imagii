import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'

/**
 * T-117 (1) - the preset id is refused at the IPC boundary, before the store is asked.
 *
 * `audio:deletePreset` checked that the id was a non-empty string and handed it to a store that
 * joined it into `<userData>/audio-presets/<id>.json` and unlinked the result. The custom export
 * presets and the mood boards gate the same id with the alphabet nanoid mints; this one did not.
 * `presets.test.ts` holds the store (real files, the survival of the file a traversal aimed at);
 * this holds the handler, with the store wrapped in a spy so a green run here can only mean the
 * HANDLER refused (the store's own guard would otherwise answer first and hide a missing one).
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
vi.mock('../audio/presets', async (importOriginal) => {
  const real = await importOriginal<typeof import('../audio/presets')>()
  storeDelete.mockImplementation(real.deletePreset)
  return { ...real, deletePreset: (...a: Parameters<typeof real.deletePreset>) => storeDelete(...a) }
})

const { registerAudioIpc } = await import('./audio')

// async so a handler that throws synchronously still reaches the test as a rejection, the way Electron hands it on.
async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`${channel} was not registered`)
  return h({ sender: { isDestroyed: () => false, send: vi.fn() } }, ...args)
}

beforeEach(() => {
  userData = mkdtempSync(path.join(tmpdir(), 'imagii-presetids-'))
  storeDelete.mockClear()
  handlers.clear()
  registerAudioIpc()
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('audio:deletePreset holds the id to the nanoid alphabet (T-117)', () => {
  it('a traversal id is refused before the store is asked, and the file it aimed at survives', async () => {
    mkdirSync(path.join(userData, 'audio-presets'), { recursive: true })
    const victim = path.join(userData, 'config.json')
    writeFileSync(victim, 'USER DATA - not a preset', 'utf8')
    // The id really does resolve onto the victim: the green run is a refusal, not a miss.
    expect(path.resolve(userData, 'audio-presets', '../config.json')).toBe(victim)

    const outcome = await call('audio:deletePreset', '../config').then(
      () => null,
      (e: unknown) => e
    )

    // Survival first: before the guard existed this is the line that went red (ENOENT - the unlink had run).
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
    await expect(call('audio:deletePreset', id)).rejects.toThrow(/nanoid alphabet/)
    expect(storeDelete).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['a number', 42],
    ['undefined', undefined],
    ['null', null]
  ])('refuses an id that is %s (the check that was already here)', async (_label, id) => {
    await expect(call('audio:deletePreset', id)).rejects.toThrow()
    expect(storeDelete).not.toHaveBeenCalled()
  })

  it('an id savePreset minted still deletes its file through the handler', async () => {
    const saved = (await call('audio:savePreset', 'My mic', DEFAULT_CHAIN_SPEC)) as { id: string }
    const file = path.join(userData, 'audio-presets', `${saved.id}.json`)
    expect(existsSync(file)).toBe(true)
    await call('audio:deletePreset', saved.id)
    expect(storeDelete).toHaveBeenCalledWith(saved.id)
    expect(existsSync(file)).toBe(false)
  })
})
