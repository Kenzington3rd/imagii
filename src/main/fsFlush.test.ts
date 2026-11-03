import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import type { ImagiiProject } from '../shared/workspace'

/**
 * T-141 (10) - a flush that fails must not leak the handle it opened.
 *
 * The autosave opened its tmp to fsync it (`open`, `sync`, `close`) inside a swallowing catch, and the close came after the sync: a sync that REJECTED (a drive
 * that cannot fsync, a network share, a full cache) skipped it, and the handle stayed open for the life of the process. One per autosave, every few seconds,
 * for the session (executed: a rejecting sync left the descriptor open on every write); on Windows an open handle also blocks the unlink and the rename of that
 * tmp. `writeFileAtomic` had the try/finally. Both now go through the one `flushToDisk`.
 *
 * The failure is a disk's, so it is injected into the REAL `node:fs/promises` (everything else in it stays real): `open` returns the real handle with `sync`
 * rejecting, and the test asks the handle itself whether it is closed (`fd` is -1 after `close()`).
 */
const state = vi.hoisted(() => ({
  userData: '',
  /** The next handles `open` hands out have a `sync` that rejects with this errno. */
  syncFails: null as string | null,
  /** Every handle opened, in order. */
  opened: [] as Array<{ fd: number }>
}))

vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>): Promise<FileHandle> => {
      const handle = await real.open(...args)
      state.opened.push(handle)
      if (state.syncFails) {
        const code = state.syncFails
        handle.sync = async (): Promise<void> => {
          throw Object.assign(new Error(`${code}: simulated, fsync`), { code, syscall: 'fsync' })
        }
      }
      return handle
    }
  }
})

const { flushToDisk, writeFileAtomic } = await import('./fsAtomic')
const { writeAutosave } = await import('./autosave')

let dir = ''
const autosaveFile = (): string => path.join(dir, 'autosave', 'autosave.json')
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-flush-'))
  state.userData = dir
  state.syncFails = null
  state.opened.length = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const project = (): ImagiiProject => ({
  schemaVersion: 1,
  savedAt: Date.now(),
  appVersion: '1.0.0',
  videoStudio: { sourcePath: 'C:/test/video.mp4', clips: [], selectedClipId: null, watermark: null }
})

describe('flushToDisk', () => {
  it('opens the file, syncs it and closes it', async () => {
    const file = path.join(dir, 'a.bin')
    writeFileSync(file, 'bytes')
    await flushToDisk(file)
    expect(state.opened.map((h) => h.fd), 'one handle, closed').toEqual([-1])
  })

  it('a sync that REJECTS still closes the handle, and the flush does not throw (it is an extra, not a gate)', async () => {
    const file = path.join(dir, 'a.bin')
    writeFileSync(file, 'bytes')
    state.syncFails = 'EIO'
    await expect(flushToDisk(file)).resolves.toBeUndefined()
    expect(state.opened, 'a handle was opened').toHaveLength(1)
    expect(state.opened[0]?.fd, 'and it is closed: the descriptor is not leaked').toBe(-1)
  })

  it('a file that cannot be opened is nothing to close, and not an error either', async () => {
    await expect(flushToDisk(path.join(dir, 'not-there.bin'))).resolves.toBeUndefined()
    expect(state.opened).toEqual([])
  })
})

describe('the autosave write flushes through it', () => {
  it('a drive whose fsync rejects: the autosave is still written whole, and no handle is left open', async () => {
    state.syncFails = 'EIO'
    const result = await writeAutosave(project())
    expect(result.ok, 'the write succeeded: a failed sync must not turn a good write into a refused one').toBe(true)
    expect(JSON.parse(readFileSync(autosaveFile(), 'utf8')).videoStudio.sourcePath).toBe('C:/test/video.mp4')
    expect(state.opened.length, 'the tmp was opened to be flushed').toBeGreaterThan(0)
    expect(state.opened.map((h) => h.fd), 'every handle the write opened is closed').toEqual(state.opened.map(() => -1))
  })

  it('one handle per write, never more, over several writes with a failing sync', async () => {
    state.syncFails = 'EIO'
    for (let i = 0; i < 4; i++) await writeAutosave(project())
    expect(state.opened.every((h) => h.fd === -1), 'none of the four writes leaked its handle').toBe(true)
    expect(state.opened).toHaveLength(4)
  })

  it('the control: a sync that works closes the handle as well, and the folder holds the autosave and no tmp', async () => {
    const result = await writeAutosave(project())
    expect(result.ok).toBe(true)
    expect(state.opened.every((h) => h.fd === -1)).toBe(true)
    expect(readdirSync(path.dirname(autosaveFile())).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('writeFileAtomic flushes through it too', () => {
  it('a rejecting sync leaves the whole file and a closed handle', async () => {
    state.syncFails = 'EIO'
    const target = path.join(dir, 'project.imagii.json')
    await writeFileAtomic(target, 'whole file')
    expect(readFileSync(target, 'utf8')).toBe('whole file')
    expect(state.opened.map((h) => h.fd)).toEqual([-1])
  })
})
