import { describe, it, expect } from 'vitest'
import { normalizeImageQuery } from './search'

describe('normalizeImageQuery', () => {
  it('returns a query for a non-blank string', () => {
    const result = normalizeImageQuery('  cozy stream overlay  ')
    expect(result).toEqual({ query: '  cozy stream overlay  ' })
  })

  it('returns the empty-result shape for a blank string', () => {
    const result = normalizeImageQuery('   ')
    expect(result).toEqual({
      empty: { query: '   ', provider: 'duckduckgo', results: [] }
    })
  })

  it('returns the empty-result shape for an empty string', () => {
    expect(normalizeImageQuery('')).toEqual({
      empty: { query: '', provider: 'duckduckgo', results: [] }
    })
  })

  // Regression (bug round 10): a non-string IPC arg made `query.trim()`
  // throw a TypeError across the IPC boundary instead of returning a
  // clean empty result.
  it.each([undefined, null, 42, {}, [], true])(
    'returns the empty-result shape for non-string arg %p without throwing',
    (arg) => {
      const result = normalizeImageQuery(arg)
      expect(result).toEqual({
        empty: { query: '', provider: 'duckduckgo', results: [] }
      })
    }
  )
})
