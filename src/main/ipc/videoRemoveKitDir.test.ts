import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-112 — `video:removeKitDir`: a kit that was canceled or failed before it wrote
 * anything takes its empty folder with it.
 *
 * The handler is a non-recursive `rmdir` behind the same path gate the other video
 * channels use. Two properties carry it, and both are tested against real folders on
 * disk rather than a fake `fs`:
 *
 *  - It can only ever remove an EMPTY directory. A folder holding a finished file, a
 *    thumbnail, or even an empty subfolder survives whatever path the renderer sends.
 *  - Every way the removal can fail (not empty, already gone, a file instead of a folder)
 *    is a console note and a resolved promise — never an error the user is shown. The
 *    failure being reported to them is the kit's own cancel or failure.
 *
 * A path that fails the gate (relative, `..`, empty, not a string) is refused before
 * anything is touched: that one DOES reject, because it can only come from a bug.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: {},
  shell: {},
  app: { getPath: () => tmpdir() }
}))

const { registerVideoIpc } = await import('./video')
const { removeKitDir } = await import('../ffmpeg/frame')

let scratch = ''
let note: ReturnType<typeof vi.spyOn>

const call = (arg: unknown): Promise<unknown> => {
  const handler = handlers.get('video:removeKitDir')
  if (!handler) throw new Error('video:removeKitDir was not registered')
  return handler({}, arg)
}

beforeEach(() => {
  handlers.clear()
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-kitdir-'))
  registerVideoIpc()
  note = vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  note.mockRestore()
  rmSync(scratch, { recursive: true, force: true })
})

describe('video:removeKitDir — an empty kit folder goes, nothing else does', () => {
  it('is registered on the video channel', () => {
    expect(handlers.has('video:removeKitDir')).toBe(true)
  })

  it('removes an empty folder', async () => {
    const kit = path.join(scratch, 'Clip_1-kit-20261010')
    mkdirSync(kit)
    await expect(call(kit)).resolves.toBeUndefined()
    expect(existsSync(kit)).toBe(false)
    // The folder it sat in is untouched.
    expect(existsSync(scratch)).toBe(true)
  })

  it('leaves a folder with a finished file in it, and the file', async () => {
    const kit = path.join(scratch, 'Clip_1-kit-20261010')
    mkdirSync(kit)
    writeFileSync(path.join(kit, 'Clip_1_youtube.mp4'), 'x')
    await expect(call(kit)).resolves.toBeUndefined()
    expect(readdirSync(kit)).toEqual(['Clip_1_youtube.mp4'])
  })

  it('is NOT recursive: a folder whose only content is an empty subfolder survives', async () => {
    const kit = path.join(scratch, 'Clip_1-kit-20261010')
    mkdirSync(path.join(kit, 'inner'), { recursive: true })
    await expect(call(kit)).resolves.toBeUndefined()
    expect(existsSync(path.join(kit, 'inner'))).toBe(true)
  })

  it('a folder that is already gone is not an error', async () => {
    await expect(call(path.join(scratch, 'never-made'))).resolves.toBeUndefined()
  })

  it('a path that is a file, not a folder, is left alone and is not an error', async () => {
    const file = path.join(scratch, 'not-a-folder.mp4')
    writeFileSync(file, 'x')
    await expect(call(file)).resolves.toBeUndefined()
    expect(existsSync(file)).toBe(true)
  })

  it('says why a folder stayed, in the console, and nowhere else', async () => {
    const kit = path.join(scratch, 'Clip_1-kit-20261010')
    mkdirSync(kit)
    writeFileSync(path.join(kit, 'a.mp4'), 'x')
    await call(kit)
    expect(note).toHaveBeenCalledTimes(1)
    expect(String(note.mock.calls[0]?.[0])).toContain(kit)
    // A removal that worked says nothing.
    const empty = path.join(scratch, 'empty')
    mkdirSync(empty)
    note.mockClear()
    await call(empty)
    expect(note).not.toHaveBeenCalled()
  })
})

describe('video:removeKitDir — the path gate runs before anything is touched', () => {
  it.each([
    ['a relative path', 'Clip_1-kit-20261010'],
    ['a path that climbs out with ..', `${tmpdir()}${path.sep}..${path.sep}x`],
    ['an empty string', ''],
    ['a number', 42],
    ['nothing', undefined],
    ['an object', { path: '/tmp/x' }]
  ])('refuses %s', async (_label, bad) => {
    await expect(call(bad)).rejects.toThrow()
  })

  it('a refused path leaves a real empty folder where it was', async () => {
    const kit = path.join(scratch, 'Clip_1-kit-20261010')
    mkdirSync(kit)
    // Same folder, spelled with a climbing segment (not path.join: it would tidy the segment
    // away): refused, so still there.
    await expect(call(`${kit}${path.sep}..${path.sep}Clip_1-kit-20261010`)).rejects.toThrow()
    expect(existsSync(kit)).toBe(true)
  })
})

describe('removeKitDir (the function)', () => {
  it('requires a path', async () => {
    await expect(removeKitDir('')).rejects.toThrow()
  })
})
