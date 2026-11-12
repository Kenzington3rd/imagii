import { describe, it, expect } from 'vitest'
import { computeCropBox } from '@shared/safeZone'
import {
  COMPILE_SIZE,
  COMPILE_TARGET,
  PLATFORM_INFO,
  customPresetInfo,
  customPresetStartFor,
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

/** The yellow note past the point where Instagram stops recommending a Reel (T-112). */
const REELS_NOTE = "Over 3 minutes — Instagram won't recommend it to new viewers"

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
    // T-112: Reels' limit is the 20 minutes it takes uploads up to, not the 3 it recommends.
    const r = evaluateSuccess(reels, clip(1300, 9 / 16), W, H)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Too long')
    expect(r.reasons).toEqual(['Longer than the typical 20-minute limit'])
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
  // Reels' typical limit is 20:00 (1200 s; T-112 — it was 3:00, which is where
  // Instagram stops RECOMMENDING a Reel). Every case is a range of the SAME
  // source, so only the speed can move the verdict.
  it('a 2x clip is under a limit its source range is over', () => {
    const slow = evaluateSuccess(reels, clip(2400, 9 / 16, 1), W, H)
    expect(slow.label).toBe('Too long')
    const fast = evaluateSuccess(reels, clip(2400, 9 / 16, 2), W, H)
    expect(fast.label).not.toContain('Too long')
    // 1200 s of output is past the 3 minutes Instagram recommends but inside the
    // limit: yellow, and the reason is the recommendation, not the cap.
    expect(fast).toMatchObject({ level: 'yellow', label: 'OK' })
    expect(fast.reasons).toEqual([REELS_NOTE])
  })

  it('a 0.5x clip is over a limit its source range is under', () => {
    expect(evaluateSuccess(reels, clip(700, 9 / 16, 1), W, H).label).not.toContain('Too long')
    const slowed = evaluateSuccess(reels, clip(700, 9 / 16, 0.5), W, H)
    expect(slowed.label).toBe('Too long')
    expect(slowed.reasons).toEqual(['Longer than the typical 20-minute limit'])
  })

  it('the limit is a strict boundary at every speed', () => {
    const at = (speed: number, sec: number) => evaluateSuccess(reels, clip(sec, 9 / 16, speed), W, H)
    // Exactly 1200 s of output is not over; a tenth of a second more is.
    expect(at(2, 2400).label).not.toContain('Too long')
    expect(at(2, 2400.2).label).toBe('Too long')
    expect(at(1, 1200).label).not.toContain('Too long')
    expect(at(1, 1200.1).label).toBe('Too long')
    expect(at(0.5, 600).label).not.toContain('Too long')
    expect(at(0.5, 600.1).label).toBe('Too long')
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

/**
 * T-112 — Reels' 3 minutes is a recommendation cutoff, not a cap.
 *
 * Instagram takes a Reel up to about 20 minutes; past 3 it stops recommending it
 * to people who do not follow the account. The grid said "Too long" in red at
 * 3:00, steering a streamer away from an upload the platform accepts. The cutoff
 * is still worth a warning, so it stays a yellow one with its own words, and the
 * red waits for the length the platform really refuses.
 */
describe('evaluateSuccess — Reels: 3 minutes is advice, 20 minutes is the limit (T-112)', () => {
  const at = (sec: number) => evaluateSuccess(reels, clip(sec, 9 / 16), W, H)

  it('is a hard limit of 20 minutes', () => {
    expect(reels.durationHardLimit).toBe(1200)
  })

  it('up to 90 s is inside the sweet spot', () => {
    expect(at(90)).toMatchObject({ level: 'green', label: 'Great' })
  })

  it('between 90 s and 3 minutes it is just past the sweet spot', () => {
    expect(at(150).reasons).toEqual(['Over the 1:30 sweet spot'])
    // Exactly 3:00 is not past the cutoff.
    expect(at(180).reasons).toEqual(['Over the 1:30 sweet spot'])
  })

  it('past 3 minutes it is yellow, in Instagram\'s terms — not red, and not a refusal', () => {
    for (const sec of [181, 300, 900, 1200]) {
      const r = at(sec)
      expect(r.level, `${sec} s`).toBe('yellow')
      expect(r.label, `${sec} s`).toBe('OK')
      expect(r.reasons, `${sec} s`).toEqual([REELS_NOTE])
    }
    expect(REELS_NOTE).not.toMatch(/too long|longer than|reject|refuse|not allowed/i)
  })

  it('red begins only past 20 minutes', () => {
    expect(at(1200).level).toBe('yellow')
    expect(at(1200.5)).toMatchObject({ level: 'red', label: 'Too long' })
    expect(at(1200.5).reasons).toEqual(['Longer than the typical 20-minute limit'])
  })

  it('a custom preset built on Reels carries the same advice (the advisories stay with the base)', () => {
    const custom = customPresetInfo({
      id: 'cp1',
      name: 'Vertical 720p',
      width: 720,
      height: 1280,
      fps: 30,
      videoBitrate: '4M',
      audioBitrate: '128k',
      basePlatformId: 'reels'
    })
    const r = evaluateSuccess(custom, clip(400, 9 / 16, undefined, 3840, 2160), 3840, 2160)
    expect(r.reasons).toEqual([REELS_NOTE])
  })

  it('no other platform got a note it did not have', () => {
    // Facebook and X keep their own words at their own lengths.
    expect(evaluateSuccess(PLATFORM_INFO.facebook, clip(400), W, H).reasons).toEqual([
      'Over the 4-minute sweet spot'
    ])
    expect(evaluateSuccess(youtube, clip(700), W, H).reasons).toEqual(['Over the 10-minute sweet spot'])
  })
})

/**
 * T-112 — TikTok's sweet-spot note stops at a minute.
 *
 * "Over the 34-second sweet spot" was said of every clip longer than that, which
 * pushed streamers away from the minute-plus length TikTok's Creator Rewards pay
 * for. The advice for the shorter clips is unchanged — under 21 s is still too
 * short to hook anyone and 34-59 s is still long for a short-clip feed — it just
 * is not said of a clip that is a minute or more.
 */
describe('evaluateSuccess — TikTok: the sweet-spot note does not apply from a minute (T-112)', () => {
  const at = (sec: number) => evaluateSuccess(tiktok, clip(sec, 9 / 16), W, H)

  it('keeps the short-clip advice below a minute, both sides of the sweet spot', () => {
    expect(at(15).reasons).toEqual(['Under the 21-second sweet spot'])
    expect(at(25)).toMatchObject({ level: 'green', label: 'Great' })
    expect(at(34)).toMatchObject({ level: 'green', label: 'Great' })
    expect(at(35).reasons).toEqual(['Over the 34-second sweet spot'])
    expect(at(59).reasons).toEqual(['Over the 34-second sweet spot'])
  })

  it('says nothing about a clip of a minute or more', () => {
    for (const sec of [60, 61, 90, 180, 600]) {
      expect(at(sec), `${sec} s`).toMatchObject({ level: 'green', label: 'Great' })
      expect(at(sec).reasons, `${sec} s`).toEqual(['Looks great for this platform'])
    }
  })

  it('is still red at the platform\'s real limit, and a wrong shape is still wrong at any length', () => {
    expect(at(3601)).toMatchObject({ level: 'red', label: 'Too long' })
    expect(evaluateSuccess(tiktok, clip(120), W, H)).toMatchObject({ level: 'red', label: 'Wrong shape' })
  })

  it('the note moves with the speed: 2x of a 100 s range is a 50 s clip, which is past the sweet spot', () => {
    expect(evaluateSuccess(tiktok, clip(100, 9 / 16, 2), W, H).reasons).toEqual([
      'Over the 34-second sweet spot'
    ])
    expect(evaluateSuccess(tiktok, clip(100, 9 / 16, 1), W, H).level).toBe('green')
  })
})

/**
 * T-105 — the Compile card's verdict row is the grid's own verdict with the
 * compilation as the target: 1920x1080, 16:9, and no length to be too long for.
 * It is `evaluateSuccess`, so what the card says about a crop cannot drift from
 * what the grid says about the same crop for a 16:9 platform.
 */
describe('COMPILE_TARGET — the compilation judged as an export target (T-105)', () => {
  it('is the frame Compile writes, and 16:9', () => {
    expect([COMPILE_TARGET.width, COMPILE_TARGET.height]).toEqual([COMPILE_SIZE.width, COMPILE_SIZE.height])
    expect([COMPILE_SIZE.width, COMPILE_SIZE.height]).toEqual([1920, 1080])
    expect(COMPILE_TARGET.aspectRatio).toBeCloseTo(16 / 9, 10)
  })

  it('a whole 16:9 clip of a big source is "Great"', () => {
    const r = evaluateSuccess(COMPILE_TARGET, clip(120), W, H)
    expect(r).toEqual({ level: 'green', label: 'Great', reasons: ['Looks great for this platform'] })
  })

  it('has no length to be too long or too short for: a 4-hour clip and a 1-second clip are both fine', () => {
    for (const sec of [1, 14_400]) {
      expect(evaluateSuccess(COMPILE_TARGET, clip(sec), W, H).level, `${sec} s`).toBe('green')
    }
    expect(evaluateSuccess(COMPILE_TARGET, clip(3600, null, 0.25), W, H).level).toBe('green')
  })

  it('a 9:16 crop is "Wrong shape" and says how much of the picture survives the cut — the grid\'s words', () => {
    const r = evaluateSuccess(COMPILE_TARGET, clip(120, 9 / 16), W, H)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Wrong shape')
    // (a 1215-px-wide crop is also enlarged to 1920, which is the second reason)
    expect(r.reasons).toEqual([
      "Only the middle 32% of the picture's height fits this shape",
      'The picture is smaller than this output — it will be scaled up and look soft'
    ])
    // ...and it is the sentence a 16:9 platform's tile gives the same clip.
    expect(evaluateSuccess(youtube, clip(120, 9 / 16), W, H).reasons).toEqual(r.reasons)
  })

  it('a 4:3 crop trims its edges and is "OK", with the percentage', () => {
    const r = evaluateSuccess(COMPILE_TARGET, clip(30, 4 / 3), W, H)
    expect(r.level).toBe('yellow')
    expect(r.label).toBe('OK')
    expect(r.reasons).toEqual(["25% of the picture's height is trimmed to fit this shape"])
  })

  it('a source that is not 16:9, with no crop, is judged by its own shape — the cut is around the middle', () => {
    const r = evaluateSuccess(COMPILE_TARGET, clip(30, null, undefined, 1080, 1920), 1080, 1920)
    expect(r.level).toBe('red')
    expect(r.reasons[0]).toMatch(/^Only the middle 32% of the picture's height fits this shape/)
  })

  it('a crop smaller than 1920x1080 of picture says it will be scaled up', () => {
    const r = evaluateSuccess(COMPILE_TARGET, clip(30, 16 / 9), 1280, 720)
    expect(r.level).toBe('yellow')
    expect(r.reasons).toEqual(['The picture is smaller than this output — it will be scaled up and look soft'])
  })

  it('reads the crop\'s frame, not the source\'s: a 16:9 crop of a 4:3 source is "Great"', () => {
    const fourThree = clip(30, 16 / 9, undefined, 2880, 2160)
    expect(evaluateSuccess(COMPILE_TARGET, fourThree, 2880, 2160).level).toBe('green')
  })
})

/**
 * T-132 (7): "Base on" in the custom-preset form loaded the platform's SIZE and left the frame rate and the bitrates where they were, so a
 * preset based on YouTube 1080p60 started at 1920x1080, 30 fps, 8M while the guide (INTERACTION_COVERAGE, T-130) said it starts at 60. The
 * form's starting point is the platform's whole encode: what `customPresetStartFor` answers is what the five boxes are set to.
 */
describe('customPresetStartFor - what the form starts at when a platform is picked as the base (T-132 (7))', () => {
  it('YouTube 1080p60 starts at 60 fps and 12M, not at the form\'s 30 fps and 8M', () => {
    expect(customPresetStartFor('youtube60')).toEqual({ width: 1920, height: 1080, fps: 60, videoBitrate: '12M', audioBitrate: '192k' })
  })

  it('every platform starts at its own size, rate and bitrates', () => {
    expect(customPresetStartFor('youtube')).toEqual({ width: 1920, height: 1080, fps: 30, videoBitrate: '8M', audioBitrate: '192k' })
    expect(customPresetStartFor('reels')).toEqual({ width: 1080, height: 1920, fps: 30, videoBitrate: '6M', audioBitrate: '128k' })
    expect(customPresetStartFor('tiktok')).toEqual({ width: 1080, height: 1920, fps: 30, videoBitrate: '6M', audioBitrate: '128k' })
    expect(customPresetStartFor('twitter')).toEqual({ width: 1280, height: 720, fps: 30, videoBitrate: '5M', audioBitrate: '128k' })
    expect(customPresetStartFor('facebook')).toEqual({ width: 1280, height: 720, fps: 30, videoBitrate: '5M', audioBitrate: '128k' })
  })

  it('reads the table the grid prints, so the form and the grid cannot disagree', () => {
    for (const id of Object.keys(PLATFORM_INFO) as Array<keyof typeof PLATFORM_INFO>) {
      const info = PLATFORM_INFO[id]
      expect(customPresetStartFor(id)).toEqual({ width: info.width, height: info.height, fps: info.fps, videoBitrate: info.videoBitrate, audioBitrate: info.audioBitrate })
    }
  })
})
