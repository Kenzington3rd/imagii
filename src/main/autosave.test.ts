import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { MAX_SCHEMA_VERSION, isSafeToAutosave, validateProjectJsonString } from '../shared/projectValidation'
import { userFacingError } from '../shared/userFacingError'
import type { ImagiiProject } from '../shared/workspace'

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

/**
 * T-139 (3) - overlapping autosave writes cannot corrupt both slots.
 *
 * `writeAutosave` wrote through ONE fixed `autosave.tmp` with no exclusion. The renderer's doSave sets `lastWriteTime` AFTER its await (so a second write can
 * start while one is in flight) and the quit flush writes beside it; overlapping calls truncated each other's tmp, a mixed file was renamed into
 * `autosave.json` and then copied over `autosave.prev.json` (executed: both slots corrupt in 6 of 6 overlapping trials). The writes now run one after
 * another (the later content wins, every caller still gets its own result) and each has its own tmp name.
 *
 * These drive the REAL module on REAL files; only electron's `userData` is pointed at a temp folder, and the failures a disk makes are injected where they are named.
 */
describe('autosave writes are serialized (T-139 (3))', () => {
  /** A valid project that is `bytes` of picture data long and says which write it is in `videoStudio.sourcePath`. */
  function tagged(tag: string, bytes: number): ImagiiProject {
    return {
      schemaVersion: MAX_SCHEMA_VERSION,
      savedAt: 1,
      appVersion: '1.0.0',
      videoStudio: { sourcePath: `C:/${tag}.mp4`, clips: [], selectedClipId: null, watermark: null },
      imageCanvas: {
        doc: {
          width: 1280,
          height: 720,
          background: '#ffffff',
          layers: [
            { id: 'img1', type: 'image', name: 'big.png', visible: true, locked: false, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, src: 'A'.repeat(bytes), width: 100, height: 100 }
          ]
        }
      }
    }
  }
  const dir = (): string => path.join(tempDir, 'autosave')
  const slot = async (name: string): Promise<{ parses: boolean; tag: string | null }> => {
    const raw = await readFile(path.join(dir(), name), 'utf8')
    const v = validateProjectJsonString(raw)
    return { parses: v.ok, tag: v.ok ? (v.project.videoStudio?.sourcePath ?? null) : null }
  }
  const BIG = 6_000_000

  /** The module over a `node:fs/promises` whose `writeFile` is `stand`, when given (everything else real). */
  function build(stand?: (real: typeof import('node:fs/promises'), file: string, data: string, rest: unknown[]) => Promise<void>): Promise<typeof import('./autosave')> {
    vi.resetModules()
    vi.doMock('electron', () => ({ app: { getPath: () => tempDir } }))
    vi.doMock('node:fs/promises', async () => {
      const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...real,
        writeFile: (file: string, data: string, ...rest: unknown[]) =>
          stand ? stand(real, file, data, rest) : (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
      }
    })
    return import('./autosave')
  }

  it('two overlapping writes of very different sizes leave a parseable current AND prev, the current is the later one, and both callers are told ok', async () => {
    for (let trial = 1; trial <= 4; trial += 1) {
      const m = await build()
      await m.writeAutosave(tagged('seed', 100))
      // The big write first, the small one right behind it: the old fixed tmp was truncated under the big one's feet.
      const [first, second] = await Promise.all([m.writeAutosave(tagged('first-big', BIG)), m.writeAutosave(tagged('second-small', 100))])
      expect(first.ok, `trial ${trial}: ${JSON.stringify(first)}`).toBe(true)
      expect(second.ok, `trial ${trial}: ${JSON.stringify(second)}`).toBe(true)
      expect(await slot('autosave.json'), `trial ${trial}: current`).toEqual({ parses: true, tag: 'C:/second-small.mp4' })
      expect(await slot('autosave.prev.json'), `trial ${trial}: prev is the write before the last, whole`).toEqual({ parses: true, tag: 'C:/first-big.mp4' })
      expect((await readdir(dir())).sort(), `trial ${trial}: no tmp left`).toEqual(['autosave.json', 'autosave.prev.json'])
      await rm(dir(), { recursive: true, force: true })
    }
  })

  it('and the other way round (small first, big behind it)', async () => {
    const m = await build()
    await m.writeAutosave(tagged('seed', 100))
    const [first, second] = await Promise.all([m.writeAutosave(tagged('first-small', 100)), m.writeAutosave(tagged('second-big', BIG))])
    expect([first.ok, second.ok]).toEqual([true, true])
    expect(await slot('autosave.json')).toEqual({ parses: true, tag: 'C:/second-big.mp4' })
    expect(await slot('autosave.prev.json')).toEqual({ parses: true, tag: 'C:/first-small.mp4' })
  })

  it('a burst of six leaves the LAST call\'s content in current and the fifth\'s in prev, and each caller got its own size', async () => {
    const m = await build()
    const sizes = [900_000, 50, 2_000_000, 300, 1_200_000, 70]
    const results = await Promise.all(sizes.map((bytes, i) => m.writeAutosave(tagged(`burst-${i}`, bytes))))
    expect(results.map((r) => r.ok)).toEqual(sizes.map(() => true))
    const written = results.map((r) => (r.ok ? r.sizeBytes : -1))
    expect(new Set(written).size, 'each result is the size of its own write').toBe(6)
    expect(await slot('autosave.json')).toEqual({ parses: true, tag: 'C:/burst-5.mp4' })
    expect(await slot('autosave.prev.json')).toEqual({ parses: true, tag: 'C:/burst-4.mp4' })
  })

  it('the quit flush beside a periodic write: both slots stay whole and the flush (the later call) is the current one', async () => {
    const ipcMain = new EventEmitter()
    vi.resetModules()
    vi.doMock('electron', () => ({ app: { getPath: () => tempDir }, ipcMain }))
    vi.doMock('node:fs/promises', async () => vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
    const m = await import('./autosave')
    const q = await import('./quitFlush')
    await m.writeAutosave(tagged('seed', 100))
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        // The renderer answers the request at once, with the small final snapshot.
        send: () => setTimeout(() => ipcMain.emit(q.QUIT_SNAPSHOT_REPLY, {}, tagged('quit-flush', 100)), 0)
      }
    }
    const periodic = m.writeAutosave(tagged('periodic-big', BIG))
    const outcome = await q.flushAutosaveOnQuit(window as unknown as Parameters<typeof q.flushAutosaveOnQuit>[0])
    expect(outcome).toBe('written')
    expect((await periodic).ok).toBe(true)
    expect(await slot('autosave.json')).toEqual({ parses: true, tag: 'C:/quit-flush.mp4' })
    expect(await slot('autosave.prev.json')).toEqual({ parses: true, tag: 'C:/periodic-big.mp4' })
  })

  it('each write has its own tmp name, in the autosave folder, and none is the old fixed autosave.tmp', async () => {
    const targets: string[] = []
    const m = await build(async (real, file, data, rest) => {
      targets.push(file)
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
    })
    await Promise.all([m.writeAutosave(tagged('a', 100)), m.writeAutosave(tagged('b', 100)), m.writeAutosave(tagged('c', 100))])
    expect(targets).toHaveLength(3)
    expect(new Set(targets).size).toBe(3)
    for (const t of targets) {
      expect(path.dirname(t)).toBe(dir())
      expect(path.basename(t)).toMatch(/\.tmp$/)
      expect(path.basename(t)).not.toBe('autosave.tmp')
    }
  })

  /** The module over a `writeFile` that fails part-way for a project tagged FAIL-ME (the first bytes reach the tmp, then ENOSPC), as a full disk does. */
  const buildFailingOnMarker = (): Promise<typeof import('./autosave')> =>
    build(async (real, file, data, rest) => {
      if (data.includes('FAIL-ME')) {
        await real.writeFile(file, data.slice(0, 40))
        throw Object.assign(new Error('ENOSPC: simulated, write'), { code: 'ENOSPC' })
      }
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
    })

  it('a write that fails answers ok:false with the disk\'s words, removes its own half-written tmp at once, and leaves the current autosave untouched', async () => {
    const m = await buildFailingOnMarker()
    await m.writeAutosave(tagged('good-1', 100))
    const before = await readFile(path.join(dir(), 'autosave.json'), 'utf8')
    const failed = await m.writeAutosave(tagged('FAIL-ME', 100))
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.reason).toContain('ENOSPC')
    // Checked BEFORE any later write: the next write would sweep a leftover, which is not what removes it here.
    expect(await readdir(dir()), 'its half-written tmp is gone the moment it fails').toEqual(['autosave.json'])
    expect(await readFile(path.join(dir(), 'autosave.json'), 'utf8')).toBe(before)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(userFacingError(new Error(failed.ok ? '' : failed.reason), 'Autosave failed.').message).toBe('Autosave failed. Your disk is full. Free up some space and try again.')
    quiet.mockRestore()
  })

  it('a write that fails does not wedge the ones behind it: the next one runs, and prev is the last good write, not the failed one', async () => {
    const m = await buildFailingOnMarker()
    await m.writeAutosave(tagged('good-1', 100))
    const [failed, after] = await Promise.all([m.writeAutosave(tagged('FAIL-ME', 100)), m.writeAutosave(tagged('good-2', 100))])
    expect(failed.ok).toBe(false)
    expect(after.ok).toBe(true)
    expect(await slot('autosave.json')).toEqual({ parses: true, tag: 'C:/good-2.mp4' })
    expect(await slot('autosave.prev.json')).toEqual({ parses: true, tag: 'C:/good-1.mp4' })
    expect((await readdir(dir())).sort()).toEqual(['autosave.json', 'autosave.prev.json'])
  })

  it('a call that THROWS before it writes anything (a project whose safety check blows up) does not wedge the chain either', async () => {
    const m = await build()
    // The first read of `videoStudio` is serializeProject's (inside the try); the second is hasStudioState's, which isSafeToAutosave makes outside it.
    const poison = (): ImagiiProject => {
      let reads = 0
      return new Proxy(tagged('poisoned', 100), {
        get(target, key, receiver) {
          if (key === 'videoStudio' && (reads += 1) > 1) throw new Error('boom: unreadable project')
          return Reflect.get(target, key, receiver) as unknown
        }
      })
    }
    expect(() => isSafeToAutosave(poison()), 'the poison throws where writeAutosave asks the question').toThrow('boom')
    await m.writeAutosave(poison()).catch(() => 'threw')
    const next = await m.writeAutosave(tagged('after-the-poison', 100))
    expect(next.ok).toBe(true)
    expect(await slot('autosave.json')).toEqual({ parses: true, tag: 'C:/after-the-poison.mp4' })
  })

  it('a tmp left by a write that was cut off (the process killed mid-write) is swept by the next write, and so is the old fixed name', async () => {
    const m = await build()
    await mkdir(dir(), { recursive: true })
    await writeFile(path.join(dir(), 'autosave.0badc0de.tmp'), '{"half":', 'utf8')
    await writeFile(path.join(dir(), 'autosave.tmp'), '{"older build', 'utf8')
    await writeFile(path.join(dir(), 'notes.tmp'), 'not ours', 'utf8')
    expect((await m.writeAutosave(tagged('fresh', 100))).ok).toBe(true)
    expect((await readdir(dir())).sort(), 'only our own tmp names are swept').toEqual(['autosave.json', 'notes.tmp'])
  })

  it('Clear removes a cut-off tmp as well (it listed one fixed name, which is no longer the only one)', async () => {
    const m = await build()
    await m.writeAutosave(tagged('one', 100))
    await m.writeAutosave(tagged('two', 100))
    await writeFile(path.join(dir(), 'autosave.0badc0de.tmp'), '{"half":', 'utf8')
    await m.clearAutosave()
    expect(await readdir(dir())).toEqual([])
  })
})
