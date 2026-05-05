import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'

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
    return net.fetch(pathToFileURL(decoded).toString())
  })
}

export function pathToImagiiFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `${IMAGII_FILE_SCHEME}://${encodeURI(normalized)}`
}
