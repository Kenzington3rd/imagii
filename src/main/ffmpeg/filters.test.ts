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
