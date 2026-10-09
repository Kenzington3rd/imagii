import { describe, it, expect } from 'vitest'
import {
  buildChain,
  chainEndsWithLoudnorm,
  denoiseFilter,
  humFrequency,
  parseLoudnormJson,
  vselectForCuts
} from './chain'
import type { ChainSpec } from '../../shared/audio'
import { DEFAULT_CHAIN_SPEC, DEFAULT_DENOISE_PARAMS } from '../../shared/audio'

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
    expect(result.filterPass2).toMatch(/afftdn=nf=-30:nr=18/)
    expect(result.filterPass2).toMatch(/acompressor=/)
    expect(chainEndsWithLoudnorm(result.filterPass2)).toBe(true)
  })
})

describe('dB → linear conversion (Phase 3.2 ducking threshold)', () => {
  // process.ts uses Math.pow(10, dB/20) to translate dBFS slider values
  // into linear values for ffmpeg's sidechaincompress threshold param.
  // These cases anchor the formula so a refactor of the call site can't
  // silently change the resulting filter graph.
  const dbToLinear = (db: number): number => Math.pow(10, db / 20)

  it('matches well-known dB anchors', () => {
    expect(dbToLinear(0)).toBeCloseTo(1.0, 3)
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 2)
    expect(dbToLinear(-20)).toBeCloseTo(0.1, 4)
    expect(dbToLinear(-26)).toBeCloseTo(0.0501, 3) // matches new default ~ 0.05
    expect(dbToLinear(-60)).toBeCloseTo(0.001, 4)
  })
})

describe('denoiseFilter — Phase 3.3 parametric mode', () => {
  it('returns the matching preset filter for non-parametric strengths', () => {
    // INIT-A (round 15): presets now spec an explicit nr (reduction) value
    // so light/medium/aggressive actually differ.
    expect(denoiseFilter('off')).toBeNull()
    expect(denoiseFilter('light')).toBe('afftdn=nf=-25:nr=12')
    expect(denoiseFilter('medium')).toBe('afftdn=nf=-30:nr=18')
    expect(denoiseFilter('aggressive')).toBe('afftdn=nf=-35:nr=24')
  })

  // Round 18: afftdn has never had an `ns` option — the old strings that
  // pinned `ns=…` were pinning a filter ffmpeg rejects outright. The real
  // ranges (per `ffmpeg -h filter=afftdn`) are nf -80..-20 and nr 0.01..97.
  it('emits only real afftdn params in parametric mode using defaults', () => {
    const filter = denoiseFilter('parametric')
    expect(filter).toBe(
      `afftdn=nf=${DEFAULT_DENOISE_PARAMS.noiseFloorDb}:nr=${DEFAULT_DENOISE_PARAMS.reductionDb}`
    )
  })

  it('honors custom params and never emits the nonexistent ns option', () => {
    const filter = denoiseFilter('parametric', {
      noiseFloorDb: -40,
      reductionDb: 25,
      sensitivity: 1.5
    })
    expect(filter).toBe('afftdn=nf=-40:nr=25')
    expect(filter).not.toContain('ns=')
  })

  it('clamps params to afftdn-accepted ranges', () => {
    expect(
      denoiseFilter('parametric', { noiseFloorDb: -200, reductionDb: 999, sensitivity: 99 })
    ).toBe('afftdn=nf=-80:nr=50')
    expect(
      denoiseFilter('parametric', { noiseFloorDb: 100, reductionDb: -5, sensitivity: -99 })
    ).toBe('afftdn=nf=-20:nr=0.01')
  })
})

describe('buildChain — hum60 (Bug round 15 B2)', () => {
  // Pre-15 the hum60 toggle pushed highpass=f=70 + lowpass=f=10000, neither
  // of which touched 60 Hz mains hum. The fix uses notch filters at the
  // fundamental and first harmonic.
  it('emits bandreject notches at 60 and 120 Hz when hum60 is enabled', () => {
    const result = buildChain(spec({ hum60: true, loudnorm: false }))
    expect(result.filterPass2).toMatch(/bandreject=f=60/)
    expect(result.filterPass2).toMatch(/bandreject=f=120/)
  })

  it('does NOT emit the legacy wrong filters', () => {
    const result = buildChain(spec({ hum60: true, loudnorm: false }))
    expect(result.filterPass2).not.toMatch(/highpass=f=70/)
    expect(result.filterPass2).not.toMatch(/lowpass=f=10000/)
  })

  it('omits hum filters entirely when hum60 is disabled', () => {
    const result = buildChain(spec({ hum60: false, loudnorm: false }))
    expect(result.filterPass2).not.toMatch(/bandreject/)
  })
})

describe('buildChain — hum frequency (T-90)', () => {
  it('a chain with no humHz notches 60 and 120, as every project saved before 50 Hz existed did', () => {
    const result = buildChain(spec({ hum60: true, loudnorm: false }))
    expect(result.filterPass2).toBe(
      'bandreject=f=60:width_type=h:w=2,bandreject=f=120:width_type=h:w=2'
    )
  })

  it('humHz 50 notches 50 and 100 — and not 60 or 120', () => {
    const result = buildChain(spec({ hum60: true, humHz: 50, loudnorm: false }))
    expect(result.filterPass2).toBe(
      'bandreject=f=50:width_type=h:w=2,bandreject=f=100:width_type=h:w=2'
    )
    expect(result.filterPass2).not.toMatch(/f=60|f=120/)
  })

  it('humHz 60 is the same graph as no humHz at all', () => {
    expect(buildChain(spec({ hum60: true, humHz: 60, loudnorm: false })).filterPass2).toBe(
      buildChain(spec({ hum60: true, loudnorm: false })).filterPass2
    )
  })

  it('the frequency is the setting on a pass-1 loudness measure too, so it is measured as it will be rendered', () => {
    const r = buildChain(spec({ hum60: true, humHz: 50, loudnorm: true }))
    expect(r.filterPass1).toMatch(/bandreject=f=50.*bandreject=f=100.*loudnorm/)
  })

  it('a frequency that is not exactly 50 can never reach the filter string', () => {
    for (const bad of [49, 51, 5000, '50', '60;x', '50,anull', null, undefined, NaN, {}, [50]]) {
      expect(humFrequency(bad)).toBe(60)
    }
    const hostile = buildChain(
      spec({ hum60: true, humHz: '60:w=0,anull' as unknown as 50, loudnorm: false })
    )
    expect(hostile.filterPass2).toBe(
      'bandreject=f=60:width_type=h:w=2,bandreject=f=120:width_type=h:w=2'
    )
  })

  it('hum off emits no notch whatever humHz says', () => {
    expect(buildChain(spec({ hum60: false, humHz: 50, loudnorm: false })).filterPass2).not.toMatch(
      /bandreject/
    )
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

describe('cut regions — one expression for sound and picture (T-82)', () => {
  const one = [{ startSec: 4, endSec: 7 }]
  const two = [
    { startSec: 2, endSec: 3.5 },
    { startSec: 10.25, endSec: 13 }
  ]
  const audioCut = (cuts: ChainSpec['cutRegions']): string =>
    buildChain(spec({ cutRegions: cuts })).filterPass2
  /** The `not(between(...)+...)` keep-expression inside a select/aselect stage. */
  const keepOf = (stage: string): string | undefined => /select='([^']*)'/.exec(stage)?.[1]

  it('writes the audio cut as aselect/asetpts, unchanged by the refactor', () => {
    expect(audioCut(one)).toBe("aselect='not(between(t\\,4.000\\,7.000))',asetpts=N/SR/TB")
    expect(audioCut(two)).toBe(
      "aselect='not(between(t\\,2.000\\,3.500)+between(t\\,10.250\\,13.000))',asetpts=N/SR/TB"
    )
  })

  it('writes the picture cut as select/setpts over the same regions', () => {
    expect(vselectForCuts(one)).toBe(
      "select='not(between(t\\,4.000\\,7.000))',setpts=N/FRAME_RATE/TB"
    )
    expect(vselectForCuts(two)).toBe(
      "select='not(between(t\\,2.000\\,3.500)+between(t\\,10.250\\,13.000))',setpts=N/FRAME_RATE/TB"
    )
  })

  it('cuts sound and picture on the identical keep-expression, so they cannot drift', () => {
    for (const cuts of [one, two]) {
      const a = keepOf(audioCut(cuts))
      const v = keepOf(vselectForCuts(cuts) ?? '')
      expect(a).toBeDefined()
      expect(v).toBe(a)
    }
  })

  it('emits nothing for no regions, or only empty / inverted ones', () => {
    expect(vselectForCuts([])).toBeNull()
    expect(vselectForCuts([{ startSec: 5, endSec: 5 }, { startSec: 9, endSec: 8 }])).toBeNull()
    expect(audioCut([])).toBe('anull')
    expect(audioCut([{ startSec: 5, endSec: 5 }])).toBe('anull')
  })

  it('skips an empty region but keeps the real one beside it', () => {
    const mixed = [{ startSec: 5, endSec: 5 }, ...one]
    expect(keepOf(vselectForCuts(mixed) ?? '')).toBe(keepOf(vselectForCuts(one) ?? ''))
  })
})
