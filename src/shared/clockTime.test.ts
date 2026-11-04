import { describe, it, expect } from 'vitest'
import { formatClock, formatTimer, parseClock } from './clockTime'

/**
 * T-125 (23): `formatClock` replaces eight copies of `m:ss` that never went past 59 minutes ("167:13.0" on a three-hour VOD), and
 * `parseClock` lets a box be typed in the same form. The first block pins that nothing under an hour changed by a character: those
 * strings are what the Timeline, the Player and the lists showed before, and what the E2Es read.
 */
describe('formatClock', () => {
  it('under an hour it is m:ss, exactly as every panel drew it', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(599.9)).toBe('9:59')
    expect(formatClock(3599.99)).toBe('59:59')
  })

  it('the fraction is truncated, not rounded, to the places asked for', () => {
    expect(formatClock(1.49, 1)).toBe('0:01.4')
    expect(formatClock(1.49, 2)).toBe('0:01.49')
    expect(formatClock(65.999, 2)).toBe('1:05.99')
    expect(formatClock(0.65, 2)).toBe('0:00.65')
    expect(formatClock(3, 1)).toBe('0:03.0')
    expect(formatClock(3, 2)).toBe('0:03.00')
  })

  it('from one hour up it is h:mm:ss, the minutes padded', () => {
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3661)).toBe('1:01:01')
    expect(formatClock(10033)).toBe('2:47:13')
    expect(formatClock(36000)).toBe('10:00:00')
  })

  it('and keeps its fraction: the Timeline\'s tenths and the Player\'s hundredths', () => {
    expect(formatClock(10033.5, 1)).toBe('2:47:13.5')
    expect(formatClock(10033.25, 2)).toBe('2:47:13.25')
  })

  it('a time that is not a time reads as zero rather than NaN', () => {
    for (const bad of [NaN, -1, Infinity, -Infinity]) {
      expect(formatClock(bad)).toBe('0:00')
      expect(formatClock(bad, 1)).toBe('0:00.0')
      expect(formatClock(bad, 2)).toBe('0:00.00')
    }
  })
})

describe('parseClock', () => {
  it('plain seconds, with or without a fraction', () => {
    expect(parseClock('90')).toBe(90)
    expect(parseClock('90.5')).toBe(90.5)
    expect(parseClock('.5')).toBe(0.5)
    expect(parseClock('12.')).toBe(12)
    expect(parseClock('  7 ')).toBe(7)
    expect(parseClock('0')).toBe(0)
  })

  it('m:ss and h:mm:ss, which is how a VOD\'s own timestamps are written', () => {
    expect(parseClock('1:30')).toBe(90)
    expect(parseClock('0:05')).toBe(5)
    expect(parseClock('90:00')).toBe(5400)
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('2:47:13')).toBe(10033)
    expect(parseClock('1:02:03.5')).toBe(3723.5)
    expect(parseClock('1:5')).toBe(65)
  })

  it('is the inverse of formatClock across the hour', () => {
    for (const s of [0, 59, 60, 3599, 3600, 3723, 10033, 86399]) {
      expect(parseClock(formatClock(s)), `${s}`).toBe(s)
    }
  })

  it('an empty box, a lone point, or text that is not a time is null', () => {
    for (const bad of ['', '  ', '.', 'abc', '1:', ':30', '1::30', '1:2:3:4', '-5', '+5', '1e3', '1,5', '1:30s', '0x10']) {
      expect(parseClock(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('a minute or second field of 60 or more beside a bigger unit is a typo, not a time', () => {
    expect(parseClock('1:75')).toBeNull()
    expect(parseClock('1:60:00')).toBeNull()
    expect(parseClock('1:00:60')).toBeNull()
    expect(parseClock('1:59:59')).toBe(7199)
  })
})

/**
 * T-126 (4): Record's REC clock was the last minutes-unbounded copy ("REC 125:33" for a two-hour take). `formatTimer` is
 * `formatClock` with the minutes padded below an hour - the E2Es read /REC 00:0x/ - and `h:mm:ss` from one hour up.
 */
describe('formatTimer', () => {
  it('below an hour it is padded mm:ss, as the REC clock always read', () => {
    expect(formatTimer(0)).toBe('00:00')
    expect(formatTimer(5)).toBe('00:05')
    expect(formatTimer(65)).toBe('01:05')
    expect(formatTimer(754)).toBe('12:34')
    expect(formatTimer(3599.99)).toBe('59:59')
  })

  it('crosses the hour as h:mm:ss, not as 60:00', () => {
    expect(formatTimer(3599)).toBe('59:59')
    expect(formatTimer(3600)).toBe('1:00:00')
    expect(formatTimer(7533)).toBe('2:05:33')
    expect(formatTimer(7533)).not.toBe('125:33')
    expect(formatTimer(36000)).toBe('10:00:00')
  })

  it('a time that is not a time reads as zero rather than NaN', () => {
    for (const bad of [NaN, -1, Infinity]) expect(formatTimer(bad)).toBe('00:00')
  })
})

/**
 * T-153 (9) - the fraction was `Math.floor((safe - whole) * 10 ** places)`: float error made into a whole digit. formatClock(1.2, 1) read "0:01.1", 4.1 read "0:04.0",
 * 152 of the 400 tenths 0.0-39.9 were wrong, and I at the end of a 10 s video (start 9.9, end 10) read "Length 0:00.0". The count is now ONE rounding at the
 * millisecond, then integer arithmetic that still truncates.
 */
describe('formatClock - the tenths and hundredths are the number that was meant (T-153 (9))', () => {
  it('the values that read a digit low', () => {
    expect(formatClock(1.2, 1)).toBe('0:01.2')
    expect(formatClock(4.1, 1)).toBe('0:04.1')
    expect(formatClock(19.9, 1)).toBe('0:19.9')
    expect(formatClock(59.9, 1)).toBe('0:59.9')
  })

  it('the length of an I at the end of a 10 s video is a tenth, not nothing', () => {
    expect(10 - 9.9, 'the float really is under 0.1').toBeLessThan(0.1)
    expect(formatClock(10 - 9.9, 1)).toBe('0:00.1')
    expect(formatClock(9.9, 1)).toBe('0:09.9')
    expect(formatClock(0.1, 1)).toBe('0:00.1')
  })

  it('it still truncates, never rounds, past the places asked for', () => {
    expect(formatClock(1.49, 1)).toBe('0:01.4')
    expect(formatClock(1.49, 2)).toBe('0:01.49')
    expect(formatClock(1.499, 2)).toBe('0:01.49')
    expect(formatClock(65.999, 2)).toBe('1:05.99')
  })

  it('hundredths read true too', () => {
    expect(formatClock(1.07, 2)).toBe('0:01.07')
    expect(formatClock(4.35, 2)).toBe('0:04.35')
    expect(formatClock(0.57, 2)).toBe('0:00.57')
  })

  it('an hour value keeps its fraction', () => {
    expect(formatClock(3599.95, 1)).toBe('59:59.9')
    expect(formatClock(3599.95, 2)).toBe('59:59.95')
    expect(formatClock(3600.1, 1)).toBe('1:00:00.1')
    expect(formatClock(10033.3, 1)).toBe('2:47:13.3')
  })

  it('a value a hair under a whole second carries into the next, with a fraction that fits (never "0:59.10")', () => {
    expect(formatClock(59.9999, 1)).toBe('1:00.0')
    expect(formatClock(59.9999, 2)).toBe('1:00.00')
    expect(formatClock(3599.9999, 1)).toBe('1:00:00.0')
  })

  it('every tenth from 0.0 to 39.9 reads as it was written', () => {
    const wrong: string[] = []
    for (let i = 0; i < 400; i++) {
      const value = i / 10
      const want = `${Math.floor(value / 60)}:${String(Math.floor(value) % 60).padStart(2, '0')}.${i % 10}`
      if (formatClock(value, 1) !== want) wrong.push(`${value} -> ${formatClock(value, 1)} (wanted ${want})`)
    }
    expect(wrong).toEqual([])
  })

  it('and the places that were never wrong did not move', () => {
    expect(formatClock(1.2)).toBe('0:01')
    expect(formatClock(59.9)).toBe('0:59')
    expect(formatClock(3599.99)).toBe('59:59')
    expect(formatTimer(1.2)).toBe('00:01')
  })
})
