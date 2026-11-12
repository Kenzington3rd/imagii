import { describe, it, expect } from 'vitest'
import {
  buildWatermark,
  isVerticalFrame,
  isWatermarkPosition,
  watermarkFontSize,
  watermarkInset,
  watermarkTextWidth,
  ARIAL_BOLD_ADVANCES,
  ARIAL_BOLD_UNITS_PER_EM,
  DEFAULT_WATERMARK_POSITION,
  VERTICAL_WATERMARK_INSET,
  WATERMARK_BOX_BORDER_PX,
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

/**
 * T-182 (2). A right-hand watermark is placed at `w-tw-20`, so a handle wider than the frame started at a negative x and lost its first
 * characters (33 characters at 67 px on 1080x1920: x = -182). `watermarkFontSize` is today's size, or the largest whole size at which the text
 * plus its 8 px box border fits between the 20 px side margins. The measured values below were read off the code once and pinned; the
 * "largest" claim is also checked as a property (it fits, and one pixel more does not), so a pinned number cannot hide a wrong rule.
 */
describe('watermarkFontSize (T-182 (2))', () => {
  const V = { width: 1080, height: 1920 }
  const FOUR_FIVE = { width: 1080, height: 1350 }
  const LAND = { width: 1920, height: 1080 }
  const URL = 'youtube.com/@averylongchannelname'
  const CAPS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMN'
  const WS = 'W'.repeat(40)
  const size = (text: string, frame: { width: number; height: number }): number => watermarkFontSize({ text, fontSizePct: WATERMARK_FONT_SIZE_PCT }, frame)
  const today = (frame: { height: number }): number => Math.max(12, Math.round((WATERMARK_FONT_SIZE_PCT / 100) * frame.height))
  const fits = (text: string, px: number, frame: { width: number }): boolean =>
    watermarkTextWidth(text, px) + 2 * WATERMARK_BOX_BORDER_PX <= frame.width - 2 * WATERMARK_EDGE_PX

  describe('controls: what fits keeps today\'s size exactly', () => {
    it('"@sample" keeps 67 on 1080x1920, 47 on 1080x1350 and 38 on 1920x1080', () => {
      expect(size('@sample', V)).toBe(67)
      expect(size('@sample', FOUR_FIVE)).toBe(47)
      expect(size('@sample', LAND)).toBe(38)
    })

    it('40 capitals keep 38 on 1920x1080 (they fit)', () => {
      expect(size(CAPS, LAND)).toBe(38)
      expect(fits(CAPS, 38, LAND)).toBe(true)
    })

    it('the 33-character URL keeps 47 on 1080x1350: it fits there (873.8 px of 1024)', () => {
      expect(size(URL, FOUR_FIVE)).toBe(47)
      expect(fits(URL, 47, FOUR_FIVE)).toBe(true)
    })
  })

  describe('a text that would not fit is set at the largest whole size that does', () => {
    // [label, text, frame, today's size, the size measured on this code]
    it.each([
      ['the URL on 1080x1920', URL, V, 67, 55],
      ['40 capitals on 1080x1920', CAPS, V, 67, 37],
      ['40 W on 1080x1920', WS, V, 67, 27],
      ['40 capitals on 1080x1350', CAPS, FOUR_FIVE, 47, 37],
      ['40 W on 1080x1350', WS, FOUR_FIVE, 47, 27]
    ])('%s: smaller than today\'s size, fits, and one pixel more would not', (_label, text, frame, wasSize, measured) => {
      const got = size(text, frame)
      expect(today(frame)).toBe(wasSize)
      expect(got).toBeLessThan(wasSize)
      expect(fits(text, got, frame), `${got} px: ${watermarkTextWidth(text, got)} + 16 in ${frame.width - 40}`).toBe(true)
      expect(fits(text, got + 1, frame), `${got + 1} px would fit too, so ${got} is not the largest`).toBe(false)
      expect(got).toBe(measured)
    })

    it('a spaced handle on 1080x1920 is set at the largest size that fits, each space counting its own 569 units', () => {
      const text = 'Follow @averylongname on Twitch'
      const got = size(text, V)
      expect(got).toBeLessThan(67)
      expect(fits(text, got, V)).toBe(true)
      expect(fits(text, got + 1, V)).toBe(false)
      expect(got).toBe(61)
    })

    it('the rule holds across widths and texts: the largest whole size that fits, or today\'s when that is smaller (a tall frame, so today\'s is 3500)', () => {
      for (const text of [URL, CAPS, WS, 'Follow @averylongname on Twitch', 'iiiiiiiiiiiiiiiiiiii', '@a']) {
        for (let width = 240; width <= 1300; width += 41) {
          const frame = { width, height: 100000 }
          const got = size(text, frame)
          if (got === 12) {
            expect(fits(text, 13, frame), `${text} in ${width}: the floor, so 13 does not fit`).toBe(false)
            continue
          }
          expect(fits(text, got, frame), `${text} in ${width}: ${got} fits`).toBe(true)
          expect(fits(text, got + 1, frame), `${text} in ${width}: ${got + 1} does not`).toBe(false)
        }
      }
    })
  })

  describe('the edges', () => {
    it('never below 12: 40 W on a 200x400 custom frame is 12', () => {
      expect(size(WS, { width: 200, height: 400 })).toBe(12)
    })

    it('an empty text has nothing to fit and keeps today\'s size, even on a frame narrower than its own margins', () => {
      expect(size('', V)).toBe(67)
      expect(size('', { width: 30, height: 1000 })).toBe(35)
    })

    it('a character outside printable ASCII measures at least as wide as "W" in the same position (the widest advance, so the estimate is never short)', () => {
      for (const ch of ['\u20ac', '\u00e9', '\u65e5', '\u{1F600}', '\u007f', '\u001f']) {
        expect(watermarkTextWidth(`a${ch}b`, 100), JSON.stringify(ch)).toBeGreaterThanOrEqual(watermarkTextWidth('aWb', 100))
      }
      // One code point is one character, and it is the widest advance in the table ("@").
      expect(watermarkTextWidth('\u{1F600}', ARIAL_BOLD_UNITS_PER_EM)).toBe(Math.max(...ARIAL_BOLD_ADVANCES))
    })

    it('a non-ASCII text shrinks on a vertical frame as an ASCII one of the same length at the widest advance would', () => {
      expect(size('\u00e9'.repeat(40), V)).toBe(size('@'.repeat(40), V))
    })
  })

  describe('the table', () => {
    it('every printable ASCII code point (0x20 to 0x7E) is its own entry, read through the public width function', () => {
      for (let code = 0x20; code <= 0x7e; code++) {
        expect(watermarkTextWidth(String.fromCharCode(code), ARIAL_BOLD_UNITS_PER_EM), `0x${code.toString(16)}`).toBe(ARIAL_BOLD_ADVANCES[code - 0x20])
      }
    })

    it('0x1F and 0x7F, either side of the range, measure as the widest advance', () => {
      const widest = Math.max(...ARIAL_BOLD_ADVANCES)
      expect(watermarkTextWidth('\u001f', ARIAL_BOLD_UNITS_PER_EM)).toBe(widest)
      expect(watermarkTextWidth('\u007f', ARIAL_BOLD_UNITS_PER_EM)).toBe(widest)
    })

    it('95 entries in 2048 units per em; space and "i" are 569, "W" 1933, "@" 1997 and the widest; each entry a positive integer below the em', () => {
      expect(ARIAL_BOLD_ADVANCES).toHaveLength(95)
      expect(ARIAL_BOLD_UNITS_PER_EM).toBe(2048)
      const at = (c: string): number => ARIAL_BOLD_ADVANCES[c.charCodeAt(0) - 0x20]!
      expect(at(' ')).toBe(569)
      expect(at('i')).toBe(569)
      expect(at('W')).toBe(1933)
      expect(at('@')).toBe(1997)
      expect(Math.max(...ARIAL_BOLD_ADVANCES)).toBe(1997)
      for (const a of ARIAL_BOLD_ADVANCES) {
        expect(Number.isInteger(a) && a > 0 && a < ARIAL_BOLD_UNITS_PER_EM).toBe(true)
      }
    })

    it('the box border is the 8 px the filter has always printed', () => {
      expect(WATERMARK_BOX_BORDER_PX).toBe(8)
    })
  })
})
