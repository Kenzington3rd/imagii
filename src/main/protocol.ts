import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { isSafeAbsolutePath } from '../shared/pathSafety'

export const IMAGII_FILE_SCHEME = 'imagii-file'

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
    const url = new URL(request.url)
    const decoded = decodeURIComponent(url.hostname + url.pathname)
    // Bug-fix (2026-05-10 audit): defense-in-depth path validation.
    // A malicious .imagii.json could carry a sourcePath that escapes
    // out of the user's media directories via `..` traversal or that
    // targets Windows reserved device names. Block here so even if a
    // bad path slips past project validation, the protocol handler
    // refuses to fetch it.
    if (!isSafeAbsolutePath(decoded)) {
      return new Response('Forbidden', { status: 403, statusText: 'Path rejected' })
    }
    return net.fetch(pathToFileURL(decoded).toString())
  })
}

export function pathToImagiiFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `${IMAGII_FILE_SCHEME}://${encodeURI(normalized)}`
}
