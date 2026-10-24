import { describe, it, expect } from 'vitest'
import { assertEnum } from '../../shared/validators'
import { ALL_PRESET_IDS, PLATFORM_PRESETS, resolveExportPreset } from './presets'
import type { CustomPreset } from '../../shared/customPresets'

/**
 * Regression tests for bug round 11 — FIX 1.
 *
 * validateExportJob (src/main/ipc/video.ts) previously validated `preset`
 * with assertNonEmptyString, so any non-empty string passed the IPC guard.
 * An unknown key then made PLATFORM_PRESETS[job.preset] return `undefined`,
 * and buildVideoFilter read `preset.aspectRatio` → an uncaught TypeError
 * thrown across the IPC boundary. The fix swaps in
 * `assertEnum(job.preset, ALL_PRESET_IDS, ...)`.
 *
 * The guard is only as strong as ALL_PRESET_IDS staying in lockstep with
 * the actual PLATFORM_PRESETS keys — if they ever drift, assertEnum would
 * accept a preset PLATFORM_PRESETS lacks and reintroduce the crash. Pin
 * both the list and the assertEnum behavior here.
 */
describe('ALL_PRESET_IDS', () => {
  it('exactly matches the keys of PLATFORM_PRESETS', () => {
    expect([...ALL_PRESET_IDS].sort()).toEqual(Object.keys(PLATFORM_PRESETS).sort())
  })

  it('every id resolves to a preset with an aspectRatio', () => {
    for (const id of ALL_PRESET_IDS) {
      const preset = PLATFORM_PRESETS[id]
      expect(preset).toBeDefined()
      expect(typeof preset.aspectRatio).toBe('number')
    }
  })
})

describe('assertEnum over ALL_PRESET_IDS (the validateExportJob guard)', () => {
  it('accepts every real platform id', () => {
    for (const id of ALL_PRESET_IDS) {
      expect(() => assertEnum(id, ALL_PRESET_IDS, 'preset')).not.toThrow()
    }
  })

  it('rejects an unknown platform key such as "instagram"', () => {
    expect(() => assertEnum('instagram', ALL_PRESET_IDS, 'preset')).toThrow()
  })

  it('rejects a non-empty but invalid string that the old guard let through', () => {
    expect(() => assertEnum('shorts', ALL_PRESET_IDS, 'preset')).toThrow()
  })
})

/**
 * T-50 — a saved custom preset is an export target, and `resolveExportPreset`
 * is the single place its numbers replace the base platform's. Everything
 * downstream (the scale filter, the drawtext coordinates, zoompan's `s=`,
 * `-b:v`, `-r`, `-b:a`) reads the resolved row, so getting this wrong writes
 * a file at the wrong size with green string-shape tests either side of it.
 */
describe('resolveExportPreset (T-50)', () => {
  const custom: CustomPreset = {
    id: 'cp1',
    name: 'Discord 1080p',
    width: 1280,
    height: 720,
    fps: 60,
    videoBitrate: '5M',
    audioBitrate: '256k',
    basePlatformId: 'reels'
  }

  it('returns the platform row untouched when there is no custom preset', () => {
    for (const id of ALL_PRESET_IDS) {
      expect(resolveExportPreset(id, null)).toBe(PLATFORM_PRESETS[id])
      expect(resolveExportPreset(id, undefined)).toBe(PLATFORM_PRESETS[id])
    }
  })

  it('takes geometry, fps and both bitrates from the custom preset', () => {
    const resolved = resolveExportPreset('reels', custom)
    expect(resolved.width).toBe(1280)
    expect(resolved.height).toBe(720)
    expect(resolved.fps).toBe(60)
    expect(resolved.videoBitrate).toBe('5M')
    expect(resolved.audioBitrate).toBe('256k')
  })

  it('re-derives aspectRatio from the custom dimensions, not the base row', () => {
    // Reels is 9:16. A 1280x720 custom preset built on it must come out
    // 16:9 — the base aspect would auto-crop the frame to a vertical strip
    // and then stretch it back out to 1280x720.
    expect(PLATFORM_PRESETS.reels.aspectRatio).toBeCloseTo(9 / 16, 10)
    expect(resolveExportPreset('reels', custom).aspectRatio).toBeCloseTo(16 / 9, 10)
  })

  it('shows the user their own preset name as the label', () => {
    expect(resolveExportPreset('reels', custom).label).toBe('Discord 1080p')
  })

  it('keeps codec, pixel format and the base platform id', () => {
    const resolved = resolveExportPreset('reels', custom)
    expect(resolved.videoCodec).toBe('libx264')
    expect(resolved.audioCodec).toBe('aac')
    expect(resolved.pixFmt).toBe('yuv420p')
    expect(resolved.id).toBe('reels')
  })

  it('keeps the base platform duration advisories', () => {
    const resolved = resolveExportPreset('reels', custom)
    expect(resolved.durationSweetSpot).toEqual(PLATFORM_PRESETS.reels.durationSweetSpot)
    expect(resolved.durationHardLimit).toBe(PLATFORM_PRESETS.reels.durationHardLimit)
  })

  it('never mutates the shared platform table', () => {
    resolveExportPreset('reels', custom)
    expect(PLATFORM_PRESETS.reels.width).toBe(1080)
    expect(PLATFORM_PRESETS.reels.height).toBe(1920)
    expect(PLATFORM_PRESETS.reels.label).toBe('Instagram Reels')
  })
})

/**
 * T-111 — the custom-preset form takes any size from 16 to 16384, yuv420p keeps
 * one chroma sample per 2x2 block, and libx264 refuses an odd width or height
 * ("width not divisible by 2"). A 1081x607 preset therefore failed EVERY export
 * made with it, from a form that had accepted it. The resolved row is what
 * every stage reads (scale, zoompan's `s=`, the drawtext coordinates), so it is
 * where the size is snapped, the way a compilation segment's is.
 */
describe('resolveExportPreset snaps odd sizes to even pixels (T-111)', () => {
  const odd: CustomPreset = {
    id: 'cp-odd',
    name: 'Odd',
    width: 1081,
    height: 607,
    fps: 30,
    videoBitrate: '5M',
    audioBitrate: '128k',
    basePlatformId: 'youtube'
  }

  it('rounds an odd side down to the even pixel below it', () => {
    const resolved = resolveExportPreset('youtube', odd)
    expect(resolved.width).toBe(1080)
    expect(resolved.height).toBe(606)
  })

  it('derives the aspect from the sizes it will actually write', () => {
    expect(resolveExportPreset('youtube', odd).aspectRatio).toBeCloseTo(1080 / 606, 10)
  })

  it('leaves an even size exactly as it was, and snaps each side on its own', () => {
    expect(resolveExportPreset('youtube', { ...odd, width: 1280, height: 720 })).toMatchObject({ width: 1280, height: 720 })
    expect(resolveExportPreset('youtube', { ...odd, width: 1081, height: 720 })).toMatchObject({ width: 1080, height: 720 })
    expect(resolveExportPreset('youtube', { ...odd, width: 1280, height: 607 })).toMatchObject({ width: 1280, height: 606 })
  })

  it('keeps the whole range the form accepts usable', () => {
    // assertCustomPreset admits 16..16384; every value in it survives even().
    expect(resolveExportPreset('youtube', { ...odd, width: 17, height: 17 })).toMatchObject({ width: 16, height: 16 })
    expect(resolveExportPreset('youtube', { ...odd, width: 16383, height: 16383 })).toMatchObject({ width: 16382, height: 16382 })
  })
})

/**
 * T-130 (q) - "YouTube 1080p60". Every platform row was 30 fps, so a streamer whose game runs at 60 had no way to export it at 60 short of
 * building a custom preset by hand. The row is YouTube's 1080p row at 60 fps and YouTube's recommended 1080p60 video bitrate (12 Mbps,
 * against 8 Mbps at 30); everything else about the platform - its audio, its codec, its length advice - is the same platform's.
 */
describe('YouTube 1080p60 (T-130 (q))', () => {
  const p60 = PLATFORM_PRESETS.youtube60
  const p30 = PLATFORM_PRESETS.youtube

  it('is a listed preset the export gate accepts', () => {
    expect(ALL_PRESET_IDS).toContain('youtube60')
    expect(() => assertEnum('youtube60', ALL_PRESET_IDS, 'preset')).not.toThrow()
  })

  it('is 1920x1080 at 60 fps and 12M, named for what it is', () => {
    expect(p60.id).toBe('youtube60')
    expect(p60.label).toBe('YouTube 1080p60')
    expect([p60.width, p60.height]).toEqual([1920, 1080])
    expect(p60.fps).toBe(60)
    expect(p60.videoBitrate).toBe('12M')
    expect(p60.aspectRatio).toBeCloseTo(16 / 9, 10)
  })

  it('has the 1080p row\'s audio, codecs and length advice, so the only differences are the rate and its bitrate', () => {
    const { id: _id, label: _label, fps: _fps, videoBitrate: _bitrate, ...rest60 } = p60
    const { id: _id30, label: _label30, fps: _fps30, videoBitrate: _bitrate30, ...rest30 } = p30
    expect(rest60).toEqual(rest30)
    expect(p60.audioBitrate).toBe('192k')
    expect(p30.fps, 'the 30 fps row is untouched').toBe(30)
    expect(p30.videoBitrate).toBe('8M')
  })

  it('a custom preset built on it resolves like one built on any platform', () => {
    const custom: CustomPreset = {
      id: 'cp60',
      name: 'Stream 720p60',
      width: 1280,
      height: 720,
      fps: 60,
      videoBitrate: '6M',
      audioBitrate: '128k',
      basePlatformId: 'youtube60'
    }
    const resolved = resolveExportPreset('youtube60', custom)
    expect([resolved.id, resolved.width, resolved.height, resolved.fps]).toEqual(['youtube60', 1280, 720, 60])
    expect(resolveExportPreset('youtube60', null)).toBe(p60)
  })
})
