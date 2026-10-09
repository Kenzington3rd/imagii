import type { ChainSpec } from './audio'

/**
 * T-90: what a cleanup preset is. The noise, level and voice settings — the
 * things a streamer dials in once for a microphone and wants again next
 * session. It deliberately has no `cutRegions` and no `secondaryTrack`: those
 * belong to ONE recording (cut times are positions in that file; the second
 * track is a path to that session's music), so a preset that carried them
 * re-imposed last week's cuts on today's take and pointed at a file that may
 * be gone.
 */
export type CleanupSettings = Omit<ChainSpec, 'cutRegions' | 'secondaryTrack'>

/**
 * The cleanup half of a chain. Used at SAVE (what main writes to disk) and at
 * APPLY (what the panel patches into the live chain), so a preset written by
 * an older build — which saved the whole chain — cannot put its cut times or
 * its second track back on the recording in front of the user.
 *
 * Rest-destructuring rather than an allow-list: a setting added to
 * `ChainSpec` is a cleanup setting by default and is saved without anyone
 * having to remember this file. `audioPreset.test.ts` pins the two removed
 * keys against `DEFAULT_CHAIN_SPEC`, so the other direction is also checked.
 */
export function cleanupSettings(chain: ChainSpec | CleanupSettings): CleanupSettings {
  const { cutRegions: _cuts, secondaryTrack: _second, ...rest } = chain as ChainSpec
  return rest
}
