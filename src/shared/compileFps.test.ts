import { describe, it, expect } from 'vitest'
import { COMPILE_FPS, MAX_COMPILE_FPS, compileFps } from './compileFps'

/**
 * T-130 (q) - the rate a compilation is written at.
 *
 * It was 30 for everything, so a 60 fps recording (OBS's usual) lost half its frames in a montage while a 60 fps platform export did not.
 * The compilation now follows its clips' source up to 60.
 */
describe('compileFps - the compilation follows the source up to 60 (T-130 (q))', () => {
  it('is the fallback (30) and the ceiling (60) the product names', () => {
    expect(COMPILE_FPS).toBe(30)
    expect(MAX_COMPILE_FPS).toBe(60)
  })

  it('keeps the rate of a source at or under the ceiling, whatever it is', () => {
    for (const rate of [10, 15, 24, 25, 30, 48, 50, 60]) {
      expect(compileFps([rate]), `${rate} fps`).toBe(rate)
    }
  })

  it('caps a faster source at 60', () => {
    for (const rate of [61, 75, 90, 120, 144, 240]) {
      expect(compileFps([rate]), `${rate} fps`).toBe(60)
    }
  })

  it('keeps an NTSC rate as it is - 59.94 compiles at 59.94, not 60, and 29.97 not 30', () => {
    expect(compileFps([60000 / 1001])).toBe(60000 / 1001)
    expect(compileFps([30000 / 1001])).toBe(30000 / 1001)
    expect(compileFps([24000 / 1001])).toBe(24000 / 1001)
    // ...and the cap is numeric: a rate a hair under 60 is not rounded up to it, one a hair over is brought down to it.
    expect(compileFps([59.99])).toBe(59.99)
    expect(compileFps([60.01])).toBe(60)
  })

  it('takes the fastest of several clips', () => {
    expect(compileFps([24, 60, 30])).toBe(60)
    expect(compileFps([25, 30])).toBe(30)
    expect(compileFps([30, 120])).toBe(60)
  })

  it('falls back to 30 when no clip states a rate (the probe says 0 for a file that does not)', () => {
    expect(compileFps([])).toBe(COMPILE_FPS)
    expect(compileFps([0])).toBe(COMPILE_FPS)
    expect(compileFps([0, 0])).toBe(COMPILE_FPS)
  })

  it('does not let a rate that is not a number, or is negative, decide anything', () => {
    expect(compileFps([Number.NaN])).toBe(COMPILE_FPS)
    expect(compileFps([Number.POSITIVE_INFINITY])).toBe(COMPILE_FPS)
    expect(compileFps([-24])).toBe(COMPILE_FPS)
    // A clip with no rate does not drag the others down to the fallback, or up from what they say.
    expect(compileFps([0, 24])).toBe(24)
    expect(compileFps([Number.NaN, 25])).toBe(25)
  })
})
