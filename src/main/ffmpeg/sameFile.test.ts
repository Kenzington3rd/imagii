import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { userFacingError } from '../../shared/userFacingError'
import { OUTPUT_IS_AN_INPUT_MESSAGE, refuseOutputOverInputs, sameFile } from './sameFile'

/**
 * T-141 (1) - `sameFile`: do two paths name one file?
 *
 * Since T-140 (1) ffmpeg is never handed the chosen path (it writes a partial beside it and the runner renames the partial over the target), so the refusal ffmpeg
 * itself made at its own open, "FFmpeg cannot edit existing files in-place", is gone: an output the Save dialog aimed at a file the job READS was rendered and
 * swapped over it (executed: the audio export over its source, the re-attach over its video, a ranged burn-in over its VOD). The runners ask this before any spawn.
 *
 * "Same file" is by resolved path: `realpath` where the file exists (a symlink, a symlinked folder, a `..` detour, and on Windows the true case and the long name
 * of an 8.3 one), `path.resolve` where it does not, and a case-insensitive compare on win32. The platform is a parameter so the Windows rule is a unit on any host.
 * A hard link is deliberately not "the same file" here: the swap renames the partial over the DIRECTORY ENTRY, so the other link keeps the old bytes.
 */

let dir = ''

// Windows refuses a symlink without the privilege (or developer mode); the rows that need one say so and skip. Decided at load, because `skipIf` reads it then.
const canSymlink = ((): boolean => {
  const probe = mkdtempSync(path.join(tmpdir(), 'imagii-samefile-probe-'))
  try {
    writeFileSync(path.join(probe, 'a'), 'a')
    symlinkSync(path.join(probe, 'a'), path.join(probe, 'b'))
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-samefile-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const touch = (name: string, text = 'bytes'): string => {
  const file = path.join(dir, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

describe('sameFile', () => {
  it('the same path is the same file, and two files in one folder are not', async () => {
    const a = touch('vod.mp4')
    const b = touch('vod-captioned.mp4')
    expect(await sameFile(a, a)).toBe(true)
    expect(await sameFile(a, b)).toBe(false)
  })

  it('a path that reaches the file by a detour is the same file', async () => {
    const a = touch('vod.mp4')
    touch('sub/other.mp4')
    expect(await sameFile(a, path.join(dir, 'sub', '..', 'vod.mp4'))).toBe(true)
    expect(await sameFile(a, path.join(dir, '.', 'vod.mp4'))).toBe(true)
  })

  it.skipIf(!canSymlink)('a symlink to the file is the same file (realpath), and a symlinked folder does not hide it', async () => {
    const a = touch('real/vod.mp4')
    symlinkSync(a, path.join(dir, 'link.mp4'))
    symlinkSync(path.join(dir, 'real'), path.join(dir, 'folder-link'), 'dir')
    expect(await sameFile(a, path.join(dir, 'link.mp4')), 'the link').toBe(true)
    expect(await sameFile(path.join(dir, 'link.mp4'), a), 'and it is symmetric').toBe(true)
    expect(await sameFile(a, path.join(dir, 'folder-link', 'vod.mp4')), 'the file seen through a symlinked folder').toBe(true)
    touch('real/other.mp4')
    expect(await sameFile(a, path.join(dir, 'folder-link', 'other.mp4')), 'a neighbour seen the same way is not').toBe(false)
  })

  it('a name nothing is at is compared by its resolved path: the same once resolved, otherwise not', async () => {
    const missing = path.join(dir, 'not-yet.mp4')
    // Spelled by hand: `path.join` would normalise the detour away. Neither `sub` nor the file is there, so `realpath` fails and the resolved path is all there is.
    expect(await sameFile(missing, `${dir}${path.sep}sub${path.sep}..${path.sep}not-yet.mp4`), 'a detour through a folder that is not there').toBe(true)
    expect(await sameFile(missing, path.relative(process.cwd(), missing)), 'a relative spelling of it').toBe(true)
    expect(await sameFile(missing, path.join(dir, 'else.mp4'))).toBe(false)
    expect(await sameFile(touch('here.mp4'), path.join(dir, 'here-not.mp4')), 'one that exists, one that does not').toBe(false)
  })

  it('case: win32 folds it (NTFS is case-insensitive), every other platform keeps it', async () => {
    const real = touch('Vod.MP4')
    const variant = path.join(dir, 'vod.mp4')
    expect(await sameFile(real, variant, 'win32'), 'a case variant of an existing file, on win32').toBe(true)
    expect(await sameFile(real, variant, 'linux'), 'the same two names on a case-sensitive platform').toBe(false)
    expect(await sameFile(path.join(dir, 'A.mp4'), path.join(dir, 'a.mp4'), 'win32'), 'two names nothing is at, on win32').toBe(true)
    expect(await sameFile(path.join(dir, 'A.mp4'), path.join(dir, 'a.mp4'), 'darwin'), 'and on darwin, where the compare is the resolved path alone').toBe(false)
    expect(await sameFile(path.join(dir, 'a.mp4'), path.join(dir, 'b.mp4'), 'win32'), 'win32 still tells two names apart').toBe(false)
  })

  it('a hard link is not the same file here: the swap replaces a directory entry, so the other link keeps its bytes', async () => {
    // Documented so nobody "fixes" it with an inode compare: the partial is renamed over the TARGET'S entry only.
    const a = touch('vod.mp4')
    const linked = path.join(dir, 'hard.mp4')
    try {
      linkSync(a, linked)
    } catch {
      return // a filesystem without hard links: nothing to say
    }
    expect(await sameFile(a, linked)).toBe(false)
  })
})

describe('refuseOutputOverInputs', () => {
  it('refuses an output that is any one of the inputs, with the one sentence, and names both paths in the console only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const source = touch('voice.wav')
    const music = touch('bed.wav')
    await expect(refuseOutputOverInputs([music], [source, music])).rejects.toThrow(OUTPUT_IS_AN_INPUT_MESSAGE)
    const err = (await refuseOutputOverInputs([music], [source, music]).catch((e: unknown) => e)) as Error
    expect(err.message, 'exactly the sentence: no path in what the person reads').toBe(OUTPUT_IS_AN_INPUT_MESSAGE)
    expect(log.mock.calls.flat().join(' '), 'the detail went to the console').toContain(music)
  })

  it('checks every output: the re-attach\'s scratch WAV as well as the video it makes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const secondTrack = touch('clip.cleaned.wav')
    const outputs = [path.join(dir, 'clip.mp4'), secondTrack]
    await expect(refuseOutputOverInputs(outputs, [touch('voice.wav'), secondTrack])).rejects.toThrow(OUTPUT_IS_AN_INPUT_MESSAGE)
  })

  it('lets a different output through, and skips an input that is not set (no second track, no srt)', async () => {
    const source = touch('voice.wav')
    await expect(refuseOutputOverInputs([path.join(dir, 'cleaned.mp3')], [source, undefined, null, ''])).resolves.toBeUndefined()
  })

  it('the sentence is one finished line a person can act on, and userFacingError lets it stand through the IPC envelope', () => {
    expect(OUTPUT_IS_AN_INPUT_MESSAGE).toBe("That is the file imagii is reading from, so it can't be replaced by the new one. Pick a different name, then try again.")
    expect(OUTPUT_IS_AN_INPUT_MESSAGE.length).toBeLessThanOrEqual(240)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(userFacingError(new Error(OUTPUT_IS_AN_INPUT_MESSAGE), 'Export failed.')).toEqual({ cancelled: false, message: OUTPUT_IS_AN_INPUT_MESSAGE })
    expect(
      userFacingError(new Error(`Error invoking remote method 'audio:export': Error: ${OUTPUT_IS_AN_INPUT_MESSAGE}`), 'Export failed.').message,
      'after Electron wraps it for the renderer'
    ).toBe(OUTPUT_IS_AN_INPUT_MESSAGE)
  })
})
