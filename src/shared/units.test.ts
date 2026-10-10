import { describe, it, expect } from 'vitest'
import { formatFps } from './units'

describe('formatFps', () => {
  it('drops the decimals of a whole rate and spaces the unit', () => {
    expect(formatFps(30)).toBe('30 fps')
    expect(formatFps(60)).toBe('60 fps')
    expect(formatFps(24)).toBe('24 fps')
  })

  it('keeps two decimals for a broadcast rate', () => {
    expect(formatFps(30000 / 1001)).toBe('29.97 fps')
    expect(formatFps(24000 / 1001)).toBe('23.98 fps')
  })

  it('rounds float noise from ffprobe back to the whole rate', () => {
    expect(formatFps(29.999999)).toBe('30 fps')
    expect(formatFps(60.0000001)).toBe('60 fps')
  })

  it('falls back to the rate the player assumes when the probe had none', () => {
    expect(formatFps(0)).toBe('30 fps')
    expect(formatFps(NaN)).toBe('30 fps')
    expect(formatFps(Infinity)).toBe('30 fps')
  })
})
