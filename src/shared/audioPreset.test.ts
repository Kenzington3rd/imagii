import { describe, it, expect } from 'vitest'
import { DEFAULT_CHAIN_SPEC, type ChainSpec } from './audio'
import { cleanupSettings } from './audioPreset'

/**
 * T-90 — a cleanup preset is cleanup settings only.
 *
 * Before: "Save current" wrote the WHOLE chain, so a preset saved on Monday
 * carried Monday's cut times and Monday's music file, and Apply put them on
 * Tuesday's recording. These tests are the old-shape fixture: the chain as a
 * pre-T-90 build wrote it to disk.
 */

/** A preset body exactly as an older build saved it: cleanup AND session data. */
const OLD_SHAPE_CHAIN: ChainSpec = {
  ...DEFAULT_CHAIN_SPEC,
  denoise: 'medium',
  hum60: true,
  rumbleHighpass: true,
  deEss: true,
  compressor: 'voice',
  loudnorm: true,
  loudnormTargetLufs: -14,
  gainDb: 1.5,
  cutRegions: [
    { startSec: 12, endSec: 20 },
    { startSec: 95.5, endSec: 101 }
  ],
  secondaryTrack: {
    filePath: 'C:/streams/monday-music.wav',
    fileName: 'monday-music.wav',
    role: 'music',
    gainDb: -10,
    duckUnderPrimary: true
  }
}

describe('cleanupSettings', () => {
  it('drops the cut regions and the second track — the two things that belong to one recording', () => {
    const out = cleanupSettings(OLD_SHAPE_CHAIN)
    expect('cutRegions' in out).toBe(false)
    expect('secondaryTrack' in out).toBe(false)
  })

  it('keeps every cleanup, level and voice setting', () => {
    expect(cleanupSettings(OLD_SHAPE_CHAIN)).toEqual({
      denoise: 'medium',
      hum60: true,
      rumbleHighpass: true,
      deEss: true,
      compressor: 'voice',
      loudnorm: true,
      loudnormTargetLufs: -14,
      gainDb: 1.5
    })
  })

  it('removes exactly those two keys from the chain — a new ChainSpec field is a cleanup field by default', () => {
    const all = Object.keys(DEFAULT_CHAIN_SPEC).sort()
    const kept = Object.keys(cleanupSettings(DEFAULT_CHAIN_SPEC)).sort()
    expect(all.filter((k) => !kept.includes(k))).toEqual(['cutRegions', 'secondaryTrack'])
    expect(kept.filter((k) => !all.includes(k))).toEqual([])
  })

  it('carries the optional fields a preset may hold (custom denoise, mains frequency)', () => {
    const out = cleanupSettings({
      ...OLD_SHAPE_CHAIN,
      denoise: 'parametric',
      denoiseParams: { noiseFloorDb: -40, reductionDb: 20 },
      humHz: 50
    })
    expect(out.denoiseParams).toEqual({ noiseFloorDb: -40, reductionDb: 20 })
    expect(out.humHz).toBe(50)
  })

  it('is idempotent and does not mutate its input', () => {
    const before = JSON.stringify(OLD_SHAPE_CHAIN)
    const once = cleanupSettings(OLD_SHAPE_CHAIN)
    expect(cleanupSettings(once)).toEqual(once)
    expect(JSON.stringify(OLD_SHAPE_CHAIN)).toBe(before)
  })
})
