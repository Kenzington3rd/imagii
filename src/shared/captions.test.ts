import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  escapeSubtitlesPath,
  isShiftedSrtName,
  shiftedSrtPath,
  shiftSrtToRange,
  tsToSeconds
} from './captions'

describe('tsToSeconds — variable-length fractional seconds (Phase 2.13)', () => {
  it('handles standard 3-digit fractions', () => {
    expect(tsToSeconds('00:00:01,500')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:01.500')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:00,000')).toBeCloseTo(0, 6)
  })

  it('handles 1-digit fractions (Whisper edge case that was broken)', () => {
    // Old code did Number('5') / 1000 = 0.005 — silently 100x too small.
    // New code: parseFloat('0.5') = 0.5.
    expect(tsToSeconds('00:00:01,5')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:01.5')).toBeCloseTo(1.5, 6)
  })

  it('handles 2-digit fractions', () => {
    expect(tsToSeconds('00:00:01,50')).toBeCloseTo(1.5, 6)
  })

  it('handles 4+ digit fractions', () => {
    expect(tsToSeconds('00:00:01,1234')).toBeCloseTo(1.1234, 6)
    expect(tsToSeconds('00:00:01,500000')).toBeCloseTo(1.5, 6)
  })

  it('combines hours, minutes, seconds, and fractional', () => {
    expect(tsToSeconds('01:02:03,500')).toBeCloseTo(3723.5, 6)
    expect(tsToSeconds('10:00:00,000')).toBeCloseTo(36000, 6)
  })

  it('returns 0 on unparseable input', () => {
    expect(tsToSeconds('')).toBe(0)
    expect(tsToSeconds('not a timestamp')).toBe(0)
    expect(tsToSeconds('1:2:3')).toBe(0) // missing fractional separator
  })
})

describe('escapeSubtitlesPath — two parsers, two rounds of escaping (round 18)', () => {
  // The values here are what real ffmpeg accepted in the Layer 5 block
  // 'subtitles path escaping (real ffmpeg)'; this pins the string shape.
  it('leaves a plain posix path alone', () => {
    expect(escapeSubtitlesPath('/tmp/captions/clip.srt')).toBe('/tmp/captions/clip.srt')
  })

  it('escapes filtergraph and option separators twice, and spaces once', () => {
    expect(escapeSubtitlesPath("/a/Sam's, [x].srt")).toBe("/a/Sam\\\\\\'s\\\\\\,\\ \\\\\\[x\\\\\\].srt")
  })

  it('normalises backslashes and escapes a Windows drive colon', () => {
    expect(escapeSubtitlesPath('C:\\Users\\me\\a.srt')).toBe('C\\\\\\:/Users/me/a.srt')
  })
})

describe('shiftSrtToRange — the SRT on the clip clock (T-81)', () => {
  // A source-clock SRT around a clip cut from 10 s to 20 s.
  const cue = (n: number, from: string, to: string, text: string): string =>
    `${n}\n${from} --> ${to}\n${text}\n`

  it('moves a cue inside the range by -startSec', () => {
    const out = shiftSrtToRange(cue(1, '00:00:12,000', '00:00:14,500', 'hello there'), 10, 20)
    expect(out).toBe('1\n00:00:02,000 --> 00:00:04,500\nhello there\n')
  })

  it('drops a cue wholly before the range', () => {
    expect(shiftSrtToRange(cue(1, '00:00:01,000', '00:00:03,000', 'early'), 10, 20)).toBe('')
  })

  it('drops a cue wholly after the range', () => {
    expect(shiftSrtToRange(cue(1, '00:00:25,000', '00:00:27,000', 'late'), 10, 20)).toBe('')
  })

  it('drops a cue that only touches an edge (zero visible length)', () => {
    expect(shiftSrtToRange(cue(1, '00:00:08,000', '00:00:10,000', 'ends at open'), 10, 20)).toBe('')
    expect(shiftSrtToRange(cue(1, '00:00:20,000', '00:00:22,000', 'starts at close'), 10, 20)).toBe('')
  })

  it('clamps a cue straddling the start to 00:00:00,000', () => {
    const out = shiftSrtToRange(cue(1, '00:00:08,500', '00:00:11,250', 'opening'), 10, 20)
    expect(out).toBe('1\n00:00:00,000 --> 00:00:01,250\nopening\n')
  })

  it('clamps a cue straddling the end to the clip length', () => {
    const out = shiftSrtToRange(cue(1, '00:00:18,000', '00:00:23,000', 'closing'), 10, 20)
    expect(out).toBe('1\n00:00:08,000 --> 00:00:10,000\nclosing\n')
  })

  it('keeps a cue that spans the whole range, clamped on both sides', () => {
    const out = shiftSrtToRange(cue(1, '00:00:05,000', '00:00:30,000', 'long'), 10, 20)
    expect(out).toBe('1\n00:00:00,000 --> 00:00:10,000\nlong\n')
  })

  it('drops a zero-length cue even inside the range', () => {
    expect(shiftSrtToRange(cue(1, '00:00:12,000', '00:00:12,000', 'blink'), 10, 20)).toBe('')
  })

  it('returns an empty string when no cue survives, and for an empty file', () => {
    expect(shiftSrtToRange('', 10, 20)).toBe('')
    expect(shiftSrtToRange('\n\n', 10, 20)).toBe('')
  })

  it('renumbers the survivors from 1 and keeps their order', () => {
    const srt = [
      cue(7, '00:00:01,000', '00:00:02,000', 'dropped'),
      cue(8, '00:00:11,000', '00:00:12,000', 'first kept'),
      cue(9, '00:00:30,000', '00:00:31,000', 'dropped too'),
      cue(10, '00:00:15,000', '00:00:16,000', 'second kept')
    ].join('\n')
    expect(shiftSrtToRange(srt, 10, 20)).toBe(
      '1\n00:00:01,000 --> 00:00:02,000\nfirst kept\n\n' +
        '2\n00:00:05,000 --> 00:00:06,000\nsecond kept\n'
    )
  })

  it('re-serialises timestamps as hh:mm:ss,mmm across hour boundaries', () => {
    // Clip from 1:59:59.5 to 2:00:10: a cue at 2:00:01.007 lands at 1.507 s.
    const out = shiftSrtToRange(cue(1, '02:00:01,007', '02:00:03,070', 'across the hour'), 7199.5, 7210)
    expect(out).toBe('1\n00:00:01,507 --> 00:00:03,570\nacross the hour\n')
    // And a large source offset keeps hours (a clip 40 minutes in, an hour long).
    const late = shiftSrtToRange(cue(1, '01:05:00,000', '01:05:02,000', 'hour two'), 2400, 6000)
    expect(late).toBe('1\n00:25:00,000 --> 00:25:02,000\nhour two\n')
  })

  it('reads variable-length fractions and dot separators, writes three digits', () => {
    const out = shiftSrtToRange(cue(1, '00:00:12.5', '00:00:13,25', 'sloppy stamps'), 10, 20)
    expect(out).toBe('1\n00:00:02,500 --> 00:00:03,250\nsloppy stamps\n')
  })

  it('does not accumulate float error on fractional starts', () => {
    // 0.1 + 0.2 style drift would put this at 00:00:00,299 or ,301.
    const out = shiftSrtToRange(cue(1, '00:00:10,500', '00:00:11,500', 'x'), 10.2, 20)
    expect(out).toBe('1\n00:00:00,300 --> 00:00:01,300\nx\n')
  })

  it('keeps multi-line text verbatim, and handles CRLF and a BOM', () => {
    const crlf =
      '﻿1\r\n00:00:12,000 --> 00:00:13,000\r\nfirst line\r\nsecond line\r\n\r\n' +
      '2\r\n00:00:14,000 --> 00:00:15,000\r\n{\\an8}tagged\r\n'
    expect(shiftSrtToRange(crlf, 10, 20)).toBe(
      '1\n00:00:02,000 --> 00:00:03,000\nfirst line\nsecond line\n\n' +
        '2\n00:00:04,000 --> 00:00:05,000\n{\\an8}tagged\n'
    )
  })

  it('skips a block with no time line, or no text', () => {
    const srt =
      'garbage block with no stamps\n\n' +
      '2\n00:00:12,000 --> 00:00:13,000\n\n' +
      cue(3, '00:00:14,000', '00:00:15,000', 'real')
    expect(shiftSrtToRange(srt, 10, 20)).toBe('1\n00:00:04,000 --> 00:00:05,000\nreal\n')
  })

  it('is the identity (renumbered) for a range that starts at 0 and covers every cue', () => {
    const srt = cue(1, '00:00:00,200', '00:00:01,500', 'a') + '\n' + cue(2, '00:00:01,600', '00:00:02,900', 'b')
    expect(shiftSrtToRange(srt, 0, 3)).toBe(
      '1\n00:00:00,200 --> 00:00:01,500\na\n\n2\n00:00:01,600 --> 00:00:02,900\nb\n'
    )
  })

  it('rejects an invalid range', () => {
    expect(() => shiftSrtToRange('', -1, 5)).toThrow(/startSec/)
    expect(() => shiftSrtToRange('', 5, 5)).toThrow(/endSec/)
    expect(() => shiftSrtToRange('', 0, Number.NaN)).toThrow(/endSec/)
  })
})

describe('shiftedSrtPath / isShiftedSrtName — the temp copy and its sweep agree (T-81)', () => {
  it('names the copy beside the real SRT, and the sweep recognises exactly that name', () => {
    const real = path.join('captions', 'My Stream-1700000000000.srt')
    const copy = shiftedSrtPath(real, randomUUID())
    expect(path.dirname(copy)).toBe(path.dirname(real))
    expect(copy.startsWith(real)).toBe(true)
    expect(isShiftedSrtName(path.basename(copy))).toBe(true)
  })

  it('never mistakes a real transcript for a temp copy, however it is named', () => {
    expect(isShiftedSrtName('My Stream-1700000000000.srt')).toBe(false)
    expect(isShiftedSrtName('clip.srt')).toBe(false)
    expect(isShiftedSrtName('x.srt.clip-notauuid.srt')).toBe(false)
    expect(isShiftedSrtName('x.srt.clip-0a1b2c3d-0000-4000-8000-0123456789ab.txt')).toBe(false)
    // A video called "x.srt.clip-<uuid>.mp4" yields a transcript of its own
    // name plus a timestamp; the UUID must be the whole tail to match.
    expect(isShiftedSrtName('x.srt.clip-0a1b2c3d-0000-4000-8000-0123456789ab-1700000000000.srt')).toBe(false)
  })

  it('refuses an id that the sweep could not recognise', () => {
    expect(() => shiftedSrtPath('a.srt', 'not-a-uuid')).toThrow(/UUID/)
  })
})
