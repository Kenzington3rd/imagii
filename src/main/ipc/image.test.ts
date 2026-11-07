import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// T-91: the Stream Graphics save handlers, driven for real (a captured
// ipcMain.handle, Electron's dialogs stubbed, the files written to a tempdir).
// "Saved" must mean "bytes are on disk", a canceled dialog must write nothing
// and say so with null, and the emote pack must be ONE dialog for three files.
const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
let saveAnswer: { canceled: boolean; filePath?: string } = { canceled: true }
let openAnswer: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
const showSaveDialog = vi.fn(async (_w: unknown, _o: { defaultPath?: string; filters?: unknown[] }) => saveAnswer)
const showOpenDialog = vi.fn(async (_w: unknown, _o: { title?: string; properties?: string[] }) => openAnswer)

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, req: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {
    showSaveDialog: (...a: Parameters<typeof showSaveDialog>) => showSaveDialog(...a),
    showOpenDialog: (...a: Parameters<typeof showOpenDialog>) => showOpenDialog(...a)
  },
  BrowserWindow: { getFocusedWindow: () => ({ id: 1 }), getAllWindows: () => [{ id: 1 }] }
}))

// T-139 (1): the failures a disk makes, injected into the real `node:fs/promises` (everything else in it stays real). Off unless a test turns one on.
const faults = vi.hoisted(() => ({
  /** A write to a path this accepts puts the first half of its bytes on disk, then fails with ENOSPC. */
  failWhen: null as ((file: string) => boolean) | null
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    writeFile: async (file: string, data: string | Buffer, ...rest: unknown[]) => {
      if (faults.failWhen?.(String(file))) {
        const bytes = Buffer.from(data)
        await real.writeFile(file, bytes.subarray(0, Math.ceil(bytes.length / 2)))
        throw Object.assign(new Error('ENOSPC: simulated, write'), { code: 'ENOSPC' })
      }
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
    }
  }
})

const { registerImageIpc } = await import('./image')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7])
const pngUrl = (b = PNG): string => `data:image/png;base64,${b.toString('base64')}`
const jpgUrl = (b = JPG): string => `data:image/jpeg;base64,${b.toString('base64')}`

async function call(channel: string, req: unknown): Promise<unknown> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`${channel} was not registered`)
  return h({}, req)
}

let dir = ''
beforeEach(() => {
  faults.failWhen = null
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-imgsave-'))
  handlers.clear()
  showSaveDialog.mockClear()
  showOpenDialog.mockClear()
  saveAnswer = { canceled: true }
  openAnswer = { canceled: true, filePaths: [] }
  registerImageIpc()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('image:save', () => {
  it('writes the picture where the user said and returns that path', async () => {
    const target = path.join(dir, 'thumb.png')
    saveAnswer = { canceled: false, filePath: target }
    await expect(
      call('image:save', { dataUrl: pngUrl(), defaultName: 'imagii-1.png', format: 'png' })
    ).resolves.toBe(target)
    expect(readFileSync(target).equals(PNG)).toBe(true)
    expect(showSaveDialog.mock.calls[0]?.[1]?.defaultPath).toBe('imagii-1.png')
  })

  it('a canceled dialog is null and writes nothing', async () => {
    await expect(
      call('image:save', { dataUrl: pngUrl(), defaultName: 'x.png', format: 'png' })
    ).resolves.toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a hostile request before any dialog opens', async () => {
    const bad: unknown[] = [
      { dataUrl: 'data:image/png;base64,AAAA', defaultName: 'x.png', format: 'png' },
      { dataUrl: jpgUrl(), defaultName: 'x.png', format: 'png' },
      { dataUrl: pngUrl(), defaultName: 'x.png', format: 'svg' },
      null
    ]
    for (const req of bad) await expect(call('image:save', req)).rejects.toThrow()
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('a JPEG is saved as a JPEG', async () => {
    const target = path.join(dir, 'a.jpg')
    saveAnswer = { canceled: false, filePath: target }
    await call('image:save', { dataUrl: jpgUrl(), defaultName: 'a.jpg', format: 'jpg' })
    expect(readFileSync(target).equals(JPG)).toBe(true)
  })
})

describe('image:saveMany', () => {
  const files = [28, 56, 112].map((n) => ({ name: `imagii-emote-${n}-1.png`, dataUrl: pngUrl(Buffer.concat([PNG, Buffer.from([n])])) }))

  it('asks for ONE folder and writes every file into it', async () => {
    openAnswer = { canceled: false, filePaths: [dir] }
    await expect(
      call('image:saveMany', { title: 'Save the emote pack', files })
    ).resolves.toEqual({ dir, count: 3 })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(showOpenDialog.mock.calls[0]?.[1]?.title).toBe('Save the emote pack')
    expect(showOpenDialog.mock.calls[0]?.[1]?.properties).toEqual(['openDirectory', 'createDirectory'])
    expect(readdirSync(dir).sort()).toEqual(files.map((f) => f.name).sort())
  })

  it('a canceled folder picker writes nothing and returns null', async () => {
    await expect(call('image:saveMany', { title: 't', files })).resolves.toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('one bad file refuses the whole save, before the picker and before any write', async () => {
    openAnswer = { canceled: false, filePaths: [dir] }
    const poisoned = [...files, { name: 'evil.png', dataUrl: 'data:image/png;base64,AAAA' }]
    await expect(call('image:saveMany', { title: 't', files: poisoned })).rejects.toThrow()
    expect(showOpenDialog).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses an unsupported extension, duplicate names and an empty or oversize list', async () => {
    openAnswer = { canceled: false, filePaths: [dir] }
    const one = files[0] as { name: string; dataUrl: string }
    await expect(call('image:saveMany', { title: 't', files: [{ ...one, name: 'a.gif' }] })).rejects.toThrow()
    await expect(call('image:saveMany', { title: 't', files: [one, one] })).rejects.toThrow(/distinct/)
    await expect(call('image:saveMany', { title: 't', files: [] })).rejects.toThrow()
    const many = Array.from({ length: 17 }, (_, i) => ({ ...one, name: `f${i}.png` }))
    await expect(call('image:saveMany', { title: 't', files: many })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })

  it('a name that climbs out of the folder lands inside it', async () => {
    openAnswer = { canceled: false, filePaths: [dir] }
    const one = files[0] as { name: string; dataUrl: string }
    await call('image:saveMany', { title: 't', files: [{ ...one, name: '../../escape.png' }] })
    expect(readdirSync(dir)).toEqual(['escape.png'])
  })
})

/**
 * T-139 (1) - Save image / the emote pack over files the person already has: each is the old file until the new one is whole.
 *
 * Both handlers wrote with `writeFile(chosen, bytes)`, which truncates the file first: a full drive part-way through left a stub PNG in place of the
 * picture the person was overwriting. They write through `writeFileAtomic` now. The failing write is injected into the real `node:fs/promises`.
 */
describe('image export over an existing file (T-139 (1))', () => {
  const OLD_PNG = Buffer.concat([PNG, Buffer.from('the old picture, whole')])
  const NEW_PNG = Buffer.concat([PNG, Buffer.alloc(40_000, 7)])

  it('image:save - a disk that fills part-way leaves the old picture byte-identical and no tmp beside it', async () => {
    const target = path.join(dir, 'thumb.png')
    writeFileSync(target, OLD_PNG)
    saveAnswer = { canceled: false, filePath: target }
    faults.failWhen = () => true
    await expect(call('image:save', { dataUrl: pngUrl(NEW_PNG), defaultName: 'thumb.png', format: 'png' })).rejects.toThrow('ENOSPC')
    expect(readFileSync(target).equals(OLD_PNG)).toBe(true)
    expect(readdirSync(dir)).toEqual(['thumb.png'])
  })

  it('image:save - a FIRST save that fails leaves no file at all', async () => {
    const target = path.join(dir, 'new.png')
    saveAnswer = { canceled: false, filePath: target }
    faults.failWhen = () => true
    await expect(call('image:save', { dataUrl: pngUrl(NEW_PNG), defaultName: 'new.png', format: 'png' })).rejects.toThrow('ENOSPC')
    expect(readdirSync(dir)).toEqual([])
  })

  it('image:save - a save that succeeds replaces the old picture with exactly the new bytes, and leaves no tmp', async () => {
    const target = path.join(dir, 'thumb.png')
    writeFileSync(target, OLD_PNG)
    saveAnswer = { canceled: false, filePath: target }
    await call('image:save', { dataUrl: pngUrl(NEW_PNG), defaultName: 'thumb.png', format: 'png' })
    expect(readFileSync(target).equals(NEW_PNG)).toBe(true)
    expect(readdirSync(dir)).toEqual(['thumb.png'])
  })

  it('image:saveMany - the file that fails keeps its old bytes, the ones before it are whole, and no tmp is left', async () => {
    const files = [28, 56, 112].map((n) => ({ name: `imagii-emote-${n}-1.png`, dataUrl: pngUrl(Buffer.concat([PNG, Buffer.alloc(30_000, n)])) }))
    const old56 = Buffer.concat([PNG, Buffer.from('the old 56 px emote')])
    writeFileSync(path.join(dir, 'imagii-emote-56-1.png'), old56)
    openAnswer = { canceled: false, filePaths: [dir] }
    faults.failWhen = (file) => path.basename(file).startsWith('imagii-emote-56-1.png')
    await expect(call('image:saveMany', { title: 'Save the emote pack', files })).rejects.toThrow('ENOSPC')
    expect(readFileSync(path.join(dir, 'imagii-emote-56-1.png')).equals(old56), 'the failing file is still the old one').toBe(true)
    expect(readFileSync(path.join(dir, 'imagii-emote-28-1.png')).equals(Buffer.concat([PNG, Buffer.alloc(30_000, 28)])), 'the one before it is whole').toBe(true)
    expect(readdirSync(dir).sort(), 'the 112 px one was never reached, and nothing else is in the folder').toEqual(['imagii-emote-28-1.png', 'imagii-emote-56-1.png'])
  })

  it('image:saveMany - a pack that succeeds over an old pack replaces every file and leaves no tmp', async () => {
    const files = [28, 56, 112].map((n) => ({ name: `imagii-emote-${n}-1.png`, dataUrl: pngUrl(Buffer.concat([PNG, Buffer.alloc(100, n)])) }))
    for (const f of files) writeFileSync(path.join(dir, f.name), 'old')
    openAnswer = { canceled: false, filePaths: [dir] }
    await expect(call('image:saveMany', { title: 't', files })).resolves.toEqual({ dir, count: 3 })
    for (const n of [28, 56, 112]) {
      expect(readFileSync(path.join(dir, `imagii-emote-${n}-1.png`)).equals(Buffer.concat([PNG, Buffer.alloc(100, n)]))).toBe(true)
    }
    expect(readdirSync(dir)).toHaveLength(3)
  })
})
