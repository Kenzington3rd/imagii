import { describe, it, expect } from 'vitest'
import {
  IMAGII_FILE_HOST,
  IMAGII_FILE_SCHEME,
  pathToImagiiFileUrl,
  imagiiFileUrlToPath
} from './fileUrl'
import { isSafeAbsolutePath } from './pathSafety'

/** The exact round-trip the app performs: preload builds, handler parses. */
function roundTrip(p: string): string | null {
  return imagiiFileUrlToPath(pathToImagiiFileUrl(p))
}

describe('imagii-file URL round-trip', () => {
  const MATRIX: Array<[label: string, path: string, expected: string]> = [
    ['Windows drive path', 'C:\\Users\\Mike\\Videos\\clip.mp4', 'C:/Users/Mike/Videos/clip.mp4'],
    ['Windows path with spaces', 'D:\\stream stuff\\raw take.mp4', 'D:/stream stuff/raw take.mp4'],
    // Regression: `#` parsed as a URL fragment under the old encodeURI
    // builder and silently truncated the path.
    ['hash in filename', 'D:\\vods\\vod #4.mp4', 'D:/vods/vod #4.mp4'],
    ['question mark in filename', 'C:\\clips\\really?.mp4', 'C:/clips/really?.mp4'],
    ['percent in filename', 'C:\\clips\\50%.mp4', 'C:/clips/50%.mp4'],
    ['ampersand + unicode', 'C:\\clips\\día & noche ép.mp4', 'C:/clips/día & noche ép.mp4'],
    ['POSIX path', '/home/user/videos/clip.mp4', '/home/user/videos/clip.mp4'],
    ['UNC share path', '\\\\nas\\share\\clip.mp4', '//nas/share/clip.mp4']
  ]

  for (const [label, input, expected] of MATRIX) {
    it(`round-trips exactly: ${label}`, () => {
      expect(roundTrip(input)).toBe(expected)
    })
  }

  it('every round-tripped path passes isSafeAbsolutePath (the 403 guard)', () => {
    for (const [, input] of MATRIX) {
      const out = roundTrip(input)
      expect(out, input).not.toBeNull()
      expect(isSafeAbsolutePath(out), `${input} -> ${out}`).toBe(true)
    }
  })

  // The three corruptions of the old builder/parser pair, pinned so a
  // future "simplification" of the encoding cannot reintroduce them.
  it('regression: drive-letter colon survives (was eaten as a URL port)', () => {
    expect(roundTrip('C:\\Users\\x.mp4')).toContain('C:')
  })

  it('regression: POSIX leading slash survives (was stripped for the authority)', () => {
    expect(roundTrip('/home/user/x.mp4')).toMatch(/^\//)
  })

  it('regression: drive-letter case survives (hostnames lowercase)', () => {
    expect(roundTrip('C:\\Users\\x.mp4')).not.toMatch(/^c:/)
  })

  it('the builder never leaks path material into the URL authority', () => {
    const url = new URL(pathToImagiiFileUrl('C:\\Users\\Mike\\clip.mp4'))
    expect(url.hostname).toBe(IMAGII_FILE_HOST)
    expect(url.port).toBe('')
    expect(url.hash).toBe('')
  })
})

describe('imagiiFileUrlToPath rejects what the builder cannot produce', () => {
  it('wrong scheme', () => {
    expect(imagiiFileUrlToPath('file://local/%2Fetc%2Fpasswd')).toBeNull()
  })

  it('wrong host', () => {
    expect(imagiiFileUrlToPath(`${IMAGII_FILE_SCHEME}://evil/%2Fetc%2Fpasswd`)).toBeNull()
  })

  it('multi-segment path (unencoded slashes)', () => {
    expect(imagiiFileUrlToPath(`${IMAGII_FILE_SCHEME}://${IMAGII_FILE_HOST}/etc/passwd`)).toBeNull()
  })

  it('empty path', () => {
    expect(imagiiFileUrlToPath(`${IMAGII_FILE_SCHEME}://${IMAGII_FILE_HOST}/`)).toBeNull()
  })

  it('malformed percent-encoding', () => {
    expect(imagiiFileUrlToPath(`${IMAGII_FILE_SCHEME}://${IMAGII_FILE_HOST}/%E0%A4%ZZ`)).toBeNull()
  })

  it('not a URL at all', () => {
    expect(imagiiFileUrlToPath('C:\\Users\\x.mp4')).toBeNull()
  })

  it('traversal still lands in the safety guard, not the filesystem', () => {
    // The parser itself decodes whatever single segment it is given; the
    // protocol handler's isSafeAbsolutePath call is what rejects it.
    const decoded = imagiiFileUrlToPath(
      `${IMAGII_FILE_SCHEME}://${IMAGII_FILE_HOST}/${encodeURIComponent('/etc/../etc/passwd')}`
    )
    expect(decoded).toBe('/etc/../etc/passwd')
    expect(isSafeAbsolutePath(decoded)).toBe(false)
  })
})
