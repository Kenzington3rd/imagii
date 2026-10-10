import { describe, it, expect } from 'vitest'
import { computeCropBox } from '@shared/safeZone'
import {
  PLATFORM_INFO,
  customPresetInfo,
  evaluateSuccess,
  outputDurationSec,
  type JudgedClip
} from './presets'

/**
 * The export grid's per-platform indicator (T-83, T-97). The verdict reads the
 * CLIP — its range, its speed and its crop — against the source's size: the
 * frame the export starts from is the crop when there is one, and the length
 * that counts is the length of the file at the clip's speed. The output is a
 * level, a label naming what is wrong, and plain-language reasons that the
 * card shows on screen.
 */

const youtube = PLATFORM_INFO.youtube
const tiktok = PLATFORM_INFO.tiktok
const reels = PLATFORM_INFO.reels
const twitter = PLATFORM_INFO.twitter

// A 4K 16:9 source: big enough that no platform's resolution check trips, so
// shape and length are the only things the cases below can be about.
const W = 3840
const H = 2160

/**
 * A clip of `sec` source seconds. `crop` is the aspect of the largest centered
 * crop of the `W` x `H` source the clip is cropped to (null: no crop), or a
 * ready-made rect; `speed` is the playback multiplier.
 */
function clip(
  sec: number,
  crop: number | JudgedClip['cropRect'] = null,
  speed?: number,
  srcW: number = W,
  srcH: number = H
): JudgedClip {
  let cropRect: JudgedClip['cropRect']
  if (typeof crop === 'number') {
    const box = computeCropBox(srcW, srcH, crop)
    cropRect = { x: box.x / srcW, y: box.y / srcH, w: box.w / srcW, h: box.h / srcH }
  } else {
    cropRect = crop
  }
  return { startSec: 0, endSec: sec, cropRect, speedMultiplier: speed }
}

describe('evaluateSuccess — the label says WHY (T-83)', () => {
  it('green is "Great" and carries the one reassuring reason', () => {
    const r = evaluateSuccess(youtube, clip(120), W, H)
    expect(r.level).toBe('green')
    expect(r.label).toBe('Great')
    expect(r.reasons).toEqual(['Looks great for this platform'])
  })

  it('a clip longer than a platform\'s typical limit is "Too long", not "Trim"', () => {
    const r = evaluateSuccess(reels, clip(200, 9 / 16), W, H)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Too long')
    expect(r.reasons).toEqual(['Longer than the typical 3-minute limit'])
  })

  it('the wrong shape is "Wrong shape", with how much of the picture survives', () => {
    // 16:9 into TikTok's 9:16 keeps 9/16 / (16/9) = 31.640625% of the width.
    const r = evaluateSuccess(tiktok, clip(25), W, H)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Wrong shape')
    expect(r.reasons).toEqual(["Only the middle 32% of the picture's width fits this shape"])
  })

  it('a tall frame on a wide platform loses height, and says so', () => {
    const r = evaluateSuccess(youtube, clip(120, null, undefined, 1080, 1920), 1080, 1920)
    expect(r.label).toBe('Wrong shape')
    expect(r.reasons[0]).toBe("Only the middle 32% of the picture's height fits this shape")
  })

  it('both problems at once name both, and list both reasons', () => {
    // The T-94 case: a 3-hour VOD whole, ticked for TikTok.
    const r = evaluateSuccess(tiktok, clip(3 * 3600), W, H)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Too long · Wrong shape')
    expect(r.reasons).toEqual([
      'Longer than the typical 60-minute limit',
      "Only the middle 32% of the picture's width fits this shape"
    ])
  })

  it('a mild mismatch is yellow "OK" and quantifies the trim', () => {
    // 4:3 into 16:9: 25% of the height goes.
    const r = evaluateSuccess(youtube, clip(120, 4 / 3), W, H)
    expect(r.level).toBe('yellow')
    expect(r.label).toBe('OK')
    expect(r.reasons).toEqual(["25% of the picture's height is trimmed to fit this shape"])
  })
})

describe('evaluateSuccess — the crop is the frame (T-83)', () => {
  it('a 9:16 crop turns the tall platforms green and the wide ones red', () => {
    const crop = 9 / 16
    // 25 s sits inside TikTok's 21-34 s sweet spot and Reels' 15-90 s.
    expect(evaluateSuccess(tiktok, clip(25, crop), W, H)).toMatchObject({
      level: 'green',
      label: 'Great'
    })
    expect(evaluateSuccess(reels, clip(25, crop), W, H)).toMatchObject({
      level: 'green',
      label: 'Great'
    })
    expect(evaluateSuccess(twitter, clip(25, crop), W, H)).toMatchObject({
      level: 'red',
      label: 'Wrong shape'
    })
    expect(evaluateSuccess(youtube, clip(120, crop), W, H)).toMatchObject({
      level: 'red',
      label: 'Wrong shape'
    })
  })

  it('without a crop the same source is the other way round', () => {
    expect(evaluateSuccess(tiktok, clip(25), W, H).label).toBe('Wrong shape')
    expect(evaluateSuccess(youtube, clip(120), W, H).label).toBe('Great')
  })

  it('a null crop falls back to the source aspect; a crop overrides it', () => {
    const portraitSource = evaluateSuccess(reels, clip(25, null, undefined, 1080, 1920), 1080, 1920)
    expect(portraitSource.level).toBe('green') // 1080x1920 is exactly Reels' 9:16
    const cropped = evaluateSuccess(reels, clip(25, 16 / 9, undefined, 1080, 1920), 1080, 1920)
    expect(cropped.label).toBe('Wrong shape')
  })
})

describe('evaluateSuccess — durations read in minutes, caps are "typical" (T-83)', () => {
  it('the sweet-spot reasons use the platform\'s own numbers as words', () => {
    expect(evaluateSuccess(youtube, clip(700), W, H).reasons).toEqual([
      'Over the 10-minute sweet spot'
    ])
    expect(evaluateSuccess(youtube, clip(30), W, H).reasons).toEqual([
      'Under the 1-minute sweet spot'
    ])
    expect(evaluateSuccess(tiktok, clip(10, 9 / 16), W, H).reasons).toEqual([
      'Under the 21-second sweet spot'
    ])
    expect(evaluateSuccess(reels, clip(120, 9 / 16), W, H).reasons).toEqual([
      'Over the 1:30 sweet spot'
    ])
  })

  it('no hard limit is stated as a fact: every one is "the typical ... limit"', () => {
    for (const p of Object.values(PLATFORM_INFO)) {
      const r = evaluateSuccess(p, clip(p.durationHardLimit + 1, p.aspectRatio), W, H)
      expect(r.label).toBe('Too long')
      expect(r.reasons[0]).toMatch(/^Longer than the typical \S+ limit$/)
    }
  })

  it('multi-hour limits read as hours, not as a three-digit minute count', () => {
    expect(evaluateSuccess(youtube, clip(13 * 3600), W, H).reasons[0]).toBe(
      'Longer than the typical 12-hour limit'
    )
    expect(evaluateSuccess(PLATFORM_INFO.facebook, clip(5 * 3600), W, H).reasons[0]).toBe(
      'Longer than the typical 4-hour limit'
    )
  })

  it('X keeps its free-account note, still as a typical limit', () => {
    const r = evaluateSuccess(twitter, clip(200), W, H)
    expect(r.level).toBe('yellow')
    expect(r.reasons).toEqual([
      'Over the typical free-account limit of 2:20 — longer videos need X Premium'
    ])
  })

  it('no reason mentions a platform by name (the card already is one)', () => {
    const everything: string[] = []
    for (const p of Object.values(PLATFORM_INFO)) {
      for (const d of [5, 30, 100, 700, 5000, 100000]) {
        for (const a of [null, 9 / 16, 1, 4 / 3]) {
          everything.push(...evaluateSuccess(p, clip(d, a, undefined, 640, 360), 640, 360).reasons)
        }
      }
    }
    for (const text of everything) {
      expect(text).not.toMatch(/YouTube|Reels|TikTok|Facebook/)
    }
  })
})

describe('evaluateSuccess — the picture the export starts from, against the size it ends at (T-97)', () => {
  const SOFT = 'The picture is smaller than this output — it will be scaled up and look soft'

  it('a source smaller than the output is yellow and says it will be scaled up and look soft', () => {
    const r = evaluateSuccess(youtube, clip(120, null, undefined, 1280, 720), 1280, 720)
    expect(r.level).toBe('yellow')
    expect(r.reasons).toEqual([SOFT])
  })

  it('a small crop of a big source is soft too: the CROP is the picture, not the file', () => {
    // A quarter of a 4K frame's area (half of each side) is 1920x1080 of
    // picture, so YouTube is exactly met — and Reels' 1080x1920 is a stretch.
    const half = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    expect(evaluateSuccess(youtube, clip(120, half), W, H)).toMatchObject({
      level: 'green',
      label: 'Great'
    })
    // Smaller than that and the same clip, the same source, is soft at 1080p.
    const quarterArea = { x: 0.25, y: 0.25, w: 0.4, h: 0.4 }
    const r = evaluateSuccess(youtube, clip(120, quarterArea), W, H)
    expect(r.level).toBe('yellow')
    expect(r.label).toBe('OK')
    expect(r.reasons).toEqual([SOFT])
    // The very same source with no crop is untouched: 4K into 1080p is a
    // downscale.
    expect(evaluateSuccess(youtube, clip(120), W, H).reasons).toEqual([
      'Looks great for this platform'
    ])
  })

  it('a crop that is still big enough says nothing about size', () => {
    // 3/4 of each side of a 4K frame is 2880x1620: more than every output.
    const big = { x: 0.1, y: 0.1, w: 0.75, h: 0.75 }
    for (const p of [youtube, twitter, PLATFORM_INFO.facebook]) {
      expect(evaluateSuccess(p, clip(120, big), W, H).reasons).not.toContain(SOFT)
    }
  })

  it('judges the crop against each platform\'s own size', () => {
    // A 1280x1440 strip of a 4K source: wide enough for 720p, too short for
    // Reels' 1920-tall frame. The crop is one thing; each output is another.
    const strip = { x: 0.3, y: 0, w: 1280 / W, h: 1440 / H }
    expect(evaluateSuccess(twitter, clip(100, strip), W, H).reasons).not.toContain(SOFT)
    expect(evaluateSuccess(reels, clip(60, strip), W, H).reasons).toContain(SOFT)
  })

  it('a custom preset is judged on the same frame against ITS size', () => {
    const custom = customPresetInfo({
      id: 'c1',
      name: '4K master',
      width: 3840,
      height: 2160,
      fps: 30,
      videoBitrate: '40M',
      audioBitrate: '320k',
      basePlatformId: 'youtube'
    })
    const half = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    expect(evaluateSuccess(custom, clip(120, half), W, H).reasons).toContain(SOFT)
    expect(evaluateSuccess(custom, clip(120), W, H).reasons).not.toContain(SOFT)
  })

  it('whole pixels decide it: a crop drawn as a fraction does not fail by a rounding hair', () => {
    // 0.5 of 3840 and 0.5 of 2160 is 1920x1080 on the nose; a float that lands
    // a hair under (the editor stores fractions) must not read as "soft".
    const hair = { x: 0, y: 0, w: 0.5 - 1e-9, h: 0.5 - 1e-9 }
    expect(evaluateSuccess(youtube, clip(120, hair), W, H).reasons).not.toContain(SOFT)
    // A whole pixel short is short.
    const short = { x: 0, y: 0, w: 0.5, h: 1078 / H }
    expect(evaluateSuccess(youtube, clip(120, short), W, H).reasons).toContain(SOFT)
  })

  it('a probe that found no size is judged as it always was, and never throws', () => {
    const r = evaluateSuccess(youtube, clip(120), 0, 0)
    expect(r.reasons).toContain(SOFT)
  })
})

describe('outputDurationSec — the length of the file, not of the range (T-97)', () => {
  const range = (sec: number, speedMultiplier?: number) => ({
    startSec: 10,
    endSec: 10 + sec,
    speedMultiplier
  })

  it('divides the range by the speed: 0.5x doubles it, 1x keeps it, 2x halves it', () => {
    expect(outputDurationSec(range(360, 0.5))).toBe(720)
    expect(outputDurationSec(range(360, 1))).toBe(360)
    expect(outputDurationSec(range(360, 2))).toBe(180)
    expect(outputDurationSec(range(360))).toBe(360)
  })

  it('reads a speed that means nothing as 1x, the way the encoder does', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(outputDurationSec(range(100, bad))).toBe(100)
    }
  })

  it('a reversed range is empty, never negative', () => {
    expect(outputDurationSec({ startSec: 9, endSec: 3, speedMultiplier: 2 })).toBe(0)
  })
})

describe('evaluateSuccess — the length is judged at the clip\'s speed (T-97)', () => {
  // Reels\' typical limit is 3:00 (180 s). Every case is a range of the SAME
  // source, so only the speed can move the verdict.
  it('a 2x clip is under a limit its source range is over', () => {
    const slow = evaluateSuccess(reels, clip(300, 9 / 16, 1), W, H)
    expect(slow.label).toBe('Too long')
    const fast = evaluateSuccess(reels, clip(300, 9 / 16, 2), W, H)
    expect(fast.label).not.toContain('Too long')
    // 150 s is past Reels' 1:30 sweet spot but inside the limit: yellow, and
    // the reason is the sweet spot, not the cap.
    expect(fast).toMatchObject({ level: 'yellow', label: 'OK' })
    expect(fast.reasons).toEqual(['Over the 1:30 sweet spot'])
  })

  it('a 0.5x clip is over a limit its source range is under', () => {
    expect(evaluateSuccess(reels, clip(100, 9 / 16, 1), W, H).label).not.toContain('Too long')
    const slowed = evaluateSuccess(reels, clip(100, 9 / 16, 0.5), W, H)
    expect(slowed.label).toBe('Too long')
    expect(slowed.reasons).toEqual(['Longer than the typical 3-minute limit'])
  })

  it('the limit is a strict boundary at every speed', () => {
    const at = (speed: number, sec: number) => evaluateSuccess(reels, clip(sec, 9 / 16, speed), W, H)
    // Exactly 180 s of output is not over; a tenth of a second more is.
    expect(at(2, 360).label).not.toContain('Too long')
    expect(at(2, 360.2).label).toBe('Too long')
    expect(at(1, 180).label).not.toContain('Too long')
    expect(at(1, 180.1).label).toBe('Too long')
    expect(at(0.5, 90).label).not.toContain('Too long')
    expect(at(0.5, 90.1).label).toBe('Too long')
  })

  it('the sweet spot moves with the speed too', () => {
    // TikTok's sweet spot is 21-34 s. A 50 s range is long at 1x and inside at 2x.
    expect(evaluateSuccess(tiktok, clip(50, 9 / 16, 1), W, H).reasons).toEqual([
      'Over the 34-second sweet spot'
    ])
    expect(evaluateSuccess(tiktok, clip(50, 9 / 16, 2), W, H)).toMatchObject({
      level: 'green',
      label: 'Great'
    })
    // And a 30 s range at 2x is 15 s: under the 21-second floor.
    expect(evaluateSuccess(tiktok, clip(30, 9 / 16, 2), W, H).reasons).toEqual([
      'Under the 21-second sweet spot'
    ])
  })
})
