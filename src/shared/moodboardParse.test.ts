import { describe, it, expect } from 'vitest'
import { parseCollection } from './moodboardParse'

/**
 * Regression: round 12 guarded the `JSON.parse` SyntaxError on a corrupt
 * mood-board file, but callers then touched `collection.items` — so a
 * file that was valid JSON yet structurally wrong (no `items`) threw a
 * `TypeError` one line later. `parseCollection` closes that class: it
 * returns a fully-formed collection (with `items` always an array) or
 * `null`, never a half-valid object.
 */
describe('parseCollection', () => {
  const valid = JSON.stringify({
    id: 'abc123',
    name: 'My board',
    createdAt: 1_700_000_000_000,
    items: [
      {
        id: 'item1',
        collectionId: 'abc123',
        thumbnail: 't.jpg',
        fullUrl: 'https://example.com/1',
        source: 'example.com',
        title: 'One',
        addedAt: 1_700_000_000_001
      }
    ]
  })

  it('parses a well-formed collection', () => {
    const c = parseCollection(valid)
    expect(c).not.toBeNull()
    expect(c?.id).toBe('abc123')
    expect(c?.name).toBe('My board')
    expect(c?.items).toHaveLength(1)
    expect(c?.items[0]?.id).toBe('item1')
  })

  it('returns null on invalid JSON (the round-12 SyntaxError case)', () => {
    expect(parseCollection('{not json')).toBeNull()
    expect(parseCollection('')).toBeNull()
  })

  it('normalizes a missing items field to an empty array (the round-12 gap)', () => {
    const c = parseCollection(JSON.stringify({ id: 'x', name: 'y', createdAt: 1 }))
    expect(c).not.toBeNull()
    expect(c?.items).toEqual([])
  })

  it('normalizes a non-array items field to an empty array', () => {
    const c = parseCollection(
      JSON.stringify({ id: 'x', name: 'y', createdAt: 1, items: 'oops' })
    )
    expect(c?.items).toEqual([])
  })

  it('drops structurally-broken items but keeps the good ones', () => {
    const c = parseCollection(
      JSON.stringify({
        id: 'x',
        name: 'y',
        createdAt: 1,
        items: [
          { id: 'ok', fullUrl: 'https://e.com/a' },
          { id: 'no-url' },
          'not-an-object',
          { fullUrl: 'https://e.com/b' }
        ]
      })
    )
    expect(c?.items).toHaveLength(1)
    expect(c?.items[0]?.id).toBe('ok')
  })

  it('rejects a non-object root', () => {
    expect(parseCollection('"a string"')).toBeNull()
    expect(parseCollection('42')).toBeNull()
    expect(parseCollection('[1,2,3]')).toBeNull()
    expect(parseCollection('null')).toBeNull()
  })

  it('rejects a collection missing required id / name / createdAt', () => {
    expect(parseCollection(JSON.stringify({ name: 'y', createdAt: 1 }))).toBeNull()
    expect(parseCollection(JSON.stringify({ id: 'x', createdAt: 1 }))).toBeNull()
    expect(parseCollection(JSON.stringify({ id: 'x', name: 'y' }))).toBeNull()
    expect(parseCollection(JSON.stringify({ id: '', name: 'y', createdAt: 1 }))).toBeNull()
  })
})
