import { assert } from './assert'

/** One logged post in the Video Studio posting diary. */
export interface DiaryEntry {
  id: string
  outputName: string
  platforms: string[]
  notes: string
  performance?: { views?: number; likes?: number; comments?: number }
  postedAt?: number
  createdAt: number
}

/**
 * T-20: where the diary lived until round 23 — renderer `localStorage`,
 * i.e. inside the Chromium profile. Wiped by a profile reset, absent from
 * project files and autosave, and invisible to every other studio's state
 * handling. The diary now lives in the settings store under `postingDiary`;
 * this key is read exactly once per install to carry the old data over.
 */
export const DIARY_LEGACY_KEY = 'imagii.postingDiary'

/** Same cap the PostChecklist has always applied when appending. */
export const DIARY_MAX_ENTRIES = 100

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').slice(0, 20)
}

function toPerformance(value: unknown): DiaryEntry['performance'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const out: NonNullable<DiaryEntry['performance']> = {}
  for (const field of ['views', 'likes', 'comments'] as const) {
    const n = raw[field]
    if (typeof n === 'number' && Number.isFinite(n)) out[field] = n
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Structural gate for diary data read back from disk (settings store) or
 * from the legacy localStorage blob. Same shape as every other
 * parse-and-normalize choke point in the codebase: junk is dropped, never
 * thrown on, because a corrupt diary must not take the studio down with it.
 */
export function parseDiaryEntries(value: unknown): DiaryEntry[] {
  assert(DIARY_MAX_ENTRIES > 0, 'diary cap must be positive')
  if (!Array.isArray(value)) return []
  const out: DiaryEntry[] = []
  // Bounded loop (Power of Ten rule 2): never walk more than the cap even if
  // a hand-edited file carries thousands.
  const limit = Math.min(value.length, DIARY_MAX_ENTRIES)
  for (let i = 0; i < limit; i++) {
    const item = value[i]
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const e = item as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id.length === 0) continue
    if (typeof e.outputName !== 'string' || e.outputName.length === 0) continue
    const entry: DiaryEntry = {
      id: e.id,
      outputName: e.outputName,
      platforms: toStringArray(e.platforms),
      notes: typeof e.notes === 'string' ? e.notes : '',
      createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0
    }
    const performance = toPerformance(e.performance)
    if (performance) entry.performance = performance
    if (typeof e.postedAt === 'number' && Number.isFinite(e.postedAt)) entry.postedAt = e.postedAt
    out.push(entry)
  }
  assert(out.length <= DIARY_MAX_ENTRIES, 'parseDiaryEntries exceeded the entry cap')
  return out
}

export interface DiaryMigration {
  entries: DiaryEntry[]
  /** True when the caller must write `entries` to settings and drop the
   *  legacy localStorage key. */
  migrated: boolean
}

/**
 * One-time move from localStorage to the settings store.
 *
 * `stored` wins whenever it is present — once the settings key exists, the
 * legacy blob is stale and must never overwrite it. A corrupt or
 * unparseable legacy blob still counts as migrated: it yields an empty
 * diary and the caller clears the dead key, so a broken value can't make
 * the app retry (and re-fail) on every mount.
 */
export function migrateDiary(input: { stored: unknown; legacyRaw: string | null }): DiaryMigration {
  assert(typeof input === 'object' && input !== null, 'migrateDiary needs an input object')
  assert(
    input.legacyRaw === null || typeof input.legacyRaw === 'string',
    'legacyRaw must be a string or null'
  )
  if (input.stored !== undefined && input.stored !== null) {
    return { entries: parseDiaryEntries(input.stored), migrated: false }
  }
  if (input.legacyRaw === null) return { entries: [], migrated: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(input.legacyRaw)
  } catch {
    return { entries: [], migrated: true }
  }
  return { entries: parseDiaryEntries(parsed), migrated: true }
}
