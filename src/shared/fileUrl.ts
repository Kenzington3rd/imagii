/**
 * The imagii-file:// URL round-trip, as a single tested source of truth.
 *
 * Bug-fix (2026-08-14): media never loaded in the packaged app — on any
 * platform — because the URL builder embedded the filesystem path into
 * the URL's AUTHORITY + PATH and the protocol handler reassembled it
 * from `url.hostname + url.pathname`. URL parsing is lossy there in
 * three independent ways:
 *
 *   - `imagii-file://C:/Users/x` — the drive colon parses as a PORT
 *     delimiter, so the handler saw `C/Users/x` (colon gone, and
 *     hostnames are lowercased to boot).
 *   - `imagii-file://home/user/x` — the builder stripped the POSIX
 *     leading slash to satisfy authority parsing and the handler never
 *     restored it, so the path came out relative (`home/user/x`).
 *   - `vod #4.mp4` — the old builder used encodeURI, which leaves `#`
 *     unescaped; everything after it parsed as a URL fragment and was
 *     dropped.
 *
 *   Every corrupted result then failed `isSafeAbsolutePath` (not
 *   absolute) and the handler returned 403 for every file the app ever
 *   asked for.
 *
 * The fix: never let the path interact with URL structure. The entire
 * absolute path is percent-encoded (encodeURIComponent — escapes `/`,
 * `:`, `#`, `?`, `%`, spaces, everything) into ONE path segment under a
 * fixed dummy host:
 *
 *   imagii-file://local/C%3A%2FUsers%2FMike%2Fclip.mp4
 *
 * The parser requires the fixed host, takes the single segment, and
 * decodes it back to the exact original path. Chromium's canonicalizer
 * preserves percent-encoded sequences in path segments, so the
 * round-trip is byte-exact.
 *
 * Consumed by BOTH sides of the boundary: the preload's
 * `window.api.video.fileUrl` (builder) and the main-process protocol
 * handler (parser). Do not re-implement either half elsewhere — that
 * duplication is what allowed builder and parser to disagree
 * undetected.
 */

export const IMAGII_FILE_SCHEME = 'imagii-file'

/**
 * Fixed dummy host. URL authorities lowercase hostnames and interpret
 * `:` as a port separator, so no path material may ever live there.
 */
export const IMAGII_FILE_HOST = 'local'

/**
 * Build an imagii-file:// URL for an absolute filesystem path.
 * Windows backslashes are normalized to forward slashes first so the
 * same encoded form round-trips on both platforms.
 */
export function pathToImagiiFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  return `${IMAGII_FILE_SCHEME}://${IMAGII_FILE_HOST}/${encodeURIComponent(normalized)}`
}

/**
 * Recover the exact absolute path from an imagii-file:// URL, or null
 * if the URL is not one this module's builder could have produced.
 * Null (never a throw) so the protocol handler can 403 cleanly.
 */
export function imagiiFileUrlToPath(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${IMAGII_FILE_SCHEME}:`) return null
  if (url.hostname !== IMAGII_FILE_HOST) return null
  // Exactly one encoded segment: "/<encoded>". A raw `/` beyond the
  // leading one means the URL didn't come from pathToImagiiFileUrl.
  const encoded = url.pathname.slice(1)
  if (encoded.length === 0 || encoded.includes('/')) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}
