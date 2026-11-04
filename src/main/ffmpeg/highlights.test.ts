import { describe, it, expect } from 'vitest'
import { __testing__ } from './highlights'

const { parseEbur128, PARSE_EBUR128_MAX_ITERATIONS } = __testing__

describe('parseEbur128', () => {
  it('extracts t/M pairs from ffmpeg ebur128 stderr', () => {
    const stderr = [
      '[Parsed_ebur128_0 @ 0x123] t:  0.100 TARGET:-23 LUFS    M: -27.4 S: -27.4',
      '[Parsed_ebur128_0 @ 0x123] t:  0.200 TARGET:-23 LUFS    M: -25.1 S: -26.1',
      '[Parsed_ebur128_0 @ 0x123] t:  0.300 TARGET:-23 LUFS    M: -10.2 S: -22.7'
    ].join('\n')
    const samples = parseEbur128(stderr)
    expect(samples).toHaveLength(3)
    expect(samples[0]).toEqual({ t: 0.1, m: -27.4 })
    expect(samples[2]).toEqual({ t: 0.3, m: -10.2 })
  })

  it('skips non-finite numbers gracefully', () => {
    const stderr = 't:  inf TARGET:-23 LUFS    M: -27.4'
    const samples = parseEbur128(stderr)
    expect(samples).toHaveLength(0)
  })

  it('keeps a line whose M: ffmpeg printed as nan / -nan / -inf as a NON-FINITE sample, not a missing one (T-149 (1))', () => {
    const stderr = [
      '[Parsed_ebur128_0 @ 0x1] t:  0.100 TARGET:-23 LUFS    M: -27.4 S: -27.4',
      '[Parsed_ebur128_0 @ 0x1] t:  0.200 TARGET:-23 LUFS    M: nan S: -27.4',
      '[Parsed_ebur128_0 @ 0x1] t:  0.300 TARGET:-23 LUFS    M:-nan S: -27.4',
      '[Parsed_ebur128_0 @ 0x1] t:  0.400 TARGET:-23 LUFS    M:-inf S: -27.4',
      '[Parsed_ebur128_0 @ 0x1] t:  0.500 TARGET:-23 LUFS    M:-163.3 S: -27.4'
    ].join('\n')
    const samples = parseEbur128(stderr)
    expect(samples.map((x) => x.t)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
    expect(samples.map((x) => Number.isFinite(x.m))).toEqual([true, false, false, false, true])
    expect(samples[4]).toEqual({ t: 0.5, m: -163.3 })
  })

  it('handles a 1 MB realistic input within reasonable time', () => {
    const line = '[Parsed_ebur128_0 @ 0x1] t:  0.100 TARGET:-23 LUFS    M: -27.4 S: -27.4\n'
    const big = line.repeat(15_000) // ~1 MB of valid samples
    const start = Date.now()
    const samples = parseEbur128(big)
    const elapsed = Date.now() - start
    expect(samples.length).toBe(15_000)
    expect(elapsed).toBeLessThan(2000)
  })

  it('cap is set high enough to never trip on real-world ffmpeg output', () => {
    // Plausibility check: the iteration cap should comfortably exceed a
    // 24-hour source's sample count (~864k) by an order of magnitude.
    expect(PARSE_EBUR128_MAX_ITERATIONS).toBeGreaterThanOrEqual(1_000_000)
  })
})
