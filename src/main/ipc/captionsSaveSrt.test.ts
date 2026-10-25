import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { userFacingError } from '../../shared/userFacingError'

/**
 * T-116 (2) - "Save .srt" tells the person what is wrong, in a sentence, and BEFORE it asks where to save.
 *
 * `captions:saveSrt` THROWS for a transcript outside the captions folder (a project file may name any
 * safe path as its srtPath) and used to find a missing one only after the Save dialog had been answered
 * (`copyFile` ENOENT, so a person picked a file name for a copy that could not be made). The panel's
 * catch turned the first into its bare fallback ("Couldn't save the captions file.") with no cause. Both
 * are now finished sentences from main, which `userFacingError` (tier 2) lets stand, and the missing file
 * is found before the dialog opens, the way `captions:writeKitSrt` does.
 *
 * This runs the REAL handler on REAL files; only electron and the captions folder's location are stood in
 * for. The end-to-end version (the button, the toast the person reads) is in video-pipelines.spec.ts.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
let scratch = ''
let captionsDir = ''
const showSaveDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [{}] },
  shell: {},
  app: { getPath: () => tmpdir() }
}))
vi.mock('../sidecars/whisperManager', () => ({
  cancelBurnIn: vi.fn(),
  cancelTranscribe: vi.fn(),
  cancelWhisperModelInstall: vi.fn(),
  getCaptionsStatus: vi.fn(),
  installWhisperModel: vi.fn(),
  runBurnIn: vi.fn(),
  runTranscribe: vi.fn()
}))
vi.mock('../sidecars/paths', () => ({
  captionsOutputDir: () => captionsDir
}))

// T-139 (1): the failures a disk makes, injected into the real `node:fs/promises` (everything else in it stays real). Off unless a test turns one on.
const faults = vi.hoisted(() => ({
  /** The next write puts the first half of its bytes on disk, then fails with ENOSPC. */
  writeThenFail: false,
  /** The next rename fails with EPERM. */
  renameFails: false
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    writeFile: async (file: string, data: string | Buffer, ...rest: unknown[]) => {
      if (faults.writeThenFail) {
        const bytes = Buffer.from(data)
        await real.writeFile(file, bytes.subarray(0, Math.ceil(bytes.length / 2)))
        throw Object.assign(new Error('ENOSPC: simulated, write'), { code: 'ENOSPC' })
      }
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
    },
    // The old handler copied with `copyFile`, which truncates the target and then fills it: the same half-way failure, at the call it made.
    copyFile: async (from: string, to: string, ...rest: unknown[]) => {
      if (faults.writeThenFail) {
        const bytes = await real.readFile(from)
        await real.writeFile(to, bytes.subarray(0, Math.ceil(bytes.length / 2)))
        throw Object.assign(new Error('ENOSPC: simulated, copyfile'), { code: 'ENOSPC' })
      }
      return (real.copyFile as (...a: unknown[]) => Promise<void>)(from, to, ...rest)
    },
    rename: async (from: string, to: string) => {
      if (faults.renameFails) throw Object.assign(new Error('EPERM: simulated, rename'), { code: 'EPERM' })
      return real.rename(from, to)
    }
  }
})

const { registerCaptionsIpc } = await import('./captions')

const GONE = "That transcript isn't on this computer anymore — transcribe the video again."
const OUTSIDE =
  "That transcript isn't in imagii's captions folder on this computer — transcribe the video again."
const FALLBACK = "Couldn't save the captions file."

const saveSrt = (srtPath: unknown, defaultName: unknown = 'clip.srt'): Promise<unknown> => {
  const handler = handlers.get('captions:saveSrt')
  if (!handler) throw new Error('captions:saveSrt was not registered')
  return handler({}, srtPath, defaultName)
}

/** What a person reads when `err` reaches the panel's `reportFailure`: through the Electron envelope, like the real bridge. */
async function shownFor(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => null,
    (e: unknown) => e
  )
  expect(err, 'the handler refused').toBeInstanceOf(Error)
  const wrapped = new Error(`Error invoking remote method 'captions:saveSrt': Error: ${(err as Error).message}`)
  return userFacingError(wrapped, FALLBACK).message
}

let srt = ''
let picked = ''
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  faults.writeThenFail = false
  faults.renameFails = false
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-savesrt-'))
  captionsDir = path.join(scratch, 'captions')
  mkdirSync(captionsDir, { recursive: true })
  srt = path.join(captionsDir, 'stream.srt')
  writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nfirst line\n', 'utf8')
  picked = path.join(scratch, 'chosen.srt')
  showSaveDialog.mockReset()
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: picked })
  handlers.clear()
  registerCaptionsIpc()
})
afterEach(() => {
  consoleError.mockRestore()
  rmSync(scratch, { recursive: true, force: true })
})

describe('captions:saveSrt says what is wrong in a sentence (T-116)', () => {
  it('a transcript that is gone is refused BEFORE the Save dialog opens, in a finished sentence', async () => {
    const gone = path.join(captionsDir, 'gone.srt')
    await expect(saveSrt(gone)).rejects.toThrow(GONE)
    expect(showSaveDialog, 'no one is asked where to save a copy that cannot be made').not.toHaveBeenCalled()
    expect(existsSync(picked)).toBe(false)
    // The sentence has no path in it; the detail is for the console.
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(gone)
  })

  it('a transcript outside the captions folder is refused in a finished sentence, with nothing read or asked', async () => {
    const outside = path.join(scratch, 'elsewhere.srt')
    writeFileSync(outside, 'secret', 'utf8')
    await expect(saveSrt(outside)).rejects.toThrow(OUTSIDE)
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(existsSync(picked)).toBe(false)
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(outside)
  })

  it('the folder gate answers first: a path outside the folder is "outside" whether or not a file is there', async () => {
    // Saying "gone" for an outside path would tell a caller which paths exist anywhere on the disk.
    await expect(saveSrt(path.join(scratch, 'nothing-here.srt'))).rejects.toThrow(OUTSIDE)
    await expect(saveSrt(`${captionsDir}${path.sep}..${path.sep}nothing-here.srt`)).rejects.toThrow(OUTSIDE)
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it.each([
    ['gone', GONE, () => path.join(captionsDir, 'gone.srt')],
    ['outside the folder', OUTSIDE, () => path.join(scratch, 'elsewhere.srt')]
  ])('the %s sentence is shown as written - userFacingError lets it stand, with no channel name in it', async (_label, sentence, source) => {
    const shown = await shownFor(saveSrt(source()))
    expect(shown).toBe(sentence)
    // Not the panel's bare fallback, and not main's plumbing.
    expect(shown).not.toBe(FALLBACK)
    expect(shown).not.toMatch(/saveSrt|captions:|invoking remote|ENOENT|directory|path/i)
    expect(shown.length).toBeLessThanOrEqual(240)
    expect(shown).toMatch(/transcribe the video again\.$/)
  })

  it('a payload that is not a path is still a plain refusal (the validators run first)', async () => {
    await expect(saveSrt('')).rejects.toThrow()
    await expect(saveSrt(42)).rejects.toThrow()
    await expect(saveSrt(srt, '')).rejects.toThrow()
    expect(showSaveDialog).not.toHaveBeenCalled()
  })
})

// T-117 (2): the folder gate asks whether the RELATIVE path leaves the folder, which means a real
// parent segment (`..` as a whole segment), not a name that merely starts with two dots. Transcripts
// are named from the video, `..intro.mp4` is a legal file name on Windows, and the gate used to
// answer "outside" for the app's OWN file - and round 66's sentence then sent the person to
// transcribe again, which wrote the same name into the same folder, and refused it again.
describe('captions:saveSrt: a name that starts with two dots is still in the folder (T-117)', () => {
  it.each(['...and then-123.srt', '..intro.srt', '.. .srt', '....srt'])(
    'a transcript called %s, in the captions folder, is saved',
    async (name) => {
      const inFolder = path.join(captionsDir, name)
      writeFileSync(inFolder, '1\n00:00:00,000 --> 00:00:01,000\nin the folder\n', 'utf8')
      await expect(saveSrt(inFolder, 'My stream.srt')).resolves.toBe(picked)
      expect(readFileSync(picked, 'utf8')).toBe(readFileSync(inFolder, 'utf8'))
      expect(showSaveDialog).toHaveBeenCalledTimes(1)
    }
  )

  it('a transcript inside a sub-folder whose name starts with two dots is saved too', async () => {
    const sub = path.join(captionsDir, '..old stream')
    mkdirSync(sub, { recursive: true })
    const inSub = path.join(sub, 'clip.srt')
    writeFileSync(inSub, '1\n00:00:00,000 --> 00:00:01,000\nin a ..folder\n', 'utf8')
    await expect(saveSrt(inSub)).resolves.toBe(picked)
    expect(readFileSync(picked, 'utf8')).toBe(readFileSync(inSub, 'utf8'))
  })

  it('a ..-named transcript that is gone is "gone", not "outside" (it passed the folder gate)', async () => {
    await expect(saveSrt(path.join(captionsDir, '...and then-123.srt'))).rejects.toThrow(GONE)
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it.each([
    ['the folder\'s parent', () => scratch],
    ['a file one level up', () => path.join(scratch, 'elsewhere.srt')],
    ['a sibling whose name starts with the folder\'s', () => path.join(scratch, 'captions-evil', 'x.srt')],
    ['a climb that comes back down into a ..-named file', () => path.join(captionsDir, '..', '..intro.srt')],
    ['a climb written with the separator', () => `${captionsDir}${path.sep}..${path.sep}stream.srt`]
  ])('a real traversal is still refused: %s', async (_label, target) => {
    const t = target()
    mkdirSync(path.dirname(t), { recursive: true })
    if (t !== scratch) writeFileSync(t, 'secret', 'utf8')
    await expect(saveSrt(t)).rejects.toThrow(OUTSIDE)
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(existsSync(picked)).toBe(false)
  })
})

describe('captions:saveSrt still saves (T-116)', () => {
  it('a transcript in the captions folder is copied to where the dialog said, and that path is returned', async () => {
    await expect(saveSrt(srt, 'My stream.srt')).resolves.toBe(picked)
    expect(readFileSync(picked, 'utf8')).toBe(readFileSync(srt, 'utf8'))
    expect(showSaveDialog).toHaveBeenCalledTimes(1)
    expect(showSaveDialog.mock.calls[0]?.[1]).toMatchObject({ defaultPath: 'My stream.srt' })
  })

  it('a canceled dialog writes nothing and answers null (not a failure)', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true })
    await expect(saveSrt(srt)).resolves.toBeNull()
    expect(existsSync(picked)).toBe(false)
  })
})

/**
 * T-139 (1) - "Save .srt" over a subtitle file the person already has: it is that file until the copy is whole.
 *
 * `copyFile(transcript, chosen)` opens the chosen file for writing and truncates it, so a copy that failed part-way (a full drive) left a stub where the
 * person's subtitles had been. The handler reads the transcript and writes it through `writeFileAtomic` (a copy to a tmp beside the target, then a rename).
 */
describe('captions:saveSrt over an existing file (T-139 (1))', () => {
  const OLD = '1\n00:00:00,000 --> 00:00:01,000\nthe old subtitles, whole\n'
  const wasUntouched = (): void => {
    expect(readFileSync(picked, 'utf8')).toBe(OLD)
    expect(readdirSync(scratch).sort(), 'no tmp is left beside the file the person chose').toEqual(['captions', 'chosen.srt'])
    expect(readFileSync(srt, 'utf8'), 'the transcript itself is untouched').toContain('first line')
  }

  it('a disk that fills part-way leaves the old subtitles byte-identical, and the person is told why', async () => {
    writeFileSync(picked, OLD)
    faults.writeThenFail = true
    const err = await saveSrt(srt).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    wasUntouched()
    expect(await shownFor(saveSrt(srt))).toBe(`${FALLBACK} Your disk is full. Free up some space and try again.`)
    wasUntouched()
  })

  it('a rename the OS refuses (the subtitle file open in an editor) leaves the old subtitles whole', async () => {
    writeFileSync(picked, OLD)
    faults.renameFails = true
    expect(await shownFor(saveSrt(srt))).toBe(`${FALLBACK} Windows blocked access to a file. Close any app using it, or check your antivirus.`)
    wasUntouched()
  })

  it('a copy that succeeds is the transcript byte for byte (a byte order mark, CRLF line ends and a byte that is not UTF-8 are not re-encoded) and leaves no tmp', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('1\r\n00:00:00,000 --> 00:00:01,000\r\ncaf', 'utf8'), Buffer.from([0xe9]), Buffer.from('\r\n')])
    writeFileSync(srt, bytes)
    writeFileSync(picked, OLD)
    await expect(saveSrt(srt)).resolves.toBe(picked)
    expect(readFileSync(picked).equals(bytes)).toBe(true)
    expect(readdirSync(scratch).sort()).toEqual(['captions', 'chosen.srt'])
  })

  it('a FIRST save that fails leaves no file at all', async () => {
    faults.writeThenFail = true
    await expect(saveSrt(srt)).rejects.toThrow('ENOSPC')
    expect(existsSync(picked)).toBe(false)
    expect(readdirSync(scratch)).toEqual(['captions'])
  })
})
