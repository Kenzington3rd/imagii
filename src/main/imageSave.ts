import path from 'node:path'
import type { ImageSaveFormat } from '../shared/canvas'

/**
 * T-91 — the pure half of saving a Stream Graphics export from main.
 *
 * The renderer used to hand the browser a data URL through a hidden
 * `<a download>`. Now it hands the same data URL to main, which owns the native
 * dialog and the write — so a trust boundary appeared: the string comes from a
 * renderer, and ends up as bytes in a file. Nothing here trusts it. The bytes
 * must be what the declared format says (a PNG or a JPEG by magic number, not
 * by the label on the URL), the size is capped, and a file name is reduced to
 * a safe leaf.
 */

/** Decoded-size cap. A 3840x2160 PNG at 3x is ~75 Mpx and tens of MB; this
 *  is an order of magnitude past that and still a bounded allocation. */
export const MAX_IMAGE_BYTES = 256 * 1024 * 1024

const MIME: Record<ImageSaveFormat, string> = { png: 'image/png', jpg: 'image/jpeg' }
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

export function isImageFormat(v: unknown): v is ImageSaveFormat {
  return v === 'png' || v === 'jpg'
}

/** The bytes inside `dataUrl`, once they are proven to be a `format` image. */
export function decodeImageDataUrl(dataUrl: unknown, format: ImageSaveFormat): Buffer {
  if (typeof dataUrl !== 'string') throw new Error('image data must be a string')
  const prefix = `data:${MIME[format]};base64,`
  if (!dataUrl.startsWith(prefix)) throw new Error(`image data is not a ${format} data URL`)
  const b64 = dataUrl.slice(prefix.length)
  // Bound the allocation BEFORE making it: base64 is 4 chars per 3 bytes.
  if (b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new Error('image is too large')
  if (!BASE64.test(b64)) throw new Error('image data is not valid base64')
  const bytes = Buffer.from(b64, 'base64')
  const magic = format === 'png' ? PNG_MAGIC : JPEG_MAGIC
  if (bytes.length < magic.length || !magic.every((b, i) => bytes[i] === b)) {
    throw new Error(`image data is not really a ${format}`)
  }
  return bytes
}

/**
 * A file name that is only a file name: no folders (either separator), no
 * characters Windows refuses, and the extension the format needs. The result
 * is always something `path.join(dir, result)` keeps inside `dir`.
 */
export function safeImageFileName(name: unknown, format: ImageSaveFormat): string {
  const leaf = typeof name === 'string' ? (name.split(/[\\/]/).pop() ?? '') : ''
  const base = leaf
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  if ((format === 'png' ? /\.png$/i : /\.jpe?g$/i).test(base)) return base
  // Any other extension is replaced, not stacked: "a.exe" becomes "a.png".
  return `${path.parse(base).name || 'imagii'}.${format}`
}

/** The format a saved file name implies (`.png` / `.jpg` / `.jpeg`), or null. */
export function formatOfFileName(name: string): ImageSaveFormat | null {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.png') return 'png'
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg'
  return null
}
