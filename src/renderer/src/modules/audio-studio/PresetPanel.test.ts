import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_CHAIN_SPEC, type ChainSpec } from '@shared/audio'
import type { ChainPreset } from '@shared/workspace'
import { useAudioStore } from './state/audioStore'
import { presetPatch } from './PresetPanel'

/**
 * T-90 — Apply puts a preset's CLEANUP settings on the recording in front of
 * the user, and leaves that recording's own cuts and second track alone.
 *
 * This drives the real store and the real apply path (`presetPatch` is what
 * the panel's Apply button hands `patchChain`). The preset is an OLD-shape
 * fixture: what a build before this ticket wrote to disk, whole chain
 * included, so a preset someone saved last month cannot re-impose its cut
 * times on a new take.
 */

const OLD_SHAPE_PRESET: ChainPreset = {
  id: 'abc123',
  name: 'Mic A',
  createdAt: 1,
  // Typed as the new, narrower shape; the runtime object is the old one.
  chain: {
    ...DEFAULT_CHAIN_SPEC,
    denoise: 'aggressive',
    deEss: true,
    loudnorm: true,
    loudnormTargetLufs: -14,
    cutRegions: [{ startSec: 400, endSec: 450 }],
    secondaryTrack: {
      filePath: 'C:/old-session/music.wav',
      fileName: 'music.wav',
      role: 'music',
      gainDb: -10,
      duckUnderPrimary: true
    }
  } as unknown as ChainPreset['chain']
}

const TODAYS_CUT = { startSec: 3, endSec: 4.5 }

beforeEach(() => {
  useAudioStore.setState({
    chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [TODAYS_CUT] } as ChainSpec,
    history: { past: [], future: [] }
  })
})

describe('applying a preset', () => {
  it('sets the cleanup settings it holds', () => {
    useAudioStore.getState().patchChain(presetPatch(OLD_SHAPE_PRESET))
    const chain = useAudioStore.getState().chain
    expect(chain.denoise).toBe('aggressive')
    expect(chain.deEss).toBe(true)
    expect(chain.loudnorm).toBe(true)
    expect(chain.loudnormTargetLufs).toBe(-14)
  })

  it('does NOT re-impose the cut times an old preset saved on this recording', () => {
    useAudioStore.getState().patchChain(presetPatch(OLD_SHAPE_PRESET))
    expect(useAudioStore.getState().chain.cutRegions).toEqual([TODAYS_CUT])
  })

  it('does NOT put the old preset\'s second track on this recording', () => {
    useAudioStore.getState().patchChain(presetPatch(OLD_SHAPE_PRESET))
    expect(useAudioStore.getState().chain.secondaryTrack).toBeNull()
  })

  it('keeps a second track the user already added to this recording', () => {
    const mine = {
      filePath: 'C:/today/bed.wav',
      fileName: 'bed.wav',
      role: 'music' as const,
      gainDb: -12,
      duckUnderPrimary: true
    }
    useAudioStore.getState().setSecondaryTrack(mine)
    useAudioStore.getState().patchChain(presetPatch(OLD_SHAPE_PRESET))
    expect(useAudioStore.getState().chain.secondaryTrack).toEqual(mine)
  })
})
