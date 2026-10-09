import { readdir, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { assert } from '../shared/assert'
import { CAPTIONS_DIR_NAME, isShiftedSrtName } from '../shared/captions'

/**
 * Tech-debt fix: prune old temp files left behind by prior imagii sessions.
 *
 * Two directories collect temp artifacts:
 *  - %TEMP%/imagii-audio    — wav files from extractAudioFromVideo (the
 *    audio:extractFromVideo IPC handler returns the path to the renderer
 *    without a matching cleanup hook, so each "extract audio from video"
 *    leaks one wav for the lifetime of the audio editing session).
 *  - %TEMP%/imagii-concat   — per-segment mp4s + concat list files. Now
 *    cleaned up by runConcat's try/finally on every exit path, but a
 *    crashed imagii leaves leftovers.
 *
 * Both files are recoverable artifacts the user can regenerate. Reaping
 * anything older than the threshold is safe.
 *
 * Two userData folders are swept too (see userDataDir): recordings/, and
 * captions/ — but captions/ also holds the user's real transcripts, so only
 * the burn-in's leftover shifted copies (`*.srt.clip-<uuid>.srt`, T-81) are
 * eligible there, matched by the same helper that names them.
 *
 * 6 hours is conservative — a concurrent imagii instance is unlikely to
 * have a session that long, and Windows Storage Sense would have reaped
 * these anyway eventually. We accelerate the cleanup at our own startup.
 */

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000

const TEMP_SUBDIRS = ['imagii-audio', 'imagii-concat', 'imagii-import'] as const

/**
 * INIT-D (round 15): a save-time crash in recording.ts could leave a 100+ MB
 * .webm in userData/recordings/. The path is not under tmpdir() so it is
 * NOT reaped by the OS / Storage Sense. List the directory separately so
 * the same 6-hour threshold applies. The function only attempts the prune
 * if `app` (electron) is available — keeps the unit test working without
 * Electron loaded.
 */
// Test seam: the unit tests have no electron, so userData is unreachable
// from them unless they point it somewhere.
let userDataOverride: string | null = null

function userDataDir(): string | null {
  if (userDataOverride) return userDataOverride
  try {
    // Lazy import keeps the unit test (node-env, no electron) loading
    // this module without crashing. app.getPath throws if invoked before
    // whenReady; the cleanup runs after, so this is safe in production.
    // dynamic-require avoids a top-level electron dependency for tests.
    const { app } =
      (eval('require') as NodeRequire)('electron') as typeof import('electron')
    return app.getPath('userData')
  } catch {
    return null
  }
}

async function pruneDir(
  dir: string,
  now: number,
  // Only names this accepts are candidates (and counted as scanned): for a
  // folder that also holds files the user owns.
  only: (name: string) => boolean = () => true
): Promise<{ scanned: number; removed: number }> {
  if (!existsSync(dir)) return { scanned: 0, removed: 0 }
  let scanned = 0
  let removed = 0
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return { scanned: 0, removed: 0 }
  }
  for (const name of entries) {
    if (!only(name)) continue
    scanned++
    const full = path.join(dir, name)
    try {
      const s = await stat(full)
      if (!s.isFile()) continue
      if (now - s.mtimeMs < STALE_THRESHOLD_MS) continue
      await unlink(full)
      removed++
    } catch {
      // EBUSY, EPERM, ENOENT mid-iteration — keep going.
      continue
    }
  }
  return { scanned, removed }
}

export async function pruneStaleTempFiles(now: number = Date.now()): Promise<{
  scanned: number
  removed: number
}> {
  // Bug-fix (audit round 7): PoT rule 7 — validate the input parameter
  // at function entry. A caller passing NaN would make `now - mtime <
  // threshold` always false (NaN < N is always false), silently turning
  // the cleanup into a no-op. A negative `now` would delete files newer
  // than `|now| + threshold` seconds, including fresh in-flight temps.
  // Refuse outright.
  assert(Number.isFinite(now) && now >= 0, 'pruneStaleTempFiles: `now` must be a finite non-negative ms timestamp')
  let scanned = 0
  let removed = 0
  // Bound: TEMP_SUBDIRS + optional recordings dir × N files each.
  for (const subdir of TEMP_SUBDIRS) {
    const dir = path.join(tmpdir(), subdir)
    const { scanned: s, removed: r } = await pruneDir(dir, now)
    scanned += s
    removed += r
  }
  const userData = userDataDir()
  if (userData) {
    const swept: Array<[string, ((name: string) => boolean) | undefined]> = [
      [path.join(userData, 'recordings'), undefined],
      [path.join(userData, CAPTIONS_DIR_NAME), isShiftedSrtName]
    ]
    for (const [dir, only] of swept) {
      const { scanned: s, removed: r } = await pruneDir(dir, now, only)
      scanned += s
      removed += r
    }
  }
  return { scanned, removed }
}

// Test-only export of the threshold so the test file doesn't have to
// hardcode the same magic number, plus the userData seam.
export const __testing__ = {
  STALE_THRESHOLD_MS,
  TEMP_SUBDIRS,
  setUserDataDirForTest: (dir: string | null): void => {
    userDataOverride = dir
  }
}
