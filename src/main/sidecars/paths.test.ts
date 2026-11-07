import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-89 — the captions engine is found under either name.
 * T-102 — and in the folder that survives a relaunch.
 *
 * The setup card sent people to fetch `whisper.exe`; current whisper.cpp
 * builds ship `whisper-cli.exe`. The resolver accepts both, prefers the new
 * name, and reports the preferred name's path when neither is there (that is
 * the file the card asks for).
 *
 * The portable exe unpacks to %TEMP% on every launch, so the resources folder
 * the card used to name is scratch and not a place to install anything. The
 * resolver looks in `<userData>/bin` FIRST and only then beside the app, and a
 * miss reports the userData path. Dev builds look under `<cwd>/resources/bin`,
 * and `app.getPath('userData')` is mocked to the same tempdir, so both folders
 * are fixtures here and nothing touches the repo.
 */

let root = ''

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => root }
}))

const { whisperExePath, WHISPER_EXE_NAMES, userBinDir } = await import('./paths')

/** The folder beside the app (a dev checkout's resources/bin). */
function resourcesDir(): string {
  return path.join(root, 'resources', 'bin')
}

/** The per-user folder: <userData>/bin. */
function userDir(): string {
  return path.join(root, 'bin')
}

function putIn(dir: string, name: string, bytes = 'exe'): string {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  writeFileSync(file, bytes)
  return file
}

const put = (name: string, bytes?: string): string => putIn(resourcesDir(), name, bytes)
const putUser = (name: string, bytes?: string): string => putIn(userDir(), name, bytes)

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

  it('the same two rules hold in the per-user folder', () => {
    const old = putUser('whisper.exe', 'old-deprecation-stub')
    expect(whisperExePath().path).toBe(old)
    const cli = putUser('whisper-cli.exe', 'real-engine')
    const status = whisperExePath()
    expect(status.path).toBe(cli)
    expect(status.sizeBytes).toBe('real-engine'.length)
  })
})

describe('whisperExePath — the per-user folder is looked in first and is what a miss names (T-102)', () => {
  it('userBinDir is <userData>/bin', () => {
    expect(userBinDir()).toBe(userDir())
  })

  it('finds the engine in <userData>/bin when the folder beside the app has nothing', () => {
    const file = putUser('whisper-cli.exe')
    const status = whisperExePath()
    expect(status.exists).toBe(true)
    expect(status.path).toBe(file)
  })

  // The whole order, one fixture per rung. Each case puts a file on a rung AND
  // on every rung below it; the answer must be the highest.
  const ladder: Array<[string, () => string]> = [
    ['<userData>/bin/whisper-cli.exe', () => putUser('whisper-cli.exe', 'u-cli')],
    ['<userData>/bin/whisper.exe', () => putUser('whisper.exe', 'u-old')],
    ['<resources>/bin/whisper-cli.exe', () => put('whisper-cli.exe', 'r-cli')],
    ['<resources>/bin/whisper.exe', () => put('whisper.exe', 'r-old')]
  ]

  for (let top = 0; top < ladder.length; top++) {
    const row = ladder[top]
    if (!row) continue
    it(`with every rung from ${row[0]} down present, that rung wins`, () => {
      let expected = ''
      for (let i = top; i < ladder.length; i++) {
        const entry = ladder[i]
        if (!entry) continue
        const file = entry[1]()
        if (i === top) expected = file
      }
      const status = whisperExePath()
      expect(status.exists).toBe(true)
      expect(status.path).toBe(expected)
    })
  }

  it('a file in the per-user folder beats the same name beside the app, even when that one is bigger', () => {
    put('whisper-cli.exe', 'a-much-larger-copy-beside-the-app')
    const mine = putUser('whisper-cli.exe', 'mine')
    const status = whisperExePath()
    expect(status.path).toBe(mine)
    expect(status.sizeBytes).toBe('mine'.length)
  })

  it('the old name in the per-user folder beats the new name beside the app (the folder decides first, the name second)', () => {
    put('whisper-cli.exe', 'beside-the-app')
    const mine = putUser('whisper.exe', 'mine')
    expect(whisperExePath().path).toBe(mine)
  })

  it('a binary only the resources folder has is still found (a dev checkout, or a build that ships one)', () => {
    const file = put('whisper-cli.exe')
    expect(whisperExePath().path).toBe(file)
  })

  it('with neither, reports the PREFERRED name in the PER-USER folder as the missing path — the file the card asks for', () => {
    const status = whisperExePath()
    expect(status.exists).toBe(false)
    expect(status.path).toBe(path.join(userDir(), 'whisper-cli.exe'))
    expect(status.sizeBytes).toBe(0)
  })

  it('creates <userData>/bin the first time it is asked, so Open folder has somewhere to go', () => {
    expect(existsSync(userDir())).toBe(false)
    whisperExePath()
    expect(statSync(userDir()).isDirectory()).toBe(true)
    // ...and asking again is harmless.
    expect(() => whisperExePath()).not.toThrow()
  })

  it('creating the folder cannot fail the lookup: a profile that is a FILE still answers', () => {
    // <userData>/bin cannot be made when a file sits where the folder would go.
    writeFileSync(userDir(), 'not a folder')
    const status = whisperExePath()
    expect(status.exists).toBe(false)
    expect(status.path).toBe(path.join(userDir(), 'whisper-cli.exe'))
    // A binary beside the app is still found past the unmakeable folder.
    const file = put('whisper-cli.exe')
    expect(whisperExePath().path).toBe(file)
  })

  it('with a bin folder that is empty, the same answer (a fresh install)', () => {
    mkdirSync(userDir(), { recursive: true })
    const status = whisperExePath()
    expect(status.exists).toBe(false)
    expect(path.basename(status.path)).toBe('whisper-cli.exe')
    expect(path.dirname(status.path)).toBe(userDir())
  })
})
