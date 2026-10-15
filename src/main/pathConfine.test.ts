import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { isOutsideFolder } from './pathConfine'

/**
 * T-117 (2) - "outside the folder" means a real parent segment, not a name that starts with two dots.
 *
 * `captions:saveSrt`, `captions:writeKitSrt` and the mood-board thumbnail gate each asked
 * `rel.startsWith('..')` of `path.relative(root, target)`. That is also true of `..intro.srt`, a file
 * INSIDE the folder, so the app refused its own transcript. The handlers' tests drive it end to end
 * (captionsSaveSrt.test.ts, captionsWriteKitSrt.test.ts, moodboard.test.ts); this holds the rule on
 * its own, under both path flavors (the shipped build is Windows).
 */
describe('isOutsideFolder (posix)', () => {
  const root = '/data/captions'

  it.each([
    '/data/captions/stream.srt',
    '/data/captions/sub/stream.srt',
    '/data/captions/...and then-123.srt',
    '/data/captions/..intro.srt',
    '/data/captions/.. .srt',
    '/data/captions/....srt',
    '/data/captions/..old stream/clip.srt',
    '/data/captions/sub/..x',
    '/data/captions/' // trailing separator: the folder itself
  ])('%s is inside', (target) => {
    expect(isOutsideFolder(root, target)).toBe(false)
  })

  it('the folder itself is not outside (the relative path is empty)', () => {
    expect(path.relative(root, root)).toBe('')
    expect(isOutsideFolder(root, root)).toBe(false)
  })

  it.each([
    ['the parent itself', '/data'],
    ['a file next to the folder', '/data/stream.srt'],
    ['a sibling that starts with the folder\'s name', '/data/captions-evil/x.srt'],
    ['a climb written out', '/data/captions/../stream.srt'],
    ['a climb to a ..-named file', '/data/captions/../..intro.srt'],
    ['two climbs', '/data/captions/sub/../../../etc/passwd'],
    ['somewhere else entirely', '/etc/passwd'],
    ['the root of the disk', '/']
  ])('%s is outside', (_label, target) => {
    expect(isOutsideFolder(root, target)).toBe(true)
  })
})

describe('isOutsideFolder (win32)', () => {
  const w = path.win32
  const root = 'C:\\Users\\maken\\AppData\\Roaming\\imagii\\captions'

  it.each([
    `${root}\\stream.srt`,
    `${root}\\...and then-123.srt`,
    `${root}\\..intro.srt`,
    `${root}\\..old stream\\clip.srt`,
    // Windows file names do not care about case, and path.win32.relative knows it.
    'c:\\users\\MAKEN\\appdata\\roaming\\IMAGII\\Captions\\x.srt'
  ])('%s is inside', (target) => {
    expect(isOutsideFolder(root, target, w)).toBe(false)
  })

  it.each([
    ['the parent itself', 'C:\\Users\\maken\\AppData\\Roaming\\imagii'],
    ['a climb written out', `${root}\\..\\stream.srt`],
    ['a climb to a ..-named file', `${root}\\..\\..intro.srt`],
    ['another drive (the relative path is absolute)', 'D:\\captions\\stream.srt'],
    ['a UNC share', '\\\\nas\\share\\stream.srt'],
    ['a sibling that starts with the folder\'s name', `${root}-evil\\x.srt`]
  ])('%s is outside', (_label, target) => {
    expect(isOutsideFolder(root, target, w)).toBe(true)
  })

  it('a posix-style climb is a climb on Windows too (path.win32 reads both separators)', () => {
    expect(isOutsideFolder(root, `${root}/../stream.srt`, w)).toBe(true)
    expect(isOutsideFolder(root, `${root}/..intro.srt`, w)).toBe(false)
  })
})

describe('no confinement test in main spells the rule out by hand again (T-117)', () => {
  // The bug was the same expression written three times. A fourth copy is how it comes back.
  const HAND_ROLLED = /\.startsWith\(\s*['"]\.\.['"]\s*\)/

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return sources(full)
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
    })
  }

  it('no source file under src/main asks startsWith(\'..\') of a relative path', () => {
    const files = sources(__dirname)
    expect(files.length, 'the scan found the main-process sources').toBeGreaterThanOrEqual(40)
    const offenders = files
      .filter((f) => HAND_ROLLED.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
      .map((f) => path.relative(__dirname, f))
    expect(offenders, "use isOutsideFolder (pathConfine.ts): startsWith('..') also refuses a file named ..intro.srt").toEqual([])
  })

  it('the scan discriminates: it flags the old spelling and passes the segment test', () => {
    expect(HAND_ROLLED.test("if (rel.startsWith('..') || path.isAbsolute(rel)) {")).toBe(true)
    expect(HAND_ROLLED.test('if (rel.startsWith(".."))')).toBe(true)
    expect(HAND_ROLLED.test("rel.startsWith('..' + path.sep)")).toBe(false)
  })
})
