import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { userFacingError } from '../shared/userFacingError'

let tempDir: string

// Stub electron's `app.getPath('userData')` to point to a per-test tempDir.
// Vitest hoists vi.mock to the top of the file, but our `tempDir` is mutated
// per test, so we use vi.doMock + dynamic import inside each test.
function buildAutosaveModule(
  // T-118: a stand-in for `unlink`, for the failures a test machine cannot make on demand (a file
  // another app holds open is EBUSY on Windows only). Everything else in node:fs/promises is real.
  unlink?: (p: string) => Promise<void>
): Promise<typeof import('./autosave')> {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name === 'userData') return tempDir
        return tempDir
      }
    }
  }))
  if (unlink) {
    vi.doMock('node:fs/promises', async () => ({
      ...(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')),
      unlink
    }))
  }
  return import('./autosave')
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'imagii-autosave-'))
})

afterEach(async () => {
  vi.doUnmock('node:fs/promises')
  await rm(tempDir, { recursive: true, force: true })
})

const validProject = () => ({
  schemaVersion: 1 as const,
  savedAt: Date.now(),
  appVersion: '1.0.0',
  videoStudio: {
    sourcePath: 'C:/test/video.mp4',
    clips: [],
    selectedClipId: null,
    watermark: null
  }
})

describe('autosave atomic write', () => {
  it('round-trips a valid project', async () => {
    const m = await buildAutosaveModule()
    const writeResult = await m.writeAutosave(validProject())
    expect(writeResult.ok).toBe(true)

    const readResult = await m.readAutosave()
    expect(readResult.ok).toBe(true)
    if (readResult.ok && readResult.project) {
      expect(readResult.project.appVersion).toBe('1.0.0')
      expect(readResult.project.videoStudio?.sourcePath).toBe('C:/test/video.mp4')
    }
  })

  it('refuses to save an empty project', async () => {
    const m = await buildAutosaveModule()
    const result = await m.writeAutosave({
      schemaVersion: 1,
      savedAt: Date.now(),
      appVersion: '1.0.0'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no studio state/)
  })

  it('overwrites existing autosave and creates a backup of the previous one', async () => {
    const m = await buildAutosaveModule()
    const v1 = validProject()
    v1.videoStudio.sourcePath = 'C:/v1.mp4'
    await m.writeAutosave(v1)

    const v2 = validProject()
    v2.videoStudio.sourcePath = 'C:/v2.mp4'
    const w2 = await m.writeAutosave(v2)
    expect(w2.ok).toBe(true)

    const dir = path.join(tempDir, 'autosave')
    const primary = await readFile(path.join(dir, 'autosave.json'), 'utf8')
    const backup = await readFile(path.join(dir, 'autosave.prev.json'), 'utf8')
    expect(primary).toMatch('v2.mp4')
    expect(backup).toMatch('v1.mp4')
  })

  it('recovers from .prev when the primary file is corrupt', async () => {
    const m = await buildAutosaveModule()
    await m.writeAutosave(validProject())
    const v2 = validProject()
    v2.videoStudio.sourcePath = 'C:/good-second.mp4'
    await m.writeAutosave(v2)

    // Corrupt the primary file (simulate a partial write that somehow survived)
    const primaryPath = path.join(tempDir, 'autosave', 'autosave.json')
    await writeFile(primaryPath, '{not valid json', 'utf8')

    const r = await m.readAutosave()
    expect(r.ok).toBe(true)
    expect(r.reason).toMatch(/recovered from backup/)
    if (r.ok && r.project) {
      expect(r.project.videoStudio?.sourcePath).not.toBe('C:/good-second.mp4')
    }
  })

  it('an autosave from before T-113 (the overlay color stored as the NAME "white") restores, and is not a corruption banner (T-114)', async () => {
    const dir = path.join(tempDir, 'autosave')
    await mkdir(dir, { recursive: true })
    // Verbatim what that build wrote: schema 5, the editor's old default color.
    await writeFile(
      path.join(dir, 'autosave.json'),
      JSON.stringify({
        schemaVersion: 5,
        savedAt: Date.now(),
        appVersion: '1.5.0',
        videoStudio: {
          sourcePath: 'C:/Users/mike/Videos/stream.mp4',
          clips: [
            {
              id: 'c1', name: 'Clip 1', startSec: 12, endSec: 40, cropRect: null,
              selectedPresets: ['tiktok'], speedMultiplier: 1,
              textOverlays: [
                { id: 'o1', text: 'Your text here', font: 'Arial', sizePx: 48, colorHex: 'white', x: 0.1, y: 0.85, startSec: 12, endSec: 40 }
              ]
            }
          ],
          selectedClipId: 'c1',
          watermark: null
        }
      }),
      'utf8'
    )
    const m = await buildAutosaveModule()
    const r = await m.readAutosave()
    expect(r.ok, JSON.stringify(r)).toBe(true)
    const clip = r.ok && r.project ? (r.project.videoStudio?.clips[0] as { textOverlays?: Array<{ colorHex: string }> }) : null
    expect(clip?.textOverlays?.[0]?.colorHex).toBe('#ffffff')
    // The launch banner reads the same file: a real savedAt, not "found but failed validation".
    expect((await m.getAutosaveInfo()).savedAt).toBeGreaterThan(0)
  })

  it('an autosave whose overlay SIZE is outside what the gate takes (the old editor clamped nothing) restores at the nearest size (T-115)', async () => {
    const dir = path.join(tempDir, 'autosave')
    await mkdir(dir, { recursive: true })
    // Verbatim what the build before the editor's 8-512 clamp wrote: a person who typed 800.
    await writeFile(
      path.join(dir, 'autosave.json'),
      JSON.stringify({
        schemaVersion: 5,
        savedAt: Date.now(),
        appVersion: '1.5.0',
        videoStudio: {
          sourcePath: 'C:/Users/mike/Videos/stream.mp4',
          clips: [
            {
              id: 'c1', name: 'Clip 1', startSec: 12, endSec: 40, cropRect: null,
              selectedPresets: ['tiktok'], speedMultiplier: 1,
              textOverlays: [
                { id: 'o1', text: 'Big', font: 'Arial', sizePx: 800, colorHex: '#ffffff', x: 0.1, y: 0.85, startSec: 12, endSec: 40 },
                { id: 'o2', text: 'Tiny', font: 'Arial', sizePx: 3, colorHex: '#ffffff', x: 0.1, y: 0.5, startSec: 12, endSec: 40 }
              ]
            }
          ],
          selectedClipId: 'c1',
          watermark: null
        }
      }),
      'utf8'
    )
    const m = await buildAutosaveModule()
    const r = await m.readAutosave()
    expect(r.ok, JSON.stringify(r)).toBe(true)
    const clip = r.ok && r.project ? (r.project.videoStudio?.clips[0] as { textOverlays?: Array<{ sizePx: number }> }) : null
    expect(clip?.textOverlays?.map((o) => o.sizePx)).toEqual([512, 8])
    expect((await m.getAutosaveInfo()).savedAt).toBeGreaterThan(0)
  })

  it('returns ok=false when both files are corrupt', async () => {
    const m = await buildAutosaveModule()
    const dir = path.join(tempDir, 'autosave')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'autosave.json'), 'garbage', 'utf8')
    await writeFile(path.join(dir, 'autosave.prev.json'), 'also garbage', 'utf8')

    const r = await m.readAutosave()
    expect(r.ok).toBe(false)
  })

  it('returns ok=false when no autosave exists', async () => {
    const m = await buildAutosaveModule()
    const r = await m.readAutosave()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/does not exist/)
  })

  it('clearAutosave removes both primary and backup', async () => {
    const m = await buildAutosaveModule()
    await m.writeAutosave(validProject())
    await m.writeAutosave(validProject())
    await expect(m.clearAutosave()).resolves.toBeUndefined()

    const dir = path.join(tempDir, 'autosave')
    expect(existsSync(path.join(dir, 'autosave.json'))).toBe(false)
    expect(existsSync(path.join(dir, 'autosave.prev.json'))).toBe(false)
  })

  it('clearAutosave is a no-op when there is nothing to clear', async () => {
    const m = await buildAutosaveModule()
    await expect(m.clearAutosave()).resolves.toBeUndefined()
  })

  // T-57: every unlink failure used to be swallowed, so the renderer heard
  // "cleared" about a file that was still there — the banner disappeared and
  // came straight back on the next launch with nothing said. A delete that
  // did not happen is now reported.
  it('clearAutosave reports a file it could not delete', async () => {
    const m = await buildAutosaveModule()
    await m.writeAutosave(validProject())
    const dir = path.join(tempDir, 'autosave')
    // A directory in the temp file's place: unlink refuses it on every OS
    // (EISDIR/EPERM), which is what a locked or read-only file does too, and
    // unlike a chmod it behaves the same for root and on Windows.
    await mkdir(path.join(dir, 'autosave.tmp', 'occupied'), { recursive: true })

    // T-118: the first failed unlink's errno rides along - EISDIR on linux, EPERM on macOS and
    // Windows, whichever this OS answers - so userFacingError can name a locked file.
    await expect(m.clearAutosave()).rejects.toThrow(/^could not delete autosave\.tmp \((EISDIR|EPERM)\)$/)

    // The files it COULD delete are still gone — a partial failure does not
    // put the autosave back, and the message names only what survived.
    expect(existsSync(path.join(dir, 'autosave.json'))).toBe(false)
    expect(existsSync(path.join(dir, 'autosave.tmp'))).toBe(true)
  })

  it('clearAutosave names the autosave itself when that is what survived', async () => {
    const m = await buildAutosaveModule()
    const dir = path.join(tempDir, 'autosave')
    await mkdir(path.join(dir, 'autosave.json', 'occupied'), { recursive: true })

    await expect(m.clearAutosave()).rejects.toThrow(/^could not delete autosave\.json \((EISDIR|EPERM)\)$/)
  })

  // T-118: round 67 sent the Clear failure through userFacingError, which names a locked file
  // ("Windows blocked access to a file. Close any app using it...") - but this function swallowed
  // every unlink errno and threw the shapeless "could not delete X", so the cause line could never
  // fire and the remedy was gone for the one case it was true of. The first failed unlink's code is
  // in the message now, and these drive the real function through the real helper.
  describe('clearAutosave carries the errno of the unlink that failed (T-118)', () => {
    const FAILED = "Couldn't clear the autosave. It's still on disk."
    const errno = (code: string): NodeJS.ErrnoException =>
      Object.assign(new Error(`${code}: simulated, unlink`), { code })
    const quiet = (): void => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
    }

    // The stand-in leaves the file where it is, which is what a locked file does.
    const refuses =
      (code: string | null) =>
      async (): Promise<void> => {
        throw code ? errno(code) : new Error('simulated, no errno')
      }

    async function failureOf(m: typeof import('./autosave')): Promise<Error> {
      try {
        await m.clearAutosave()
      } catch (err) {
        return err as Error
      }
      throw new Error('clearAutosave resolved, and the file is still there')
    }

    it('a locked file is "could not delete autosave.json (EBUSY)", and userFacingError names it', async () => {
      const m = await buildAutosaveModule(refuses('EBUSY'))
      await m.writeAutosave(validProject())
      const err = await failureOf(m)
      expect(err.message).toBe('could not delete autosave.json (EBUSY)')
      quiet()
      expect(userFacingError(err, FAILED).message).toBe(
        `${FAILED} Windows blocked access to a file. Close any app using it, or check your antivirus.`
      )
    })

    it('the same message crosses the IPC bridge and still maps (the envelope is stripped first)', async () => {
      const m = await buildAutosaveModule(refuses('EPERM'))
      await m.writeAutosave(validProject())
      const err = await failureOf(m)
      quiet()
      const wrapped = new Error(`Error invoking remote method 'autosave:clear': Error: ${err.message}`)
      expect(userFacingError(wrapped, FAILED).message).toContain('Windows blocked access to a file.')
    })

    it('a failure with no errno is the bare shape, which stays the bare fallback sentence', async () => {
      const m = await buildAutosaveModule(refuses(null))
      await m.writeAutosave(validProject())
      const err = await failureOf(m)
      // No parenthesis, no trailing period: an unknown shape must not read as a finished sentence.
      expect(err.message).toBe('could not delete autosave.json')
      quiet()
      expect(userFacingError(err, FAILED).message).toBe(FAILED)
    })

    it('an errno the helper has no cause for is the fallback too, and the code stays out of it', async () => {
      const m = await buildAutosaveModule(refuses('EROFS'))
      await m.writeAutosave(validProject())
      const err = await failureOf(m)
      expect(err.message).toBe('could not delete autosave.json (EROFS)')
      quiet()
      expect(userFacingError(err, FAILED).message).toBe(FAILED)
    })

    it('the FIRST failed unlink supplies the code, and every survivor is named', async () => {
      const dir = path.join(tempDir, 'autosave')
      const codes: Record<string, string> = { 'autosave.json': 'EBUSY', 'autosave.prev.json': 'EACCES' }
      const m = await buildAutosaveModule(async (p) => {
        throw errno(codes[path.basename(p)] ?? 'EIO')
      })
      await mkdir(dir, { recursive: true })
      for (const name of ['autosave.json', 'autosave.prev.json', 'autosave.tmp']) {
        await writeFile(path.join(dir, name), 'x', 'utf8')
      }
      expect((await failureOf(m)).message).toBe(
        'could not delete autosave.json, autosave.prev.json, autosave.tmp (EBUSY)'
      )
    })

    it('a file that vanished under the unlink is not a failure, and its code is not reported', async () => {
      // A second window cleared the same file a moment earlier: unlink says ENOENT, the file is
      // gone, and that is the outcome the caller asked for. Only the file that really stayed
      // (a folder in the temp file's place) supplies the code.
      const dir = path.join(tempDir, 'autosave')
      const { unlink: realUnlink } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      const m = await buildAutosaveModule(async (p) => {
        if (path.basename(p) === 'autosave.json') {
          await realUnlink(p)
          throw errno('ENOENT')
        }
        return realUnlink(p)
      })
      await m.writeAutosave(validProject())
      await mkdir(path.join(dir, 'autosave.tmp', 'occupied'), { recursive: true })
      const err = await failureOf(m)
      expect(err.message).toMatch(/^could not delete autosave\.tmp \((EISDIR|EPERM)\)$/)
      expect(err.message).not.toContain('ENOENT')
      expect(existsSync(path.join(dir, 'autosave.json'))).toBe(false)
    })
  })

  it('rejects payloads that fail JSON serialization', async () => {
    const m = await buildAutosaveModule()
    const circular = validProject() as unknown as Record<string, unknown>
    circular.self = circular
    const result = await m.writeAutosave(circular as unknown as ReturnType<typeof validProject>)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/serialization failed/)
  })
})

describe('autosave info', () => {
  it('reports exists=false when no file present', async () => {
    const m = await buildAutosaveModule()
    const info = await m.getAutosaveInfo()
    expect(info.exists).toBe(false)
  })

  it('reports timestamp + age once written', async () => {
    const m = await buildAutosaveModule()
    await m.writeAutosave(validProject())
    const info = await m.getAutosaveInfo()
    expect(info.exists).toBe(true)
    expect(info.savedAt).toBeGreaterThan(0)
    expect(info.ageMs).toBeGreaterThanOrEqual(0)
  })
})
