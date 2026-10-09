import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  MAX_IMAGE_BYTES,
  decodeImageDataUrl,
  formatOfFileName,
  isImageFormat,
  safeImageFileName
} from './imageSave'

// T-91: main now turns a renderer-supplied data URL into a file. These pin the
// trust boundary: only real PNG/JPEG bytes in the declared format, a bounded
// size, and a file name that cannot leave its folder.

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8])
const pngUrl = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`
const jpgUrl = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`

describe('decodeImageDataUrl', () => {
  it('round-trips the exact bytes of a PNG and of a JPEG', () => {
    expect(decodeImageDataUrl(pngUrl(PNG_BYTES), 'png').equals(PNG_BYTES)).toBe(true)
    expect(decodeImageDataUrl(jpgUrl(JPEG_BYTES), 'jpg').equals(JPEG_BYTES)).toBe(true)
  })

  it('refuses a data URL of the wrong format', () => {
    expect(() => decodeImageDataUrl(jpgUrl(JPEG_BYTES), 'png')).toThrow(/not a png data URL/)
    expect(() => decodeImageDataUrl(pngUrl(PNG_BYTES), 'jpg')).toThrow(/not a jpg data URL/)
  })

  it('refuses bytes that are not what the label says (magic number, not mime)', () => {
    const lies = `data:image/png;base64,${Buffer.from('MZ\x90\x00not an image at all').toString('base64')}`
    expect(() => decodeImageDataUrl(lies, 'png')).toThrow(/not really a png/)
    // A PNG labelled as a JPEG is also refused.
    const wrong = `data:image/jpeg;base64,${PNG_BYTES.toString('base64')}`
    expect(() => decodeImageDataUrl(wrong, 'jpg')).toThrow(/not really a jpg/)
  })

  it('refuses anything that is not base64, and anything that is not a string', () => {
    expect(() => decodeImageDataUrl('data:image/png;base64,@@@', 'png')).toThrow(/base64/)
    expect(() => decodeImageDataUrl('data:image/png;base64,AAAA\nBBBB', 'png')).toThrow(/base64/)
    for (const bad of [undefined, null, 5, {}, ['data:image/png;base64,AAAA']]) {
      expect(() => decodeImageDataUrl(bad, 'png')).toThrow(/string/)
    }
    expect(() => decodeImageDataUrl('https://example.com/a.png', 'png')).toThrow(/data URL/)
  })

  it('refuses an oversize payload before decoding it', () => {
    const huge = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16)}`
    expect(() => decodeImageDataUrl(huge, 'png')).toThrow(/too large/)
  })
})

describe('safeImageFileName', () => {
  it('keeps a good name, adds the extension the format needs', () => {
    expect(safeImageFileName('imagii-123.png', 'png')).toBe('imagii-123.png')
    expect(safeImageFileName('shot.JPEG', 'jpg')).toBe('shot.JPEG')
    expect(safeImageFileName('shot', 'png')).toBe('shot.png')
  })

  it('replaces a different extension rather than stacking one', () => {
    expect(safeImageFileName('virus.exe', 'png')).toBe('virus.png')
    expect(safeImageFileName('a.png', 'jpg')).toBe('a.jpg')
  })

  it('reduces a path to its leaf: nothing can climb out of the chosen folder', () => {
    for (const hostile of ['../../etc/passwd', '..\\..\\Windows\\x.png', '/abs/olute/x.png', 'a/b/c.png']) {
      const out = safeImageFileName(hostile, 'png')
      expect(out).not.toMatch(/[\\/]/)
      expect(path.join('/safe/dir', out).startsWith(path.join('/safe/dir') + path.sep)).toBe(true)
    }
    expect(safeImageFileName('../../etc/passwd', 'png')).toBe('passwd.png')
  })

  it('strips characters Windows refuses and control characters', () => {
    expect(safeImageFileName('a<b>c:d"e|f?g*h\u0001.png', 'png')).toBe('abcdefgh.png')
  })

  it('falls back to a name when nothing usable is left', () => {
    for (const v of ['', '   ', '...', undefined, null, 7]) {
      expect(safeImageFileName(v, 'png')).toBe('imagii.png')
    }
  })

  it('caps the length', () => {
    expect(safeImageFileName('x'.repeat(500) + '.png', 'png').length).toBeLessThanOrEqual(125)
  })
})

describe('formatOfFileName / isImageFormat', () => {
  it('reads the format off the extension', () => {
    expect(formatOfFileName('a.png')).toBe('png')
    expect(formatOfFileName('a.JPG')).toBe('jpg')
    expect(formatOfFileName('a.jpeg')).toBe('jpg')
    expect(formatOfFileName('a.gif')).toBeNull()
    expect(formatOfFileName('noext')).toBeNull()
  })

  it('accepts exactly the two formats', () => {
    expect(isImageFormat('png')).toBe(true)
    expect(isImageFormat('jpg')).toBe(true)
    for (const bad of ['jpeg', 'svg', 'PNG', '', null, undefined, 1]) expect(isImageFormat(bad)).toBe(false)
  })
})
