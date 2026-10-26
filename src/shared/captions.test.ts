import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  ASS_PLAY_RES_Y,
  burnInDoneMessage,
  burnInLengthSec,
  burnInPercent,
  captionBasisPx,
  captionPhaseLabel,
  captionPlayResY,
  captionsReadyMessage,
  captionSizeReadout,
  clearedTranscriptsMessage,
  clearTranscriptsQuestion,
  DEFAULT_CAPTION_STYLE,
  effectiveCaptionPx,
  escapeSubtitlesPath,
  isShiftedSrtName,
  isUsableFrame,
  shiftedSrtPath,
  shiftSrtToRange,
  staleCaptionsMessage,
  tsToSeconds,
  type CaptionsProgress
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

  // T-118 (7): the path is the filter's first POSITIONAL option, so ffmpeg's option parser splits
  // an unescaped `=` into a name and a value and dies with "Option not found" (exit 8) - the
  // Layer 5 case 'burns subtitles from a=b.srt' runs it against the real binary. `=` is in both
  // character classes, like the other separators: twice, and not as a space is (once).
  it('escapes an equals sign twice, like the other separators', () => {
    expect(escapeSubtitlesPath('/a/a=b.srt')).toBe('/a/a\\\\\\=b.srt')
    expect(escapeSubtitlesPath('/captions/Boss=Dead-2026.srt')).toBe('/captions/Boss\\\\\\=Dead-2026.srt')
    // Every `=` in the name, not the first only (the replace is global).
    expect(escapeSubtitlesPath('/a/x=y=z.srt')).toBe('/a/x\\\\\\=y\\\\\\=z.srt')
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

  // T-113: the Clip Kit bundles this file beside a video that is the clip AT ITS SPEED, so the
  // cues land on the OUTPUT clock: shifted onto the clip, then divided by the speed (the
  // export's `setpts=PTS/speed`). The burn-in has no speed and passes none.
  describe('on the OUTPUT clock of a clip played at a speed (T-113)', () => {
    it('divides every time by the speed after the shift', () => {
      const srt = cue(1, '00:00:12,000', '00:00:14,000', 'a') + '\n' + cue(2, '00:00:16,000', '00:00:20,000', 'b')
      expect(shiftSrtToRange(srt, 10, 20, 2)).toBe(
        '1\n00:00:01,000 --> 00:00:02,000\na\n\n2\n00:00:03,000 --> 00:00:05,000\nb\n'
      )
      expect(shiftSrtToRange(srt, 10, 20, 0.5)).toBe(
        '1\n00:00:04,000 --> 00:00:08,000\na\n\n2\n00:00:12,000 --> 00:00:20,000\nb\n'
      )
    })

    it('a speed of 1 is exactly the shift it always was (and so is leaving it out)', () => {
      const srt = cue(1, '00:00:12,000', '00:00:14,500', 'hello there')
      expect(shiftSrtToRange(srt, 10, 20, 1)).toBe(shiftSrtToRange(srt, 10, 20))
      expect(shiftSrtToRange(srt, 10, 20, 1)).toBe('1\n00:00:02,000 --> 00:00:04,500\nhello there\n')
    })

    it('clips to the range BEFORE dividing: a cue past the end ends where the clip ends', () => {
      // 10 s of source at 2x is a 5 s file; the cue that runs to 23 s is cut at the clip's end.
      expect(shiftSrtToRange(cue(1, '00:00:18,000', '00:00:23,000', 'closing'), 10, 20, 2)).toBe(
        '1\n00:00:04,000 --> 00:00:05,000\nclosing\n'
      )
    })

    it('a whole-file clip at 1x keeps its cues (times and text) exactly', () => {
      const srt = cue(1, '00:00:00,200', '00:00:01,500', 'a') + '\n' + cue(2, '00:00:01,600', '00:00:02,900', 'b')
      expect(shiftSrtToRange(srt, 0, 3, 1)).toBe(shiftSrtToRange(srt, 0, 3))
      expect(shiftSrtToRange(srt, 0, 3, 1)).toBe(
        '1\n00:00:00,200 --> 00:00:01,500\na\n\n2\n00:00:01,600 --> 00:00:02,900\nb\n'
      )
    })

    it('rounds in whole milliseconds, so a third of a second does not drift', () => {
      expect(shiftSrtToRange(cue(1, '00:00:11,000', '00:00:12,000', 'x'), 10, 20, 3)).toBe(
        '1\n00:00:00,333 --> 00:00:00,667\nx\n'
      )
    })

    it('rejects a speed that is not a positive number', () => {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => shiftSrtToRange('', 0, 5, bad), String(bad)).toThrow(/speed/)
      }
    })
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

describe('effectiveCaptionPx — the size control says what it makes (T-89)', () => {
  // libass scales force_style FontSize against a 288-line script (PlayResY),
  // so the number on the slider is a fraction of the frame, not pixels. The
  // expected values below are worked by hand from the ratio 1080 / 288 = 3.75
  // — NOT read back from the helper — and the first two are the measurements
  // the T-11 entry recorded from real renders (a nominal 24 painted ~90 px on
  // 1080p).
  it('is size x 1080 / 288 on a 1080p frame', () => {
    expect(effectiveCaptionPx(24)).toBe(90)
    expect(effectiveCaptionPx(32)).toBe(120)
    expect(effectiveCaptionPx(16)).toBe(60)
    expect(effectiveCaptionPx(56)).toBe(210)
    expect(effectiveCaptionPx(96)).toBe(360)
  })

  it('is never the raw number — the label that said "px" was wrong at every setting', () => {
    for (let size = 16; size <= 96; size += 8) {
      expect(effectiveCaptionPx(size)).not.toBe(size)
      expect(effectiveCaptionPx(size)).toBeGreaterThan(size)
    }
  })

  it('scales with the frame, because the 288 is the script and the frame is the picture', () => {
    expect(effectiveCaptionPx(32, 720)).toBe(80)
    expect(effectiveCaptionPx(32, 2160)).toBe(240)
    expect(effectiveCaptionPx(32, 288)).toBe(32)
  })

  it('rounds to whole pixels', () => {
    // 17 x 3.75 = 63.75
    expect(effectiveCaptionPx(17)).toBe(64)
    expect(Number.isInteger(effectiveCaptionPx(33))).toBe(true)
  })

  it('pins the constant it is built on', () => {
    expect(ASS_PLAY_RES_Y).toBe(288)
  })

  it('refuses a size or a frame that is not a positive number', () => {
    expect(() => effectiveCaptionPx(0)).toThrow()
    expect(() => effectiveCaptionPx(Number.NaN)).toThrow()
    expect(() => effectiveCaptionPx(32, 0)).toThrow()
  })

  it('the readout beside the slider says it in words, for the default and the extremes', () => {
    expect(captionSizeReadout(DEFAULT_CAPTION_STYLE.fontSize)).toBe('about 120 px tall on 1080p')
    expect(captionSizeReadout(16)).toBe('about 60 px tall on 1080p')
    expect(captionSizeReadout(96)).toBe('about 360 px tall on 1080p')
  })
})

/**
 * T-112 — with a video loaded the readout is about THAT video. It said "on 1080p"
 * whatever was open, so a 720p recording's 32 read 120 px and drew 80, and a
 * vertical one drew a 16:9-equivalent 120 against the same words (T-111 put the
 * width into `effectiveCaptionPx`; this is the readout using it).
 */
describe('captionSizeReadout — the loaded video\'s own frame (T-112)', () => {
  it('names the real size on the real frame: 720p, 1080p, 4K and a vertical clip', () => {
    expect(captionSizeReadout(32, { width: 1280, height: 720 })).toBe('about 80 px tall on this video')
    expect(captionSizeReadout(32, { width: 1920, height: 1080 })).toBe('about 120 px tall on this video')
    expect(captionSizeReadout(32, { width: 3840, height: 2160 })).toBe('about 240 px tall on this video')
    // 1080x1920: the 16:9-equivalent basis (T-111), 32 x 607.5 / 288 = 67.5.
    expect(captionSizeReadout(32, { width: 1080, height: 1920 })).toBe('about 68 px tall on this video')
  })

  it('is exactly what the burn draws: the number is effectiveCaptionPx with the frame\'s width', () => {
    for (const [width, height] of [[1280, 720], [1920, 1080], [1080, 1080], [1080, 1350], [2560, 1080]] as const) {
      for (const size of [16, 32, 56, 96]) {
        expect(captionSizeReadout(size, { width, height })).toBe(
          `about ${effectiveCaptionPx(size, height, width)} px tall on this video`
        )
      }
    }
  })

  it('without a video the 1080p wording stays', () => {
    expect(captionSizeReadout(32, null)).toBe('about 120 px tall on 1080p')
    expect(captionSizeReadout(32, undefined)).toBe('about 120 px tall on 1080p')
  })

  it('a probe that could not size the video falls back to the 1080p wording, never throws', () => {
    expect(captionSizeReadout(32, { width: 0, height: 0 })).toBe('about 120 px tall on 1080p')
    expect(captionSizeReadout(32, { width: 1920, height: 0 })).toBe('about 120 px tall on 1080p')
  })
})

/**
 * T-111 — caption size follows the 16:9 picture a frame's WIDTH would make.
 * libass scales a force_style FontSize by frame HEIGHT / PlayResY, so a vertical
 * clip (1080x1920) drew text 1.78x the size it has in the same proportion of a
 * landscape one: the default 32 wrapped into an 817 px block, 43% of the frame
 * (measured on a real render). The expected numbers are worked by hand from
 * `basis = min(height, width * 9 / 16)` and `PlayResY = 288 * height / basis`.
 */
describe('caption size on a frame that is not 16:9 (T-111)', () => {
  it('the basis is the frame\'s height on 16:9 and wider, and width x 9/16 on narrower', () => {
    expect(captionBasisPx(1080, 1920)).toBe(1080)
    expect(captionBasisPx(1080, 2560)).toBe(1080) // ultrawide: still the height
    expect(captionBasisPx(2160, 3840)).toBe(2160)
    expect(captionBasisPx(1920, 1080)).toBe(607.5) // vertical
    expect(captionBasisPx(1080, 1080)).toBe(607.5) // square
    expect(captionBasisPx(1350, 1080)).toBe(607.5) // 4:5
    expect(captionBasisPx(1080, 1440)).toBe(810) // 4:3
  })

  it('with no width the height is all there is — the readout\'s 1080p behavior is unchanged', () => {
    expect(captionBasisPx(1080)).toBe(1080)
    expect(effectiveCaptionPx(32)).toBe(120)
    expect(effectiveCaptionPx(32, 720)).toBe(80)
  })

  it('the same size is the same number of pixels per width on 1920x1080 and 1080x1920', () => {
    // The invariant: glyph height as a fraction of frame WIDTH is one number.
    const land = effectiveCaptionPx(32, 1080, 1920) / 1920
    const vert = effectiveCaptionPx(32, 1920, 1080) / 1080
    expect(effectiveCaptionPx(32, 1080, 1920)).toBe(120)
    expect(effectiveCaptionPx(32, 1920, 1080)).toBe(68) // 32 x 607.5 / 288 = 67.5, not the old 213
    expect(vert / land).toBeGreaterThan(0.9)
    expect(vert / land).toBeLessThan(1.1)
    // ...and it was 1.78x before: the height-only readout for the same frame.
    expect(effectiveCaptionPx(32, 1920)).toBe(213)
  })

  it('needs no PlayResY on 16:9 or wider, so a landscape burn is exactly what it was', () => {
    expect(captionPlayResY(1920, 1080)).toBeNull()
    expect(captionPlayResY(1280, 720)).toBeNull()
    expect(captionPlayResY(3840, 2160)).toBeNull()
    expect(captionPlayResY(2560, 1080)).toBeNull()
    // Within rounding of 16:9 (a 1918-wide crop of a 1080p frame): 288.3 rounds to 288, which is "none".
    expect(captionPlayResY(1918, 1080)).toBeNull()
  })

  it('gives libass a PlayResY that makes its scale the 16:9-equivalent one on a narrower frame', () => {
    expect(captionPlayResY(1080, 1920)).toBe(910) // 288 x 1920 / 607.5 = 910.2
    expect(captionPlayResY(1080, 1080)).toBe(512) // 288 x 1080 / 607.5
    expect(captionPlayResY(1080, 1350)).toBe(640) // 288 x 1350 / 607.5
    expect(captionPlayResY(1440, 1080)).toBe(384) // 4:3: 288 x 1080 / 810
    // The scale libass draws at, frameHeight / PlayResY, against the one wanted, basis / 288: within 0.1%.
    for (const [w, h] of [[1080, 1920], [1080, 1080], [1080, 1350], [1440, 1080], [720, 1280], [1080, 2400]] as const) {
      const playResY = captionPlayResY(w, h) as number
      expect(h / playResY / (captionBasisPx(h, w) / 288), `${w}x${h}`).toBeGreaterThan(0.999)
      expect(h / playResY / (captionBasisPx(h, w) / 288), `${w}x${h}`).toBeLessThan(1.001)
    }
  })

  it('refuses a frame that is not a positive size', () => {
    expect(() => captionPlayResY(0, 1080)).toThrow()
    expect(() => captionPlayResY(1080, Number.NaN)).toThrow()
    expect(() => captionBasisPx(-1, 100)).toThrow()
    expect(() => effectiveCaptionPx(32, 1080, 0)).toThrow()
  })
})

/**
 * T-111 — the burn-in's percent is a measurement. It used to be `5 + 0.5 per
 * second encoded`, capped at 99: ahead of the work on a short clip, pinned at its
 * cap for most of a long one, and unrelated to either.
 */
describe('burnInLengthSec and burnInPercent — the burn-in bar measures (T-111)', () => {
  it('the length is the source\'s own with no range', () => {
    expect(burnInLengthSec(120, null)).toBe(120)
  })

  it('the length is the range\'s when there is one, clipped to what the source has after its start', () => {
    expect(burnInLengthSec(120, { startSec: 10, endSec: 40 })).toBe(30)
    expect(burnInLengthSec(120, { startSec: 100, endSec: 140 })).toBe(20) // the source ends first
    expect(burnInLengthSec(null, { startSec: 10, endSec: 40 })).toBe(30) // an unprobed source: the range
  })

  it('the length is unknown when nothing says: an unprobed whole file, or a range past the end', () => {
    expect(burnInLengthSec(null, null)).toBeNull()
    expect(burnInLengthSec(0, null)).toBeNull()
    expect(burnInLengthSec(120, { startSec: 130, endSec: 140 })).toBeNull()
  })

  it('is the encode position over the output length, as a percent', () => {
    expect(burnInPercent(0, 60)).toBe(0)
    expect(burnInPercent(15, 60)).toBe(25)
    expect(burnInPercent(30, 60)).toBe(50)
    expect(burnInPercent(45, 60)).toBe(75)
  })

  it('does not run ahead of the work: a 2-hour VOD at 10 s is not at 5%', () => {
    // The old formula said 5 + 0.5 x 10 = 10% here and 99% an hour in.
    expect(burnInPercent(10, 7200)).toBeCloseTo(0.139, 3)
    expect(burnInPercent(3600, 7200)).toBe(50)
  })

  it('never reaches 100 — the file is still being finalized, and `done` is the only 100', () => {
    expect(burnInPercent(60, 60)).toBe(99)
    expect(burnInPercent(61, 60)).toBe(99)
    expect(burnInPercent(1e9, 60)).toBe(99)
  })

  it('is absent when the length is unknown or the position is not a number', () => {
    expect(burnInPercent(10, null)).toBeUndefined()
    expect(burnInPercent(10, 0)).toBeUndefined()
    expect(burnInPercent(10, -5)).toBeUndefined()
    // T-115: an infinite or NaN length is not a length (10 / Infinity was a confident 0%).
    expect(burnInPercent(10, Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(burnInPercent(10, Number.NaN)).toBeUndefined()
    expect(burnInPercent(Number.NaN, 60)).toBeUndefined()
    expect(burnInPercent(Number.POSITIVE_INFINITY, 60)).toBeUndefined()
  })

  it('never goes below 0', () => {
    expect(burnInPercent(-0.033, 60)).toBe(0)
  })
})

describe('captionPhaseLabel — plain words for each phase (T-89)', () => {
  const PHASES: Array<[CaptionsProgress['phase'], string]> = [
    ['extracting', 'Extracting audio…'],
    ['transcribing', 'Transcribing…'],
    ['building-srt', 'Building captions…'],
    ['burning-in', 'Burning in…'],
    ['done', 'Done']
  ]

  it.each(PHASES)('%s reads %s', (phase, label) => {
    expect(captionPhaseLabel(phase)).toBe(label)
  })

  it('no label is the raw id', () => {
    for (const [phase] of PHASES) {
      expect(captionPhaseLabel(phase)).not.toBe(phase)
      expect(captionPhaseLabel(phase)).not.toMatch(/-/)
      // The panel used to upper-case the id ("BUILDING-SRT"); a label is
      // sentence case, not a shouted identifier.
      expect(captionPhaseLabel(phase)).toMatch(/^[A-Z][a-z]/)
    }
  })
})

describe('clearedTranscriptsMessage — what "Clear saved transcripts" reports (T-128 (3))', () => {
  it('names the count, in the button\'s verb, with the singular handled and no trailing period', () => {
    expect(clearedTranscriptsMessage({ removed: 3, failed: 0 })).toEqual({ text: 'Cleared 3 saved transcripts', error: false })
    expect(clearedTranscriptsMessage({ removed: 1, failed: 0 })).toEqual({ text: 'Cleared 1 saved transcript', error: false })
  })

  it('a press that found nothing (the count was stale) says so, as a result and not an error', () => {
    expect(clearedTranscriptsMessage({ removed: 0, failed: 0 })).toEqual({ text: 'No saved transcripts to clear', error: false })
  })

  it('a clear that got part of the way says how far, and what to do about the rest', () => {
    const m = clearedTranscriptsMessage({ removed: 2, failed: 1 })
    expect(m.error).toBe(false)
    expect(m.text).toBe('Cleared 2 of 3 saved transcripts. The rest are open in another program; close it and clear again.')
    expect(clearedTranscriptsMessage({ removed: 1, failed: 1 }).text).toMatch(/^Cleared 1 of 2 saved transcripts\./)
  })

  it('a clear that removed nothing because every file refused is an error, in a finished sentence with its period', () => {
    const m = clearedTranscriptsMessage({ removed: 0, failed: 2 })
    expect(m.error).toBe(true)
    expect(m.text).toBe("Couldn't clear the saved transcripts. Close anything that has them open, then try again.")
  })
})

// T-135 (7): the confirm said "including the one for the video you have open" unconditionally, while its count is the whole folder's and the open
// video may have no transcript at all.
describe('clearTranscriptsQuestion — what the Clear confirm says it will delete (T-135 (7))', () => {
  it('counts the folder, with the singular handled', () => {
    expect(clearTranscriptsQuestion(3, false)).toMatch(/^This deletes the 3 saved transcripts imagii keeps on this computer/)
    expect(clearTranscriptsQuestion(1, false)).toMatch(/^This deletes the 1 saved transcript imagii keeps on this computer/)
  })

  it('names the open video\'s transcript only when the open video has one', () => {
    expect(clearTranscriptsQuestion(3, true)).toBe(
      'This deletes the 3 saved transcripts imagii keeps on this computer, including the one for the video you have open. Transcribe again whenever you need one.'
    )
    expect(clearTranscriptsQuestion(3, false)).toBe(
      'This deletes the 3 saved transcripts imagii keeps on this computer. Transcribe again whenever you need one.'
    )
    expect(clearTranscriptsQuestion(3, false), 'no claim about a video with no transcript').not.toMatch(/video you have open/)
  })

  it('is a finished sentence pair with a period, and has no hedge tacked on', () => {
    for (const has of [true, false]) {
      const text = clearTranscriptsQuestion(2, has)
      expect(text.endsWith('.')).toBe(true)
      expect(text).not.toMatch(/if it has one/)
    }
  })
})

describe('the captions toasts say what happened (T-89)', () => {
  it('a transcription reports lines of caption with the singular handled', () => {
    expect(captionsReadyMessage(0)).toBe('Captions ready (0 lines)')
    expect(captionsReadyMessage(1)).toBe('Captions ready (1 line)')
    expect(captionsReadyMessage(42)).toBe('Captions ready (42 lines)')
    expect(captionsReadyMessage(42)).not.toMatch(/segment/i)
  })

  it('a burn-in that put captions on the picture says so', () => {
    expect(burnInDoneMessage(true)).toBe('Captions burned in')
  })

  it('a burn-in over a range nobody speaks in does NOT claim captions', () => {
    const msg = burnInDoneMessage(false)
    expect(msg).toBe('No captions in this range — exported without captions.')
    expect(msg).not.toMatch(/burned in/i)
  })
})

describe('isUsableFrame — a probe can answer 0 (T-113)', () => {
  it('is true only for a width and a height that are both positive, finite numbers', () => {
    expect(isUsableFrame({ width: 1920, height: 1080 })).toBe(true)
    expect(isUsableFrame({ width: 1, height: 1 })).toBe(true)
    for (const [width, height] of [[0, 0], [0, 1080], [1920, 0], [-1, 1080], [1920, -5], [Number.NaN, 1080], [1920, Number.NaN], [Number.POSITIVE_INFINITY, 1080]] as const) {
      expect(isUsableFrame({ width, height }), `${width}x${height}`).toBe(false)
    }
    expect(isUsableFrame(null)).toBe(false)
    expect(isUsableFrame(undefined)).toBe(false)
  })

  it('the size readout and the burn agree: an unusable frame is quoted on 1080p', () => {
    expect(captionSizeReadout(32, { width: 0, height: 0 })).toBe(captionSizeReadout(32))
    expect(captionSizeReadout(32, { width: 1920, height: Number.NaN })).toBe(captionSizeReadout(32))
    expect(captionSizeReadout(32, { width: 1920, height: 1080 })).toBe('about 120 px tall on this video')
  })
})

describe('staleCaptionsMessage — a transcript that finished for a video that is gone (T-113)', () => {
  it('names the video, says closed or replaced (a close is not "another video"), and the way back', () => {
    expect(staleCaptionsMessage('stream.mp4')).toBe(
      "Captions for stream.mp4 finished after that video was closed or replaced, so they weren't added. " +
        "Transcribe again when you're ready."
    )
  })

  it('does not claim another video was opened', () => {
    expect(staleCaptionsMessage('a.mp4')).not.toMatch(/another video/i)
  })
})
