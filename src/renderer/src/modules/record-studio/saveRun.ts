import { createRunStore } from '../../lib/runStore'

/**
 * The Record screen's save (T-137 (2)): the take that has been stopped and is being written to the place the person chose - the Save dialog, then
 * the MP4 convert (or the WebM copy). It was `RecordStudio`'s `useState` (`savePercent`, `discarding`) beside the `phase` that said "saving", and a
 * save is minutes long for an hour-long take. Leaving Record during it unmounted all three; the screen that came back was IDLE, with Start enabled,
 * over a convert main was still running and no Discard for it. Started on a second take, whose own Discard called `cancelConverts('recording')`, it
 * cancelled the first take's convert as well, and that save - told "cancelled" by something other than the quit - unlinked its raw webm: the only
 * copy of a recording the person never discarded.
 *
 * It is a run in a module store (the `createRunStore` pattern of T-135 / T-136): the save's own closure (`finalizeRecording`, which holds no
 * component state that matters after it) keeps running when its screen is gone and writes here; a Record that mounts over a run draws the same
 * saving card, with the same bar and the same Discard, and offers no Start. `takeId` is what the Discard is aimed at: main cancels the convert of
 * THAT take and no other (`recording:cancelSave`).
 */
export interface RecordSave {
  /** The main-process session id the take was recorded under (`recording:begin`'s answer): what "Discard recording" names. */
  takeId: string
  /** The save is the MP4 convert (a bar, a Discard) rather than a plain WebM copy (neither, T-88). It is what the take was started with, not the checkbox now. */
  convertToMp4: boolean
  /** 0-99 once main has measured the convert, null while it has no measurement (the bar slides, T-115). */
  percent: number | null
  /** "Discard recording" has been pressed and the convert has not yet rejected (T-88): the card says so, and the button cannot be pressed twice. */
  discarding: boolean
  /** How far into the take the microphone stopped (T-126 (2)), or null: the saving card says it until the file is done. */
  micLostAt: number | null
}

export const useRecordSave = createRunStore<RecordSave>()
