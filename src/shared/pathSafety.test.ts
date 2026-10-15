import { describe, it, expect } from 'vitest'
import { isSafeAbsolutePath, assertSafeAbsolutePath, isSafeId, assertSafeId } from './pathSafety'

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
