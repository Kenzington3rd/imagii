import { describe, it, expect } from 'vitest'
import {
  PLATFORM_PRESETS,
  ALL_PRESET_IDS,
  resolveExportPreset
} from '../../src/main/ffmpeg/presets'
import {
  PLATFORM_INFO,
  ALL_PLATFORM_IDS,
  KIT_PLATFORM_IDS,
  COMPILE_SIZE,
  COMPILE_TARGET,
  REELS_RECOMMEND_CUTOFF_SEC,
  TIKTOK_REWARDS_MIN_SEC,
  customPresetInfo
} from '../../src/renderer/src/modules/video-studio/presets'
import { COMPILE_FPS } from '../../src/main/ffmpeg/concat'
import { PLATFORM_IDS } from '../../src/shared/clip'
import type { CustomPreset } from '../../src/shared/customPresets'

/**
 * Round 18: the main-process encode table and the renderer advisory table
 * describe the same five platforms, but the round-15 duration updates only
 * landed in the renderer copy — main still carried pre-2024 limits for two
 * rounds. This test pins every shared field so the next platform-policy
 * update can't land in only one of the two files.
 */
describe('platform preset tables stay in sync', () => {
  it('lists the same platforms in the same order', () => {
    expect(ALL_PRESET_IDS).toEqual(ALL_PLATFORM_IDS)
  })

  it.each(ALL_PRESET_IDS)('%s shares dimensions, aspect, and duration limits', (id) => {
    const main = PLATFORM_PRESETS[id]
    const renderer = PLATFORM_INFO[id]
    expect(main.width).toBe(renderer.width)
    expect(main.height).toBe(renderer.height)
    // T-92: the grid prints the fps, so the grid and the encoder must agree.
    expect(main.fps).toBe(renderer.fps)
    expect(main.aspectRatio).toBeCloseTo(renderer.aspectRatio, 10)
    expect(main.durationSweetSpot).toEqual(renderer.durationSweetSpot)
    expect(main.durationHardLimit).toBe(renderer.durationHardLimit)
  })

  it('both display lists are the shared PLATFORM_IDS source', () => {
    expect(ALL_PRESET_IDS).toEqual([...PLATFORM_IDS])
    expect(ALL_PLATFORM_IDS).toEqual([...PLATFORM_IDS])
  })
})

/**
 * T-130 (q): "YouTube 1080p60" is a row in BOTH tables, and the two say the same thing about it - the grid prints its size and rate, the
 * encoder writes them. Clip Kit is the five platforms and stays so (a sixth file for the same platform would be a 30 fps source upsampled
 * to 60), which is why it reads its own list and not the grid's.
 */
describe('YouTube 1080p60 is one preset on both sides of the bridge (T-130 (q))', () => {
  it('both tables carry it, at 1920x1080 and 60 fps', () => {
    for (const row of [PLATFORM_PRESETS.youtube60, PLATFORM_INFO.youtube60]) {
      expect(row.id).toBe('youtube60')
      expect([row.width, row.height, row.fps]).toEqual([1920, 1080, 60])
    }
    expect(PLATFORM_PRESETS.youtube60.videoBitrate).toBe('12M')
  })

  it('the grid lists it straight after YouTube, and the shared id list names it', () => {
    expect(ALL_PLATFORM_IDS.slice(0, 2)).toEqual(['youtube', 'youtube60'])
    expect(PLATFORM_IDS).toContain('youtube60')
  })

  it('it is YouTube\'s length advice: the same platform, the same limits', () => {
    expect(PLATFORM_INFO.youtube60.durationSweetSpot).toEqual(PLATFORM_INFO.youtube.durationSweetSpot)
    expect(PLATFORM_INFO.youtube60.durationHardLimit).toBe(PLATFORM_INFO.youtube.durationHardLimit)
  })

  it('Clip Kit is still the five platforms, in the order the guide names them, without it', () => {
    expect(KIT_PLATFORM_IDS).toEqual(['youtube', 'reels', 'tiktok', 'twitter', 'facebook'])
    expect(KIT_PLATFORM_IDS).not.toContain('youtube60')
    for (const id of KIT_PLATFORM_IDS) expect(ALL_PLATFORM_IDS).toContain(id)
  })
})

/**
 * T-112 — Reels' 180 s was a cap on both sides of the bridge, and it was
 * Instagram's RECOMMENDATION cutoff: Reels upload up to about 20 minutes. The
 * generic loop above only holds the two tables EQUAL, so it passed with the wrong
 * number in both; this is the knowing update — the number is pinned by value, and
 * the cutoff that replaced it as the yellow warning must sit below the limit.
 */
describe('Reels: 3 minutes is advice, 20 minutes is the limit (T-112)', () => {
  it('both tables carry the 20-minute limit', () => {
    expect(PLATFORM_PRESETS.reels.durationHardLimit).toBe(1200)
    expect(PLATFORM_INFO.reels.durationHardLimit).toBe(1200)
  })

  it('the recommendation cutoff is 3 minutes, past the sweet spot and under the limit', () => {
    expect(REELS_RECOMMEND_CUTOFF_SEC).toBe(180)
    expect(REELS_RECOMMEND_CUTOFF_SEC).toBeGreaterThan(PLATFORM_INFO.reels.durationSweetSpot.max)
    expect(REELS_RECOMMEND_CUTOFF_SEC).toBeLessThan(PLATFORM_INFO.reels.durationHardLimit)
  })

  it('TikTok\'s sweet-spot note stops at a minute, inside the platform\'s limit', () => {
    expect(TIKTOK_REWARDS_MIN_SEC).toBe(60)
    expect(TIKTOK_REWARDS_MIN_SEC).toBeGreaterThan(PLATFORM_INFO.tiktok.durationSweetSpot.max)
    expect(TIKTOK_REWARDS_MIN_SEC).toBeLessThan(PLATFORM_INFO.tiktok.durationHardLimit)
  })
})

/**
 * T-50: a custom preset now has to be understood in TWO places — the grid
 * that shows the user what they will get (`customPresetInfo`) and the
 * encoder that produces it (`resolveExportPreset`). If those two disagree,
 * the panel promises one size and the file arrives at another, which is the
 * whole class of defect T-50 is fixing. Pin them against each other on
 * every base platform.
 */
describe('custom-preset resolution stays in sync across the two tables', () => {
  const make = (basePlatformId: CustomPreset['basePlatformId']): CustomPreset => ({
    id: `cp-${basePlatformId}`,
    name: 'Discord 1080p',
    width: 1280,
    height: 720,
    fps: 60,
    videoBitrate: '5M',
    audioBitrate: '256k',
    basePlatformId
  })

  it.each(ALL_PRESET_IDS)('on a %s base, both sides agree on what gets encoded', (id) => {
    const custom = make(id)
    const encoder = resolveExportPreset(id, custom)
    const shown = customPresetInfo(custom)
    expect(shown.width).toBe(encoder.width)
    expect(shown.height).toBe(encoder.height)
    // The custom preset's own frame rate, not the base platform's 30 (T-92).
    expect(shown.fps).toBe(encoder.fps)
    expect(shown.fps).toBe(60)
    expect(shown.aspectRatio).toBeCloseTo(encoder.aspectRatio, 10)
    expect(shown.label).toBe(encoder.label)
    // The advisories still come from the base platform on both sides.
    expect(shown.durationSweetSpot).toEqual(encoder.durationSweetSpot)
    expect(shown.durationHardLimit).toBe(encoder.durationHardLimit)
    // ...and the PlatformId the export job carries is the base, not a
    // made-up id: `assertEnum(job.preset, ALL_PRESET_IDS)` has to accept it.
    expect(shown.id).toBe(id)
    expect(ALL_PRESET_IDS).toContain(shown.id)
  })

  // T-111: the encoder writes even pixels, so the grid must judge the same file.
  it.each(ALL_PRESET_IDS)('on a %s base, an odd custom size is the same even size on both sides', (id) => {
    const custom = { ...make(id), width: 1081, height: 607 }
    const encoder = resolveExportPreset(id, custom)
    const shown = customPresetInfo(custom)
    expect([encoder.width, encoder.height]).toEqual([1080, 606])
    expect([shown.width, shown.height]).toEqual([encoder.width, encoder.height])
    expect(shown.aspectRatio).toBeCloseTo(encoder.aspectRatio, 10)
  })
})

/**
 * T-105: the Compile card judges each clip against `COMPILE_TARGET` and sends
 * `COMPILE_SIZE` to main, which writes every segment at `COMPILE_FPS`. Three
 * constants on two sides of the bridge describe one frame; this is the pin
 * that a change to any of them is a change to all.
 */
describe('the compilation frame is the same on both sides of the bridge (T-105)', () => {
  it('the verdict is about the frame main writes: size, shape and rate', () => {
    expect([COMPILE_TARGET.width, COMPILE_TARGET.height]).toEqual([COMPILE_SIZE.width, COMPILE_SIZE.height])
    expect(COMPILE_TARGET.aspectRatio).toBeCloseTo(COMPILE_SIZE.width / COMPILE_SIZE.height, 10)
    expect(COMPILE_TARGET.fps).toBe(COMPILE_FPS)
  })

  it('is the YouTube preset\'s frame, which is what lets a segment equal an export of that preset byte for byte', () => {
    const youtube = PLATFORM_PRESETS.youtube
    expect([youtube.width, youtube.height]).toEqual([COMPILE_SIZE.width, COMPILE_SIZE.height])
    expect(youtube.aspectRatio).toBeCloseTo(COMPILE_TARGET.aspectRatio, 10)
    expect(youtube.fps).toBe(COMPILE_FPS)
  })
})
