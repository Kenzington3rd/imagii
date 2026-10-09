import { describe, it, expect } from 'vitest'
import { countOf } from './plural'

describe('countOf', () => {
  it('uses the singular for exactly one', () => {
    expect(countOf(1, 'file')).toBe('1 file')
    expect(countOf(1, 'clip')).toBe('1 clip')
  })

  it('uses the plural for zero and for everything above one', () => {
    expect(countOf(0, 'file')).toBe('0 files')
    expect(countOf(2, 'file')).toBe('2 files')
    expect(countOf(6, 'clip')).toBe('6 clips')
    expect(countOf(11, 'file')).toBe('11 files')
  })

  it('takes an explicit plural for a noun that does not add an s', () => {
    expect(countOf(1, 'match', 'matches')).toBe('1 match')
    expect(countOf(3, 'match', 'matches')).toBe('3 matches')
  })
})
