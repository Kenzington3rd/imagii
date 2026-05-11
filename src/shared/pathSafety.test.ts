import { describe, it, expect } from 'vitest'
import { isSafeAbsolutePath, assertSafeAbsolutePath } from './pathSafety'

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
