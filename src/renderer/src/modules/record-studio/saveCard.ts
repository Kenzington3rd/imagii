/**
 * T-88: what the "Finishing up" card after Stop says and offers, per state.
 *
 * The card used to be one sentence for every case — "converting and writing
 * to disk…" even with Convert to MP4 off, where nothing converts — with a
 * progress bar that sat at its 2% floor (nothing reports progress for a plain
 * copy) and a "Discard recording" button that, in that same case, called a
 * cancel with nothing behind it and did nothing at all. What can actually be
 * stopped is the ffmpeg convert; a WebM save is a file copy, over in a
 * moment. The card says which one is happening and offers Discard only while
 * there is something for it to stop.
 */

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
      note: 'Saving a WebM is a plain file copy, so there is nothing to stop.'
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
