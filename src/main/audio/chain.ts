import type { ChainSpec, CompressorPreset, DenoiseStrength } from '../../shared/audio'

function denoiseFilter(strength: DenoiseStrength): string | null {
  switch (strength) {
    case 'off':
      return null
    case 'light':
      return 'afftdn=nf=-20'
    case 'medium':
      return 'afftdn=nf=-25'
    case 'aggressive':
      return 'afftdn=nf=-35'
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
    baseFilters.push('highpass=f=70')
    baseFilters.push('lowpass=f=10000')
  }

  const dn = denoiseFilter(spec.denoise)
  if (dn) baseFilters.push(dn)

  if (spec.deEss) {
    baseFilters.push('equalizer=f=6500:t=q:w=1.5:g=-6')
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
