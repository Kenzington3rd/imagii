import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureOutputDir, isExistingFolder, nextFreePath, outputFolderRefusal } from './outputPath'
import { makeKitDir } from './frame'
import { localDate } from '../../shared/filename'

/**
 * T-106 — the one place a runner turns the name it wants into a name it may
 * write. Real files in a real folder (the helper is a walk over `lstat`; a mock
 * would test the mock). Layer 5 ("an export never replaces a file that is
 * already there") proves each runner uses it and that ffmpeg really writes
 * beside the old file.
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-free-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const touch = (...names: string[]): void => {
  for (const name of names) writeFileSync(path.join(dir, name), 'earlier export')
}
const base = (p: string): string => path.basename(p)

describe('nextFreePath', () => {
  it('a name nothing is using is returned as it was given', async () => {
    const wanted = path.join(dir, 'clip.mp4')
    expect(await nextFreePath(wanted)).toBe(wanted)
  })

  it('a name that is taken becomes "name (2).ext", in the same folder', async () => {
    touch('clip.mp4')
    const got = await nextFreePath(path.join(dir, 'clip.mp4'))
    expect(got).toBe(path.join(dir, 'clip (2).mp4'))
  })

  it('walks past every copy that exists: 1, 2, 3 taken gives 4', async () => {
    touch('clip.mp4', 'clip (2).mp4', 'clip (3).mp4')
    expect(base(await nextFreePath(path.join(dir, 'clip.mp4')))).toBe('clip (4).mp4')
  })

  it('fills the first gap before it uses a higher number', async () => {
    touch('clip.mp4', 'clip (2).mp4', 'clip (4).mp4', 'clip (5).mp4')
    expect(base(await nextFreePath(path.join(dir, 'clip.mp4')))).toBe('clip (3).mp4')
  })

  it('a missing original with copies still there gets the original name back', async () => {
    touch('clip (2).mp4')
    expect(base(await nextFreePath(path.join(dir, 'clip.mp4')))).toBe('clip.mp4')
  })

  it('counts past 9 into two digits, and past 99 into three', async () => {
    touch('clip.mp4', ...Array.from({ length: 10 }, (_, i) => `clip (${i + 2}).mp4`))
    expect(base(await nextFreePath(path.join(dir, 'clip.mp4')))).toBe('clip (12).mp4')
    touch(...Array.from({ length: 90 }, (_, i) => `clip (${i + 12}).mp4`))
    expect(base(await nextFreePath(path.join(dir, 'clip.mp4')))).toBe('clip (102).mp4')
  })

  it('numbers before the extension, and keeps the dots in a name', async () => {
    touch('my.clip.v2.mp4', 'a.b.gif')
    expect(base(await nextFreePath(path.join(dir, 'my.clip.v2.mp4')))).toBe('my.clip.v2 (2).mp4')
    expect(base(await nextFreePath(path.join(dir, 'a.b.gif')))).toBe('a.b (2).gif')
  })

  it('a name with no extension is numbered at the end', async () => {
    touch('README')
    expect(base(await nextFreePath(path.join(dir, 'README')))).toBe('README (2)')
  })

  it('a name that already ends in a number is numbered again, not renumbered', async () => {
    touch('clip (2).mp4')
    expect(base(await nextFreePath(path.join(dir, 'clip (2).mp4')))).toBe('clip (2) (2).mp4')
  })

  it('a folder at the path counts as taken, and so does a link that points nowhere', async () => {
    mkdirSync(path.join(dir, 'a.mp4'))
    expect(base(await nextFreePath(path.join(dir, 'a.mp4')))).toBe('a (2).mp4')
    try {
      symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'b.mp4'))
    } catch {
      return // Windows without the privilege to link: the claim cannot be made here.
    }
    expect(base(await nextFreePath(path.join(dir, 'b.mp4')))).toBe('b (2).mp4')
  })

  it('a folder that does not exist yet is not an error: the file is free, and ffmpeg says the rest', async () => {
    const wanted = path.join(dir, 'not-made', 'clip.mp4')
    expect(await nextFreePath(wanted)).toBe(wanted)
  })

  it('does not create or touch anything', async () => {
    touch('clip.mp4')
    await nextFreePath(path.join(dir, 'clip.mp4'))
    expect(existsSync(path.join(dir, 'clip (2).mp4'))).toBe(false)
  })

  it('refuses any path whose parent is a file, rather than guessing', async () => {
    touch('plain')
    await expect(nextFreePath(path.join(dir, 'plain', 'clip.mp4'))).rejects.toThrow(/ENOTDIR/)
  })
})

describe('nextFreePath for a folder', () => {
  it('numbers the whole name, whatever dots it holds', async () => {
    mkdirSync(path.join(dir, 'Clip 1.5-kit-20261010'))
    const got = await nextFreePath(path.join(dir, 'Clip 1.5-kit-20261010'), { directory: true })
    expect(base(got)).toBe('Clip 1.5-kit-20261010 (2)')
  })
})

describe('makeKitDir — a second kit does not share the first one\'s folder (T-106)', () => {
  // T-117: the person's calendar day (the export panel's {date}), not UTC's.
  const stamp = localDate().replace(/-/g, '')

  it('the first kit gets the folder it always did', async () => {
    const kit = await makeKitDir(dir, 'Clip 1')
    expect(kit).toBe(path.join(dir, `Clip_1-kit-${stamp}`))
    expect(existsSync(kit)).toBe(true)
  })

  it('the next kit of the same clip on the same day gets its own, and the first is untouched', async () => {
    const first = await makeKitDir(dir, 'Clip 1')
    writeFileSync(path.join(first, 'Clip_1_youtube.mp4'), 'the first kit')
    const second = await makeKitDir(dir, 'Clip 1')
    const third = await makeKitDir(dir, 'Clip 1')
    expect([base(second), base(third)]).toEqual([`Clip_1-kit-${stamp} (2)`, `Clip_1-kit-${stamp} (3)`])
    expect(existsSync(path.join(second, 'Clip_1_youtube.mp4'))).toBe(false)
    expect(existsSync(path.join(first, 'Clip_1_youtube.mp4'))).toBe(true)
  })

  it('makes the parent folder too, as it did', async () => {
    const kit = await makeKitDir(path.join(dir, 'not', 'made', 'yet'), 'Clip 1')
    expect(existsSync(kit)).toBe(true)
  })

  // T-117 (3): the folder was stamped from the UTC ISO string, so a kit made at 9:23 pm in Pacific time
  // (04:23 the next day in UTC) landed in tomorrow's folder while the export panel's {date} said today.
  describe('the date in the folder is the date on the clock (T-117)', () => {
    const was = process.env.TZ
    afterEach(() => {
      vi.useRealTimers()
      if (was === undefined) delete process.env.TZ
      else process.env.TZ = was
    })

    it('9:23 pm on the 10th in Pacific time is the 10th, though it is the 11th in UTC', async () => {
      process.env.TZ = 'America/Los_Angeles'
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-11T04:23:02Z'))
      const kit = await makeKitDir(dir, 'Clip 1')
      expect(base(kit)).toBe('Clip_1-kit-20261010')
    })

    it('and 9:30 am on the 11th in Auckland is the 11th, though it is still the 10th in UTC', async () => {
      process.env.TZ = 'Pacific/Auckland'
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-10T20:30:05Z'))
      const kit = await makeKitDir(dir, 'Clip 1')
      expect(base(kit)).toBe('Clip_1-kit-20261011')
    })

    it('a single-digit month and day are zero-padded, so the folders sort by name', async () => {
      process.env.TZ = 'America/Los_Angeles'
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-01-02T08:04:05Z'))
      expect(base(await makeKitDir(dir, 'Clip 1'))).toMatch(/^Clip_1-kit-20260102$/)
    })
  })
})

/**
 * T-125 (10) - the folder an output is written to.
 *
 * A remembered folder that was deleted (or lives on a drive that is unplugged) is still a well-formed path; every runner passed
 * it to ffmpeg, which could not open its output, and the failure read "A file imagii needs isn't there" - after a Compile had burned
 * its whole segment encode. The folder is made (recursively) before anything is encoded; if it cannot be made, the person is told
 * WHICH folder, in a finished sentence `userFacingError` lets stand.
 */
describe('isExistingFolder', () => {
  it('is true for a folder, false for a file, a missing path, a dangling link and a non-string', async () => {
    writeFileSync(path.join(dir, 'file.txt'), 'x')
    mkdirSync(path.join(dir, 'sub'))
    symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'dangling'))
    expect(await isExistingFolder(dir)).toBe(true)
    expect(await isExistingFolder(path.join(dir, 'sub'))).toBe(true)
    expect(await isExistingFolder(path.join(dir, 'file.txt'))).toBe(false)
    expect(await isExistingFolder(path.join(dir, 'missing'))).toBe(false)
    expect(await isExistingFolder(path.join(dir, 'dangling'))).toBe(false)
    expect(await isExistingFolder(undefined)).toBe(false)
    expect(await isExistingFolder(42)).toBe(false)
    expect(await isExistingFolder('')).toBe(false)
  })

  it('is true for a link to a folder (a folder reached through a junction is a folder)', async () => {
    mkdirSync(path.join(dir, 'real'))
    symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'))
    expect(await isExistingFolder(path.join(dir, 'link'))).toBe(true)
  })
})

describe('ensureOutputDir', () => {
  it('makes a folder that is not there, and every missing parent of it', async () => {
    const target = path.join(dir, 'deleted', 'last', 'week')
    await ensureOutputDir(target)
    expect(existsSync(target)).toBe(true)
  })

  it('leaves a folder that is there, and what is in it, exactly as it was', async () => {
    touch('earlier.mp4')
    await ensureOutputDir(dir)
    expect(existsSync(path.join(dir, 'earlier.mp4'))).toBe(true)
  })

  it('a folder that cannot be made is refused in a sentence that NAMES it, and the sentence is a finished one', async () => {
    // A FILE where a parent should be: mkdir fails the way an unplugged drive's path does.
    writeFileSync(path.join(dir, 'blocker'), 'x')
    const target = path.join(dir, 'blocker', 'Clips')
    const err = await ensureOutputDir(target).then(() => null, (e: Error) => e)
    expect(err?.message).toBe(outputFolderRefusal('Clips'))
    expect(err?.message).toContain('"Clips"')
    // No path, no errno, no channel: it reaches the person as written (userFacingError tier 2).
    expect(err?.message).not.toContain(dir)
    expect(err?.message).not.toMatch(/ENOTDIR|ENOENT|EPERM|EACCES|mkdir/)
    expect(err?.message.length ?? 0).toBeLessThanOrEqual(240)
    expect(err?.message).toMatch(/[.!?]$/)
  })

  it('names a long folder by its first 60 characters, so the sentence stays one line', () => {
    const long = 'x'.repeat(200)
    expect(outputFolderRefusal(long).length).toBeLessThanOrEqual(240)
    expect(outputFolderRefusal(long)).toContain(`"${'x'.repeat(60)}…"`)
  })
})

// T-183 (2): a name over a file system's 255 is fitted where the name is chosen, so what a runner is handed (and the toast and Show in folder report) can be written.
describe('nextFreePath - names at and over the file system limit (T-183 (2))', () => {
  const bytes = (p: string): number => Buffer.byteLength(path.basename(p), 'utf8')
  const stemOf = (n: number, c = 'a'): string => c.repeat(n)

  it('a free 255-character name is returned exactly as given', async () => {
    const wanted = path.join(dir, `${stemOf(251)}.mp4`)
    expect(await nextFreePath(wanted)).toBe(wanted)
  })

  it('a taken 255-character name returns a fitted " (2)" that is 255 bytes and can be written; then " (3)"', async () => {
    touch(`${stemOf(251)}.mp4`)
    const second = await nextFreePath(path.join(dir, `${stemOf(251)}.mp4`))
    expect(base(second)).toBe(`${stemOf(247)} (2).mp4`)
    expect(bytes(second)).toBe(255)
    writeFileSync(second, 'x')
    const third = await nextFreePath(path.join(dir, `${stemOf(251)}.mp4`))
    expect(base(third)).toBe(`${stemOf(247)} (3).mp4`)
    // A two-digit copy number has a longer tail, so the cut grows with it: " (10).mp4" leaves 246 characters of the name.
    for (let n = 3; n <= 9; n++) touch(`${stemOf(247)} (${n}).mp4`)
    const ten = await nextFreePath(path.join(dir, `${stemOf(251)}.mp4`))
    expect(base(ten)).toBe(`${stemOf(246)} (10).mp4`)
    expect(bytes(ten)).toBe(255)
  })

  it('a wanted name OVER 255 is fitted, and the name that comes back is writable', async () => {
    const got = await nextFreePath(path.join(dir, `${stemOf(300)}.mp4`))
    expect(base(got)).toBe(`${stemOf(251)}.mp4`)
    writeFileSync(got, 'x')
    expect(existsSync(got)).toBe(true)
    // And the next one is a " (2)" of the fitted name.
    expect(base(await nextFreePath(path.join(dir, `${stemOf(300)}.mp4`)))).toBe(`${stemOf(247)} (2).mp4`)
  })

  it('a multi-byte name is cut to whole characters and held to 255 BYTES', async () => {
    const wanted = path.join(dir, `${'\u00e9'.repeat(150)}.mp4`)
    const got = await nextFreePath(wanted)
    expect(bytes(got)).toBeLessThanOrEqual(255)
    expect(base(got)).toBe(`${'\u00e9'.repeat(125)}.mp4`)
    writeFileSync(got, 'x')
    const next = await nextFreePath(wanted)
    expect(bytes(next)).toBeLessThanOrEqual(255)
    expect(next).not.toBe(got)
  })

  it('a name that fits is not touched, taken or not (the " (2)" of a short name is what it always was)', async () => {
    touch('short.mp4')
    expect(base(await nextFreePath(path.join(dir, 'short.mp4')))).toBe('short (2).mp4')
  })

  it('a folder name over 255 is fitted (extension-less: the whole name is the stem), and its " (2)" too', async () => {
    const wanted = path.join(dir, `${stemOf(300)}.5-kit-20261111`)
    const first = await nextFreePath(wanted, { directory: true })
    expect(bytes(first)).toBe(255)
    mkdirSync(first)
    const second = await nextFreePath(wanted, { directory: true })
    expect(bytes(second)).toBe(255)
    expect(base(second).endsWith(' (2)')).toBe(true)
    mkdirSync(second)
    expect(existsSync(second)).toBe(true)
  })

  it('the Clip Kit folder of a very long clip name is a folder the disk can make', async () => {
    const kit = await makeKitDir(dir, 'k'.repeat(300))
    expect(bytes(kit)).toBeLessThanOrEqual(255)
    expect(base(kit).endsWith(`-kit-${localDate().replace(/-/g, '')}`)).toBe(true)
    expect(existsSync(kit)).toBe(true)
  })
})

/**
 * T-184 (2) - the drive's unit is named in ONE place and every place main fits a name uses it.
 *
 * `NAME_UNIT` is `'utf16'` on Windows (NTFS holds 255 UTF-16 units: a kanji is one) and `'utf8'` elsewhere (ext4 holds 255 bytes). It is read when the module loads, so the
 * platform is mocked and the module imported afresh. The Windows unit cannot be exercised against a real folder on this host (a 200-kanji name is 600 bytes, which ext4
 * refuses at `lstat`), so the integration half mocks the file system's `lstat` and asks `nextFreePath` what name it would use; Layer 5 holds the ASCII names on real files.
 */
describe('NAME_UNIT - the unit the drive counts a name in (T-184 (2))', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
  const KANJI = '漢'

  async function loadOn(platform: string): Promise<typeof import('./outputPath')> {
    Object.defineProperty(process, 'platform', { ...realPlatform, value: platform })
    vi.resetModules()
    return import('./outputPath')
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
    vi.doUnmock('node:fs/promises')
    vi.resetModules()
  })

  it("is 'utf16' under a mocked win32 and 'utf8' everywhere else", async () => {
    expect((await loadOn('win32')).NAME_UNIT).toBe('utf16')
    expect((await loadOn('linux')).NAME_UNIT).toBe('utf8')
    expect((await loadOn('darwin')).NAME_UNIT).toBe('utf8')
  })

  it('nextFreePath follows it: a 200-kanji name is kept whole on win32 and cut to whole characters on linux', async () => {
    vi.doMock('node:fs/promises', () => ({
      lstat: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      mkdir: async () => undefined,
      stat: async () => ({ isDirectory: () => true })
    }))
    const wanted = path.join('/out', `${KANJI.repeat(200)}.mp4`)
    expect(await (await loadOn('win32')).nextFreePath(wanted)).toBe(wanted)
    expect(await (await loadOn('linux')).nextFreePath(wanted)).toBe(path.join('/out', `${KANJI.repeat(83)}.mp4`))
  })

  it('every place main fits a name passes it: no fitFileName, nameWithTail or shiftedSrtPath call in src/main is without NAME_UNIT', () => {
    const mainDir = path.join(__dirname, '..')
    const files: string[] = []
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full)
      }
    }
    walk(mainDir)
    let sites = 0
    const bare: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\b(fitFileName|nameWithTail|shiftedSrtPath)\(/g)) {
        // The arguments, to the matching close paren (strings and template literals skipped, so a "(9999)" in one does not count).
        let depth = 1
        let i = (m.index ?? 0) + m[0].length
        let quote: string | null = null
        const start = i
        for (; i < text.length && depth > 0; i++) {
          const c = text[i]
          if (quote) {
            if (c === '\\') i++
            else if (c === quote) quote = null
          } else if (c === "'" || c === '"' || c === '`') quote = c
          else if (c === '(') depth++
          else if (c === ')') depth--
        }
        const args = text.slice(start, i - 1)
        // The definitions and the doc comments are not calls: a call has no `function ` / `export` before it and is not inside a comment line.
        const lineStart = text.lastIndexOf('\n', m.index ?? 0) + 1
        const line = text.slice(lineStart, text.indexOf('\n', m.index ?? 0))
        if (/^\s*(\*|\/\/|\/\*)/.test(line) || /function\s+\w+\($/.test(text.slice(lineStart, (m.index ?? 0) + m[0].length))) continue
        sites++
        if (!/\bNAME_UNIT\b/.test(args)) bare.push(`${path.relative(mainDir, file)}: ${m[1]}(${args.slice(0, 40)}`)
      }
    }
    expect(bare).toEqual([])
    // The fifteen call sites there are in main today: a rename that made the scan find none must not pass.
    expect(sites).toBeGreaterThanOrEqual(15)
  })
})
