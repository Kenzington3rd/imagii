import { describe, it, expect } from 'vitest'
import { lufsTargetToPresetId } from './LevelsPanel'

// Round 16 INIT-H regression: the LUFS preset picker round-trips through
// the numeric loudnormTargetLufs. Confirm the mapping handles the four
// well-known platform targets and falls back to 'custom' for everything
// else.
describe('lufsTargetToPresetId', () => {
  it('maps standard targets to their preset id', () => {
    expect(lufsTargetToPresetId(-16)).toBe('podcast')
    // -14 hits youtube first (and tiktok/reels share -14); the picker
    // tooltip explains the equivalence.
    expect(lufsTargetToPresetId(-14)).toBe('youtube')
    expect(lufsTargetToPresetId(-23)).toBe('broadcast')
  })

  it('returns "custom" for unknown targets', () => {
    expect(lufsTargetToPresetId(-12)).toBe('custom')
    expect(lufsTargetToPresetId(-18.5)).toBe('custom')
    expect(lufsTargetToPresetId(0)).toBe('custom')
  })
})
