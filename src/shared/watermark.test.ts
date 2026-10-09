import { describe, it, expect } from 'vitest'
import {
  buildWatermark,
  isWatermarkPosition,
  DEFAULT_WATERMARK_POSITION,
  WATERMARK_FONT_SIZE_PCT,
  WATERMARK_MAX_LENGTH,
  WATERMARK_OPACITY,
  WATERMARK_POSITIONS
} from './watermark'

/**
 * T-85. Clip Kit passed `watermark: null` while the Export panel stamped the
 * same clip, so the one place that turns a handle and a corner into a
 * `WatermarkSpec` is shared now — and what each caller can hand it is
 * untrusted (the kit reads a settings file off disk).
 */
describe('buildWatermark', () => {
  it('builds the look imagii stamps everywhere: 0.85 opacity, 3.5% type', () => {
    expect(buildWatermark('@imagii', 'top-left')).toEqual({
      text: '@imagii',
      position: 'top-left',
      opacity: 0.85,
      fontSizePct: 3.5
    })
    // Pinned as literals too: the Layer 5 pixel tests were calibrated on them.
    expect(WATERMARK_OPACITY).toBe(0.85)
    expect(WATERMARK_FONT_SIZE_PCT).toBe(3.5)
  })

  it('keeps every corner the picker offers', () => {
    for (const position of WATERMARK_POSITIONS) {
      expect(buildWatermark('@a', position)?.position).toBe(position)
    }
    expect(WATERMARK_POSITIONS).toHaveLength(4)
  })

  it('trims the handle, and a blank one is no watermark at all', () => {
    expect(buildWatermark('  @imagii  ', 'top-left')?.text).toBe('@imagii')
    for (const blank of ['', '   ', '\t\n']) {
      expect(buildWatermark(blank, 'top-left')).toBeNull()
    }
  })

  it('treats a missing or non-string saved handle as none (a fresh install, a damaged file)', () => {
    for (const bad of [undefined, null, 42, true, {}, ['@a']]) {
      expect(buildWatermark(bad, 'top-left')).toBeNull()
    }
  })

  it('falls back to the default corner for anything the picker does not offer', () => {
    for (const bad of [undefined, null, '', 'middle', 'TOP-LEFT', 3, {}]) {
      expect(buildWatermark('@a', bad)?.position).toBe(DEFAULT_WATERMARK_POSITION)
    }
    expect(DEFAULT_WATERMARK_POSITION).toBe('bottom-right')
  })

  it('cuts an overlong handle to what the Export panel input allows', () => {
    const long = '@' + 'x'.repeat(200)
    const spec = buildWatermark(long, 'top-left')
    expect(spec?.text).toHaveLength(WATERMARK_MAX_LENGTH)
    expect(spec?.text.startsWith('@xxx')).toBe(true)
    // A cut that lands on a space does not leave one dangling at the end.
    const spaced = 'a'.repeat(WATERMARK_MAX_LENGTH - 1) + ' tail'
    expect(buildWatermark(spaced, 'top-left')?.text).toBe('a'.repeat(WATERMARK_MAX_LENGTH - 1))
  })

  it('does not alter an in-range handle, so the Export panel is byte-for-byte what it was', () => {
    const exactly40 = '@' + 'y'.repeat(39)
    expect(buildWatermark(exactly40, 'top-right')?.text).toBe(exactly40)
  })
})

describe('isWatermarkPosition', () => {
  it('accepts exactly the four corners', () => {
    for (const p of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      expect(isWatermarkPosition(p)).toBe(true)
    }
    for (const p of ['center', 'left', '', null, undefined, 1]) {
      expect(isWatermarkPosition(p)).toBe(false)
    }
  })
})
