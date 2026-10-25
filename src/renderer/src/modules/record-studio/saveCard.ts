/**
 * T-88: what the "Finishing up" card after Stop says and offers, per state.
 *
 * The card used to be one sentence for every case — "converting and writing
 * to disk…" even with Convert to MP4 off, where nothing converts — with a
 * progress bar that sat at its 2% floor (nothing reports progress for a plain
 * copy) and a "Discard recording" button that, in that same case, called a
 * cancel with nothing behind it and did nothing at all. What is worth stopping
 * is the ffmpeg convert; a WebM save is a copy of the packets into a fresh
 * file (T-120: a remux, which main can also stop), over in a moment. The card
 * says which one is happening and offers Discard only for the convert.
 * simplification: a WebM save offers no Discard although the remux is a child
 * main can kill; the upgrade is `canDiscard: !discarding` for that state, with
 * the card test and the Record E2E that pin "nothing to stop" re-pinned.
 */
import { formatTimer } from '@shared/clockTime'

/**
 * T-126 (2): the record that the microphone went away, kept after the toast that said so is gone. `atMs` is how far into the
 * take it stopped (null: it did not). The same words on the REC header, the saving card and the saved toast, so a person who
 * looked away for the 8 s of the toast can still read, when the file is done, that the rest of it has no voice.
 */
export function micLostLine(atMs: number | null): string | null {
  if (atMs === null) return null
  return `Microphone stopped at ${formatTimer(Math.max(0, atMs) / 1000)} — no sound after that`
}

/**
 * T-137 (2): what Start says when a take is still being saved. The studio draws the saving card (not the idle controls) over a save, including
 * one it came back to after a visit elsewhere, so this is the backstop for a Start that arrives anyway: a second take over a running save is what
 * let a Discard on it cancel the first take's convert. Same shape as the importers' "Still converting the last video. Wait for it to finish."
 */
export const SAVE_RUNNING_MESSAGE = 'Still saving the last recording. Wait for it to finish.'

export interface SaveCard {
  /** The status line. */
  status: string
  /** A progress bar only exists for the convert, the one step that reports progress. */
  showProgress: boolean
  /** True while "Discard recording" has a running convert to kill. */
  canDiscard: boolean
  /** A line under the button explaining why it is off, or null. */
  note: string | null
}

export function saveCard(convertToMp4: boolean, discarding: boolean): SaveCard {
  if (!convertToMp4) {
    return {
      status: 'Finishing up — saving to disk…',
      showProgress: false,
      canDiscard: false,
      note: 'Saving a WebM is a quick copy, so there is nothing to stop.'
    }
  }
  if (discarding) {
    return {
      status: 'Discarding the recording…',
      showProgress: false,
      canDiscard: false,
      note: null
    }
  }
  return {
    status: 'Finishing up — converting to MP4…',
    showProgress: true,
    canDiscard: true,
    note: null
  }
}
