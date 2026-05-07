import { describe, it, expect } from 'vitest'
import {
  describeImportError,
  examineDroppedFile,
  pathLooksLikeCloudSync
} from './importDiagnostics'

function makeFile(opts: {
  name?: string
  size?: number
  type?: string
  path?: string | null
}): File {
  const f = new File(['x'], opts.name ?? 'video.mp4', { type: opts.type ?? 'video/mp4' })
  if (opts.path !== undefined) {
    Object.defineProperty(f, 'path', {
      value: opts.path,
      configurable: true
    })
  }
  if (opts.size !== undefined) {
    Object.defineProperty(f, 'size', { value: opts.size })
  }
  return f
}

describe('pathLooksLikeCloudSync', () => {
  it.each([
    'C:\\Users\\mike\\OneDrive\\Documents\\clip.mp4',
    'C:\\Users\\mike\\Google Drive\\My Drive\\clip.mp4',
    'C:\\Users\\mike\\Dropbox\\videos\\clip.mp4',
    '/Users/mike/iCloudDrive/clip.mp4'
  ])('detects %s as cloud-sync', (path) => {
    expect(pathLooksLikeCloudSync(path)).toBe(true)
  })

  it.each([
    'C:\\Users\\mike\\Desktop\\clip.mp4',
    'C:\\Videos\\clip.mp4',
    null,
    undefined,
    ''
  ])('does not flag %s', (path) => {
    expect(pathLooksLikeCloudSync(path)).toBe(false)
  })
})

describe('examineDroppedFile', () => {
  it('reports no-file when undefined', () => {
    const r = examineDroppedFile(undefined)
    expect(r.hadFile).toBe(false)
    expect(r.reason).toBe('no-file')
  })

  it('reports no-path when File has no .path property', () => {
    const f = makeFile({ name: 'vid.mp4', path: null })
    const r = examineDroppedFile(f)
    expect(r.reason).toBe('no-path')
    expect(r.hadFile).toBe(true)
    expect(r.hadPath).toBe(false)
    expect(r.hint).toMatch(/cloud-only|browser tab|sandboxed/)
  })

  it('flags cloud-placeholder paths', () => {
    const f = makeFile({
      name: 'vid.mp4',
      path: 'C:\\Users\\mike\\OneDrive\\Videos\\vid.mp4'
    })
    const r = examineDroppedFile(f)
    expect(r.reason).toBe('cloud-placeholder')
    expect(r.hint).toMatch(/Always keep on this device/)
  })

  it('passes through normal local paths', () => {
    const f = makeFile({
      name: 'vid.mp4',
      path: 'C:\\Users\\mike\\Desktop\\vid.mp4'
    })
    const r = examineDroppedFile(f)
    expect(r.reason).toBe('ok')
    expect(r.hadFile).toBe(true)
    expect(r.hadPath).toBe(true)
  })
})

describe('describeImportError', () => {
  it('passes through plain messages', () => {
    expect(describeImportError(new Error('something broke'))).toMatch(/something broke/)
  })

  it('annotates ENOENT with context-specific hint', () => {
    const msg = describeImportError(new Error('ENOENT: no such file or directory'), 'C:\\foo\\vid.mp4')
    expect(msg).toMatch(/file picker/)
  })

  it('annotates ENOENT with cloud-aware hint when path is in OneDrive', () => {
    const msg = describeImportError(
      new Error('ENOENT: no such file or directory'),
      'C:\\Users\\mike\\OneDrive\\Videos\\vid.mp4'
    )
    expect(msg).toMatch(/Always keep on this device/)
  })

  it('annotates access-denied with antivirus hint', () => {
    const msg = describeImportError(new Error('EACCES: access is denied'))
    expect(msg).toMatch(/antivirus/i)
  })

  it('detects missing video stream', () => {
    const msg = describeImportError(new Error('No video stream found in file'))
    expect(msg).toMatch(/Audio Studio/)
  })

  it('truncates very long error messages', () => {
    const big = 'x'.repeat(500)
    const msg = describeImportError(new Error(big))
    expect(msg.length).toBeLessThanOrEqual(260)
  })
})
