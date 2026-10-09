import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-89 — the captions engine is found under either name.
 *
 * The setup card sent people to fetch `whisper.exe`; current whisper.cpp
 * builds ship `whisper-cli.exe`. The resolver accepts both, prefers the new
 * name, and reports the preferred name's path when neither is there (that is
 * the file the card asks for). Dev builds look under `<cwd>/resources/bin`, so
 * the tests point cwd at a tempdir instead of touching the repo.
 */

let root = ''

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => root }
}))

const { whisperExePath, WHISPER_EXE_NAMES } = await import('./paths')

function binDir(): string {
  return path.join(root, 'resources', 'bin')
}

function put(name: string, bytes = 'exe'): string {
  mkdirSync(binDir(), { recursive: true })
  const file = path.join(binDir(), name)
  writeFileSync(file, bytes)
  return file
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'imagii-whisper-paths-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('whisperExePath — either name sets captions up (T-89)', () => {
  it('names whisper-cli.exe first and whisper.exe second', () => {
    expect([...WHISPER_EXE_NAMES]).toEqual(['whisper-cli.exe', 'whisper.exe'])
  })

  it('finds whisper-cli.exe, the name current whisper.cpp builds ship', () => {
    const file = put('whisper-cli.exe')
    const status = whisperExePath()
    expect(status.exists).toBe(true)
    expect(status.path).toBe(file)
    expect(status.sizeBytes).toBe(3)
  })

  it('still finds whisper.exe for a user who set up under the old name', () => {
    const file = put('whisper.exe')
    const status = whisperExePath()
    expect(status.exists).toBe(true)
    expect(status.path).toBe(file)
  })

  it('prefers whisper-cli.exe when both are there', () => {
    put('whisper.exe', 'old-deprecation-stub')
    const cli = put('whisper-cli.exe', 'real-engine')
    const status = whisperExePath()
    expect(status.path).toBe(cli)
    expect(status.sizeBytes).toBe('real-engine'.length)
  })

  it('with neither, reports the PREFERRED name as the missing path — the file the card asks for', () => {
    mkdirSync(binDir(), { recursive: true })
    const status = whisperExePath()
    expect(status.exists).toBe(false)
    expect(status.path).toBe(path.join(binDir(), 'whisper-cli.exe'))
    expect(status.sizeBytes).toBe(0)
  })

  it('with no bin folder at all, the same answer (a fresh install)', () => {
    const status = whisperExePath()
    expect(status.exists).toBe(false)
    expect(path.basename(status.path)).toBe('whisper-cli.exe')
  })
})
