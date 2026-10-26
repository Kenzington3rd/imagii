import { describe, it, expect, vi } from 'vitest'
import type { ChainSpec } from '@shared/audio'
import { DEFAULT_CHAIN_SPEC } from '@shared/audio'
import { audioCloseMessage, confirmAudioClose } from './AudioStudio'
import { confirmReplaceAfterWait } from './audioClose'

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
    expect(message).toBe('Close this audio? Your cleanup settings will be discarded.')
  })

  it('counts cut regions', () => {
    const message = audioCloseMessage(
      edited({ cutRegions: [{ startSec: 1, endSec: 2 }, { startSec: 4, endSec: 5 }] })
    )
    expect(message).toBe('Close this audio? 2 cuts will be discarded.')
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
    expect(message).toBe('Close this audio? The second track will be discarded.')
  })

  it('lists everything at risk when several kinds of edit exist — as a sentence, not a comma splice (T-113)', () => {
    const message = audioCloseMessage(
      edited({ denoise: 'light', cutRegions: [{ startSec: 0, endSec: 1 }] })
    )
    expect(message).toBe(
      'Close this audio? Your cleanup settings and 1 cut will be discarded.'
    )
  })

  it('three things read "A, B and C"', () => {
    const message = audioCloseMessage(
      edited({
        denoise: 'light',
        cutRegions: [{ startSec: 0, endSec: 1 }, { startSec: 2, endSec: 3 }],
        secondaryTrack: {
          filePath: 'C:/music.mp3',
          fileName: 'music.mp3',
          role: 'music',
          gainDb: -10,
          duckUnderPrimary: true
        }
      })
    )
    expect(message).toBe(
      'Close this audio? Your cleanup settings, 2 cuts and the second track will be discarded.'
    )
  })
})

// T-121: a chain from an older build is a chain with FEWER KEYS, not one with the default's values. The close
// question named things that were never there: `secondaryTrack` is optional (`undefined !== null` read as "there
// is a second track") and every switch added since a project was saved compared `undefined` to its default.
describe('audioCloseMessage - a chain that lacks keys is not a chain with edits (T-121)', () => {
  /** The chain as a project saved before the second track existed: no `secondaryTrack` key at all. */
  const withoutKeys = (...keys: Array<keyof ChainSpec>): ChainSpec => {
    const chain: Partial<ChainSpec> = { ...DEFAULT_CHAIN_SPEC }
    for (const key of keys) delete chain[key]
    return chain as ChainSpec
  }

  it('no secondaryTrack key: there is no second track to discard', () => {
    expect(audioCloseMessage(withoutKeys('secondaryTrack'))).toBeNull()
    expect(audioCloseMessage(edited({ secondaryTrack: undefined }))).toBeNull()
    expect(audioCloseMessage({ ...DEFAULT_CHAIN_SPEC, secondaryTrack: null })).toBeNull()
  })

  it('no secondaryTrack key beside a real edit: the question names the edit and not a second track', () => {
    const chain = { ...withoutKeys('secondaryTrack'), cutRegions: [{ startSec: 1, endSec: 2 }] }
    expect(audioCloseMessage(chain)).toBe('Close this audio? 1 cut will be discarded.')
  })

  it.each(['hum60', 'rumbleHighpass', 'deEss', 'compressor', 'loudnorm', 'denoise'] as const)(
    'a chain without %s is the default for it, so untouched audio asks nothing',
    (key) => {
      expect(audioCloseMessage(withoutKeys(key))).toBeNull()
      expect(audioCloseMessage(withoutKeys(key), 'replace')).toBeNull()
    }
  )

  it('every optional key missing at once is still untouched audio', () => {
    expect(audioCloseMessage(withoutKeys('hum60', 'rumbleHighpass', 'deEss', 'compressor', 'loudnorm', 'denoise', 'secondaryTrack'))).toBeNull()
  })

  it('a missing key beside an edited one does not change what is named', () => {
    const chain = { ...withoutKeys('deEss', 'secondaryTrack'), loudnorm: true }
    expect(audioCloseMessage(chain)).toBe('Close this audio? Your cleanup settings will be discarded.')
  })

  it('a real second track and a real edit are still named (the guard did not widen into silence)', () => {
    const chain = edited({
      denoise: 'light',
      secondaryTrack: { filePath: 'C:/music.mp3', fileName: 'music.mp3', role: 'music', gainDb: -10, duckUnderPrimary: true }
    })
    expect(audioCloseMessage(chain)).toBe('Close this audio? Your cleanup settings and the second track will be discarded.')
  })
})

// T-113: Video Studio's "Clean audio" REPLACES the audio Audio Studio holds. It borrowed
// Close's question word for word — "Close this audio?" — when nothing is being closed and the
// person pressed a button on a video. The question is the same list of what would be lost,
// with a lead-in that says what is about to happen.
describe('audioCloseMessage — the lead-in names the act (T-113)', () => {
  it('Clean audio asks "Replace the audio you\'re editing?" over the same list', () => {
    const message = audioCloseMessage(
      edited({ denoise: 'light', cutRegions: [{ startSec: 0, endSec: 1 }, { startSec: 2, endSec: 3 }] }),
      'replace'
    )
    expect(message).toBe("Replace the audio you're editing? Your cleanup settings and 2 cuts will be discarded.")
  })

  it('and still asks nothing when nothing is at risk', () => {
    expect(audioCloseMessage(DEFAULT_CHAIN_SPEC, 'replace')).toBeNull()
  })

  it('Close, by default and by name, keeps its words', () => {
    const chain = edited({ cutRegions: [{ startSec: 0, endSec: 3 }] })
    expect(audioCloseMessage(chain)).toBe('Close this audio? 1 cut will be discarded.')
    expect(audioCloseMessage(chain, 'close')).toBe(audioCloseMessage(chain))
  })

  it('confirmAudioClose passes the lead through to the question it asks', () => {
    const ask = vi.fn().mockReturnValue(false)
    expect(confirmAudioClose(edited({ deEss: true }), ask, 'replace')).toBe(false)
    expect(ask).toHaveBeenCalledWith("Replace the audio you're editing? Your cleanup settings will be discarded.")
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
    expect(ask).toHaveBeenCalledWith('Close this audio? Your cleanup settings will be discarded.')
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

// T-133 (6): Clean audio asks "Replace the audio you're editing?" ONCE, before an extraction that takes minutes on a long recording, and
// `replacedSince` only notices a different FILE. Work tuned in Audio Studio during the wait was replaced without a word (loadSource resets
// the chain and the undo history with it: no way back), against the guide's "asks first". After the wait the question is asked again
// when the chain is no longer the one the person said yes about; one they already agreed to lose is not asked about twice.
describe('confirmReplaceAfterWait - what was tuned while the extraction ran is asked about (T-133 (6))', () => {
  const tuned = edited({ denoise: 'medium' })

  it('the chain the person already agreed to lose (or the untouched one) is not asked about again', () => {
    const ask = vi.fn(() => false)
    expect(confirmReplaceAfterWait(tuned, tuned, ask)).toBe(true)
    expect(confirmReplaceAfterWait(DEFAULT_CHAIN_SPEC, DEFAULT_CHAIN_SPEC, ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('work tuned during the wait on a clean chain: asked, with the same list and lead-in as before the wait', () => {
    const ask = vi.fn(() => true)
    expect(confirmReplaceAfterWait(DEFAULT_CHAIN_SPEC, tuned, ask)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith("Replace the audio you're editing? Your cleanup settings will be discarded.")
  })

  it('declined: the sound is not put in over the work (the whole point)', () => {
    const ask = vi.fn(() => false)
    expect(confirmReplaceAfterWait(DEFAULT_CHAIN_SPEC, edited({ cutRegions: [{ startSec: 1, endSec: 2 }] }), ask)).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('more work on top of work they agreed to lose is new work: asked again, over the whole of it', () => {
    const ask = vi.fn(() => false)
    expect(confirmReplaceAfterWait(tuned, edited({ denoise: 'medium', cutRegions: [{ startSec: 1, endSec: 2 }] }), ask)).toBe(false)
    expect(ask).toHaveBeenCalledWith("Replace the audio you're editing? Your cleanup settings and 1 cut will be discarded.")
  })

  it('work tuned and then undone back to nothing during the wait has nothing to lose: no question', () => {
    const ask = vi.fn(() => false)
    expect(confirmReplaceAfterWait(tuned, { ...DEFAULT_CHAIN_SPEC }, ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })
})
