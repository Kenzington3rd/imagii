import { describe, it, expect } from 'vitest'
import { LUFS_PRESETS, lufsTargetToPresetId } from './LevelsPanel'

// Round 16 INIT-H regression: the loudness preset picker round-trips through
// the numeric loudnormTargetLufs. Confirm the mapping handles the well-known
// targets and falls back to 'custom' for everything else.
describe('lufsTargetToPresetId', () => {
  it('maps standard targets to their preset id', () => {
    expect(lufsTargetToPresetId(-16)).toBe('podcast')
    expect(lufsTargetToPresetId(-14)).toBe('streaming')
    expect(lufsTargetToPresetId(-23)).toBe('broadcast')
  })

  it('returns "custom" for unknown targets', () => {
    expect(lufsTargetToPresetId(-12)).toBe('custom')
    expect(lufsTargetToPresetId(-18.5)).toBe('custom')
    expect(lufsTargetToPresetId(0)).toBe('custom')
  })
})

/**
 * T-90. The picker is a select whose value is `lufsTargetToPresetId(target)`
 * and whose onChange writes the chosen row's target. With two rows that shared
 * −14, choosing the second wrote −14, the lookup found the FIRST row, and the
 * select snapped back — the second row could not be chosen. The property that
 * rules the whole class out: every row survives the round trip.
 */
describe('the loudness picker round-trips every row (T-90)', () => {
  it.each(LUFS_PRESETS.map((p) => [p.label, p] as const))(
    '%s: choosing it leaves it chosen',
    (_label, preset) => {
      expect(lufsTargetToPresetId(preset.target)).toBe(preset.value)
    }
  )

  it('has one row per distinct number, so no row can shadow another', () => {
    const targets = LUFS_PRESETS.map((p) => p.target)
    expect(new Set(targets).size).toBe(targets.length)
    expect(new Set(LUFS_PRESETS.map((p) => p.value)).size).toBe(LUFS_PRESETS.length)
  })

  it('lists the two −14 platforms as one row that names all four services', () => {
    const rows = LUFS_PRESETS.filter((p) => p.target === -14)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('YouTube, Spotify, TikTok, Reels (−14)')
  })

  it('speaks to a streamer: no EBU, R128 or LUFS unit in a row label', () => {
    for (const p of LUFS_PRESETS) expect(p.label).not.toMatch(/EBU|R128|LUFS/)
  })
})
