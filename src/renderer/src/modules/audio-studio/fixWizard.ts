import type { ChainSpec, CompressorPreset, DenoiseStrength } from '@shared/audio'

/**
 * The Fix Wizard's whole decision, as pure functions (T-90).
 *
 * The summary the user is shown and the settings that get applied used to be
 * two separate pieces of logic that agreed by accident: the summary printed
 * "Highpass + 60 Hz hum reduction: off" for a talking-only recording in a quiet
 * room while Apply turned the highpass ON (it keys off the use as well as the
 * noise). Now there is ONE patch. `fixPatch` builds it, `fixSummary` renders
 * lines from that exact object, and Apply patches that exact object — so the
 * list cannot say anything the apply step does not do (the T-82 keepExpression
 * precedent: one builder, every consumer reads its output).
 */

export interface FixAnswers {
  backgroundNoise: 'none' | 'mild' | 'loud' | null
  echoy: boolean | null
  primaryUse: 'voice' | 'music' | 'mixed' | null
}

export const EMPTY_ANSWERS: FixAnswers = {
  backgroundNoise: null,
  echoy: null,
  primaryUse: null
}

/** What the wizard sets — every field here is shown to the user and applied. */
export type FixPatch = Required<
  Pick<
    ChainSpec,
    | 'denoise'
    | 'hum60'
    | 'rumbleHighpass'
    | 'deEss'
    | 'compressor'
    | 'loudnorm'
    | 'loudnormTargetLufs'
  >
>

export function fixPatch(answers: FixAnswers): FixPatch {
  const denoise: DenoiseStrength =
    answers.backgroundNoise === 'loud'
      ? 'aggressive'
      : answers.backgroundNoise === 'mild'
        ? 'medium'
        : 'off'
  const compressor: CompressorPreset = answers.primaryUse ?? 'voice'
  return {
    denoise,
    hum60: answers.backgroundNoise !== 'none',
    rumbleHighpass: answers.backgroundNoise !== 'none' || answers.primaryUse === 'voice',
    deEss: answers.primaryUse === 'voice' || answers.primaryUse === 'mixed',
    compressor,
    loudnorm: true,
    loudnormTargetLufs: -16
  }
}

const onOff = (on: boolean): string => (on ? 'on' : 'off')

/**
 * One line per setting in the patch, in creator words. Reads ONLY the patch it
 * is given. U+2212 is the minus sign the Levels panel uses for its targets.
 */
export function fixSummary(patch: FixPatch): string[] {
  return [
    patch.denoise === 'off'
      ? 'Quieter background: off'
      : `Quieter background: on (${patch.denoise})`,
    `Low rumble removal: ${onOff(patch.rumbleHighpass)}`,
    `Hum removal: ${onOff(patch.hum60)}`,
    `Softer harsh 's' sounds: ${onOff(patch.deEss)}`,
    `Compressor: ${patch.compressor}`,
    patch.loudnorm
      ? `Even volume: on (target −${Math.abs(patch.loudnormTargetLufs)})`
      : 'Even volume: off'
  ]
}
