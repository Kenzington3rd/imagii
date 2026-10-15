import { describe, it, expect } from 'vitest'
import {
  aselectForCuts,
  keptDurationSec,
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

describe('buildChain — a mono source is measured the way a stereo playback hears it (T-123 (11))', () => {
  // EBU R128 counts a mono file as one channel; every stereo playback of it is dual mono, 3 LU hotter than
  // that measurement says. loudnorm's `dual_mono=true` measures and corrects it as it will be played, and it
  // has to be on BOTH passes: pass 1's `measured_I` and pass 2's gain must agree on what was measured.
  // (Layer 5, "Even volume on a mono source lands on its label", runs the real binary.)
  const MEASURED = {
    input_i: '-23.50',
    input_tp: '-3.20',
    input_lra: '5.10',
    input_thresh: '-33.50',
    target_offset: '-0.12'
  }
  const on = spec({ loudnorm: true, loudnormTargetLufs: -16 })

  it('pass 1 and pass 2 both carry dual_mono=true when the source is mono', () => {
    const pass1 = buildChain(on, undefined, true)
    expect(pass1.filterPass1).toBe('loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json:dual_mono=true')
    const pass2 = buildChain(on, MEASURED, true)
    expect(pass2.filterPass1).toContain(':dual_mono=true')
    expect(pass2.filterPass2).toBe(
      'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-23.50:measured_LRA=5.10:measured_TP=-3.20:' +
        'measured_thresh=-33.50:offset=-0.12:linear=true:print_format=summary:dual_mono=true'
    )
    // The measure pass and the render pass agree on what a measurement is.
    expect((pass1.filterPass1 ?? '').endsWith(':dual_mono=true')).toBe(true)
    expect(pass2.filterPass2.endsWith(':dual_mono=true')).toBe(true)
  })

  it('the single-pass fallback (a silent measurement) carries it too: it is the same loudnorm', () => {
    expect(buildChain(on, undefined, true).filterPass2).toBe(
      'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json:dual_mono=true'
    )
  })

  it('neither pass carries it by default: a stereo source, and the mix path, are unchanged', () => {
    for (const result of [buildChain(on), buildChain(on, undefined, false), buildChain(on, MEASURED), buildChain(on, MEASURED, false)]) {
      expect(result.filterPass1).not.toContain('dual_mono')
      expect(result.filterPass2).not.toContain('dual_mono')
    }
    expect(buildChain(on, undefined, false).filterPass1).toBe('loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json')
  })

  it('with Even volume off there is no loudnorm to set it on, so the flag changes nothing', () => {
    const off = spec({ gainDb: 3 })
    expect(buildChain(off, undefined, true)).toEqual(buildChain(off))
    expect(buildChain(off, undefined, true).filterPass2).toBe('volume=3dB')
  })

  it('it is appended to the loudnorm stage, after the stages that come before it', () => {
    const chain = spec({ loudnorm: true, rumbleHighpass: true, compressor: 'voice' })
    const pass2 = buildChain(chain, MEASURED, true).filterPass2
    expect(pass2.startsWith('highpass=f=80,acompressor=')).toBe(true)
    expect(chainEndsWithLoudnorm(pass2)).toBe(true)
    expect(pass2.match(/dual_mono=true/g)).toHaveLength(1)
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
    expect(denoiseFilter('light')).toBe('afftdn=nf=-35:nr=12')
    expect(denoiseFilter('medium')).toBe('afftdn=nf=-30:nr=18')
    expect(denoiseFilter('aggressive')).toBe('afftdn=nf=-25:nr=24')
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

  describe('a silent input (T-114)', () => {
    // What ffmpeg 7 prints for pass 1 over silence (anullsrc), verbatim: the integrated loudness
    // and true peak are -inf and the offset is inf. Pass 2 hands them back as measured_I/TP and
    // offset, whose ranges are -99..0 / -99..99 / -99..99, and ffmpeg refuses the option
    // ("Value -inf for parameter 'measured_I' out of range") - the export died.
    const silence = `[Parsed_loudnorm_0 @ 0x7fee28002440]
{
\t"input_i" : "-inf",
\t"input_tp" : "-inf",
\t"input_lra" : "0.00",
\t"input_thresh" : "-70.00",
\t"output_i" : "-inf",
\t"output_tp" : "-inf",
\t"output_lra" : "0.00",
\t"output_thresh" : "-70.00",
\t"normalization_type" : "dynamic",
\t"target_offset" : "inf"
}`
    const measured = (over: Record<string, string>): string =>
      JSON.stringify({ input_i: '-23.50', input_tp: '-3.20', input_lra: '5.10', input_thresh: '-33.50', target_offset: '-7.50', ...over })

    it('is no measurement at all: the caller falls back to single-pass loudnorm', () => {
      expect(parseLoudnormJson(silence)).toBeNull()
    })

    it.each([
      ['input_i', '-inf'],
      ['input_tp', '-inf'],
      ['input_tp', 'inf'],
      ['input_lra', 'inf'],
      ['input_thresh', '-inf'],
      ['target_offset', 'inf'],
      ['target_offset', '-inf'],
      ['input_i', 'nan'],
      ['input_i', 'NaN'],
      ['input_i', 'Infinity'],
      ['input_i', 'not a number']
    ])('%s = %j alone makes the whole measurement unusable', (field, value) => {
      expect(parseLoudnormJson(measured({ [field]: value }))).toBeNull()
    })

    it('a loud-but-ordinary block, zeros and large negatives still parse (only non-finite is refused)', () => {
      expect(parseLoudnormJson(measured({}))).not.toBeNull()
      expect(parseLoudnormJson(measured({ input_i: '-99.00', input_lra: '0.00', target_offset: '0.00' }))).toMatchObject({
        input_i: '-99.00',
        input_lra: '0.00',
        target_offset: '0.00'
      })
      expect(parseLoudnormJson(measured({ input_tp: '0.00', target_offset: '12.34' }))).not.toBeNull()
    })

    it('a measurement it accepts is one pass 2 can hand back: finite numbers in every field', () => {
      const m = parseLoudnormJson(measured({}))
      for (const v of Object.values(m ?? {})) expect(Number.isFinite(Number(v))).toBe(true)
    })
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

  it('writes the audio cut as asetnsamples/aselect/asetpts: the sound is re-chunked to 256 samples BEFORE the select (T-124 (32))', () => {
    expect(audioCut(one)).toBe(
      "asetnsamples=n=256:p=0,aselect='not(between(t\\,4.000\\,7.000))',asetpts=N/SR/TB,asetnsamples=n=4096:p=0"
    )
    expect(audioCut(two)).toBe(
      "asetnsamples=n=256:p=0,aselect='not(between(t\\,2.000\\,3.500)+between(t\\,10.250\\,13.000))',asetpts=N/SR/TB,asetnsamples=n=4096:p=0"
    )
  })

  it('the 256 grid does not leak: the cut ends by re-chunking to 4096, AFTER the retime and not before the select (T-125 (5))', () => {
    // asetnsamples re-chunks every stage behind it, and a chained cut export ran 1.7-2.3x slower on 256-sample frames.
    const stages = (aselectForCuts(one) as string).split(/(?<!\\),/)
    expect(stages).toEqual([
      'asetnsamples=n=256:p=0',
      "aselect='not(between(t\\,4.000\\,7.000))'",
      'asetpts=N/SR/TB',
      'asetnsamples=n=4096:p=0'
    ])
    // The order is the whole claim: 256 ahead of the select (the cut's grid), the retime after it, 4096 last (the rest of the chain's).
    expect(stages.findIndex((x) => x === 'asetnsamples=n=4096:p=0')).toBeGreaterThan(stages.findIndex((x) => x === 'asetpts=N/SR/TB'))
    expect(stages.filter((x) => x.startsWith('asetnsamples=n=256'))).toHaveLength(1)
    // Both are unpadded (`p=0`): the last short frame is not filled with silence, so the file's length is unchanged.
    expect(stages.filter((x) => x.startsWith('asetnsamples='))).toEqual(['asetnsamples=n=256:p=0', 'asetnsamples=n=4096:p=0'])
    // And whatever follows the cut in a chain follows the 4096 stage.
    const chain = buildChain(spec({ cutRegions: one, rumbleHighpass: true })).filterPass2
    expect(chain.indexOf('asetnsamples=n=4096:p=0')).toBeGreaterThan(-1)
    expect(chain.indexOf('asetnsamples=n=4096:p=0')).toBeLessThan(chain.indexOf('highpass='))
  })

  it('the re-chunk is the first stage of the cut, sits ahead of the select that would otherwise cut on the decoder\'s block, and is not padded (T-124 (32))', () => {
    const stage = aselectForCuts(one) as string
    const stages = stage.split(/(?<!\\),/) // the commas inside the expression are escaped (\\,), so this is the stage list
    expect(stages[0]).toBe('asetnsamples=n=256:p=0')
    expect(stages.findIndex((x) => x.startsWith('aselect='))).toBe(1)
    // The cut is the FIRST thing a chain does to the sound; what follows it sees 4096-sample frames again (T-125 (5), pinned above).
    expect(audioCut(one).startsWith('asetnsamples=n=256:p=0,aselect=')).toBe(true)
    // No cut, no stage: a chain without cuts is not re-chunked.
    expect(aselectForCuts([])).toBeNull()
    expect(audioCut([])).not.toContain('asetnsamples')
  })

  it('writes the picture cut as select/settb/setpts over the same regions, closing each gap by the time it took (T-121, T-123)', () => {
    expect(vselectForCuts(one)).toBe(
      "select='not(between(t\\,4.000\\,7.000))',settb=AVTB,setpts='PTS-(max(0\\,min(T\\,7.000)-4.000))/TB'"
    )
    expect(vselectForCuts(two)).toBe(
      "select='not(between(t\\,2.000\\,3.500)+between(t\\,10.250\\,13.000))',settb=AVTB," +
        "setpts='PTS-(max(0\\,min(T\\,3.500)-2.000)+max(0\\,min(T\\,13.000)-10.250))/TB'"
    )
  })

  it('puts a microsecond time base between select and setpts: an AVI\'s 1/fps base would round the retimed stamp itself (T-123 (12))', () => {
    // setpts writes the stamp in the time base of the frames it was handed. An AVI's video stream has 1/fps, so
    // 3.3083 s was rounded onto the 24 fps grid (3.2917 s, a frame that is already there) INSIDE the filter, before any
    // encoder option could matter. settb comes after select (which keeps the source base) and before setpts.
    for (const cuts of [one, two]) {
      const stage = vselectForCuts(cuts) ?? ''
      const at = (needle: string): number => stage.indexOf(needle)
      expect(at('select=')).toBeGreaterThanOrEqual(0)
      expect(at('settb=AVTB')).toBeGreaterThan(at('select='))
      expect(at('setpts=')).toBeGreaterThan(at('settb=AVTB'))
      expect(stage.match(/settb=/g)).toHaveLength(1)
    }
  })

  it('never renumbers the survivors at a frame rate: a container that reads 1000/1 cannot collapse the picture (T-121)', () => {
    for (const cuts of [one, two]) {
      const stage = vselectForCuts(cuts) ?? ''
      expect(stage).not.toContain('FRAME_RATE')
      expect(stage).not.toMatch(/setpts=N\b/)
    }
  })

  describe('the shift counts every removed second once', () => {
    /** The expression inside `setpts='PTS-(...)/TB'`. */
    const shiftOf = (cuts: ChainSpec['cutRegions']): string | undefined =>
      /setpts='PTS-\((.*)\)\/TB'/.exec(vselectForCuts(cuts) ?? '')?.[1]
    const span = (end: string, start: string): string => `max(0\\,min(T\\,${end})-${start})`

    it('overlapping regions (widening a cut by dragging over it) are one span', () => {
      expect(shiftOf([{ startSec: 4, endSec: 7 }, { startSec: 6, endSec: 9 }])).toBe(span('9.000', '4.000'))
    })

    it('touching regions are one span', () => {
      expect(shiftOf([{ startSec: 4, endSec: 7 }, { startSec: 7, endSec: 9 }])).toBe(span('9.000', '4.000'))
    })

    it('a region inside another adds nothing', () => {
      expect(shiftOf([{ startSec: 2, endSec: 10 }, { startSec: 4, endSec: 5 }])).toBe(span('10.000', '2.000'))
    })

    it('regions in any order read in time order', () => {
      expect(shiftOf([{ startSec: 10, endSec: 12 }, { startSec: 1, endSec: 2 }])).toBe(
        `${span('2.000', '1.000')}+${span('12.000', '10.000')}`
      )
    })

    it('a region that starts before the file counts from its start', () => {
      expect(shiftOf([{ startSec: -2, endSec: 3 }])).toBe(span('3.000', '0.000'))
    })

    it('a region wholly before the file removes nothing and still parses (0, never an empty group)', () => {
      expect(shiftOf([{ startSec: -3, endSec: -1 }])).toBe('0')
    })

    it('the keep-expression still names every region as given, so sound and picture drop the same frames', () => {
      const cuts = [{ startSec: 6, endSec: 9 }, { startSec: 4, endSec: 7 }]
      expect(keepOf(vselectForCuts(cuts) ?? '')).toBe(keepOf(audioCut(cuts)))
    })
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

describe('keptDurationSec - what an audio export writes (T-125 (6))', () => {
  it('the source\'s length less the cuts', () => {
    expect(keptDurationSec(300, [])).toBe(300)
    expect(keptDurationSec(300, [{ startSec: 50, endSec: 150 }])).toBe(200)
    expect(keptDurationSec(300, [{ startSec: 10, endSec: 20 }, { startSec: 100, endSec: 130 }])).toBe(260)
  })

  it('overlapping, touching and out-of-order cuts are one span, counted once', () => {
    expect(keptDurationSec(300, [{ startSec: 80, endSec: 150 }, { startSec: 50, endSec: 100 }])).toBe(200)
    expect(keptDurationSec(300, [{ startSec: 10, endSec: 20 }, { startSec: 20, endSec: 30 }])).toBe(280)
    expect(keptDurationSec(300, [{ startSec: 10, endSec: 100 }, { startSec: 20, endSec: 30 }])).toBe(210)
  })

  it('a cut that begins before the file or runs past its end removes only what is there', () => {
    expect(keptDurationSec(300, [{ startSec: -20, endSec: 10 }])).toBe(290)
    expect(keptDurationSec(300, [{ startSec: 250, endSec: 400 }])).toBe(250)
    expect(keptDurationSec(300, [{ startSec: 400, endSec: 500 }])).toBe(300)
  })

  it('a reversed or empty region removes nothing, and a chain that cuts it all still divides by something', () => {
    expect(keptDurationSec(300, [{ startSec: 100, endSec: 100 }, { startSec: 200, endSec: 150 }])).toBe(300)
    expect(keptDurationSec(300, [{ startSec: 0, endSec: 300 }])).toBe(0.1)
  })
})
