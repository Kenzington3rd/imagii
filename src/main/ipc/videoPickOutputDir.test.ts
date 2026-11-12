import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-120 (11) - `video:pickOutputDir` opens its chooser where the caller says.
 *
 * Clip Kit wrote `clipKit.lastOutputDir` after every kit and never read it, so the kit asked for a folder from
 * scratch on every press while Export remembers its own. The kit now passes the saved folder as the chooser's
 * `defaultPath`. The value came off disk (a hand-edited or stale setting), so main treats it as a hint: only a
 * usable absolute path becomes the dialog's `defaultPath`, anything else is ignored rather than refused, because
 * a stale setting must not stop a kit. The chooser itself is native; the options it is opened with are what the
 * handler decides, and they are read here.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const openOptions: Array<Record<string, unknown>> = []
let answer: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {
    showOpenDialog: async (_win: unknown, options: Record<string, unknown>) => {
      openOptions.push(options)
      return answer
    }
  },
  BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [{}] },
  shell: {},
  app: { getPath: () => tmpdir() }
}))

const { registerVideoIpc } = await import('./video')

// T-125 (10): the hint must be a folder that is THERE. These are real folders: the first test used paths nothing had made.
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'imagii-pick-dir-'))
const KITS = path.join(SCRATCH, 'kits')
const SECOND = path.join(SCRATCH, 'Clips', 'kits')
const A_FILE = path.join(SCRATCH, 'not-a-folder.txt')
await import('node:fs').then(({ mkdirSync }) => {
  mkdirSync(KITS, { recursive: true })
  mkdirSync(SECOND, { recursive: true })
})
writeFileSync(A_FILE, 'x')
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

const pick = (...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get('video:pickOutputDir')
  if (!handler) throw new Error('video:pickOutputDir was not registered')
  return handler({}, ...args)
}

beforeEach(() => {
  handlers.clear()
  openOptions.length = 0
  answer = { canceled: true, filePaths: [] }
  registerVideoIpc()
})

describe('video:pickOutputDir opens on the folder it is given (T-120)', () => {
  it('a folder that is there is the chooser\'s defaultPath', async () => {
    await pick(KITS)
    await pick(SECOND)
    expect(openOptions.map((o) => o.defaultPath)).toEqual([KITS, SECOND])
  })

  // T-125 (10): USER_GUIDE promises "a folder that is no longer a usable path is ignored and the chooser opens as it always did".
  // A well-formed path to a folder that was deleted (or lives on a drive that is not plugged in) passed the shape check and was
  // handed to the dialog; the same stale value seeded a panel's button and the file's failure blamed "a file imagii needs".
  it.each([
    ['a well-formed path to a folder that was deleted', path.join(SCRATCH, 'deleted-last-week', 'kits')],
    ['a Windows path on a drive that is not there', 'Z:\\Clips\\kits'],
    ['a path to a FILE, not a folder', A_FILE]
  ])('%s is ignored like any other stale value: the chooser opens where it always did', async (_label, value) => {
    await expect(pick(value)).resolves.toBeNull()
    expect(openOptions).toHaveLength(1)
    expect('defaultPath' in (openOptions[0] ?? {})).toBe(false)
  })

  it('the chooser is otherwise what it was: its title and a folder picker that can make a folder', async () => {
    await pick(KITS)
    expect(openOptions[0]).toMatchObject({
      title: 'Choose where to save exports',
      properties: ['openDirectory', 'createDirectory']
    })
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a relative path', 'Videos/kits'],
    ['a path that climbs out of its folder', '/home/streamer/../../etc'],
    ['a reserved device name', 'C:/Windows/CON'],
    ['a number', 42],
    ['an object', { path: '/x' }]
  ])('%s is ignored: the chooser opens where it always did, and nothing is refused', async (_label, value) => {
    await expect(pick(value)).resolves.toBeNull()
    expect(openOptions).toHaveLength(1)
    expect('defaultPath' in (openOptions[0] ?? {})).toBe(false)
  })

  it('the folder that was chosen still comes back, and a canceled chooser is still null', async () => {
    answer = { canceled: false, filePaths: ['/home/streamer/Videos/new'] }
    await expect(pick(KITS)).resolves.toBe('/home/streamer/Videos/new')
    answer = { canceled: true, filePaths: [] }
    await expect(pick(KITS)).resolves.toBeNull()
  })
})
