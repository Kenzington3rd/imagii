import type { MoodBoardCollection, MoodBoardItem } from './search'
import { isSafeAbsolutePath } from './pathSafety'

/**
 * Pure parser + normalizer for a mood-board collection JSON file.
 *
 * Round 12 guarded `JSON.parse` against a `SyntaxError` on a corrupt
 * board file, but the callers then immediately touched `collection.items`
 * — so a file that is *valid JSON yet structurally wrong* (e.g.
 * `{"id":"x","name":"y"}` with no `items`) still threw a `TypeError`
 * one line later. This function closes that whole class: it returns a
 * fully-formed `MoodBoardCollection` or `null`, never a half-valid
 * object. `items` is always an array on the success path.
 *
 * Pure (no fs, no electron) so it is unit-testable under the node-env
 * vitest config. `moodboard.ts` reads the file and hands the text here.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A board item is kept only if it has the string fields the UI relies on. */
function normalizeItem(v: unknown): MoodBoardItem | null {
  if (!isPlainObject(v)) return null
  if (typeof v.id !== 'string' || typeof v.fullUrl !== 'string') return null
  // M2 fix (round 15): cachedThumbPath comes from a JSON file on disk that
  // a hostile actor could have edited (e.g. swap to C:\Windows\System32\…).
  // The main-process readCollection later confines the value to thumbsCacheDir,
  // but a string failing the basic isSafeAbsolutePath gate (relative path,
  // traversal, reserved device) should never reach that confinement step
  // either — drop it here. Keep the rest of the item so the board still
  // loads with the thumbnail simply unset.
  if ('cachedThumbPath' in v) {
    if (typeof v.cachedThumbPath !== 'string' || !isSafeAbsolutePath(v.cachedThumbPath)) {
      const cleaned: Record<string, unknown> = { ...v }
      delete cleaned.cachedThumbPath
      return cleaned as unknown as MoodBoardItem
    }
  }
  return v as unknown as MoodBoardItem
}

/**
 * Parse a board JSON string. Returns the normalized collection, or
 * `null` if the text is not JSON, not an object, or is missing the
 * required `id` / `name` / `createdAt` fields. A missing or non-array
 * `items` is normalized to `[]` rather than rejected — the board is
 * still usable, just empty.
 */
export function parseCollection(raw: string): MoodBoardCollection | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null
  if (typeof parsed.name !== 'string') return null
  if (typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt)) {
    return null
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : []
  const items: MoodBoardItem[] = []
  for (const it of rawItems) {
    const norm = normalizeItem(it)
    if (norm) items.push(norm)
  }
  return {
    id: parsed.id,
    name: parsed.name,
    items,
    createdAt: parsed.createdAt
  }
}
