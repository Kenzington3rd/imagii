import type { ChainSpec } from '@shared/audio'
import { DEFAULT_CHAIN_SPEC } from '@shared/audio'
import { countOf } from '@shared/plural'

/**
 * What the question is ABOUT (T-113). The list of what would be lost is the same either
 * way; the lead-in names what the person is doing: closing the audio they are editing, or
 * handing Audio Studio a video's sound to replace it with.
 */
export type AudioDiscardLead = 'close' | 'replace'

const LEAD_IN: Record<AudioDiscardLead, string> = {
  close: 'Close this audio?',
  replace: "Replace the audio you're editing?"
}

/** "A", "A and B", "A, B and C". */
function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * T-19: what a Close would throw away. Everything here is unrecoverable —
 * clearSource() resets the chain AND drops the undo history with it. T-112: it is also
 * what Video Studio's "Clean audio" would throw away, because loading a new sound
 * resets the chain and the history the same way — and T-113 gave that its own lead-in
 * (`'replace'`): nothing is being closed when you press a button on a video.
 */
export function audioCloseMessage(chain: ChainSpec, lead: AudioDiscardLead = 'close'): string | null {
  const cuts = chain.cutRegions.length
  // `!= null`, not `!== null`: the field is optional (`secondaryTrack?:`), and a chain saved before the second
  // track existed has no key at all - `undefined !== null` said "The second track will be discarded" about a
  // track that was never there (T-121).
  const hasSecondary = chain.secondaryTrack != null
  const chainEdited = chainDiffersFromDefault(chain)
  if (!cuts && !hasSecondary && !chainEdited) return null
  const parts: string[] = []
  if (chainEdited) parts.push('your cleanup settings')
  if (cuts > 0) parts.push(countOf(cuts, 'cut'))
  if (hasSecondary) parts.push('the second track')
  // Mirrors VideoStudio.tsx's confirm copy: name what is lost, then say it
  // is discarded. T-113: a list reads "A and B", not "A, B".
  const list = joinList(parts)
  return `${LEAD_IN[lead]} ${list.charAt(0).toUpperCase()}${list.slice(1)} will be discarded.`
}

/**
 * Field-by-field so a re-ordered object literal can't read as "edited". A field the chain does not carry is the
 * default (T-121): a project or a preset from an older build lacks the switches added since, and comparing
 * `undefined` to `false` called untouched audio "your cleanup settings".
 */
function chainDiffersFromDefault(chain: ChainSpec): boolean {
  const keys = Object.keys(DEFAULT_CHAIN_SPEC) as Array<keyof ChainSpec>
  return keys.some((key) => {
    if (key === 'cutRegions' || key === 'secondaryTrack') return false
    return JSON.stringify(chain[key] ?? DEFAULT_CHAIN_SPEC[key]) !== JSON.stringify(DEFAULT_CHAIN_SPEC[key])
  })
}

/**
 * T-19: Video Studio has confirmed its Close since round 18; Audio Studio
 * silently discarded chain edits, cut regions, and a loaded second track.
 * Split out from the component so the accept AND decline branches are unit
 * testable in the node-env layer.
 */
export function confirmAudioClose(
  chain: ChainSpec,
  ask: (message: string) => boolean,
  lead: AudioDiscardLead = 'close'
): boolean {
  const message = audioCloseMessage(chain, lead)
  if (message === null) return true
  return ask(message)
}

/**
 * T-133 (6): may Clean audio put the video's sound in Audio Studio now that the extraction is over?
 *
 * The first question is asked BEFORE a wait that can be minutes long, and the person is free to work in Audio Studio meanwhile. A different
 * FILE is `replacedSince`'s business (ProjectIO); work tuned on the file already open is this: loading a sound resets the chain and drops the
 * undo history, so what was tuned during the wait would be replaced with nothing to bring it back. `chainAsked` is the chain the person was
 * asked about (every edit makes a new chain object): the same object means nothing new to lose, so they are not asked twice about work they
 * already agreed to give up; a different one is asked about over its own list, with the same lead-in.
 */
export function confirmReplaceAfterWait(
  chainAsked: ChainSpec,
  chainNow: ChainSpec,
  ask: (message: string) => boolean
): boolean {
  if (chainNow === chainAsked) return true
  return confirmAudioClose(chainNow, ask, 'replace')
}
