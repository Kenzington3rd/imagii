import { describe, it, expect } from 'vitest'
import { validateSearchResult } from './search'

// Round 17 phase-2 regression: every moodboard:addItem IPC call now passes
// the renderer-supplied SearchResult through validateSearchResult before it
// reaches addToCollection. A regression that loosens this check would
// re-open the door to hostile string fields landing in the moodboards JSON.
describe('validateSearchResult', () => {
  const valid = {
    id: 'abc',
    fullUrl: 'https://example.com/full.jpg',
    thumbnail: 'https://example.com/thumb.jpg',
    source: 'duckduckgo',
    title: 'A nice image'
  }

  it('accepts a well-formed result', () => {
    expect(() => validateSearchResult(valid)).not.toThrow()
  })

  it('accepts an empty title (some scrapers omit it)', () => {
    expect(() => validateSearchResult({ ...valid, title: '' })).not.toThrow()
  })

  it.each([null, undefined, 42, 'string', [], true])(
    'rejects non-object input %p',
    (input) => {
      expect(() => validateSearchResult(input)).toThrow(/plain object/)
    }
  )

  it.each([
    ['fullUrl missing', { ...valid, fullUrl: undefined }],
    ['fullUrl empty', { ...valid, fullUrl: '' }],
    ['fullUrl non-string', { ...valid, fullUrl: 42 }],
    ['thumbnail missing', { ...valid, thumbnail: undefined }],
    ['thumbnail empty', { ...valid, thumbnail: '' }],
    ['source missing', { ...valid, source: undefined }],
    ['source empty', { ...valid, source: '' }],
    ['title non-string', { ...valid, title: 42 }]
  ])('rejects: %s', (_label, bad) => {
    expect(() => validateSearchResult(bad)).toThrow()
  })

  it('rejects megabyte-sized URL payloads', () => {
    const huge = 'x'.repeat(5_000)
    expect(() => validateSearchResult({ ...valid, fullUrl: huge })).toThrow(/too long/)
    expect(() => validateSearchResult({ ...valid, thumbnail: huge })).toThrow(/too long/)
  })

  it('rejects oversized title', () => {
    expect(() =>
      validateSearchResult({ ...valid, title: 'x'.repeat(3_000) })
    ).toThrow(/too long/)
  })

  it('rejects oversized source', () => {
    expect(() =>
      validateSearchResult({ ...valid, source: 'x'.repeat(300) })
    ).toThrow(/too long/)
  })
})
