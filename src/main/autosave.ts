import { app } from 'electron'
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  unlink,
  stat,
  copyFile,
  open
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { isSafeToAutosave, validateProjectJsonString } from '../shared/projectValidation'
import type { ImagiiProject } from '../shared/workspace'

export interface AutosaveInfo {
  exists: boolean
  filePath: string
  savedAt?: number
  ageMs?: number
  sizeBytes?: number
}

export interface AutosaveLoadResult {
  ok: boolean
  reason?: string
  project?: ImagiiProject
  info?: AutosaveInfo
}

const FILENAME = 'autosave.json'
const PREV_FILENAME = 'autosave.prev.json'
const TMP_FILENAME = 'autosave.tmp'

function autosaveDir(): string {
  return path.join(app.getPath('userData'), 'autosave')
}

function autosavePath(): string {
  return path.join(autosaveDir(), FILENAME)
}

function prevAutosavePath(): string {
  return path.join(autosaveDir(), PREV_FILENAME)
}

function tmpAutosavePath(): string {
  return path.join(autosaveDir(), TMP_FILENAME)
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
 */
export async function writeAutosave(
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

  try {
    await ensureDir()
    const tmp = tmpAutosavePath()
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
      ageMs: Date.now() - validation.project.savedAt,
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
      return { exists: true, filePath, sizeBytes: s.size }
    }
    return {
      exists: true,
      filePath,
      savedAt: validation.project.savedAt,
      ageMs: Date.now() - validation.project.savedAt,
      sizeBytes: s.size
    }
  } catch {
    return { exists: true, filePath }
  }
}

export async function clearAutosave(): Promise<void> {
  for (const p of [autosavePath(), prevAutosavePath(), tmpAutosavePath()]) {
    if (existsSync(p)) {
      try {
        await unlink(p)
      } catch {
        /* ignore */
      }
    }
  }
}
