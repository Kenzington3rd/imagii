import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { assert } from '../shared/assert'
import { isSafeAbsolutePath } from '../shared/pathSafety'
import { IMAGII_FILE_SCHEME, imagiiFileUrlToPath } from '../shared/fileUrl'

export { IMAGII_FILE_SCHEME }

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGII_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true
      }
    }
  ])
}

/**
 * Content-Type by extension. `net.fetch(file://…)` used to label the
 * bytes; serving them ourselves (see `serveFile`) means we label them.
 * Covers every extension the app can hand this protocol — the import
 * lists in `shared/mediaFormats.ts` plus the reference thumbnails.
 */
const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

function mimeTypeFor(filePath: string): string {
  assert(typeof filePath === 'string', 'mimeTypeFor needs a path')
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = filePath.slice(dot + 1).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

/** An inclusive byte range, resolved against the real file size. */
type ByteRange = { start: number; end: number }

/**
 * Parse a `Range` request header against a known file size (RFC 9110
 * §14.1.1 / §14.2). Untrusted input: the header is whatever the renderer
 * — or anything the renderer loads — chose to send, so every branch has
 * to land on a defined answer instead of throwing.
 *
 *   `'full'`          — serve 200 with the whole body. Used for BOTH "no
 *                       Range header" and "a Range header we must
 *                       ignore": an unknown range unit, a multi-range
 *                       list (we never emit multipart/byteranges), a
 *                       reversed or non-integer spec. RFC 9110 §14.2
 *                       makes ignoring the header the correct fallback
 *                       for anything invalid or unsupported.
 *   `'unsatisfiable'` — 416. Reserved for a syntactically VALID range
 *                       that does not overlap the file at all: a first
 *                       byte at or past EOF, or a zero-length suffix
 *                       (§15.5.17).
 *   `{start, end}`    — 206 over exactly these inclusive byte offsets.
 */
function parseByteRange(header: string | null, size: number): ByteRange | 'full' | 'unsatisfiable' {
  assert(Number.isSafeInteger(size) && size >= 0, 'parseByteRange needs a real byte size')
  if (header === null || size === 0) return 'full'
  // One `bytes=` spec only. A comma (multi-range), another unit, or any
  // stray character fails the match and falls back to the full body.
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return 'full'
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return 'full'
  if (rawStart === '') {
    // Suffix form `bytes=-N`: the last N bytes. N larger than the file
    // means the whole file; N of zero selects nothing, so 416.
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix)) return 'full'
    if (suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isSafeInteger(start)) return 'full'
  // Open-ended `bytes=N-`: valid whatever N is, so a start past EOF is
  // unsatisfiable rather than invalid.
  if (rawEnd === '') return start >= size ? 'unsatisfiable' : { start, end: size - 1 }
  const end = Number(rawEnd)
  if (!Number.isSafeInteger(end)) return 'full'
  // A spec is INVALID when last-byte-pos is present and below
  // first-byte-pos (RFC 9110 §14.1.1) — invalid is ignored, not 416.
  if (end < start) return 'full'
  if (start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/** Inclusive-range file body as a web stream, for a `Response`. */
function bodyStream(filePath: string, start: number, end: number): ReadableStream {
  assert(start >= 0 && end >= start, 'bodyStream needs an inclusive forward range')
  return Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
}

/**
 * Bug-fix (2026-08-15, T-37): serve the bytes ourselves instead of
 * `net.fetch(file://…)`. That helper answers every request with the
 * whole file and no `Accept-Ranges`, so Chromium's media stack concludes
 * the resource is not seekable — `video.seekable` reads [0, 0] and EVERY
 * `currentTime` assignment clamps to 0. Honouring `Range` here is what
 * makes frame steps, arrow nudges and scrubbing land.
 */
async function serveFile(filePath: string, rangeHeader: string | null): Promise<Response> {
  assert(isSafeAbsolutePath(filePath), 'serveFile got an unvalidated path')
  let size: number
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return new Response('Not found', { status: 404, statusText: 'Not a file' })
    size = info.size
  } catch {
    return new Response('Not found', { status: 404, statusText: 'File not found' })
  }
  const headers: Record<string, string> = {
    'Content-Type': mimeTypeFor(filePath),
    'Accept-Ranges': 'bytes'
  }
  const range = parseByteRange(rangeHeader, size)
  if (range === 'unsatisfiable') {
    return new Response('Range not satisfiable', {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { ...headers, 'Content-Range': `bytes */${size}` }
    })
  }
  if (range === 'full') {
    return new Response(size === 0 ? null : bodyStream(filePath, 0, size - 1), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) }
    })
  }
  return new Response(bodyStream(filePath, range.start, range.end), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      ...headers,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`
    }
  })
}

export function registerFileProtocol(): void {
  protocol.handle(IMAGII_FILE_SCHEME, (request) => {
    // Bug-fix (2026-08-14): parse with the shared round-trip module.
    // The old handler reassembled `url.hostname + url.pathname`, which
    // corrupted every path URL parsing touched (drive colon eaten as a
    // port, POSIX leading slash lost, hostname lowercased) — so the
    // safety check below rejected every request and no media ever
    // loaded in the packaged app. See src/shared/fileUrl.ts.
    const decoded = imagiiFileUrlToPath(request.url)

    // Bug-fix (2026-05-10 audit): defense-in-depth path validation.
    // A malicious .imagii.json could carry a sourcePath that escapes
    // out of the user's media directories via `..` traversal or that
    // targets Windows reserved device names. Block here so even if a
    // bad path slips past project validation, the protocol handler
    // refuses to fetch it.
    if (decoded === null || !isSafeAbsolutePath(decoded)) {
      return new Response('Forbidden', { status: 403, statusText: 'Path rejected' })
    }
    return serveFile(decoded, request.headers.get('range'))
  })
}
