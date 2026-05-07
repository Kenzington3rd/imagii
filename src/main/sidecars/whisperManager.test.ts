import { describe, it, expect } from 'vitest'
import { tsToSeconds } from './whisperManager'

describe('tsToSeconds — variable-length fractional seconds (Phase 2.13)', () => {
  it('handles standard 3-digit fractions', () => {
    expect(tsToSeconds('00:00:01,500')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:01.500')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:00,000')).toBeCloseTo(0, 6)
  })

  it('handles 1-digit fractions (Whisper edge case that was broken)', () => {
    // Old code did Number('5') / 1000 = 0.005 — silently 100x too small.
    // New code: parseFloat('0.5') = 0.5.
    expect(tsToSeconds('00:00:01,5')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:01.5')).toBeCloseTo(1.5, 6)
  })

  it('handles 2-digit fractions', () => {
    expect(tsToSeconds('00:00:01,50')).toBeCloseTo(1.5, 6)
  })

  it('handles 4+ digit fractions', () => {
    expect(tsToSeconds('00:00:01,1234')).toBeCloseTo(1.1234, 6)
    expect(tsToSeconds('00:00:01,500000')).toBeCloseTo(1.5, 6)
  })

  it('combines hours, minutes, seconds, and fractional', () => {
    expect(tsToSeconds('01:02:03,500')).toBeCloseTo(3723.5, 6)
    expect(tsToSeconds('10:00:00,000')).toBeCloseTo(36000, 6)
  })

  it('returns 0 on unparseable input', () => {
    expect(tsToSeconds('')).toBe(0)
    expect(tsToSeconds('not a timestamp')).toBe(0)
    expect(tsToSeconds('1:2:3')).toBe(0) // missing fractional separator
  })
})
