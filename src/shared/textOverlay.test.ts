import { describe, it, expect } from 'vitest'
import {
  OVERLAY_COLOR_REFUSAL,
  OVERLAY_TIME_REFUSAL,
  clampOverlaySize,
  newTextOverlay,
  normalizeOverlayPatch,
  overlayOutsideClipMessage,
  overlayTimePair,
  overlayTimeText
} from './textOverlay'
import { resolveOverlayColor } from './overlayColors'
import { parseClock } from './clockTime'
import { isValidTextOverlay } from './projectValidation'

/**
 * T-113 (1) — a name the editor invites ("white or #ffcc00") becomes the hex every
 * gate takes BEFORE it is stored. The gates stay hex-only (they guard the IPC
 * boundary against filter injection); these tests are the other half of that
 * bargain: nothing but a hex ever reaches them from the editor.
 */

describe('OVERLAY_COLOR_REFUSAL', () => {
  it('the sentence the editor shows names both forms it takes, and takes its own examples', () => {
    expect(OVERLAY_COLOR_REFUSAL).toMatch(/white/)
    expect(OVERLAY_COLOR_REFUSAL).toMatch(/#ffcc00/)
    expect(resolveOverlayColor('white')).toBe('#ffffff')
    expect(resolveOverlayColor('#ffcc00')).toBe('#ffcc00')
  })
})

describe('OVERLAY_TIME_REFUSAL (T-125 (23))', () => {
  it('is a finished sentence that names the forms the Source time boxes take, and every example in it is one they read', () => {
    expect(OVERLAY_TIME_REFUSAL).toMatch(/^imagii could not read that time\. /)
    expect(OVERLAY_TIME_REFUSAL.length).toBeLessThanOrEqual(240)
    for (const example of ['90.5', '1:30', '2:47:13']) {
      expect(OVERLAY_TIME_REFUSAL).toContain(example)
      expect(parseClock(example), example).not.toBeNull()
    }
  })
})

describe('clampOverlaySize — the validator\'s 8..512', () => {
  it('holds a size to the range and to whole pixels', () => {
    expect(clampOverlaySize(48)).toBe(48)
    expect(clampOverlaySize(8)).toBe(8)
    expect(clampOverlaySize(512)).toBe(512)
    expect(clampOverlaySize(3)).toBe(8)
    expect(clampOverlaySize(-40)).toBe(8)
    expect(clampOverlaySize(9999)).toBe(512)
    expect(clampOverlaySize(48.6)).toBe(49)
  })

  it('a clamped size is always one the overlay gate accepts', () => {
    for (const n of [-1e9, -1, 0, 1, 7.4, 8, 400, 401, 512, 513, 1e9, Infinity, -Infinity, NaN]) {
      const overlay = { ...newTextOverlay(0, 1), sizePx: clampOverlaySize(n) }
      expect(isValidTextOverlay(overlay), String(n)).toBe(true)
    }
  })
})

describe('newTextOverlay — what "+ Add text" stores untouched', () => {
  it('passes the overlay gate exactly as it is (the default used to be the named color "white")', () => {
    const overlay = newTextOverlay(12, 20)
    expect(isValidTextOverlay({ id: 'x', ...overlay })).toBe(true)
    expect(overlay.colorHex).toBe('#ffffff')
  })

  it('spans the clip it was added to, and says what to change', () => {
    const overlay = newTextOverlay(12, 20)
    expect(overlay.startSec).toBe(12)
    expect(overlay.endSec).toBe(20)
    expect(overlay.text).toBe('Your text here')
  })
})

describe('normalizeOverlayPatch — the store boundary', () => {
  it('writes a color name as its hex', () => {
    expect(normalizeOverlayPatch({ colorHex: 'Gold' })).toEqual({ colorHex: '#ffd700' })
  })

  it('drops a color it cannot resolve, so the stored one stays', () => {
    expect(normalizeOverlayPatch({ colorHex: 'nope', text: 'hi' })).toEqual({ text: 'hi' })
  })

  it('clamps a size, and drops one that is not a number', () => {
    expect(normalizeOverlayPatch({ sizePx: 9999 })).toEqual({ sizePx: 512 })
    expect(normalizeOverlayPatch({ sizePx: 2 })).toEqual({ sizePx: 8 })
    expect(normalizeOverlayPatch({ sizePx: NaN })).toEqual({})
  })

  it('passes every other field through untouched', () => {
    expect(normalizeOverlayPatch({ text: 'a', font: 'Impact', x: 0.5, startSec: 3 })).toEqual({
      text: 'a',
      font: 'Impact',
      x: 0.5,
      startSec: 3
    })
  })

  it('does not mutate what it was given', () => {
    const patch = { colorHex: 'red', sizePx: 1 }
    normalizeOverlayPatch(patch)
    expect(patch).toEqual({ colorHex: 'red', sizePx: 1 })
  })
})

// T-124 (18): an overlay's Time boxes are seconds in the SOURCE video, and a window that never meets the selected clip draws nothing
// ("never matches" in filters.ts): the export finishes and the text is not in it. The editor says so as soon as it is true.
describe('overlayOutsideClipMessage - a window that misses the clip draws nothing (T-124 (18))', () => {
  const clip = { startSec: 10, endSec: 20 }
  const at = (startSec: number, endSec: number): { startSec: number; endSec: number } => ({ startSec, endSec })

  it('says nothing for a window that overlaps the clip, wherever it starts and ends', () => {
    expect(overlayOutsideClipMessage(at(10, 20), clip)).toBeNull() // the untouched overlay: the clip's own range
    expect(overlayOutsideClipMessage(at(12, 15), clip)).toBeNull() // inside
    expect(overlayOutsideClipMessage(at(5, 12), clip)).toBeNull() // opens before the clip, shows its end
    expect(overlayOutsideClipMessage(at(18, 40), clip)).toBeNull() // closes after the clip, shows its start
    expect(overlayOutsideClipMessage(at(0, 1000), clip)).toBeNull() // covers it
  })

  it('warns for a window wholly before the clip, wholly after it, and one that touches only at an edge', () => {
    expect(overlayOutsideClipMessage(at(0, 5), clip)).not.toBeNull()
    expect(overlayOutsideClipMessage(at(25, 30), clip)).not.toBeNull()
    // [start, end) against [clip start, clip end): ending exactly where the clip starts, or starting exactly where it ends, shows nothing.
    expect(overlayOutsideClipMessage(at(5, 10), clip)).not.toBeNull()
    expect(overlayOutsideClipMessage(at(20, 25), clip)).not.toBeNull()
  })

  it('warns for a window of no length, which can never be on screen', () => {
    expect(overlayOutsideClipMessage(at(15, 15), clip)).not.toBeNull()
  })

  // T-125 (14): a window whose end clamped to its start is INSIDE the clip, and the sentence said "its times fall outside the clip" -
  // false, and the person who read it moved the times around the clip for a window that had no length. Its own sentence, whatever
  // clip it is measured against (a window of no length never shows, so where it sits is not the reason).
  it('a window of no length gets its own, true sentence - not the one about the clip', () => {
    const SAME = "This text won't show in the export: its start and end are the same, so it never shows."
    expect(overlayOutsideClipMessage(at(15, 15), clip)).toBe(SAME)
    expect(overlayOutsideClipMessage(at(10, 10), clip), 'on the clip\'s first instant').toBe(SAME)
    expect(overlayOutsideClipMessage(at(20, 20), clip), 'on the clip\'s last instant').toBe(SAME)
    expect(overlayOutsideClipMessage(at(3, 3), clip), 'outside the clip too: the zero length is the reason that is always true').toBe(SAME)
    expect(overlayOutsideClipMessage(at(15, 15), clip)).not.toMatch(/fall outside/)
    expect(SAME).toMatch(/[.!?]$/)
  })

  it('a window with a real length that misses the clip still gets the sentence about the clip', () => {
    expect(overlayOutsideClipMessage(at(0, 5), clip)).toMatch(/its times fall outside the clip/)
    expect(overlayOutsideClipMessage(at(14.99, 15), clip)).toBeNull()
  })

  it('the sentence names the clip\'s own range in the source, says what happens, and is a finished sentence', () => {
    const sentence = overlayOutsideClipMessage(at(0, 5), clip) ?? ''
    expect(sentence).toBe("This text won't show in the export: its times fall outside the clip, which runs from 10.00 to 20.00 s of the video.")
    expect(sentence).toMatch(/[.!?]$/)
    expect(overlayOutsideClipMessage(at(5, 9), { startSec: 0, endSec: 2.5 })).toContain('from 0.00 to 2.50 s')
  })

  it('does not judge a clip whose range is not a range (the clip list refuses those before they get here)', () => {
    expect(overlayOutsideClipMessage(at(0, 5), { startSec: 5, endSec: 5 })).toBeNull()
    expect(overlayOutsideClipMessage(at(0, 5), { startSec: Number.NaN, endSec: 5 })).toBeNull()
  })
})

// T-126 (5): the Source time boxes and the outside-the-clip note speak clock from an hour up, beside a Timeline that does.
describe('overlayTimeText', () => {
  it('below an hour it is the seconds the card says, two places, exactly as it always was', () => {
    expect(overlayTimeText(0)).toBe('0.00')
    expect(overlayTimeText(12)).toBe('12.00')
    expect(overlayTimeText(15.5)).toBe('15.50')
    expect(overlayTimeText(3599.99)).toBe('3599.99')
  })

  it('from one hour up it is the clock, with the hundredths', () => {
    expect(overlayTimeText(3600)).toBe('1:00:00.00')
    expect(overlayTimeText(3601.5)).toBe('1:00:01.50')
    expect(overlayTimeText(3723)).toBe('1:02:03.00')
    expect(overlayTimeText(10038)).toBe('2:47:18.00')
    expect(overlayTimeText(6043.5)).toBe('1:40:43.50')
  })

  it('what it shows is what parseClock reads back to the same number', () => {
    for (const n of [0, 12.5, 3599.99, 3600, 3601.5, 3723, 10038, 6043.5, 36000.25]) {
      expect(parseClock(overlayTimeText(n)), String(n)).toBeCloseTo(n, 2)
    }
  })

  it('a value that rounds to a whole hour is shown as the hour, not as "59:59.99" or "3600.00"', () => {
    expect(overlayTimeText(3599.996)).toBe('1:00:00.00')
  })

  it('the hundredths are exact: a float\'s .57 is not shown as .56', () => {
    // 3600.57 - 3600 is 0.5699999999999363, which `Math.floor(x * 100)` turns into 56.
    expect(overlayTimeText(3600.57)).toBe('1:00:00.57')
    expect(overlayTimeText(7325.07)).toBe('2:02:05.07')
    for (const hundredths of [0, 1, 7, 29, 57, 58, 99]) {
      const n = 3600 + hundredths / 100
      expect(parseClock(overlayTimeText(n)), String(n)).toBeCloseTo(n, 9)
    }
  })
})

// T-127 (7): the Source time ROW. Each box used to pick its own form ("3590.00 -> 1:00:10.00 s"); the PAIR decides.
describe('overlayTimePair - the two boxes speak one form (T-127 (7))', () => {
  it('both below an hour: both are seconds, and the unit is "s"', () => {
    expect(overlayTimePair(0, 2)).toEqual({ start: '0.00', end: '2.00', clock: false })
    expect(overlayTimePair(12.5, 3599.99)).toEqual({ start: '12.50', end: '3599.99', clock: false })
  })

  it('either at one hour or more: BOTH are the clock, and there is no unit', () => {
    expect(overlayTimePair(3590, 3610)).toEqual({ start: '59:50.00', end: '1:00:10.00', clock: true })
    expect(overlayTimePair(1, 3723)).toEqual({ start: '0:01.00', end: '1:02:03.00', clock: true })
    expect(overlayTimePair(3600, 3600)).toEqual({ start: '1:00:00.00', end: '1:00:00.00', clock: true })
    // The start alone can be the one over the line (a window an editor reads back before it is lifted).
    expect(overlayTimePair(7200, 7200.5)).toEqual({ start: '2:00:00.00', end: '2:00:00.50', clock: true })
    expect(overlayTimePair(7201, 12)).toEqual({ start: '2:00:01.00', end: '0:12.00', clock: true })
  })

  it('the boundary is the one overlayTimeText has: a value that rounds to a whole hour is over it, for the pair too', () => {
    expect(overlayTimePair(0, 3599.996)).toEqual({ start: '0:00.00', end: '1:00:00.00', clock: true })
    expect(overlayTimePair(0, 3599.994)).toEqual({ start: '0.00', end: '3599.99', clock: false })
    for (const n of [0, 12.5, 3599.994, 3599.996, 3600, 10038]) {
      expect(overlayTimeText(n), `a lone box at ${n} reads as the pair's would with itself`).toBe(overlayTimePair(n, n).start)
    }
  })

  it('what each box shows reads back to the same number (parseClock), in both forms', () => {
    for (const [a, b] of [[0, 2], [12.5, 15.5], [3590, 3610], [1, 3723], [7201, 12], [0, 36000.25]] as const) {
      const pair = overlayTimePair(a, b)
      expect(parseClock(pair.start), `${a} in ${pair.start}`).toBeCloseTo(a, 2)
      expect(parseClock(pair.end), `${b} in ${pair.end}`).toBeCloseTo(b, 2)
    }
  })

  it('the outside-the-clip sentence reads its range by the same pair, so the card never mixes forms (and a range that rounds to an hour is the clock)', () => {
    const sentence = (start: number, end: number): string => overlayOutsideClipMessage({ startSec: 0, endSec: 5 }, { startSec: start, endSec: end }) ?? ''
    expect(sentence(3590, 3620)).toContain('from 59:50.00 to 1:00:20.00 of the video')
    expect(sentence(10, 20)).toContain('from 10.00 to 20.00 s of the video')
    expect(sentence(3500, 3599.996)).toContain('from 58:20.00 to 1:00:00.00 of the video')
  })
})

describe('overlayOutsideClipMessage - a clip an hour or more into the video (T-126 (5))', () => {
  const at = (startSec: number, endSec: number) => ({ startSec, endSec })

  it('names the clip\'s range as the Timeline reads it, not as seconds', () => {
    const sentence = overlayOutsideClipMessage(at(0, 5), { startSec: 6043.5, endSec: 6103.5 }) ?? ''
    expect(sentence).toBe("This text won't show in the export: its times fall outside the clip, which runs from 1:40:43.50 to 1:41:43.50 of the video.")
    expect(sentence).not.toMatch(/6043|6103/)
  })

  it('a clip that crosses the hour reads both ends as the clock, so the sentence is in one form', () => {
    const sentence = overlayOutsideClipMessage(at(0, 5), { startSec: 3590, endSec: 3620 }) ?? ''
    expect(sentence).toContain('from 59:50.00 to 1:00:20.00 of the video')
  })

  it('a clip that ends before the hour keeps the seconds form and the "s"', () => {
    expect(overlayOutsideClipMessage(at(0, 5), { startSec: 3500, endSec: 3599.5 })).toContain('from 3500.00 to 3599.50 s of the video')
  })
})
