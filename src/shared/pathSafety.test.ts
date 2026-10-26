import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { isSafeAbsolutePath, assertSafeAbsolutePath, isSafeId, assertSafeId, SAFE_ID_RE } from './pathSafety'

describe('isSafeAbsolutePath', () => {
  it('accepts well-formed Windows absolute paths', () => {
    expect(isSafeAbsolutePath('C:/Users/maken/video.mp4')).toBe(true)
    expect(isSafeAbsolutePath('C:\\Users\\maken\\video.mp4')).toBe(true)
    expect(isSafeAbsolutePath('D:/projects/imagii/out.mp4')).toBe(true)
  })

  it('accepts well-formed POSIX absolute paths', () => {
    expect(isSafeAbsolutePath('/home/user/video.mp4')).toBe(true)
    expect(isSafeAbsolutePath('/Volumes/External/clip.mp4')).toBe(true)
  })

  it('rejects relative paths', () => {
    expect(isSafeAbsolutePath('video.mp4')).toBe(false)
    expect(isSafeAbsolutePath('./video.mp4')).toBe(false)
    expect(isSafeAbsolutePath('subdir/video.mp4')).toBe(false)
  })

  it('rejects paths with unresolved .. traversal', () => {
    expect(isSafeAbsolutePath('C:/Users/maken/../other')).toBe(false)
    expect(isSafeAbsolutePath('/home/user/../etc/passwd')).toBe(false)
    expect(isSafeAbsolutePath('C:\\Users\\..\\Windows\\System32')).toBe(false)
    expect(isSafeAbsolutePath('/a/b/c/..')).toBe(false)
  })

  it('does NOT false-positive on filenames containing .. as substrings', () => {
    expect(isSafeAbsolutePath('C:/Users/foo..bar/file.mp4')).toBe(true)
    expect(isSafeAbsolutePath('/home/test..backup/data')).toBe(true)
  })

  it('rejects Windows reserved device basenames', () => {
    expect(isSafeAbsolutePath('C:/Users/maken/CON')).toBe(false)
    expect(isSafeAbsolutePath('C:/Users/maken/con.mp4')).toBe(false)
    expect(isSafeAbsolutePath('C:/Users/maken/aux.json')).toBe(false)
    expect(isSafeAbsolutePath('C:/Users/maken/COM1')).toBe(false)
    expect(isSafeAbsolutePath('C:/Users/maken/lpt5.txt')).toBe(false)
    expect(isSafeAbsolutePath('/home/user/PRN.dat')).toBe(false)
  })

  it('is case-insensitive on reserved-name check', () => {
    expect(isSafeAbsolutePath('C:/Users/maken/Con.mp4')).toBe(false)
    expect(isSafeAbsolutePath('C:/Users/maken/AuX')).toBe(false)
  })

  it('rejects non-string and empty input', () => {
    expect(isSafeAbsolutePath('')).toBe(false)
    expect(isSafeAbsolutePath(null)).toBe(false)
    expect(isSafeAbsolutePath(undefined)).toBe(false)
    expect(isSafeAbsolutePath(42)).toBe(false)
    expect(isSafeAbsolutePath({})).toBe(false)
  })
})

describe('assertSafeAbsolutePath', () => {
  it('passes silently on a safe path', () => {
    expect(() => assertSafeAbsolutePath('C:/Users/maken/file.mp4', 'sourcePath')).not.toThrow()
  })
  it('throws with the named field on rejection', () => {
    expect(() => assertSafeAbsolutePath('../etc/passwd', 'sourcePath')).toThrow(/sourcePath/)
    expect(() => assertSafeAbsolutePath('relative/path', 'videoPath')).toThrow(/videoPath/)
  })
})

// T-117: an id the renderer hands back is joined into a path under userData, so it is held to the
// alphabet nanoid mints (the same set customPresets.ts, moodboard.ts and ipc/search.ts each spell out).
describe('isSafeId', () => {
  it.each(['abc', 'A_b-9', '_', '-', 'V1StGXR8_Z', 'a'.repeat(64)])('accepts %j', (id) => {
    expect(isSafeId(id)).toBe(true)
  })

  it.each([
    '',
    '..',
    '.',
    '../config',
    'a/b',
    'a\\b',
    'has space',
    'x.json',
    'abc\n',
    'a\u0000b',
    'caf\u00e9',
    'a%2fb'
  ])('refuses %j', (id) => {
    expect(isSafeId(id)).toBe(false)
  })

  it('refuses anything that is not a string', () => {
    for (const v of [undefined, null, 42, {}, [], ['abc'], { toString: () => 'abc' }]) expect(isSafeId(v)).toBe(false)
  })
})

describe('assertSafeId', () => {
  it('passes silently on an id in the alphabet', () => {
    expect(() => assertSafeId('V1StGXR8_Z', 'preset id')).not.toThrow()
  })
  it('throws with the named field and the alphabet on rejection', () => {
    expect(() => assertSafeId('../config', 'preset id')).toThrow(/preset id must match nanoid alphabet/)
    expect(() => assertSafeId(42, 'preset id')).toThrow(/preset id/)
  })
})

// T-128 (6), T-110 (ad): the alphabet nanoid mints was spelled out in five more places beside the one T-117 made shared, and a sixth copy
// would be the next place a fix (a wider id, a length cap) lands in five of six. ONE definition; the sites import it.
const SRC_ROOT = path.resolve(__dirname, '..')

/** Every non-test `.ts` / `.tsx` file under `dir`, as an absolute path. */
function sourceFiles(dir: string, depth = 0): string[] {
  if (depth > 8) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full, depth + 1)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : []
  })
}

/** The code of a file, comments removed, so the sentence that NAMES the alphabet in a docstring is not a copy of it. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** How many times `text` spells the alphabet class out (`[A-Za-z0-9_-]`), comments aside. */
const alphabetLiterals = (text: string): number => (withoutComments(text).match(/\[A-Za-z0-9_-\]/g) ?? []).length

describe('one nanoid alphabet (T-128 (6), T-110 (ad))', () => {
  it('the alphabet is written out once in src, in this module', () => {
    const copies = sourceFiles(SRC_ROOT)
      .map((f) => [path.relative(SRC_ROOT, f).split(path.sep).join('/'), alphabetLiterals(readFileSync(f, 'utf8'))] as const)
      .filter(([, n]) => n > 0)
    expect(copies, 'every other file imports SAFE_ID_RE from shared/pathSafety').toEqual([['shared/pathSafety.ts', 1]])
  })

  it.each([
    'main/customPresets.ts',
    'main/search/moodboard.ts',
    'main/ipc/search.ts',
    'main/ipc/recording.ts',
    'main/ipc/video.ts'
  ])('%s imports the shared gate and tests against it', (rel) => {
    const code = withoutComments(readFileSync(path.join(SRC_ROOT, rel), 'utf8'))
    expect(code).toMatch(/import\s*\{[^}]*\bSAFE_ID_RE\b[^}]*\}\s*from\s*'[^']*shared\/pathSafety'/)
    expect(code).toMatch(/\bSAFE_ID_RE\.test\(/)
  })

  it('the scan sees a second copy, and not a docstring that names the alphabet', () => {
    expect(alphabetLiterals('const A_RE = /^[A-Za-z0-9_-]+$/')).toBe(1)
    expect(alphabetLiterals("const B = new RegExp('^[A-Za-z0-9_-]+$')")).toBe(1)
    expect(alphabetLiterals('/** nanoid emits only [A-Za-z0-9_-] */\n// and [A-Za-z0-9_-] again\nconst x = 1')).toBe(0)
    // Other classes that merely look alike are not this alphabet (base64 carries + and /; \w is wider than the alphabet's letters).
    expect(alphabetLiterals('const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/')).toBe(0)
  })

  it('the shared pattern is the one isSafeId reads, and a test() on it keeps no state between calls', () => {
    for (const id of ['abc', 'A_b-9', '../config', 'a/b', 'abc\n', '']) expect(SAFE_ID_RE.test(id), JSON.stringify(id)).toBe(isSafeId(id))
    // A global or sticky regex remembers lastIndex: the second test() of the same id would answer differently.
    expect(SAFE_ID_RE.global || SAFE_ID_RE.sticky).toBe(false)
    expect([SAFE_ID_RE.test('abc'), SAFE_ID_RE.test('abc')]).toEqual([true, true])
  })
})
