import { describe, it, expect } from 'vitest'
import { REFRAME_TARGET, reframePhaseLabel, reframeReadout, type ReframePhase } from './reframe'

describe('reframePhaseLabel — plain words for each phase (T-100)', () => {
  const PHASES: Array<[ReframePhase, string]> = [
    ['starting', 'Starting…'],
    ['analyzing', 'Checking the video…'],
    ['rendering', 'Rendering…'],
    ['done', 'Done']
  ]

  it.each(PHASES)('%s reads %s', (phase, label) => {
    expect(reframePhaseLabel(phase)).toBe(label)
  })

  it('never shows the id: not as it is, and not the upper-cased form the panel printed', () => {
    for (const [phase] of PHASES) {
      const label = reframePhaseLabel(phase)
      expect(label).not.toBe(phase.toUpperCase())
      expect(label).toMatch(/^[A-Z][a-z]/)
    }
    // "Done" is a plain word that happens to be the id's; every other phase's
    // label is something else entirely.
    for (const phase of ['starting', 'analyzing', 'rendering'] as const) {
      expect(reframePhaseLabel(phase).toLowerCase()).not.toBe(phase)
    }
  })
})

describe('reframeReadout - the header reads the picture the strip is cut from (T-125 (9))', () => {
  it('no crop: the source\'s own size', () => {
    expect(reframeReadout(1920, 1080, null)).toBe('1920×1080 → 1080×1920')
    expect(reframeReadout(1920, 1080, undefined)).toBe('1920×1080 → 1080×1920')
  })

  it('a crop: the crop\'s size in whole pixels, not the source\'s', () => {
    expect(reframeReadout(1920, 1080, { w: 0.5, h: 2 / 3 })).toBe('960×720 → 1080×1920')
    expect(reframeReadout(640, 360, { w: 0.5, h: 1 })).toBe('320×360 → 1080×1920')
    // Rounded, not truncated: 0.4001 of 1920 is 768.19.
    expect(reframeReadout(1920, 1080, { w: 0.4001, h: 0.5 })).toBe('768×540 → 1080×1920')
  })

  it('a crop that is not a usable size reads as no crop (the renderer must not throw while drawing)', () => {
    expect(reframeReadout(1920, 1080, { w: Number.NaN, h: 0.5 })).toBe('1920×1080 → 1080×1920')
  })

  it('the target is the one the panel and the IPC call send', () => {
    expect(REFRAME_TARGET).toEqual({ width: 1080, height: 1920 })
  })
})
