import { describe, it, expect } from 'vitest'
import type { DiaryEntry } from './postingDiary'
import { DIARY_MAX_ENTRIES, migrateDiary, parseDiaryEntries } from './postingDiary'

/**
 * T-20 regression: the posting diary lived in renderer localStorage — gone
 * with the Chromium profile, absent from project files and autosave. It now
 * lives in the settings store, which means (a) whatever comes back off disk
 * must be treated as untrusted, and (b) the one-time carry-over must run
 * exactly once and never clobber newer settings data.
 */
const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: 'e1',
  outputName: 'Clip 1',
  platforms: ['YouTube'],
  notes: 'posted at 9pm',
  createdAt: 1_700_000_000_000,
  ...over
})

describe('parseDiaryEntries', () => {
  it('round-trips a full entry through JSON, the way settings storage does', () => {
    const original = [entry({ performance: { views: 12, likes: 3 }, postedAt: 1_700_000_100_000 })]
    const roundTripped = parseDiaryEntries(JSON.parse(JSON.stringify(original)))
    expect(roundTripped).toEqual(original)
    // And it is stable: parsing its own output changes nothing.
    expect(parseDiaryEntries(roundTripped)).toEqual(original)
  })

  it.each([undefined, null, 42, 'nope', {}, true])('returns [] for non-array %p', (value) => {
    expect(parseDiaryEntries(value)).toEqual([])
  })

  it('drops entries missing an id or a name rather than rendering blanks', () => {
    const parsed = parseDiaryEntries([
      entry(),
      { outputName: 'no id', platforms: [], notes: '', createdAt: 1 },
      { id: 'x', platforms: [], notes: '', createdAt: 1 },
      { id: '', outputName: 'empty id', platforms: [], notes: '', createdAt: 1 },
      'not an object',
      null
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.id).toBe('e1')
  })

  it('normalizes junk fields instead of throwing', () => {
    const parsed = parseDiaryEntries([
      { id: 'a', outputName: 'A', platforms: ['X', 7, null], notes: 99, createdAt: 'soon' }
    ])
    expect(parsed[0]).toEqual({
      id: 'a',
      outputName: 'A',
      platforms: ['X'],
      notes: '',
      createdAt: 0
    })
  })

  it('keeps only finite numeric performance fields', () => {
    const parsed = parseDiaryEntries([
      entry({ performance: { views: 5, likes: Number.NaN, comments: 'lots' } as never })
    ])
    expect(parsed[0]?.performance).toEqual({ views: 5 })
  })

  it('drops an all-junk performance object entirely', () => {
    const parsed = parseDiaryEntries([entry({ performance: { views: 'x' } as never })])
    expect(parsed[0]?.performance).toBeUndefined()
  })

  it('caps a hand-edited config at the entry limit', () => {
    const many = Array.from({ length: DIARY_MAX_ENTRIES + 40 }, (_, i) =>
      entry({ id: `e${i}`, outputName: `Clip ${i}` })
    )
    expect(parseDiaryEntries(many)).toHaveLength(DIARY_MAX_ENTRIES)
  })
})

describe('migrateDiary', () => {
  it('carries the legacy localStorage blob over on first read', () => {
    const legacy = JSON.stringify([entry()])
    const result = migrateDiary({ stored: undefined, legacyRaw: legacy })
    expect(result.migrated).toBe(true)
    expect(result.entries).toEqual([entry()])
  })

  it('does not migrate again once settings holds the diary', () => {
    // The second mount: settings wins, and the (already-cleared, but
    // possibly re-seeded) legacy blob must not resurrect deleted entries.
    const result = migrateDiary({
      stored: [entry({ id: 'new', outputName: 'From settings' })],
      legacyRaw: JSON.stringify([entry({ id: 'old', outputName: 'Deleted long ago' })])
    })
    expect(result.migrated).toBe(false)
    expect(result.entries.map((e) => e.id)).toEqual(['new'])
  })

  it('does not migrate when settings holds an empty diary', () => {
    // [] is a real value — a user who deleted every entry keeps that state.
    const result = migrateDiary({ stored: [], legacyRaw: JSON.stringify([entry()]) })
    expect(result).toEqual({ entries: [], migrated: false })
  })

  it('is a no-op on a fresh install (nothing stored, nothing legacy)', () => {
    expect(migrateDiary({ stored: undefined, legacyRaw: null })).toEqual({
      entries: [],
      migrated: false
    })
  })

  it('survives a corrupt legacy blob and still retires the dead key', () => {
    // Negative path: unparseable JSON must not throw (the panel renders
    // inside Video Studio), must yield an empty diary, and must report
    // migrated:true so the caller clears the key — otherwise every mount
    // re-reads the same broken value forever.
    const result = migrateDiary({ stored: undefined, legacyRaw: '{"half":' })
    expect(result).toEqual({ entries: [], migrated: true })
  })

  it.each(['null', '"a string"', '{"not":"an array"}', '[]', '17'])(
    'treats valid-JSON-but-wrong-shape legacy value %s as an empty migrated diary',
    (raw) => {
      const result = migrateDiary({ stored: undefined, legacyRaw: raw })
      expect(result).toEqual({ entries: [], migrated: true })
    }
  )

  it('migrates the good entries out of a partially corrupt blob', () => {
    const result = migrateDiary({
      stored: undefined,
      legacyRaw: JSON.stringify([entry(), { garbage: true }, null])
    })
    expect(result.migrated).toBe(true)
    expect(result.entries).toEqual([entry()])
  })
})
