import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pathToImagiiFileUrl } from '../shared/fileUrl'

/**
 * T-06 — trust-boundary test for the imagii-file:// handler.
 *
 * `src/shared/fileUrl.ts` and `src/shared/pathSafety.ts` are both well
 * covered on their own. What nothing pinned until now is that
 * `registerFileProtocol` actually WIRES THEM IN: a regression that
 * dropped the `isSafeAbsolutePath` call (or swapped the shared parser
 * back for `url.hostname + url.pathname`) would leave every existing
 * test green while handing the renderer arbitrary file reads.
 *
 * So this file drives the registered handler function directly and
 * asserts on the two observable outputs it produces:
 *   - refusal: a 403 Response with statusText 'Path rejected' AND
 *     net.fetch never called (nothing touched the filesystem)
 *   - acceptance: the exact file:// URL handed to net.fetch
 */

type FileProtocolHandler = (request: { url: string }) => Response | Promise<Response>

let registeredScheme: string | null = null
let registeredHandler: FileProtocolHandler | null = null
let privilegedSchemes: Array<{ scheme: string; privileges: Record<string, boolean> }> = []
let fetchedUrls: string[] = []

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
  },
  net: {
    fetch: (url: string) => {
      fetchedUrls.push(url)
      return Promise.resolve(new Response('media-bytes', { status: 200 }))
    }
  }
}))

async function loadHandler(): Promise<FileProtocolHandler> {
  const m = await import('./protocol')
  m.registerFileProtocol()
  if (registeredHandler === null) throw new Error('protocol.handle was never called')
  return registeredHandler
}

/** Asserts the exact refusal shape the handler produces, and that the
 *  filesystem was never consulted on the way there. */
async function expectRefused(handler: FileProtocolHandler, url: string): Promise<void> {
  const res = await handler({ url })
  expect(res.status).toBe(403)
  expect(res.statusText).toBe('Path rejected')
  expect(await res.text()).toBe('Forbidden')
  expect(fetchedUrls).toEqual([])
}

beforeEach(() => {
  fetchedUrls = []
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

describe('imagii-file handler refuses hostile requests (403, no fetch)', () => {
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
})

// pathToFileURL is platform-dependent: on win32 a rootless POSIX path
// resolves against the current drive (file:///D:/home/...). The v1.3.0
// release run — the only place `npm run verify` executes on Windows —
// caught these three assertions as linux-only. Fixtures pin exact URLs
// per platform; building expectations with pathToFileURL itself would
// be tautological against protocol.ts's own builder.
const WIN = process.platform === 'win32'
const VIDEOS = WIN ? 'C:/Users/streamer/Videos' : '/home/user/Videos'
const VIDEOS_URL = WIN ? 'file:///C:/Users/streamer/Videos' : 'file:///home/user/Videos'

describe('imagii-file handler resolves legitimate requests', () => {
  it('fetches the exact file:// URL for a safe absolute path', async () => {
    const handler = await loadHandler()
    const res = await handler({ url: pathToImagiiFileUrl(`${VIDEOS}/clip.mp4`) })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('media-bytes')
    expect(fetchedUrls).toEqual([`${VIDEOS_URL}/clip.mp4`])
  })

  it('round-trips a filename with #, space and % through to net.fetch', async () => {
    const handler = await loadHandler()
    const res = await handler({
      url: pathToImagiiFileUrl(`${VIDEOS}/vod #4 100%.mp4`)
    })
    expect(res.status).toBe(200)
    expect(fetchedUrls).toEqual([`${VIDEOS_URL}/vod%20%234%20100%25.mp4`])
  })

  it('allows a filename containing dots that are not a .. segment', async () => {
    const handler = await loadHandler()
    const res = await handler({ url: pathToImagiiFileUrl(`${VIDEOS}/vod..final.mp4`) })
    expect(res.status).toBe(200)
    expect(fetchedUrls).toEqual([`${VIDEOS_URL}/vod..final.mp4`])
  })
})
