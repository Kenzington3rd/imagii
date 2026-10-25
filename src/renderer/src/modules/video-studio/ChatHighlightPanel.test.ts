import { describe, it, expect } from 'vitest'
import { peakRange } from './ChatHighlightPanel'

/**
 * T-137 (9) - a chat row shows the range "+ Clip" adds.
 *
 * The row printed `p.startSec` and `p.endSec` raw while `addPeak` held both ends to the video (T-48), so a spike near a VOD's end read "9:58 -> 10:20"
 * for a 10:00 video and the clip that came out was 9:58 -> 10:00: the panel promised a range that was not the one added (USER_GUIDE: "adds exactly
 * that range"). Both now come from this one function.
 */
describe('peakRange - the range a chat row shows and adds (T-137 (9))', () => {
  it('an end past the video is the video\'s end', () => {
    expect(peakRange({ startSec: 598, endSec: 620 }, 600)).toEqual({ start: 598, end: 600 })
  })

  it('a start before zero is zero (the padding reaches back past the start of the video)', () => {
    expect(peakRange({ startSec: -15, endSec: 12 }, 600)).toEqual({ start: 0, end: 12 })
  })

  it('both at once: a spike in the first seconds of a very short video', () => {
    expect(peakRange({ startSec: -9, endSec: 40 }, 10)).toEqual({ start: 0, end: 10 })
  })

  it('a range inside the video is unchanged', () => {
    expect(peakRange({ startSec: 120.5, endSec: 150 }, 600)).toEqual({ start: 120.5, end: 150 })
  })

  it('a spike that starts past the video collapses to its end (the store then refuses the add, and the row is honest about why)', () => {
    expect(peakRange({ startSec: 700, endSec: 730 }, 600)).toEqual({ start: 600, end: 600 })
  })
})
