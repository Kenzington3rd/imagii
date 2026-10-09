import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, utimes, readdir } from 'node:fs/promises'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { pruneStaleTempFiles, __testing__ } from './tempCleanup'
import { CAPTIONS_DIR_NAME, shiftedSrtPath } from '../shared/captions'

const { STALE_THRESHOLD_MS, TEMP_SUBDIRS, setUserDataDirForTest } = __testing__

/**
 * T-67: every family the function SCANS, not just the two this file writes
 * to. `pruneStaleTempFiles` also scans imagii-import, and `npm run test:media`
 * can leave a partial there (the linux mpegts pin crashes the convert child
 * mid-write), so "handles a missing tempdir gracefully" — an exact
 * `scanned === 0` — went red purely because another suite had run first.
 * Deriving the list from `TEMP_SUBDIRS` means a family added to the function
 * later is isolated here on the same commit rather than the next red run.
 */
const SCANNED_DIRS = TEMP_SUBDIRS.map((name) => path.join(tmpdir(), name))
const AUDIO_DIR = path.join(tmpdir(), 'imagii-audio')

async function setMtime(filePath: string, ageMs: number): Promise<void> {
  const t = (Date.now() - ageMs) / 1000
  await utimes(filePath, t, t)
}

async function makeFile(dir: string, name: string, ageMs = 0): Promise<string> {
  await mkdir(dir, { recursive: true })
  const full = path.join(dir, name)
  await writeFile(full, 'test')
  if (ageMs > 0) await setMtime(full, ageMs)
  return full
}

function clearScannedDirs(): void {
  for (const dir of SCANNED_DIRS) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
}

describe('pruneStaleTempFiles', () => {
  beforeEach(clearScannedDirs)

  afterEach(clearScannedDirs)

  it('removes files older than the staleness threshold', async () => {
    const oldFile = await makeFile(AUDIO_DIR, 'old.wav', STALE_THRESHOLD_MS + 60_000)
    const result = await pruneStaleTempFiles()
    expect(existsSync(oldFile)).toBe(false)
    expect(result.removed).toBeGreaterThanOrEqual(1)
  })

  it('preserves recent files', async () => {
    const fresh = await makeFile(AUDIO_DIR, 'fresh.wav', 60_000) // 1 minute old
    const result = await pruneStaleTempFiles()
    expect(existsSync(fresh)).toBe(true)
    expect(result.scanned).toBeGreaterThanOrEqual(1)
  })

  it('handles a missing tempdir gracefully', async () => {
    // Every family the function scans is cleared in beforeEach — nothing to
    // scan. The exact 0 is the assertion T-67 fixed the isolation for.
    const result = await pruneStaleTempFiles()
    expect(result.scanned).toBe(0)
    expect(result.removed).toBe(0)
  })

  it('cleans every temp family it scans', async () => {
    for (const dir of SCANNED_DIRS) {
      await makeFile(dir, 'stale.bin', STALE_THRESHOLD_MS + 60_000)
    }
    const result = await pruneStaleTempFiles()
    expect(result.scanned).toBe(SCANNED_DIRS.length)
    expect(result.removed).toBe(SCANNED_DIRS.length)
    for (const dir of SCANNED_DIRS) {
      expect((await readdir(dir)).length, dir).toBe(0)
    }
  })

  it('works with caller-supplied "now" for deterministic tests', async () => {
    const file = await makeFile(AUDIO_DIR, 'mid.wav', 0) // brand new
    // Pretend "now" is 1 hour in the future of file's mtime — still under
    // the 6-hour threshold so the file should survive.
    const result = await pruneStaleTempFiles(Date.now() + 60 * 60 * 1000)
    expect(existsSync(file)).toBe(true)
    expect(result.removed).toBe(0)
  })

  // Regression: audit round 7 added a parameter assertion to refuse
  // NaN / Infinity / negative timestamps. Without it, NaN would silently
  // skip the cleanup; negative would over-delete fresh files.
  it('throws on non-finite or negative now', async () => {
    await expect(pruneStaleTempFiles(NaN)).rejects.toThrow(/finite non-negative/)
    await expect(pruneStaleTempFiles(Infinity)).rejects.toThrow(/finite non-negative/)
    await expect(pruneStaleTempFiles(-1)).rejects.toThrow(/finite non-negative/)
  })
})

/**
 * T-81: the burn-in's shifted-SRT copies live in userData/captions, beside the
 * user's real transcripts. That folder is not under tmpdir(), so the isolation
 * the families above get from SCANNED_DIRS comes from the userData seam
 * instead: every case points it at its own mkdtemp (never the real userData,
 * which these tests cannot reach anyway) and puts it back in afterEach, so the
 * exact-count cases above keep scanning nothing outside tmpdir().
 */
describe('pruneStaleTempFiles — the captions temp-copy family (T-81)', () => {
  let userData = ''
  let captionsDir = ''
  const STALE = STALE_THRESHOLD_MS + 60_000

  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'imagii-cleanup-userdata-'))
    captionsDir = path.join(userData, CAPTIONS_DIR_NAME)
    setUserDataDirForTest(userData)
    clearScannedDirs()
  })

  afterEach(() => {
    setUserDataDirForTest(null)
    rmSync(userData, { recursive: true, force: true })
    clearScannedDirs()
  })

  it('sweeps a stale orphaned shifted copy and nothing that is the user\'s', async () => {
    const real = path.join(captionsDir, 'Stream-1700000000000.srt')
    const staleOrphan = shiftedSrtPath(real, randomUUID())
    const freshOrphan = shiftedSrtPath(real, randomUUID())
    const staleOther = path.join(captionsDir, 'notes.txt')
    await makeFile(captionsDir, path.basename(real), STALE) // a real transcript, however old
    await makeFile(captionsDir, path.basename(staleOrphan), STALE)
    await makeFile(captionsDir, path.basename(freshOrphan), 60_000) // a burn that may still be running
    await makeFile(captionsDir, path.basename(staleOther), STALE)

    const result = await pruneStaleTempFiles()

    expect(existsSync(staleOrphan)).toBe(false)
    expect(existsSync(freshOrphan)).toBe(true)
    expect(existsSync(real)).toBe(true)
    expect(existsSync(staleOther)).toBe(true)
    // Only the two temp-copy names are candidates; the transcript and the
    // note are not counted as scanned, let alone removed.
    expect(result).toEqual({ scanned: 2, removed: 1 })
  })

  it('a userData without a captions folder is not an error', async () => {
    const result = await pruneStaleTempFiles()
    expect(result).toEqual({ scanned: 0, removed: 0 })
  })
})
