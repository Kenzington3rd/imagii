import { describe, it, expect, vi } from 'vitest'
import type { ChainSpec } from '@shared/audio'
import { DEFAULT_CHAIN_SPEC } from '@shared/audio'
import { audioCloseMessage, confirmAudioClose } from './AudioStudio'

/**
 * T-19 regression: Video Studio has confirmed its Close since round 18;
 * Audio Studio's Close called clearSource() directly, wiping the cleanup
 * chain, every cut region, a loaded second track, AND the undo history that
 * could have brought them back — silently, on one click.
 */
const edited = (patch: Partial<ChainSpec>): ChainSpec => ({ ...DEFAULT_CHAIN_SPEC, ...patch })

describe('audioCloseMessage', () => {
  it('is null for an untouched chain — nothing to lose, no prompt', () => {
    expect(audioCloseMessage(DEFAULT_CHAIN_SPEC)).toBeNull()
  })

  it('is null for a re-built copy of the defaults', () => {
    expect(audioCloseMessage({ ...DEFAULT_CHAIN_SPEC })).toBeNull()
  })

  it.each([
    ['denoise', { denoise: 'medium' as const }],
    ['hum60', { hum60: true }],
    ['rumbleHighpass', { rumbleHighpass: true }],
    ['deEss', { deEss: true }],
    ['compressor', { compressor: 'voice' as const }],
    ['loudnorm', { loudnorm: true }],
    ['loudnormTargetLufs', { loudnormTargetLufs: -14 }],
    ['gainDb', { gainDb: 3 }]
  ])('names the cleanup settings when %s is edited', (_field, patch) => {
    const message = audioCloseMessage(edited(patch))
    expect(message).toBe('Close this audio? your cleanup settings will be discarded.')
  })

  it('counts cut regions', () => {
    const message = audioCloseMessage(
      edited({ cutRegions: [{ startSec: 1, endSec: 2 }, { startSec: 4, endSec: 5 }] })
    )
    expect(message).toBe('Close this audio? 2 cut region(s) will be discarded.')
  })

  it('names a loaded second track', () => {
    const message = audioCloseMessage(
      edited({
        secondaryTrack: {
          filePath: 'C:/music.mp3',
          fileName: 'music.mp3',
          role: 'music',
          gainDb: -10,
          duckUnderPrimary: true
        }
      })
    )
    expect(message).toBe('Close this audio? the second track will be discarded.')
  })

  it('lists everything at risk when several kinds of edit exist', () => {
    const message = audioCloseMessage(
      edited({ denoise: 'light', cutRegions: [{ startSec: 0, endSec: 1 }] })
    )
    expect(message).toBe(
      'Close this audio? your cleanup settings, 1 cut region(s) will be discarded.'
    )
  })
})

describe('confirmAudioClose', () => {
  it('closes without asking when there is nothing to lose', () => {
    const ask = vi.fn(() => true)
    expect(confirmAudioClose(DEFAULT_CHAIN_SPEC, ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks with the specific message, then closes when accepted', () => {
    const ask = vi.fn(() => true)
    expect(confirmAudioClose(edited({ deEss: true }), ask)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith('Close this audio? your cleanup settings will be discarded.')
  })

  it('REFUSES to close when the confirm is declined (the whole point)', () => {
    // Negative path, per the round-21 protocol: the declined branch is the
    // one that saves the work, so it gets its own specific assertion rather
    // than riding along with the accepted branch.
    const ask = vi.fn(() => false)
    expect(confirmAudioClose(edited({ cutRegions: [{ startSec: 0, endSec: 3 }] }), ask)).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('declining a multi-edit chain still refuses', () => {
    const ask = vi.fn(() => false)
    expect(
      confirmAudioClose(edited({ loudnorm: true, cutRegions: [{ startSec: 1, endSec: 2 }] }), ask)
    ).toBe(false)
  })
})
