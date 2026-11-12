import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

// T-142 (1): `recording:revealTake` - the way to a take imagii kept (T-141 (5)). The Record screen's kept-take toast calls it with the take's session id;
// main builds the path, so the renderer can name a take and never a file. The harness is recordingStream.test.ts's: the electron surface the module touches is
// mocked at import time and the handler is captured off ipcMain.handle. `shell` is the part under test: what it was asked, and nothing else.

let TMP = ''
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const shown: string[] = []
const opened: string[] = []
let openResult = ''

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => void handlers.set(channel, fn) },
  desktopCapturer: { getSources: vi.fn() },
  dialog: {},
  BrowserWindow: {},
  app: { getPath: () => TMP },
  shell: {
    showItemInFolder: (p: string) => void shown.push(p),
    openPath: async (p: string) => {
      opened.push(p)
      return openResult
    }
  }
}))

const { registerRecordingIpc } = await import('./recording')
registerRecordingIpc()

function reveal(id: unknown): Promise<unknown> {
  const handler = handlers.get('recording:revealTake')
  if (!handler) throw new Error('no handler registered for recording:revealTake')
  return Promise.resolve(handler({}, id))
}

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-reveal-'))
  mkdirSync(path.join(TMP, 'recordings'))
  shown.length = 0
  opened.length = 0
  openResult = ''
})
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('recording:revealTake', () => {
  it('a take that is there is shown in the file manager, at the path main builds from the id', async () => {
    const take = path.join(TMP, 'recordings', 'AbC_123-xyz.webm')
    writeFileSync(take, 'the raw take')
    await reveal('AbC_123-xyz')
    expect(shown, 'the file itself, selected in its folder').toEqual([take])
    expect(opened, 'the folder is not opened as well').toEqual([])
  })

  it('a take that has been moved or reaped opens the folder it was kept in instead: the honest fallback, not an error', async () => {
    await expect(reveal('gone_take_1')).resolves.toBeUndefined()
    expect(shown).toEqual([])
    expect(opened).toEqual([path.join(TMP, 'recordings')])
  })

  it.each([
    ['an empty id', ''],
    ['a path-shaped id', '../config'],
    ['an id with a separator', 'a/b'],
    ['an id with a dot', 'take.webm'],
    ['an absolute path', path.join(TMP, 'recordings', 'x')],
    ['not a string', 42]
  ])('%s is refused, and the shell is never asked', async (_label, id) => {
    await expect(reveal(id)).rejects.toThrow()
    expect(shown).toEqual([])
    expect(opened).toEqual([])
  })

  it('a take of another name in the folder is not shown: the id names the file, nothing else is searched for', async () => {
    writeFileSync(path.join(TMP, 'recordings', 'other_take.webm'), 'someone else')
    await reveal('mine_gone_1')
    expect(shown).toEqual([])
    expect(opened).toEqual([path.join(TMP, 'recordings')])
  })
})
