import { describe, it, expect } from 'vitest'
import { computeInitialWindowSize } from './windowSizing'

/**
 * Resolution-fragility regression: the previous fixed 1280x800 default
 * looked cramped on 1440p/4K monitors — the studios were squeezed into
 * a 1080p-sized box on a screen with 4x the pixel area. These tests pin
 * the auto-sized behavior at the three target resolutions (1080p, 2K,
 * 4K) so a future "simplify" doesn't accidentally revert to the fixed
 * default.
 */
describe('computeInitialWindowSize', () => {
  it('preserves the prior cramped default on 1080p displays', () => {
    // 1080p with a ~40px taskbar → work area ~1920x1040
    // 85% of that is 1632x884 — but width exceeds 1080p comfortably,
    // and we still cap by MIN to keep the launch experience consistent.
    const r = computeInitialWindowSize(1920, 1040)
    expect(r.width).toBe(1632) // 1920 * 0.85
    expect(r.height).toBe(884) // 1040 * 0.85
  })

  it('respects the MIN floor on very small displays', () => {
    // A 1024x768 work area (uncommon but possible on netbooks) should
    // clamp UP to the MIN, then back DOWN to the actual screen width.
    // 85% of 1024 = 870, MIN is 1280 → wants 1280, but display is only
    // 1024 wide, so final clamps to 1024.
    const r = computeInitialWindowSize(1024, 768)
    expect(r.width).toBe(1024)
    expect(r.height).toBe(768)
  })

  it('scales up nicely on 2K (1440p) displays', () => {
    // 2560x1440 with taskbar → 2560x1400
    // 85% = 2176x1190, both inside MAX, so used directly.
    const r = computeInitialWindowSize(2560, 1400)
    expect(r.width).toBe(2176)
    expect(r.height).toBe(1190)
  })

  it('caps the window size on 4K displays so it does not span the whole desktop', () => {
    // 3840x2160 with taskbar → 3840x2120
    // 85% = 3264x1802 — both exceed the MAX, so they cap at MAX.
    const r = computeInitialWindowSize(3840, 2120)
    expect(r.width).toBe(2400) // MAX_REQUESTED_WIDTH
    expect(r.height).toBe(1500) // MAX_REQUESTED_HEIGHT
  })

  it('caps on ultrawide 5120 displays too', () => {
    const r = computeInitialWindowSize(5120, 2160)
    expect(r.width).toBe(2400)
    expect(r.height).toBe(1500)
  })

  it('rejects invalid work-area dimensions', () => {
    expect(() => computeInitialWindowSize(0, 1080)).toThrow()
    expect(() => computeInitialWindowSize(1920, 0)).toThrow()
    expect(() => computeInitialWindowSize(NaN, 1080)).toThrow()
    expect(() => computeInitialWindowSize(1920, -100)).toThrow()
  })
})
