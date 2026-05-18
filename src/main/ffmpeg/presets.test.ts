import { describe, it, expect } from 'vitest'
import { assertEnum } from '../../shared/validators'
import { ALL_PRESET_IDS, PLATFORM_PRESETS } from './presets'

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
