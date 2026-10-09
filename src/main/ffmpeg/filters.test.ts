import { describe, it, expect } from 'vitest'
import { __testing__, buildVideoFilter, even } from './filters'
import { PLATFORM_PRESETS } from './presets'
import type { Clip, TextOverlay } from '../../shared/clip'

const { escapeDrawtext, safeOverlaySize, safeOverlayColor } = __testing__

/**
 * Regression tests for the drawtext escape helper. Round 6 caught that
 * newlines weren't being escaped, which broke the entire export for any
 * text overlay or watermark with embedded line breaks. Pin the escape
 * behavior in tests so a future "simplification" of the function can't
 * regress.
 */
describe('escapeDrawtext', () => {
  it('escapes the four classic offenders', () => {
    expect(escapeDrawtext("o'reilly")).toBe("o\\'reilly")
    expect(escapeDrawtext('12:30')).toBe('12\\:30')
    expect(escapeDrawtext('50%')).toBe('50\\%')
    expect(escapeDrawtext('path\\file')).toBe('path\\\\file')
  })

  it('escapes newlines to ffmpeg-compatible \\n sequence', () => {
    expect(escapeDrawtext('line1\nline2')).toBe('line1\\nline2')
    expect(escapeDrawtext('a\r\nb')).toBe('a\\nb')
    expect(escapeDrawtext('a\rb')).toBe('a\\nb')
  })

  it('handles all offenders together without double-escaping', () => {
    // Backslash must be escaped FIRST so we don't double-escape introduced \\
    const out = escapeDrawtext("it's 50%:\nfoo\\bar")
    expect(out).toBe("it\\'s 50\\%\\:\\nfoo\\\\bar")
  })

  it('returns empty string for empty input', () => {
    expect(escapeDrawtext('')).toBe('')
  })

  it('passes through safe alphanumeric text', () => {
    expect(escapeDrawtext('Hello World 123')).toBe('Hello World 123')
  })
})

/**
 * Regression for round 14: drawTextFilter interpolated `overlay.sizePx`
 * and `overlay.colorHex` raw. A malicious .imagii.json could set colorHex
 * to `white,movie=C\:/Users/victim/.ssh/id_rsa[k]...` and inject arbitrary
 * FFmpeg filter directives. These sink-side coercers are the last-line
 * defense — they must never let a non-numeric size or non-hex color reach
 * the filter string.
 */
describe('safeOverlaySize', () => {
  it('passes through a valid in-range size, rounded', () => {
    expect(safeOverlaySize(48)).toBe(48)
    expect(safeOverlaySize(64.4)).toBe(64)
  })

  it('clamps to the 8..512 range', () => {
    expect(safeOverlaySize(2)).toBe(8)
    expect(safeOverlaySize(9999)).toBe(512)
  })

  it('falls back to 48 for non-finite / non-numeric input', () => {
    expect(safeOverlaySize(NaN)).toBe(48)
    expect(safeOverlaySize(Infinity)).toBe(48)
    expect(safeOverlaySize('64; movie=secret' as unknown)).toBe(48)
    expect(safeOverlaySize(undefined as unknown)).toBe(48)
  })
})

/**
 * M4 fix (round 15): yuv420p chroma subsampling needs even W/H/X/Y. The
 * previous Math.round() let odd values through which crashed libx264 in
 * strict mode. `even()` clears the low bit.
 */
describe('even', () => {
  it('rounds odd positives down to the nearest even', () => {
    expect(even(1081)).toBe(1080)
    expect(even(3)).toBe(2)
    expect(even(101.7)).toBe(100)
  })

  it('passes even values through unchanged', () => {
    expect(even(1080)).toBe(1080)
    expect(even(0)).toBe(0)
    expect(even(2)).toBe(2)
  })

  it('rounds negatives toward -infinity (-1 → -2)', () => {
    // Only consumer that sees a negative is the Math.max(0, …) clamp, so
    // the exact rule for negatives doesn't matter functionally — pin it
    // anyway so a refactor can't drift the contract.
    expect(even(-1)).toBe(-2)
    expect(even(-2)).toBe(-2)
  })

  it('returns 0 for non-finite input', () => {
    expect(even(NaN)).toBe(0)
    expect(even(Infinity)).toBe(0)
    expect(even(-Infinity)).toBe(0)
  })
})

/**
 * T-74 — the overlay `enable` window is stored SOURCE-absolute (the editor's
 * Time fields) and consumed in the FILTER GRAPH's timebase, which starts at 0
 * for every clip because `runExportJob` seeks with `-ss` before `-i`, and is
 * divided again by `setpts=PTS/speed`. These pin the conversion; the Layer 5
 * drawbox stand-in (`npm run test:media`) proves real ffmpeg agrees.
 */
describe('text-overlay enable window (T-74)', () => {
  const preset = PLATFORM_PRESETS.youtube
  const source = { width: 1920, height: 1080 }

  function overlay(startSec: number, endSec: number): TextOverlay {
    return {
      id: 'ov1',
      text: 'HELLO',
      font: 'Arial',
      sizePx: 48,
      colorHex: '#ffffff',
      x: 0.1,
      y: 0.85,
      startSec,
      endSec
    }
  }

  function clipWith(startSec: number, endSec: number, overlays: TextOverlay[]): Clip {
    return {
      id: 'c1',
      name: 'clip',
      startSec,
      endSec,
      cropRect: null,
      textOverlays: overlays,
      selectedPresets: ['youtube']
    }
  }

  function windowsIn(chain: string): string[] {
    return [...chain.matchAll(/enable='between\(t,([-\d.]+),([-\d.]+)\)'/g)].map(
      (m) => `${m[1]},${m[2]}`
    )
  }

  it("rebases the editor default (the clip's own range) onto the clip", () => {
    // What TextOverlayEditor creates for a clip that starts at 10: the
    // overlay covers 10 -> 13, and the graph must draw it for all 3 seconds.
    const chain = buildVideoFilter(clipWith(10, 13, [overlay(10, 13)]), preset, source)
    expect(windowsIn(chain)).toEqual(['0.000,3.000'])
  })

  it('rebases a sub-range the same way', () => {
    const chain = buildVideoFilter(clipWith(10, 13, [overlay(11, 12)]), preset, source)
    expect(windowsIn(chain)).toEqual(['1.000,2.000'])
  })

  it('leaves a clip that starts at 0 exactly as it was (the only case that ever worked)', () => {
    const chain = buildVideoFilter(clipWith(0, 3, [overlay(0.4, 1.6)]), preset, source)
    expect(windowsIn(chain)).toEqual(['0.400,1.600'])
  })

  it('divides by the clip speed, because setpts already did', () => {
    // 2x: the clip's 3 source seconds become 1.5 output seconds, so an
    // overlay covering source 11 -> 12 lands at 0.5 -> 1.0 in the graph.
    const clip = { ...clipWith(10, 13, [overlay(11, 12)]), speedMultiplier: 2 }
    const chain = buildVideoFilter(clip, preset, source)
    expect(chain.startsWith('setpts=PTS/2.0000,')).toBe(true)
    expect(windowsIn(chain)).toEqual(['0.500,1.000'])
  })

  it('converts every overlay on the clip, not just the first', () => {
    const chain = buildVideoFilter(
      clipWith(10, 13, [overlay(10, 13), overlay(11.5, 12.5)]),
      preset,
      source
    )
    expect(windowsIn(chain)).toEqual(['0.000,3.000', '1.500,2.500'])
  })

  it('keeps the visible half of a window that opens before the clip', () => {
    // Unclamped on purpose: `between()` cannot match before t=0 anyway, so
    // a negative start is exactly "already on when the clip begins".
    const chain = buildVideoFilter(clipWith(10, 13, [overlay(8, 11)]), preset, source)
    expect(windowsIn(chain)).toEqual(['-2.000,1.000'])
  })
})

/**
 * T-83 — a manual crop is the new SOURCE FRAME: crop (the user's) ->
 * aspect cut (against the CROPPED size, the same code the no-crop path runs
 * against the source) -> scale. These pin the geometry of that chain; the
 * Layer 5 marker tests prove real ffmpeg agrees and that nothing is stretched.
 */
describe('a manual crop is the frame each platform is cut from (T-83)', () => {
  function clipWithCrop(cropRect: Clip['cropRect']): Clip {
    return {
      id: 'c1',
      name: 'clip',
      startSec: 0,
      endSec: 3,
      cropRect,
      textOverlays: [],
      selectedPresets: ['youtube']
    }
  }

  /** Every `crop=w:h:x:y` in a chain, in order. */
  function crops(chain: string): Array<{ w: number; h: number; x: number; y: number }> {
    return [...chain.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => ({
      w: Number(m[1]),
      h: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4])
    }))
  }

  const src = { width: 1920, height: 1080 }

  it('cuts the platform shape out of the crop: a 4:3 crop for Reels gets a second, centered crop', () => {
    // 960x720 at (480, 180); 9:16 of that is 404x720, centered at x = 278.
    const chain = buildVideoFilter(
      clipWithCrop({ x: 0.25, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }),
      PLATFORM_PRESETS.reels,
      src
    )
    expect(crops(chain)).toEqual([
      { w: 960, h: 720, x: 480, y: 180 },
      { w: 404, h: 720, x: 278, y: 0 }
    ])
    // crop, aspect cut, scale — in that order, and nothing between the two crops.
    expect(chain).toMatch(/^crop=960:720:480:180,crop=404:720:278:0,scale=1080:1920:/)
  })

  it('cuts the other way for a tall crop on a wide platform', () => {
    // 540x960 at (690, 60); 16:9 of that is 540x302 (even), centered at y = 328.
    const chain = buildVideoFilter(
      clipWithCrop({ x: 690 / 1920, y: 60 / 1080, w: 540 / 1920, h: 960.25 / 1080 }),
      PLATFORM_PRESETS.youtube,
      src
    )
    expect(crops(chain)).toEqual([
      { w: 540, h: 960, x: 690, y: 60 },
      { w: 540, h: 302, x: 0, y: 328 }
    ])
  })

  it('adds nothing when the crop already has the platform shape', () => {
    const chain = buildVideoFilter(
      clipWithCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }),
      PLATFORM_PRESETS.youtube,
      src
    )
    expect(crops(chain)).toEqual([{ w: 960, h: 540, x: 480, y: 270 }])
  })

  it('leaves the no-crop path as it was: one aspect cut, against the source', () => {
    const chain = buildVideoFilter(clipWithCrop(null), PLATFORM_PRESETS.reels, src)
    expect(crops(chain)).toEqual([{ w: 606, h: 1080, x: 656, y: 0 }])
  })

  it('every chain ends in a frame of the preset shape, whatever was cropped', () => {
    // The invariant the bug broke: the last crop before `scale` has the
    // preset's aspect, so `scale` only resizes. Within one even pixel of
    // rounding (a ~200 px frame is the smallest tested).
    const rects: Array<NonNullable<Clip['cropRect']>> = [
      { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.3, y: 0.05, w: 0.28, h: 0.89 },
      { x: 0.2, y: 0.2, w: 0.6, h: 0.3 },
      { x: 0.4, y: 0.4, w: 0.13, h: 0.5 },
      { x: 0.05, y: 0.45, w: 0.9, h: 0.1 }
    ]
    for (const rect of rects) {
      for (const preset of Object.values(PLATFORM_PRESETS)) {
        const chain = buildVideoFilter(clipWithCrop(rect), preset, src)
        const list = crops(chain)
        const last = list[list.length - 1]
        expect(last, `a crop exists for ${JSON.stringify(rect)} / ${preset.id}`).toBeDefined()
        if (!last) continue
        const tolerance = 2 / Math.min(last.w, last.h)
        expect(
          Math.abs(last.w / last.h / preset.aspectRatio - 1),
          `${JSON.stringify(rect)} -> ${preset.id}: ${last.w}x${last.h}`
        ).toBeLessThan(Math.max(tolerance, 0.01))
        // ...and each crop sits inside the frame the one before it left.
        let frame = { w: src.width, h: src.height }
        for (const c of list) {
          expect(c.x + c.w).toBeLessThanOrEqual(frame.w)
          expect(c.y + c.h).toBeLessThanOrEqual(frame.h)
          frame = { w: c.w, h: c.h }
        }
      }
    }
  })

  it('every dimension and offset of every crop is even, on an odd source too', () => {
    // yuv420p / libx264 refuse odd values; the cropped size feeds the second
    // crop, so an odd intermediate would only fail at runtime.
    const rect = { x: 0.137, y: 0.061, w: 0.4413, h: 0.7219 }
    for (const dims of [
      { width: 1920, height: 1080 },
      { width: 1919, height: 1079 },
      { width: 1281, height: 721 }
    ]) {
      for (const preset of Object.values(PLATFORM_PRESETS)) {
        for (const c of crops(buildVideoFilter(clipWithCrop(rect), preset, dims))) {
          for (const n of [c.w, c.h, c.x, c.y]) {
            expect(n % 2, `${dims.width}x${dims.height} -> ${preset.id}: ${JSON.stringify(c)}`).toBe(0)
          }
        }
      }
    }
  })

  it('works through a custom-preset aspect too (the aspect is whatever the preset resolves to)', () => {
    const custom = { ...PLATFORM_PRESETS.youtube, width: 1000, height: 1000, aspectRatio: 1 }
    const chain = buildVideoFilter(
      clipWithCrop({ x: 0.25, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }),
      custom,
      src
    )
    expect(crops(chain)).toEqual([
      { w: 960, h: 720, x: 480, y: 180 },
      { w: 720, h: 720, x: 120, y: 0 }
    ])
  })
})

describe('safeOverlayColor', () => {
  it('passes through a well-formed hex color', () => {
    expect(safeOverlayColor('#ffffff')).toBe('#ffffff')
    expect(safeOverlayColor('00FF00')).toBe('00FF00')
  })

  it('falls back to white for an injection payload', () => {
    expect(
      safeOverlayColor('white,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]')
    ).toBe('white')
    expect(safeOverlayColor('red')).toBe('white')
    expect(safeOverlayColor('#fff')).toBe('white')
    expect(safeOverlayColor(42 as unknown)).toBe('white')
  })
})
