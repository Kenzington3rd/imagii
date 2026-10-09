import { describe, it, expect } from 'vitest'
import { PLATFORM_INFO, evaluateSuccess } from './presets'

/**
 * The export grid's per-platform indicator (T-83). The inputs are the clip's
 * length and the frame the export STARTS from — the source, or the manual
 * crop's size and aspect — and the output is a level, a label naming what is
 * wrong, and plain-language reasons that the card shows on screen.
 */

const youtube = PLATFORM_INFO.youtube
const tiktok = PLATFORM_INFO.tiktok
const reels = PLATFORM_INFO.reels
const twitter = PLATFORM_INFO.twitter

// A 4K 16:9 source: big enough that no platform's resolution check trips, so
// shape and length are the only things the cases below can be about.
const W = 3840
const H = 2160

describe('evaluateSuccess — the label says WHY (T-83)', () => {
  it('green is "Great" and carries the one reassuring reason', () => {
    const r = evaluateSuccess(youtube, 120, W, H, null)
    expect(r.level).toBe('green')
    expect(r.label).toBe('Great')
    expect(r.reasons).toEqual(['Looks great for this platform'])
  })

  it('a clip longer than a platform\'s typical limit is "Too long", not "Trim"', () => {
    const r = evaluateSuccess(reels, 200, W, H, 9 / 16)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Too long')
    expect(r.reasons).toEqual(['Longer than the typical 3-minute limit'])
  })

  it('the wrong shape is "Wrong shape", with how much of the picture survives', () => {
    // 16:9 into TikTok's 9:16 keeps 9/16 / (16/9) = 31.640625% of the width.
    const r = evaluateSuccess(tiktok, 25, W, H, null)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Wrong shape')
    expect(r.reasons).toEqual(["Only the middle 32% of the picture's width fits this shape"])
  })

  it('a tall frame on a wide platform loses height, and says so', () => {
    const r = evaluateSuccess(youtube, 120, 1080, 1920, null)
    expect(r.label).toBe('Wrong shape')
    expect(r.reasons[0]).toBe("Only the middle 32% of the picture's height fits this shape")
  })

  it('both problems at once name both, and list both reasons', () => {
    // The T-94 case: a 3-hour VOD whole, ticked for TikTok.
    const r = evaluateSuccess(tiktok, 3 * 3600, W, H, null)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Too long · Wrong shape')
    expect(r.reasons).toEqual([
      'Longer than the typical 60-minute limit',
      "Only the middle 32% of the picture's width fits this shape"
    ])
  })

  it('a mild mismatch is yellow "OK" and quantifies the trim', () => {
    // 4:3 into 16:9: 25% of the height goes.
    const r = evaluateSuccess(youtube, 120, W, H, 4 / 3)
    expect(r.level).toBe('yellow')
    expect(r.label).toBe('OK')
    expect(r.reasons).toEqual(["25% of the picture's height is trimmed to fit this shape"])
  })
})

describe('evaluateSuccess — the crop is the frame (T-83)', () => {
  it('a 9:16 crop turns the tall platforms green and the wide ones red', () => {
    const crop = 9 / 16
    // 25 s sits inside TikTok's 21-34 s sweet spot and Reels' 15-90 s.
    expect(evaluateSuccess(tiktok, 25, W, H, crop)).toMatchObject({ level: 'green', label: 'Great' })
    expect(evaluateSuccess(reels, 25, W, H, crop)).toMatchObject({ level: 'green', label: 'Great' })
    expect(evaluateSuccess(twitter, 25, W, H, crop)).toMatchObject({
      level: 'red',
      label: 'Wrong shape'
    })
    expect(evaluateSuccess(youtube, 120, W, H, crop)).toMatchObject({
      level: 'red',
      label: 'Wrong shape'
    })
  })

  it('without a crop the same source is the other way round', () => {
    expect(evaluateSuccess(tiktok, 25, W, H, null).label).toBe('Wrong shape')
    expect(evaluateSuccess(youtube, 120, W, H, null).label).toBe('Great')
  })

  it('a null crop falls back to the source aspect; a crop overrides it', () => {
    const portraitSource = evaluateSuccess(reels, 25, 1080, 1920, null)
    expect(portraitSource.level).toBe('green') // 1080x1920 is exactly Reels' 9:16
    const cropped = evaluateSuccess(reels, 25, 1080, 1920, 16 / 9)
    expect(cropped.label).toBe('Wrong shape')
  })
})

describe('evaluateSuccess — durations read in minutes, caps are "typical" (T-83)', () => {
  it('the sweet-spot reasons use the platform\'s own numbers as words', () => {
    expect(evaluateSuccess(youtube, 700, W, H, null).reasons).toEqual([
      'Over the 10-minute sweet spot'
    ])
    expect(evaluateSuccess(youtube, 30, W, H, null).reasons).toEqual([
      'Under the 1-minute sweet spot'
    ])
    expect(evaluateSuccess(tiktok, 10, W, H, 9 / 16).reasons).toEqual([
      'Under the 21-second sweet spot'
    ])
    expect(evaluateSuccess(reels, 120, W, H, 9 / 16).reasons).toEqual([
      'Over the 1:30 sweet spot'
    ])
  })

  it('no hard limit is stated as a fact: every one is "the typical ... limit"', () => {
    for (const p of Object.values(PLATFORM_INFO)) {
      const r = evaluateSuccess(p, p.durationHardLimit + 1, W, H, p.aspectRatio)
      expect(r.label).toBe('Too long')
      expect(r.reasons[0]).toMatch(/^Longer than the typical \S+ limit$/)
    }
  })

  it('multi-hour limits read as hours, not as a three-digit minute count', () => {
    expect(evaluateSuccess(youtube, 13 * 3600, W, H, null).reasons[0]).toBe(
      'Longer than the typical 12-hour limit'
    )
    expect(evaluateSuccess(PLATFORM_INFO.facebook, 5 * 3600, W, H, null).reasons[0]).toBe(
      'Longer than the typical 4-hour limit'
    )
  })

  it('X keeps its free-account note, still as a typical limit', () => {
    const r = evaluateSuccess(twitter, 200, W, H, null)
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
          everything.push(...evaluateSuccess(p, d, 640, 360, a).reasons)
        }
      }
    }
    for (const text of everything) {
      expect(text).not.toMatch(/YouTube|Reels|TikTok|Facebook/)
    }
  })
})

describe('evaluateSuccess — resolution', () => {
  it('a frame smaller than the output is yellow and says it will be enlarged', () => {
    const r = evaluateSuccess(youtube, 120, 1280, 720, null)
    expect(r.level).toBe('yellow')
    expect(r.reasons).toEqual(['Picture is smaller than this output — it will be enlarged'])
  })
})
