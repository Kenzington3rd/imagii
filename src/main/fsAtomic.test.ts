import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-139 (1) - `writeFileAtomic`: a file the person chose is the OLD file until the NEW one is whole.
 *
 * `writeFile(chosen, bytes)` truncates the chosen file first, so a write that fails after it began (a full or removed drive, a crash)
 * leaves neither the old project nor the new one: executed on a tmpfs, ENOSPC left a 2,097,152-byte unparseable file where the person's
 * project had been. The helper writes a unique tmp beside the target and renames it over, so the target is never open for writing.
 *
 * The failures are a disk's, so they are injected into the REAL `node:fs/promises` (everything else in it stays real): a write that puts
 * half of its bytes on disk and then fails, a rename that is refused, a cleanup that is refused, a drive that cannot fsync. The real
 * handlers are driven through the same helper in `projectSave.test.ts`, `image.test.ts`, `captionsSaveSrt.test.ts` and `moodboard.test.ts`.
 */
const faults = vi.hoisted(() => ({
  /** The next write(s) put the first half on disk and then fail with this errno. */
  writeThenFail: null as string | null,
  /** The next rename(s) fail with this errno. */
  renameFails: null as string | null,
  /** Every unlink fails with this errno. */
  unlinkFails: null as string | null,
  /** Every open() fails with this errno (the fsync is the only open the helper makes). */
  openFails: null as string | null,
  /** Every path a write was aimed at, in order. */
  written: [] as string[],
  /** Every pair a rename was asked for, in order. */
  renamed: [] as Array<[string, string]>
}))

const errno = (code: string, syscall: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: simulated, ${syscall}`), { code })

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    writeFile: async (file: string, data: string | Buffer, ...rest: unknown[]) => {
      faults.written.push(String(file))
      if (faults.writeThenFail) {
        const bytes = Buffer.from(data)
        await real.writeFile(file, bytes.subarray(0, Math.ceil(bytes.length / 2)))
        throw errno(faults.writeThenFail, 'write')
      }
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
    },
    rename: async (from: string, to: string) => {
      faults.renamed.push([String(from), String(to)])
      if (faults.renameFails) throw errno(faults.renameFails, 'rename')
      return real.rename(from, to)
    },
    unlink: async (file: string) => {
      if (faults.unlinkFails) throw errno(faults.unlinkFails, 'unlink')
      return real.unlink(file)
    },
    open: async (...a: Parameters<typeof real.open>) => {
      if (faults.openFails) throw errno(faults.openFails, 'open')
      return real.open(...a)
    }
  }
})

const { writeFileAtomic, ATOMIC_TMP } = await import('./fsAtomic')

let dir = ''
let target = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-atomic-'))
  target = path.join(dir, 'My project.imagii.json')
  faults.writeThenFail = null
  faults.renameFails = null
  faults.unlinkFails = null
  faults.openFails = null
  faults.written.length = 0
  faults.renamed.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const OLD = 'the old project, whole\n'
const BIG = 'x'.repeat(300_000)

describe('writeFileAtomic - the success path', () => {
  it('writes exactly the bytes it was given, as text', async () => {
    const text = '{"name":"café — 日本語"}\n'
    await writeFileAtomic(target, text)
    expect(readFileSync(target)).toEqual(Buffer.from(text, 'utf8'))
  })

  it('writes exactly the bytes it was given, as a buffer (every byte value, none re-encoded)', async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    await writeFileAtomic(target, bytes)
    expect(readFileSync(target).equals(bytes)).toBe(true)
  })

  it('replaces an existing file with the new bytes (a longer one, then a shorter one)', async () => {
    writeFileSync(target, OLD)
    await writeFileAtomic(target, BIG)
    expect(readFileSync(target, 'utf8')).toBe(BIG)
    await writeFileAtomic(target, 'short')
    expect(readFileSync(target, 'utf8')).toBe('short')
  })

  it('leaves nothing behind but the file: no tmp in the folder', async () => {
    writeFileSync(target, OLD)
    await writeFileAtomic(target, 'new')
    expect(readdirSync(dir)).toEqual([path.basename(target)])
  })

  it('an empty file is a file (zero bytes are written, not skipped)', async () => {
    writeFileSync(target, OLD)
    await writeFileAtomic(target, '')
    expect(readFileSync(target, 'utf8')).toBe('')
  })
})

describe('writeFileAtomic - the target is never opened for writing', () => {
  it('writes to a tmp in the SAME folder and renames it over the target (a rename across volumes is not atomic)', async () => {
    await writeFileAtomic(target, 'new')
    expect(faults.written).toHaveLength(1)
    const tmp = faults.written[0] as string
    expect(tmp).not.toBe(target)
    expect(path.dirname(tmp)).toBe(path.dirname(target))
    expect(path.basename(tmp)).toMatch(/\.tmp$/)
    expect(faults.renamed).toEqual([[tmp, target]])
  })

  it('every call has its own tmp name (two saves in flight cannot share one)', async () => {
    await Promise.all([writeFileAtomic(target, 'a'), writeFileAtomic(target, 'b')])
    expect(faults.written).toHaveLength(2)
    expect(new Set(faults.written).size).toBe(2)
  })

  it('two saves in flight over one target leave one of them WHOLE, never a mixture', async () => {
    const a = 'A'.repeat(2_000_000)
    const b = 'B'.repeat(50_000)
    await Promise.all([writeFileAtomic(target, a), writeFileAtomic(target, b)])
    const now = readFileSync(target, 'utf8')
    expect([a, b]).toContain(now)
    expect(readdirSync(dir)).toEqual([path.basename(target)])
  })
})

describe('writeFileAtomic - a write that fails after it began leaves the old file whole (T-139 (1))', () => {
  it('a disk that fills part-way: the old bytes are untouched, no tmp is left, and the error is the original one', async () => {
    writeFileSync(target, OLD)
    faults.writeThenFail = 'ENOSPC'
    const err = await writeFileAtomic(target, BIG).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as NodeJS.ErrnoException).code).toBe('ENOSPC')
    expect((err as Error).message).toBe('ENOSPC: simulated, write')
    expect(readFileSync(target, 'utf8')).toBe(OLD)
    expect(readdirSync(dir)).toEqual([path.basename(target)])
  })

  it('a first save (no old file) that fails leaves no file at all, not a half one', async () => {
    faults.writeThenFail = 'ENOSPC'
    await expect(writeFileAtomic(target, BIG)).rejects.toThrow('ENOSPC')
    expect(readdirSync(dir)).toEqual([])
  })

  it('a rename that is refused (the target held open by another app): the old bytes stand and the tmp is removed', async () => {
    writeFileSync(target, OLD)
    faults.renameFails = 'EPERM'
    const err = await writeFileAtomic(target, 'new').then(() => null, (e: unknown) => e)
    expect((err as NodeJS.ErrnoException).code).toBe('EPERM')
    expect(readFileSync(target, 'utf8')).toBe(OLD)
    expect(readdirSync(dir)).toEqual([path.basename(target)])
  })

  it('a cleanup that is itself refused does not hide the error that mattered', async () => {
    writeFileSync(target, OLD)
    faults.writeThenFail = 'ENOSPC'
    faults.unlinkFails = 'EBUSY'
    const err = await writeFileAtomic(target, BIG).then(() => null, (e: unknown) => e)
    expect((err as NodeJS.ErrnoException).code).toBe('ENOSPC')
    expect(readFileSync(target, 'utf8')).toBe(OLD)
  })

  it('a folder that is not there refuses with the OS error and writes nothing', async () => {
    const gone = path.join(dir, 'no-such-folder', 'x.json')
    const err = await writeFileAtomic(gone, 'new').then(() => null, (e: unknown) => e)
    expect((err as NodeJS.ErrnoException).code).toBe('ENOENT')
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('writeFileAtomic - the flush to disk is best effort', () => {
  it('a drive that cannot fsync still gets a whole file (the sync is an extra, not a gate)', async () => {
    writeFileSync(target, OLD)
    faults.openFails = 'EPERM'
    await writeFileAtomic(target, 'new')
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readdirSync(dir)).toEqual([path.basename(target)])
  })
})

/**
 * T-139 (1) round 88b - the e2e helpers that list a folder a converted site writes into (`savedNames`, the Reference Export's poll) must not read the
 * writer's tmp as a saved file: a poll on a COUNT sees 1 while that one is the tmp, then reads every name (partial, or gone by the rename). They filter on
 * `ATOMIC_TMP` (via `tests/e2e/atomicTmp.ts`), so this pins the filter to the name the writer REALLY makes (the path the real `writeFile` is handed), and to
 * nothing that a person or the app saves under a final name.
 */
describe('ATOMIC_TMP is the writer\'s own tmp name and no final name', () => {
  it.each(['My project.imagii.json', 'imagii-1730000000000.png', 'imagii-emote-28-1.png', 'once.srt', 'a.b.c', '.hidden'])(
    'a tmp made for %s matches, and is beside it',
    async (name) => {
      faults.written.length = 0
      const file = path.join(dir, name)
      await writeFileAtomic(file, 'x')
      const tmp = faults.written[0] as string
      expect(path.basename(tmp), 'the name the e2e helpers must ignore').toMatch(ATOMIC_TMP)
      expect(path.dirname(tmp)).toBe(dir)
      expect(path.basename(tmp).startsWith(name), 'it is named after its target, so a stray one can be traced').toBe(true)
    }
  )

  it.each([
    'imagii-1730000000000.png',
    'imagii-variant-warm-1730000000000.png',
    'My project.imagii.json',
    'Mid_captions.srt',
    'once.srt',
    'abcdef12.png',
    'board.json',
    'autosave.json',
    'autosave.prev.json',
    'model.bin.partial',
    'notes.tmp',
    'x.deadbeef.txt'
  ])('the final name %s does not match', (name) => {
    expect(name).not.toMatch(ATOMIC_TMP)
  })

  it('a final name that merely ends the way a tmp does (eight hex characters, then .tmp) is the one thing it cannot tell apart, and says so', () => {
    // The price of a name-only filter: a file the PERSON called "x.deadbeef.tmp" would be hidden from a test's listing. Nothing in the app saves one.
    expect('x.deadbeef.tmp').toMatch(ATOMIC_TMP)
  })
})

