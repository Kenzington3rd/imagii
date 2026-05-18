import { describe, it, expect } from 'vitest'
import { defaultExportScale } from './ExportDialog'

/**
 * Resolution-fragility regression: previously the ExportDialog defaulted
 * to scale=1 regardless of the user's monitor DPR. On a 4K monitor at
 * 200% Windows scaling, devicePixelRatio is 2 — meaning the canvas the
 * user SEES at 1× is internally rendered at 2× — and yet the default
 * export was 1×, producing a half-size PNG relative to what they saw on
 * screen. This helper picks a sensible scale per DPR; the picker still
 * lets the user override.
 */
describe('defaultExportScale', () => {
  it('returns 1× on standard 1080p monitors (DPR 1.0)', () => {
    expect(defaultExportScale(1)).toBe(1)
  })

  it('returns 1× on slightly-scaled 1440p (DPR ~1.25-1.5)', () => {
    expect(defaultExportScale(1.25)).toBe(1)
    expect(defaultExportScale(1.5)).toBe(1)
  })

  it('returns 2× on common 4K-at-200% setups (DPR ~1.75-2.4)', () => {
    expect(defaultExportScale(1.75)).toBe(2)
    expect(defaultExportScale(2)).toBe(2)
    expect(defaultExportScale(2.4)).toBe(2)
  })

  it('returns 3× on extreme HiDPI displays (DPR ≥ 2.5)', () => {
    expect(defaultExportScale(2.5)).toBe(3)
    expect(defaultExportScale(3)).toBe(3)
    expect(defaultExportScale(4)).toBe(3)
  })

  it('defends against invalid DPR inputs by defaulting to 1', () => {
    expect(defaultExportScale(0)).toBe(1)
    expect(defaultExportScale(-1)).toBe(1)
    expect(defaultExportScale(NaN)).toBe(1)
    expect(defaultExportScale(Infinity)).toBe(1)
  })
})
