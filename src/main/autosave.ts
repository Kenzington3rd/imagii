import { app } from 'electron'
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  unlink,
  stat,
  copyFile,
  open
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { isSafeToAutosave, validateProjectJsonString } from '../shared/projectValidation'
import type { ImagiiProject } from '../shared/workspace'

export interface AutosaveInfo {
  exists: boolean
  filePath: string
  /** The project's own `savedAt`. Present only when the file VALIDATES —
   *  an unparseable file has no in-file timestamp worth trusting. */
  savedAt?: number
  /**
   * How long ago this autosave was written. Sourced from `savedAt` when the
   * file validates and from the file's mtime when it does not (T-33): the
   * corruption banner's copy promises an age, and the filesystem knows one
   * even when the bytes are garbage. Absent only when the file cannot be
   * stat'd at all.
   */
  ageMs?: number
  sizeBytes?: number
}

/**
 * Age of a timestamp, clamped at zero. On Windows, `Date.now()`'s ~15 ms
 * quantization and the filesystem's clock can disagree, so a JUST-written
 * file's mtime lands fractionally in the future and a bare subtraction goes
 * negative — the v1.5.0 release run (the de facto Windows CI) caught
 * `ageMs: -0.49` violating the >= 0 contract the corruption banner's tests
 * pin. A file from the future is, for every purpose here, brand new.
 */
function ageOf(timestampMs: number): number {
  return Math.max(0, Date.now() - timestampMs)
}

export interface AutosaveLoadResult {
  ok: boolean
  reason?: string
  project?: ImagiiProject
  info?: AutosaveInfo
}

const FILENAME = 'autosave.json'
const PREV_FILENAME = 'autosave.prev.json'
/**
 * A write's tmp is `autosave.<8 hex>.tmp`, its own (T-139 (3)); `autosave.tmp` is the one fixed name earlier builds used. Found at rest, either is the
 * leftover of a write that was cut off (the process killed mid-write: a quit flush that hit its deadline), because a live write's tmp exists only
 * between its first byte and its rename, and the writes run one at a time.
 */
const TMP_NAME = /^autosave(?:\.[0-9a-f]{8})?\.tmp$/

function autosaveDir(): string {
  return path.join(app.getPath('userData'), 'autosave')
}

function autosavePath(): string {
  return path.join(autosaveDir(), FILENAME)
}

function prevAutosavePath(): string {
  return path.join(autosaveDir(), PREV_FILENAME)
}

/** Every tmp the autosave folder holds, as full paths (none when the folder is not there). */
async function tmpLeftovers(): Promise<string[]> {
  try {
    return (await readdir(autosaveDir())).filter((name) => TMP_NAME.test(name)).sort().map((name) => path.join(autosaveDir(), name))
  } catch {
    return []
  }
}

async function ensureDir(): Promise<void> {
  await mkdir(autosaveDir(), { recursive: true })
}

/**
 * Atomically write JSON to disk:
 *   1. Write the new content to a temp file in the same directory
 *   2. fsync the temp file's data to disk
 *   3. If a previous autosave exists, copy it to the .prev file
 *   4. Rename the temp file over the autosave file (atomic on the same FS)
 *
 * If a crash occurs at any step:
 *   - Before step 4: the existing autosave.json (if any) is intact
 *   - During step 4: rename is atomic — file is either old or new, never half
 *   - The .prev file always represents the previous successfully-saved state
 *
 * The function never throws upstream — it returns a result object instead.
 *
 * T-139 (3): the writes run ONE AT A TIME, in the order they were asked for. The renderer's doSave sets its `lastWriteTime` after its await (so a second
 * write can start while one is in flight) and the quit flush writes beside it; with one fixed tmp, overlapping calls truncated each other's file, a
 * mixed file was renamed into autosave.json and then copied over autosave.prev.json (executed: both slots corrupt in 6 of 6 overlapping trials).
 * Each call starts after the previous one has settled, so the later content wins and every caller still gets the result of its own write; each write
 * also has its own tmp name, so a mistake elsewhere could not make two of them share one. A call that fails (or throws) does not stop the ones behind it.
 */
let writeChain: Promise<unknown> = Promise.resolve()

export function writeAutosave(
  project: ImagiiProject
): Promise<{ ok: true; sizeBytes: number } | { ok: false; reason: string }> {
  const run = writeChain.then(() => writeAutosaveNow(project))
  writeChain = run.catch(() => undefined)
  return run
}

async function writeAutosaveNow(
  project: ImagiiProject
): Promise<{ ok: true; sizeBytes: number } | { ok: false; reason: string }> {
  const safety = isSafeToAutosave(project)
  if (!safety.ok) return { ok: false, reason: safety.reason }

  let raw: string
  try {
    raw = JSON.stringify({ ...project, savedAt: Date.now() })
  } catch (err) {
    return {
      ok: false,
      reason: `serialization failed: ${err instanceof Error ? err.message : 'unknown'}`
    }
  }

  let tmp: string | null = null
  try {
    await ensureDir()
    // Nothing of ours is in flight (the chain), so a tmp found now was left by a write that was cut off; it can be up to the size limit, and
    // each write has a new name, so nothing else would ever replace it.
    for (const leftover of await tmpLeftovers()) await unlink(leftover).catch(() => undefined)
    tmp = path.join(autosaveDir(), `autosave.${randomBytes(4).toString('hex')}.tmp`)
    await writeFile(tmp, raw, 'utf8')

    // fsync to ensure data hits disk before the rename
    try {
      const fh = await open(tmp, 'r+')
      await fh.sync()
      await fh.close()
    } catch {
      // fsync failures are not fatal — proceed with rename
    }

    // Save the previous autosave as a backup before overwriting
    const current = autosavePath()
    if (existsSync(current)) {
      try {
        await copyFile(current, prevAutosavePath())
      } catch {
        // backup-copy failure is non-fatal
      }
    }

    await rename(tmp, current)
    return { ok: true, sizeBytes: raw.length }
  } catch (err) {
    // A write that failed part-way must not leave its half file behind (it has a name of its own now, so nothing would overwrite it).
    if (tmp !== null) await unlink(tmp).catch(() => undefined)
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'write failed'
    }
  }
}

async function readAndValidate(filePath: string): Promise<AutosaveLoadResult> {
  if (!existsSync(filePath)) {
    return { ok: false, reason: 'autosave does not exist' }
  }
  let stats: { mtimeMs: number; size: number }
  try {
    const s = await stat(filePath)
    stats = { mtimeMs: s.mtimeMs, size: s.size }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'stat failed' }
  }
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'read failed' }
  }
  const validation = validateProjectJsonString(raw)
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      info: {
        exists: true,
        filePath,
        // T-33: age the file by its mtime. The renderer's corruption banner
        // reads "An autosave was found (5 min ago) but failed validation",
        // and withholding the age here is what left that banner — and its
        // Clear button, the only way to get rid of the bad file — unable to
        // render at all.
        ageMs: ageOf(stats.mtimeMs),
        sizeBytes: stats.size
      }
    }
  }
  return {
    ok: true,
    project: validation.project,
    info: {
      exists: true,
      filePath,
      savedAt: validation.project.savedAt,
      ageMs: ageOf(validation.project.savedAt),
      sizeBytes: stats.size
    }
  }
}

export async function readAutosave(): Promise<AutosaveLoadResult> {
  const primary = await readAndValidate(autosavePath())
  if (primary.ok) return primary
  // Try the backup if the primary is corrupt or missing
  const backup = await readAndValidate(prevAutosavePath())
  if (backup.ok) {
    return {
      ...backup,
      reason: `recovered from backup (${primary.reason})`
    }
  }
  return primary
}

export async function getAutosaveInfo(): Promise<AutosaveInfo> {
  const filePath = autosavePath()
  if (!existsSync(filePath)) {
    return { exists: false, filePath }
  }
  try {
    const s = await stat(filePath)
    const raw = await readFile(filePath, 'utf8')
    const validation = validateProjectJsonString(raw)
    if (!validation.ok) {
      // Same contract as readAndValidate above: no savedAt, but a real age.
      return { exists: true, filePath, ageMs: ageOf(s.mtimeMs), sizeBytes: s.size }
    }
    return {
      exists: true,
      filePath,
      savedAt: validation.project.savedAt,
      ageMs: ageOf(validation.project.savedAt),
      sizeBytes: s.size
    }
  } catch {
    return { exists: true, filePath }
  }
}

/**
 * Delete the autosave, its backup, and any leftover temp file (T-139 (3): every tmp name a write has used, not one).
 *
 * T-57: this used to swallow every unlink failure, so "Autosave discarded."
 * was printed over a file that was still on disk — the banner vanished, the
 * next launch offered the same autosave again, and nothing anywhere said
 * why. A delete that did not happen is reported. The check is `existsSync`
 * rather than the thrown errno because a file that vanished underneath us
 * (a second window clearing at the same time) is the outcome the caller
 * asked for, not a failure.
 *
 * T-118: that same swallow threw away the one fact the renderer can use. The
 * message carries the errno CODE of the first unlink that failed on a file that
 * stayed ("could not delete autosave.json (EBUSY)"), so `userFacingError` can
 * tell a locked file ("Windows blocked access to a file. Close any app using
 * it...") from a failure it has no words for. No trailing period, on purpose:
 * a shape the helper does not know must fall to the caller's own sentence, and
 * a period would make it read as a finished one. A code on a file that vanished
 * is not reported, because that is not a failure.
 */
export async function clearAutosave(): Promise<void> {
  const survivors: string[] = []
  let code: string | undefined
  for (const p of [autosavePath(), prevAutosavePath(), ...(await tmpLeftovers())]) {
    if (!existsSync(p)) continue
    let failedWith: string | undefined
    try {
      await unlink(p)
    } catch (err) {
      /* the existsSync below decides whether this mattered */
      const c = (err as NodeJS.ErrnoException | null)?.code
      if (typeof c === 'string') failedWith = c
    }
    if (existsSync(p)) {
      survivors.push(path.basename(p))
      code ??= failedWith
    }
  }
  if (survivors.length > 0) {
    throw new Error(`could not delete ${survivors.join(', ')}${code ? ` (${code})` : ''}`)
  }
}
