import { describe, it, expect } from 'vitest'
import { formatFps, readoutText } from './units'

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

// T-126 (12): the Ratio slider drew "8 :1" and read "8 :1" to a screen reader, beside a hint that says "8:1".
describe('readoutText', () => {
  it('a unit is spaced from its number, as every unit is', () => {
    expect(readoutText(300, 'ms')).toBe('300 ms')
    expect(readoutText(-30, 'dBFS')).toBe('-30 dBFS')
    expect(readoutText(1.5, 'ms')).toBe('1.5 ms')
  })

  it('a unit that begins with a colon is a ratio and joins without a space', () => {
    expect(readoutText(8, ':1')).toBe('8:1')
    expect(readoutText(2.5, ':1')).toBe('2.5:1')
    expect(readoutText(20, ':1')).toBe('20:1')
    expect(readoutText(8, ':1')).not.toContain(' ')
  })

  it('only a LEADING colon joins: a colon inside a unit keeps the space', () => {
    expect(readoutText(3, 'x:y')).toBe('3 x:y')
  })
})
