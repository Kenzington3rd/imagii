import { describe, it, expect } from 'vitest'
import {
  buildWatermark,
  isVerticalFrame,
  isWatermarkPosition,
  watermarkInset,
  DEFAULT_WATERMARK_POSITION,
  VERTICAL_WATERMARK_INSET,
  WATERMARK_EDGE_PX,
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

/**
 * T-130 (an) - where a watermark sits, so that it clears the platform's own interface on a vertical frame.
 *
 * It sat a flat 20 px from its corner on every preset. On a 9:16 frame (Reels, TikTok, Shorts) the top 15% is the app's header and the bottom
 * 25% is the caption, the account name and the sound, so a handle in the bottom corner was drawn under the caption it was meant to sit beside
 * and a top one under the header. Layer 5 measures the pixels (win32: the shipped binary has drawtext); this pins the numbers.
 */
describe('the watermark\'s margins (T-130 (an))', () => {
  it('a landscape frame keeps the flat 20 px: the constants the product names', () => {
    expect(WATERMARK_EDGE_PX).toBe(20)
    expect(VERTICAL_WATERMARK_INSET).toEqual({ top: 0.15, bottom: 0.25 })
    for (const frame of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 3840, height: 2160 }]) {
      expect(watermarkInset(frame), `${frame.width}x${frame.height}`).toEqual({ top: 20, bottom: 20 })
    }
  })

  it('a 1080x1920 frame is inset 288 px at the top and 480 px at the bottom: 15% and 25% of its height', () => {
    expect(watermarkInset({ width: 1080, height: 1920 })).toEqual({ top: 288, bottom: 480 })
  })

  it('the inset is a share of the frame\'s height, so a smaller or larger vertical frame has the same proportions', () => {
    expect(watermarkInset({ width: 720, height: 1280 })).toEqual({ top: 192, bottom: 320 })
    expect(watermarkInset({ width: 2160, height: 3840 })).toEqual({ top: 576, bottom: 960 })
    expect(watermarkInset({ width: 1080, height: 2340 })).toEqual({ top: 351, bottom: 585 })
  })

  it('only a frame at least as tall as 9:16 is vertical: 4:5, square and every landscape shape are not', () => {
    for (const frame of [{ width: 1080, height: 1920 }, { width: 720, height: 1280 }, { width: 1080, height: 2340 }, { width: 1080, height: 1918 }, { width: 1080, height: 1920 - 2 }]) {
      expect(isVerticalFrame(frame), `${frame.width}x${frame.height}`).toBe(true)
    }
    for (const frame of [{ width: 1080, height: 1350 }, { width: 1080, height: 1080 }, { width: 1080, height: 1440 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      expect(isVerticalFrame(frame), `${frame.width}x${frame.height}`).toBe(false)
      expect(watermarkInset(frame), `${frame.width}x${frame.height}`).toEqual({ top: 20, bottom: 20 })
    }
  })

  it('a frame with no usable size is not vertical, and gets the flat margin', () => {
    for (const frame of [{ width: 0, height: 1920 }, { width: 1080, height: 0 }, { width: Number.NaN, height: 1920 }, { width: 1080, height: Number.POSITIVE_INFINITY }]) {
      expect(isVerticalFrame(frame)).toBe(false)
      expect(watermarkInset(frame)).toEqual({ top: 20, bottom: 20 })
    }
  })

  it('the vertical bottom inset is deeper than the top, and both are deeper than the flat margin at any size a video can be', () => {
    expect(VERTICAL_WATERMARK_INSET.bottom).toBeGreaterThan(VERTICAL_WATERMARK_INSET.top)
    const small = watermarkInset({ width: 144, height: 256 })
    expect(small.top).toBeGreaterThan(WATERMARK_EDGE_PX)
    expect(small.bottom).toBeGreaterThan(WATERMARK_EDGE_PX)
  })
})
