import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
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
    return net.fetch(pathToFileURL(decoded).toString())
  })
}
