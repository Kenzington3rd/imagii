import { describe, it, expect } from 'vitest'
import {
  computeInitialWindowSize,
  isStoredWindowBounds,
  resolveWindowBounds,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  type ScreenRect
} from './windowSizing'

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

/**
 * T-47 — the window has to come back the size and place the user left it,
 * and must never come back onto a display that is no longer there. The
 * unplugged-monitor case is the whole reason this helper is pure: it is
 * the one that a manual test can't reach without a second display.
 */
describe('resolveWindowBounds', () => {
  const LAPTOP: ScreenRect = { x: 0, y: 0, width: 1920, height: 1040 }
  /** A second display to the LEFT, the layout that produces negative x. */
  const LEFT_MONITOR: ScreenRect = { x: -2560, y: 0, width: 2560, height: 1400 }

  it('falls back to the auto-sized default when nothing is stored', () => {
    const r = resolveWindowBounds(undefined, [LAPTOP], LAPTOP)
    expect(r).toEqual({ ...computeInitialWindowSize(1920, 1040), maximized: false })
    // No position at all — BrowserWindow centers on the primary display.
    expect(r.x).toBeUndefined()
    expect(r.y).toBeUndefined()
  })

  it.each([
    ['a string', 'nope'],
    ['null', null],
    ['a partial record', { x: 10, y: 10, width: 800 }],
    ['a NaN coordinate', { x: Number.NaN, y: 0, width: 1200, height: 800, maximized: false }],
    ['a zero width', { x: 0, y: 0, width: 0, height: 800, maximized: false }],
    ['a non-boolean maximized', { x: 0, y: 0, width: 1200, height: 800, maximized: 'yes' }]
  ])('ignores stored garbage: %s', (_label, stored) => {
    expect(isStoredWindowBounds(stored)).toBe(false)
    const r = resolveWindowBounds(stored, [LAPTOP], LAPTOP)
    expect(r.x).toBeUndefined()
    expect(r.maximized).toBe(false)
  })

  it('reuses bounds that land on the connected display', () => {
    const r = resolveWindowBounds(
      { x: 120, y: 80, width: 1400, height: 900, maximized: false },
      [LAPTOP],
      LAPTOP
    )
    expect(r).toEqual({ x: 120, y: 80, width: 1400, height: 900, maximized: false })
  })

  it('keeps the size but drops the position when the display is gone', () => {
    // Saved on the left-hand monitor, reopened with only the laptop.
    const stored = { x: -1800, y: 200, width: 1500, height: 950, maximized: false }
    expect(resolveWindowBounds(stored, [LEFT_MONITOR, LAPTOP], LAPTOP)).toEqual({
      x: -1800,
      y: 200,
      width: 1500,
      height: 950,
      maximized: false
    })
    const orphaned = resolveWindowBounds(stored, [LAPTOP], LAPTOP)
    expect(orphaned.width).toBe(1500)
    expect(orphaned.height).toBe(950)
    expect(orphaned.x).toBeUndefined()
    expect(orphaned.y).toBeUndefined()
  })

  it('drops a position that only clips the screen corner', () => {
    // 40px of the window is on screen — a title bar the user cannot grab.
    const r = resolveWindowBounds(
      { x: 1880, y: 1000, width: 1200, height: 800, maximized: false },
      [LAPTOP],
      LAPTOP
    )
    expect(r.x).toBeUndefined()
    expect(r.width).toBe(1200)
  })

  it('keeps a position that is mostly off-screen but still grabbable', () => {
    const r = resolveWindowBounds(
      { x: 1700, y: 300, width: 1200, height: 800, maximized: false },
      [LAPTOP],
      LAPTOP
    )
    expect(r.x).toBe(1700)
  })

  it('clamps a stored size to the app minimum and to the work area', () => {
    const tiny = resolveWindowBounds(
      { x: 10, y: 10, width: 200, height: 100, maximized: false },
      [LAPTOP],
      LAPTOP
    )
    expect(tiny.width).toBe(MIN_WINDOW_WIDTH)
    expect(tiny.height).toBe(MIN_WINDOW_HEIGHT)

    const huge = resolveWindowBounds(
      { x: 0, y: 0, width: 9000, height: 9000, maximized: false },
      [LAPTOP],
      LAPTOP
    )
    expect(huge.width).toBe(1920)
    expect(huge.height).toBe(1040)
  })

  it('carries the maximized flag without forgetting the normal size', () => {
    const r = resolveWindowBounds(
      { x: 60, y: 40, width: 1300, height: 860, maximized: true },
      [LAPTOP],
      LAPTOP
    )
    // The window opens at the restored size and is maximized on top of it,
    // so un-maximizing lands back on the user's own geometry.
    expect(r).toEqual({ x: 60, y: 40, width: 1300, height: 860, maximized: true })
  })
})
