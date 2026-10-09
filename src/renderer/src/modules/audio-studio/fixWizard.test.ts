import { describe, it, expect } from 'vitest'
import { EMPTY_ANSWERS, fixPatch, fixSummary, type FixAnswers } from './fixWizard'

/**
 * T-90 — the wizard's summary is the patch it applies.
 *
 * The bug: the list on the final card was computed by its own `noise !== 'none'`
 * expressions while Apply used `fixPatch`'s, and the two disagreed — a talking
 * recording in a quiet room read "Highpass + 60 Hz hum reduction: off" and
 * then switched the highpass ON. These tests run EVERY combination of the three
 * questions and hold each summary line to the patch field it describes.
 */

const NOISE: Array<FixAnswers['backgroundNoise']> = ['none', 'mild', 'loud']
const ECHO: Array<FixAnswers['echoy']> = [false, true]
const USE: Array<FixAnswers['primaryUse']> = ['voice', 'music', 'mixed']

const ALL: FixAnswers[] = NOISE.flatMap((backgroundNoise) =>
  ECHO.flatMap((echoy) => USE.map((primaryUse) => ({ backgroundNoise, echoy, primaryUse })))
)

/** The line for a setting, by its creator-words name. */
function line(lines: string[], name: string): string {
  const hit = lines.find((l) => l.startsWith(`${name}:`))
  if (hit === undefined) throw new Error(`no "${name}" line in ${JSON.stringify(lines)}`)
  return hit
}

describe('fixSummary renders the patch it is given', () => {
  it('covers all 18 answer combinations', () => {
    expect(ALL).toHaveLength(18)
  })

  it.each(ALL.map((a) => [JSON.stringify(a), a] as const))('%s', (_label, answers) => {
    const patch = fixPatch(answers)
    const lines = fixSummary(patch)
    const on = (b: boolean): string => (b ? 'on' : 'off')

    expect(line(lines, 'Low rumble removal')).toBe(`Low rumble removal: ${on(patch.rumbleHighpass)}`)
    expect(line(lines, 'Hum removal')).toBe(`Hum removal: ${on(patch.hum60)}`)
    expect(line(lines, "Softer harsh 's' sounds")).toBe(`Softer harsh 's' sounds: ${on(patch.deEss)}`)
    expect(line(lines, 'Compressor')).toBe(`Compressor: ${patch.compressor}`)
    expect(line(lines, 'Quieter background')).toBe(
      patch.denoise === 'off' ? 'Quieter background: off' : `Quieter background: on (${patch.denoise})`
    )
    expect(line(lines, 'Even volume')).toBe('Even volume: on (target −16)')
  })

  it('says only what the patch says: change one field and exactly its line changes', () => {
    const base = fixPatch({ backgroundNoise: 'none', echoy: false, primaryUse: 'music' })
    const baseLines = fixSummary(base)
    const flipped = fixSummary({ ...base, rumbleHighpass: !base.rumbleHighpass })
    const changed = flipped.filter((l, i) => l !== baseLines[i])
    expect(changed).toEqual([`Low rumble removal: ${base.rumbleHighpass ? 'off' : 'on'}`])
  })
})

describe('the case the old summary got wrong', () => {
  it('talking in a quiet room: the highpass is ON, and the list says so', () => {
    const patch = fixPatch({ backgroundNoise: 'none', echoy: false, primaryUse: 'voice' })
    // The apply step turned it on (voice keys the highpass)…
    expect(patch.rumbleHighpass).toBe(true)
    // …while hum removal stays off for a quiet room — two different answers,
    // which the old combined "Highpass + 60 Hz hum reduction" line could not
    // express at all.
    expect(patch.hum60).toBe(false)
    const lines = fixSummary(patch)
    expect(lines).toContain('Low rumble removal: on')
    expect(lines).toContain('Hum removal: off')
  })

  it('music in a quiet room turns neither on', () => {
    const lines = fixSummary(fixPatch({ backgroundNoise: 'none', echoy: false, primaryUse: 'music' }))
    expect(lines).toContain('Low rumble removal: off')
    expect(lines).toContain('Hum removal: off')
    expect(lines).toContain("Softer harsh 's' sounds: off")
    expect(lines).toContain('Quieter background: off')
    expect(lines).toContain('Compressor: music')
  })
})

describe('the patch itself', () => {
  it('maps the noise answer to a strength', () => {
    expect(fixPatch({ ...EMPTY_ANSWERS, backgroundNoise: 'loud' }).denoise).toBe('aggressive')
    expect(fixPatch({ ...EMPTY_ANSWERS, backgroundNoise: 'mild' }).denoise).toBe('medium')
    expect(fixPatch({ ...EMPTY_ANSWERS, backgroundNoise: 'none' }).denoise).toBe('off')
  })

  it('always evens the volume to -16, the talking/podcast target', () => {
    for (const a of ALL) {
      const p = fixPatch(a)
      expect(p.loudnorm).toBe(true)
      expect(p.loudnormTargetLufs).toBe(-16)
    }
  })

  it('an unanswered use falls back to the voice compressor, as before', () => {
    expect(fixPatch(EMPTY_ANSWERS).compressor).toBe('voice')
  })

  it('has no engineer words in any line it can show', () => {
    const text = ALL.flatMap((a) => fixSummary(fixPatch(a))).join('\n')
    expect(text).not.toMatch(/highpass|de-ess|denoise|loudnorm|LUFS|dBTP|sidechain|\bI'll\b/i)
  })
})
