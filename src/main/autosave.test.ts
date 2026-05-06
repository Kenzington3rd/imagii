import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

let tempDir: string

// Stub electron's `app.getPath('userData')` to point to a per-test tempDir.
// Vitest hoists vi.mock to the top of the file, but our `tempDir` is mutated
// per test, so we use vi.doMock + dynamic import inside each test.
function buildAutosaveModule(): Promise<typeof import('./autosave')> {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name === 'userData') return tempDir
        return tempDir
      }
    }
  }))
  return import('./autosave')
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'imagii-autosave-'))
})

afterEach(async () => {
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
    await m.clearAutosave()

    const dir = path.join(tempDir, 'autosave')
    expect(existsSync(path.join(dir, 'autosave.json'))).toBe(false)
    expect(existsSync(path.join(dir, 'autosave.prev.json'))).toBe(false)
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
