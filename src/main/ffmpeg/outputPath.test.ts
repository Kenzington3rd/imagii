import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
