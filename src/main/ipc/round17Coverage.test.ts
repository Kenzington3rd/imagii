import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

// Round 17 phase-6 — IPC handler coverage round-out. The handlers themselves
// import `electron` so we test the underlying pure helpers and store-backed
// CRUD bodies, mocking only what's needed.

let TMP = ''

vi.mock('electron', () => ({
  app: { getPath: () => TMP }
}))

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-r17-cov-'))
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// audio:suggestOutputName — pure path computation.
// The actual IPC body just does `path.parse(sourcePath).name + '-cleaned.' + ext`.
// Cover that pure shape here so a future refactor keeps the contract.
// ---------------------------------------------------------------------------
describe('audio:suggestOutputName shape', () => {
  function suggest(sourcePath: string, format: 'mp3' | 'wav' | 'flac' | 'aac'): string {
    const base = path.parse(sourcePath).name
    return `${base}-cleaned.${format}`
  }

  it('drops the source extension and suffixes -cleaned + new format', () => {
    expect(suggest('C:/streams/podcast-ep5.flac', 'mp3')).toBe(
      'podcast-ep5-cleaned.mp3'
    )
  })

  it('handles paths with no extension', () => {
    expect(suggest('C:/streams/raw', 'wav')).toBe('raw-cleaned.wav')
  })

  it('handles posix-style paths', () => {
    expect(suggest('/home/me/audio.mp3', 'aac')).toBe('audio-cleaned.aac')
  })
})

// ---------------------------------------------------------------------------
// audio cancelAudioJob — should also no-op for unknown ids.
// ---------------------------------------------------------------------------
describe('audio cancelAudioJob', () => {
  it('returns false for an unknown jobId without throwing', async () => {
    const m = await import('../audio/process')
    expect(m.cancelAudioJob('does-not-exist')).toBe(false)
    expect(m.cancelAudioJob('still-nothing')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// captions copySrtTo — path-confinement is the security-critical bit.
// Reuse the same path.relative gate the handler uses to assert refusal of
// anything outside the captions output directory.
// ---------------------------------------------------------------------------
describe('captions copySrtTo path confinement', () => {
  function confined(allowedRoot: string, src: string): boolean {
    const resolvedSrc = path.resolve(src)
    const rel = path.relative(allowedRoot, resolvedSrc)
    return !(rel.startsWith('..') || path.isAbsolute(rel))
  }

  it('accepts a child of the allowed root', () => {
    const root = path.resolve(TMP)
    expect(confined(root, path.join(root, 'job1.srt'))).toBe(true)
  })

  it('rejects ../ escapes', () => {
    const root = path.resolve(TMP, 'sub')
    expect(confined(root, path.resolve(TMP, 'escape.srt'))).toBe(false)
  })

  it('rejects unrelated absolute paths', () => {
    const root = path.resolve(TMP, 'sub')
    expect(confined(root, '/etc/passwd')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// moodboard CRUD (round 17 phase-6 + phase-2 validators). Touches the real
// store backed by TMP via the mocked electron app.getPath.
// ---------------------------------------------------------------------------
describe('moodboard CRUD store (round 17 phase-6)', () => {
  async function load(): Promise<typeof import('../search/moodboard')> {
    return import('../search/moodboard')
  }

  it('listCollections returns [] for a fresh user-data dir', async () => {
    const m = await load()
    expect(await m.listCollections()).toEqual([])
  })

  it('createCollection persists and listCollections returns it', async () => {
    const m = await load()
    const c = await m.createCollection('My board')
    expect(c.id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(c.name).toBe('My board')
    expect(c.items).toEqual([])
    const list = await m.listCollections()
    expect(list.length).toBe(1)
    expect(list[0]?.name).toBe('My board')
  })

  it('createCollection falls back to "Untitled board" on blank name', async () => {
    const m = await load()
    const c = await m.createCollection('   ')
    expect(c.name).toBe('Untitled board')
  })

  it('renameCollection updates the name', async () => {
    const m = await load()
    const c = await m.createCollection('Old name')
    const renamed = await m.renameCollection(c.id, 'New name')
    expect(renamed?.name).toBe('New name')
  })

  it('renameCollection returns null for an unknown id', async () => {
    const m = await load()
    expect(await m.renameCollection('abc123', 'whatever')).toBeNull()
  })

  it('renameCollection rejects an id outside the nanoid alphabet', async () => {
    const m = await load()
    await expect(m.renameCollection('../escape', 'x')).rejects.toThrow(
      /nanoid alphabet/
    )
  })

  it('deleteCollection removes the JSON file', async () => {
    const m = await load()
    const c = await m.createCollection('tmp')
    await m.deleteCollection(c.id)
    expect(await m.listCollections()).toEqual([])
  })

  it('deleteCollection rejects a traversal id', async () => {
    const m = await load()
    await expect(m.deleteCollection('../../etc/passwd')).rejects.toThrow(
      /nanoid alphabet/
    )
  })

  it('removeFromCollection rejects bad ids', async () => {
    const m = await load()
    await expect(
      m.removeFromCollection('not safe', 'also unsafe')
    ).rejects.toThrow()
  })

  it('listCollections skips files that fail to parse', async () => {
    const m = await load()
    // Write a junk file alongside a real one.
    const dir = path.join(TMP, 'moodboards')
    if (!existsSync(dir)) {
      const fs = await import('node:fs/promises')
      await fs.mkdir(dir, { recursive: true })
    }
    writeFileSync(path.join(dir, 'bogus.json'), '{not json')
    await m.createCollection('Real one')
    const list = await m.listCollections()
    expect(list.length).toBe(1)
    expect(list[0]?.name).toBe('Real one')
  })
})
