import type {
  ChainSpec,
  CompressorPreset,
  DenoiseParams,
  DenoiseStrength
} from '../../shared/audio'
import { DEFAULT_DENOISE_PARAMS } from '../../shared/audio'

export function denoiseFilter(
  strength: DenoiseStrength,
  params?: DenoiseParams
): string | null {
  switch (strength) {
    case 'off':
      return null
    // INIT-A (round 15): the prior light/medium/aggressive presets emitted
    // afftdn=nf=… alone — leaving the noise-reduction amount at ffmpeg's
    // default of 12 dB regardless of strength. Spec the nr (reduction)
    // explicitly so the user-visible "aggressive" actually behaves
    // differently from "light".
    case 'light':
      return 'afftdn=nf=-25:nr=12'
    case 'medium':
      return 'afftdn=nf=-30:nr=18'
    case 'aggressive':
      return 'afftdn=nf=-35:nr=24'
    case 'parametric': {
      const p = params ?? DEFAULT_DENOISE_PARAMS
      // Clamp the user-controllable values to afftdn's REAL accepted ranges
      // (verified against `ffmpeg -h filter=afftdn`): nf is -80..-20 (the
      // prior -10 ceiling let a third of the slider produce an out-of-range
      // value ffmpeg rejects), and nr's floor is 0.01, not 0. The prior
      // string also appended `ns=…` — afftdn has never had an `ns` option,
      // so every parametric export failed at graph-parse time. The
      // DenoiseParams.sensitivity field is retained for stored-preset
      // compatibility but no longer emitted.
      const nf = Math.max(-80, Math.min(-20, p.noiseFloorDb))
      const nr = Math.max(0.01, Math.min(50, p.reductionDb))
      return `afftdn=nf=${nf}:nr=${nr}`
    }
  }
}

function compressorFilter(preset: CompressorPreset): string | null {
  switch (preset) {
    case 'off':
      return null
    case 'voice':
      return 'acompressor=threshold=0.05:ratio=4:attack=20:release=250:makeup=2'
    case 'music':
      return 'acompressor=threshold=0.1:ratio=2:attack=20:release=500:makeup=1'
    case 'mixed':
      return 'acompressor=threshold=0.08:ratio=3:attack=20:release=300:makeup=1.5'
  }
}

function aselectForCuts(cuts: ChainSpec['cutRegions']): string | null {
  if (cuts.length === 0) return null
  const conditions = cuts
    .filter((c) => c.endSec > c.startSec)
    .map((c) => `between(t\\,${c.startSec.toFixed(3)}\\,${c.endSec.toFixed(3)})`)
  if (conditions.length === 0) return null
  return `aselect='not(${conditions.join('+')})',asetpts=N/SR/TB`
}

function loudnormFilter(targetLufs: number, measured?: LoudnormMeasurement): string {
  // INIT-A (round 15): keep -1.5 dBTP as the safe default — Spotify/YouTube
  // recommend -1.0 dBTP but a small inter-sample peak overhead protects
  // against codec rounding on the playback side. Users delivering ONLY to
  // streaming targets can override via a future custom-target slider.
  const base = `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`
  if (!measured) return `${base}:print_format=json`
  return [
    base,
    `measured_I=${measured.input_i}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    `linear=true`,
    `print_format=summary`
  ].join(':')
}

export interface LoudnormMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

export interface ChainBuildResult {
  filterPass1: string | null
  filterPass2: string
  needsTwoPass: boolean
}

export function buildChain(
  spec: ChainSpec,
  measurement?: LoudnormMeasurement
): ChainBuildResult {
  const baseFilters: string[] = []

  const cuts = aselectForCuts(spec.cutRegions)
  if (cuts) baseFilters.push(cuts)

  if (spec.rumbleHighpass) baseFilters.push('highpass=f=80')

  if (spec.hum60) {
    // B2 fix (round 15): the previous highpass+lowpass pair did NOT touch the
    // 60 Hz mains-hum fundamental at all — the label was a lie and the
    // lowpass dulled voice. Mains hum is a narrow tone, so a bandreject
    // (notch) at the fundamental AND first harmonic is the correct filter.
    // width_type=h:w=2 = 2 Hz wide, which kills hum without audibly
    // hollowing nearby vocal content.
    baseFilters.push('bandreject=f=60:width_type=h:w=2')
    baseFilters.push('bandreject=f=120:width_type=h:w=2')
  }

  const dn = denoiseFilter(spec.denoise, spec.denoiseParams)
  if (dn) baseFilters.push(dn)

  if (spec.deEss) {
    // Round 18: use ffmpeg's dedicated dynamic de-esser instead of a
    // permanent -6 dB EQ notch at 6.5 kHz. The static cut dulled voice
    // during non-sibilant passages while letting loud esses through —
    // the same "related-sounding filter isn't the right filter" failure
    // the round-15 hum60 fix called out. deesser's i/m/f are normalized
    // 0..1: intensity 0.15 with max 0.5 tames esses without lisping.
    baseFilters.push('deesser=i=0.15:m=0.5:f=0.5')
  }

  const comp = compressorFilter(spec.compressor)
  if (comp) baseFilters.push(comp)

  if (spec.gainDb !== 0) {
    baseFilters.push(`volume=${spec.gainDb}dB`)
  }

  const filterPass2Parts = [...baseFilters]
  if (spec.loudnorm) {
    filterPass2Parts.push(loudnormFilter(spec.loudnormTargetLufs, measurement))
  }

  let filterPass1: string | null = null
  if (spec.loudnorm) {
    filterPass1 = [...baseFilters, loudnormFilter(spec.loudnormTargetLufs)].join(',')
  }

  return {
    filterPass1,
    filterPass2: filterPass2Parts.length > 0 ? filterPass2Parts.join(',') : 'anull',
    needsTwoPass: spec.loudnorm
  }
}

/**
 * True iff the trailing filter in `filterChain` is a `loudnorm=…` segment.
 * Used by the secondary-track match-loudness path to skip a redundant
 * second loudnorm append when buildChain has already emitted one (which
 * happens whenever ChainSpec.loudnorm is enabled).
 *
 * The filter graph uses comma-separated stages — split on the last
 * comma-or-start and check the final stage's name.
 */
export function chainEndsWithLoudnorm(filterChain: string): boolean {
  if (filterChain.length === 0) return false
  const lastComma = filterChain.lastIndexOf(',')
  const lastStage = lastComma === -1 ? filterChain : filterChain.slice(lastComma + 1)
  return lastStage.startsWith('loudnorm=')
}

export function parseLoudnormJson(stderrOutput: string): LoudnormMeasurement | null {
  const start = stderrOutput.lastIndexOf('{')
  const end = stderrOutput.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const obj = JSON.parse(stderrOutput.slice(start, end + 1)) as Record<string, string | undefined>
    const i = obj.input_i
    const tp = obj.input_tp
    const lra = obj.input_lra
    const thresh = obj.input_thresh
    const offset = obj.target_offset
    if (!i || !tp || !lra || !thresh || !offset) return null
    return { input_i: i, input_tp: tp, input_lra: lra, input_thresh: thresh, target_offset: offset }
  } catch {
    return null
  }
}
