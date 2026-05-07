import { describe, it, expect } from 'vitest'
import { buildChain, chainEndsWithLoudnorm, parseLoudnormJson } from './chain'
import type { ChainSpec } from '../../shared/audio'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'

function spec(partial: Partial<ChainSpec> = {}): ChainSpec {
  return { ...DEFAULT_CHAIN_SPEC, ...partial }
}

describe('chainEndsWithLoudnorm', () => {
  it('returns true when filter chain ends with a loudnorm stage', () => {
    expect(chainEndsWithLoudnorm('loudnorm=I=-16:TP=-1.5:LRA=11')).toBe(true)
    expect(
      chainEndsWithLoudnorm('highpass=f=80,acompressor=threshold=0.05,loudnorm=I=-16')
    ).toBe(true)
  })

  it('returns false when filter chain does not end with loudnorm', () => {
    expect(chainEndsWithLoudnorm('')).toBe(false)
    expect(chainEndsWithLoudnorm('anull')).toBe(false)
    expect(chainEndsWithLoudnorm('loudnorm=I=-16,volume=2dB')).toBe(false)
  })
})

describe('buildChain — match-loudness double-pass guard (Phase 2.9)', () => {
  it('emits a single loudnorm in pass2 when loudnorm flag is on', () => {
    const result = buildChain(spec({ loudnorm: true, loudnormTargetLufs: -16 }))
    expect(result.needsTwoPass).toBe(true)
    expect(chainEndsWithLoudnorm(result.filterPass2)).toBe(true)
    // Exactly ONE loudnorm in the output — the secondary-track path will
    // detect this and skip its own append.
    const matches = result.filterPass2.match(/loudnorm=/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('emits zero loudnorm stages when loudnorm flag is off', () => {
    const result = buildChain(spec({ loudnorm: false }))
    expect(result.needsTwoPass).toBe(false)
    expect(chainEndsWithLoudnorm(result.filterPass2)).toBe(false)
  })

  it('still emits the cuts/highpass/comp stages in order', () => {
    const result = buildChain(
      spec({
        rumbleHighpass: true,
        denoise: 'medium',
        compressor: 'voice',
        loudnorm: true
      })
    )
    expect(result.filterPass2).toMatch(/highpass=f=80/)
    expect(result.filterPass2).toMatch(/afftdn=nf=-25/)
    expect(result.filterPass2).toMatch(/acompressor=/)
    expect(chainEndsWithLoudnorm(result.filterPass2)).toBe(true)
  })
})

describe('parseLoudnormJson', () => {
  it('parses a complete loudnorm JSON block from stderr', () => {
    const stderr = `[Parsed_loudnorm_0 @ 0x1] {
  "input_i" : "-23.50",
  "input_tp" : "-3.20",
  "input_lra" : "5.10",
  "input_thresh" : "-33.50",
  "target_offset" : "-7.50"
}`
    const m = parseLoudnormJson(stderr)
    expect(m).not.toBeNull()
    expect(m?.input_i).toBe('-23.50')
    expect(m?.target_offset).toBe('-7.50')
  })

  it('returns null on missing or malformed JSON', () => {
    expect(parseLoudnormJson('')).toBeNull()
    expect(parseLoudnormJson('no json here')).toBeNull()
    expect(parseLoudnormJson('{ "input_i": "}')).toBeNull()
    expect(parseLoudnormJson('{ "input_i": "-23" }')).toBeNull() // missing other required keys
  })
})
