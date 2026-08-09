import { describe, it, expect } from 'vitest'
import { PLATFORM_PRESETS, ALL_PRESET_IDS } from '../../src/main/ffmpeg/presets'
import { PLATFORM_INFO, ALL_PLATFORM_IDS } from '../../src/renderer/src/modules/video-studio/presets'

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
})
