import { describe, it, expect } from 'vitest'
import {
  PLATFORM_PRESETS,
  ALL_PRESET_IDS,
  resolveExportPreset
} from '../../src/main/ffmpeg/presets'
import {
  PLATFORM_INFO,
  ALL_PLATFORM_IDS,
  customPresetInfo
} from '../../src/renderer/src/modules/video-studio/presets'
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
})
