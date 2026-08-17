import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToImagiiFileUrl } from '../shared/fileUrl'

/**
 * T-06 / T-37 — trust-boundary test for the imagii-file:// handler.
 *
 * `src/shared/fileUrl.ts` and `src/shared/pathSafety.ts` are both well
 * covered on their own. What nothing pinned until now is that
 * `registerFileProtocol` actually WIRES THEM IN: a regression that
 * dropped the `isSafeAbsolutePath` call (or swapped the shared parser
 * back for `url.hostname + url.pathname`) would leave every existing
 * test green while handing the renderer arbitrary file reads.
 *
 * So this file drives the registered handler function directly and
 * asserts on the observable outputs it produces:
 *   - refusal: a 403 Response with statusText 'Path rejected' AND the
 *     filesystem never consulted (the `node:fs` mocks below record every
 *     path the handler stats or opens)
 *   - acceptance: the real bytes of a real file on disk, with the status,
 *     Content-Type, Content-Length, Accept-Ranges and Content-Range the
 *     media stack needs
 *
 * T-37 added the second trust boundary: the `Range` REQUEST HEADER. It is
 * untrusted input in exactly the way a URL is, so every malformed,
 * unsupported and unsatisfiable form has its own case below, asserting
 * the exact fallback the handler implements (RFC 9110: ignore the header
 * and serve 200 for anything invalid or unsupported; 416 only for a valid
 * range that misses the file).
 *
 * Platform note (2026-08-15 LESSONS): the old positives pinned exact
 * `file://` URLs and had to be made platform-aware because
 * `pathToFileURL` resolves a rootless POSIX path against the current
 * drive on win32. The handler no longer builds a URL at all — it opens
 * the path — so these fixtures are real files under `os.tmpdir()` and
 * contain no platform-pinned strings on either side.
 */

/** Every path the handler stats or opens, in order. Reset per test. */
const fsSpy = vi.hoisted(() => ({ touched: [] as string[] }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream(path: Parameters<typeof actual.createReadStream>[0], options?: unknown) {
      fsSpy.touched.push(String(path))
      return actual.createReadStream(path, options as never)
    }
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat(path: Parameters<typeof actual.stat>[0]) {
      fsSpy.touched.push(String(path))
      return actual.stat(path)
    }
  }
})

type FileProtocolHandler = (request: {
  url: string
  headers: Headers
}) => Response | Promise<Response>

let registeredScheme: string | null = null
let registeredHandler: FileProtocolHandler | null = null
let privilegedSchemes: Array<{ scheme: string; privileges: Record<string, boolean> }> = []

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (
      schemes: Array<{ scheme: string; privileges: Record<string, boolean> }>
    ) => {
      privilegedSchemes = schemes
    },
    handle: (scheme: string, handler: FileProtocolHandler) => {
      registeredScheme = scheme
      registeredHandler = handler
    }
  }
}))

async function loadHandler(): Promise<FileProtocolHandler> {
  const m = await import('./protocol')
  m.registerFileProtocol()
  if (registeredHandler === null) throw new Error('protocol.handle was never called')
  return registeredHandler
}

/** Drive the handler for a path, optionally with a Range request header. */
function request(
  handler: FileProtocolHandler,
  filePath: string,
  range?: string
): Response | Promise<Response> {
  const headers = new Headers()
  if (range !== undefined) headers.set('Range', range)
  return handler({ url: pathToImagiiFileUrl(filePath), headers })
}

/** Asserts the exact refusal shape the handler produces, and that the
 *  filesystem was never consulted on the way there. */
async function expectRefused(handler: FileProtocolHandler, url: string): Promise<void> {
  const res = await handler({ url, headers: new Headers() })
  expect(res.status).toBe(403)
  expect(res.statusText).toBe('Path rejected')
  expect(await res.text()).toBe('Forbidden')
  expect(fsSpy.touched).toEqual([])
}

/** 16 known bytes so every slice below is readable at a glance. */
const BODY = '0123456789abcdef'
const SIZE = BODY.length

let root = ''
let clip = ''
let emptyFile = ''
let unknownExt = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'imagii-protocol-'))
  clip = join(root, 'clip.mp4')
  writeFileSync(clip, BODY, 'utf8')
  emptyFile = join(root, 'empty.mp4')
  writeFileSync(emptyFile, '', 'utf8')
  unknownExt = join(root, 'notes.zzz')
  writeFileSync(unknownExt, BODY, 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  fsSpy.touched = []
})

describe('registerFileProtocol wiring', () => {
  it('registers a handler for the imagii-file scheme', async () => {
    await loadHandler()
    expect(registeredScheme).toBe('imagii-file')
  })

  it('registers the scheme as privileged without bypassing CSP', async () => {
    const m = await import('./protocol')
    m.registerPrivilegedSchemes()
    const entry = privilegedSchemes.find((s) => s.scheme === 'imagii-file')
    expect(entry).toBeDefined()
    expect(entry?.privileges.standard).toBe(true)
    expect(entry?.privileges.secure).toBe(true)
    expect(entry?.privileges.bypassCSP).toBe(false)
  })
})

describe('imagii-file handler refuses hostile requests (403, no file access)', () => {
  it('refuses a relative traversal path built through the real URL builder', async () => {
    const handler = await loadHandler()
    // encodeURIComponent('../../etc/passwd') => '..%2F..%2Fetc%2Fpasswd'
    await expectRefused(handler, pathToImagiiFileUrl('../../etc/passwd'))
  })

  it('refuses an ABSOLUTE path that still contains .. segments', async () => {
    const handler = await loadHandler()
    // Absolute, so the "must be absolute" half of the guard passes — only
    // the `..`-segment check can reject this one.
    await expectRefused(handler, pathToImagiiFileUrl('/home/user/media/../../../etc/passwd'))
  })

  it('refuses a Windows drive path with .. segments', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, pathToImagiiFileUrl('C:/Users/streamer/../../Windows/win.ini'))
  })

  it('refuses a Windows reserved device name', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, pathToImagiiFileUrl('C:/Users/streamer/NUL'))
  })

  it('refuses hand-written percent-encoded traversal (lowercase hex, not builder output)', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'imagii-file://local/%2e%2e%2f%2e%2e%2fetc%2fpasswd')
  })

  it('refuses a URL whose host is not the fixed dummy host', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'imagii-file://evil/%2Fhome%2Fuser%2Fclip.mp4')
  })

  it('refuses a legacy multi-segment URL (raw slashes in the path)', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'imagii-file://local/home/user/clip.mp4')
  })

  it('refuses a legacy Windows-authority URL (drive letter in the host)', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'imagii-file://C:/Users/Mike/clip.mp4')
  })

  it('refuses an empty path segment', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'imagii-file://local/')
  })

  it('refuses malformed percent-encoding instead of throwing', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'imagii-file://local/%zz')
  })

  it('refuses a wrong-scheme URL', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'file:///etc/passwd')
  })

  it('refuses a string that is not a URL at all', async () => {
    const handler = await loadHandler()
    await expectRefused(handler, 'not a url')
  })

  it('still refuses a hostile path when a Range header is present', async () => {
    const handler = await loadHandler()
    const res = await handler({
      url: pathToImagiiFileUrl('/home/user/media/../../../etc/passwd'),
      headers: new Headers({ Range: 'bytes=0-3' })
    })
    expect(res.status).toBe(403)
    expect(fsSpy.touched).toEqual([])
  })
})

describe('imagii-file handler resolves legitimate requests', () => {
  it('serves the whole file with 200, Content-Length and Accept-Ranges', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe(String(SIZE))
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.headers.get('Content-Range')).toBeNull()
    expect(await res.text()).toBe(BODY)
    // Separator-insensitive: the handler passes the decoded forward-slash
    // path to fs (Windows accepts it), while `clip` is path.join-native —
    // backslashes on win32. The recorder stays verbatim; the comparison
    // normalizes. Caught by the v1.5.0 release run.
    const fwd = (p: string): string => p.replace(/\\/g, '/')
    expect(fsSpy.touched.map(fwd)).toEqual([clip, clip].map(fwd))
  })

  it('round-trips a filename with #, space and % through to the real file', async () => {
    const handler = await loadHandler()
    const awkward = join(root, 'vod #4 100%.mp4')
    writeFileSync(awkward, BODY, 'utf8')
    const res = await request(handler, awkward)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(BODY)
  })

  it('allows a filename containing dots that are not a .. segment', async () => {
    const handler = await loadHandler()
    const dotted = join(root, 'vod..final.mp4')
    writeFileSync(dotted, BODY, 'utf8')
    const res = await request(handler, dotted)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(BODY)
  })

  it('labels an unknown extension as application/octet-stream', async () => {
    const handler = await loadHandler()
    const res = await request(handler, unknownExt)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
  })

  it('404s a path that does not exist instead of throwing', async () => {
    const handler = await loadHandler()
    const res = await request(handler, join(root, 'gone.mp4'))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('Not found')
  })

  it('404s a directory instead of opening it as a stream', async () => {
    const handler = await loadHandler()
    const dir = join(root, 'subdir')
    mkdirSync(dir, { recursive: true })
    const res = await request(handler, dir)
    expect(res.status).toBe(404)
    expect(res.statusText).toBe('Not a file')
  })
})

/**
 * T-37. Chromium decides `video.seekable` from these responses: no
 * Accept-Ranges / no 206 means "not seekable", which clamps every
 * `currentTime` assignment to 0. The offsets below are asserted against
 * the real bytes so an off-by-one in Content-Range or in the stream slice
 * fails here rather than as a corrupt frame in the app.
 */
describe('imagii-file handler answers Range requests (206)', () => {
  it('serves a leading range with the exact bytes, Content-Range and Content-Length', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=0-3')
    expect(res.status).toBe(206)
    expect(res.statusText).toBe('Partial Content')
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-3/${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe('4')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(await res.text()).toBe('0123')
  })

  it('serves a MID-FILE range from the right offset (the seek that T-37 unblocked)', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=4-7')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 4-7/${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe('4')
    expect(await res.text()).toBe('4567')
  })

  it('serves an open-ended range to EOF', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=12-')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 12-${SIZE - 1}/${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe('4')
    expect(await res.text()).toBe('cdef')
  })

  it("answers Chromium's probe request (bytes=0-) with a 206 spanning the file", async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=0-')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-${SIZE - 1}/${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe(String(SIZE))
    expect(await res.text()).toBe(BODY)
  })

  it('clamps a last-byte-pos past EOF to the final byte', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=13-9999')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 13-${SIZE - 1}/${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe('3')
    expect(await res.text()).toBe('def')
  })

  it('serves a suffix range (last N bytes)', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=-4')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 12-${SIZE - 1}/${SIZE}`)
    expect(await res.text()).toBe('cdef')
  })

  it('clamps a suffix longer than the file to the whole file', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=-9999')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-${SIZE - 1}/${SIZE}`)
    expect(await res.text()).toBe(BODY)
  })

  it('accepts the range unit case-insensitively', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'BYTES=0-1')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-1/${SIZE}`)
    expect(await res.text()).toBe('01')
  })

  it('tolerates surrounding whitespace in the header', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, '  bytes=2-3  ')
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('23')
  })
})

/**
 * Malformed / unsupported Range headers. RFC 9110 §14.2: a server MUST
 * ignore a Range it does not understand and MAY ignore any invalid one —
 * so these all fall back to the FULL 200 body rather than erroring. Only
 * a syntactically valid range that misses the file earns a 416 (§15.5.17).
 */
describe('imagii-file handler refuses malformed Range headers safely', () => {
  async function expectFullBodyFallback(range: string): Promise<void> {
    const handler = await loadHandler()
    const res = await request(handler, clip, range)
    expect(res.status, `Range: ${range}`).toBe(200)
    expect(res.headers.get('Content-Range')).toBeNull()
    expect(res.headers.get('Content-Length')).toBe(String(SIZE))
    expect(await res.text()).toBe(BODY)
  }

  it('ignores a REVERSED range (last-byte-pos before first-byte-pos)', async () => {
    await expectFullBodyFallback('bytes=9-2')
  })

  it('ignores a garbage header', async () => {
    await expectFullBodyFallback('cheese')
  })

  it('ignores an empty header value', async () => {
    await expectFullBodyFallback('')
  })

  it('ignores a range unit we do not implement', async () => {
    await expectFullBodyFallback('items=0-3')
  })

  it('ignores a MULTI-RANGE list (no multipart/byteranges support)', async () => {
    await expectFullBodyFallback('bytes=0-1,4-5')
  })

  it('ignores a bare "bytes=-" with neither position', async () => {
    await expectFullBodyFallback('bytes=-')
  })

  it('ignores non-integer positions', async () => {
    await expectFullBodyFallback('bytes=abc-def')
  })

  it('ignores a first-byte-pos too large to be a safe integer', async () => {
    await expectFullBodyFallback('bytes=99999999999999999999-')
  })

  it('ignores a negative first-byte-pos (the minus is not part of the grammar)', async () => {
    await expectFullBodyFallback('bytes=-3-6')
  })

  it('416s a first-byte-pos at or past EOF, with Content-Range bytes */size', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, `bytes=${SIZE}-`)
    expect(res.status).toBe(416)
    expect(res.statusText).toBe('Range Not Satisfiable')
    expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`)
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
  })

  it('416s a zero-length suffix range', async () => {
    const handler = await loadHandler()
    const res = await request(handler, clip, 'bytes=-0')
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`)
  })

  it('serves an empty file as an empty 200 even when a range is asked for', async () => {
    const handler = await loadHandler()
    const res = await request(handler, emptyFile, 'bytes=0-0')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('0')
    expect(await res.text()).toBe('')
  })
})
