/**
 * A take that is being recorded, and the one question every way off its screen asks (T-133 (1)).
 *
 * Leaving Record unmounts `RecordStudio`, whose cleanup stops the tracks: a take still being recorded is cut short and its save dialog opens
 * over some other studio. The Home link has asked "Stop and save it before leaving?" since round 18, but it is not the only way off that
 * screen. T-132 (1)'s own fix put an "Open Audio Studio" button in an 8-second toast that sits over the REC screen, and Record's and
 * Reframe's saved-file toasts carry "Edit in Video Studio": one press on either `navigate`d away and cut the take. A toast outlives the
 * screen that raised it, so the screen cannot guard its own exits; the screen REGISTERS the live take here (for as long as its phase is
 * "recording") and every way off asks `mayLeaveLiveTake` first.
 */

/** The Home link's question, word for word (it is the one the guide and the e2e specs quote). */
export const LIVE_TAKE_MESSAGE = 'A recording is in progress. Stop and save it before leaving? (Cancel keeps recording.)'

let stopTake: (() => void) | null = null

/**
 * Record says a take is live and how to stop it (its normal Stop: the save runs on Record). Returns the unregister, which only clears
 * THIS registration: a cleanup that runs after a newer registration (StrictMode runs an effect's cleanup and then the effect again) leaves
 * the newer one alone.
 */
export function registerLiveTake(stop: () => void): () => void {
  stopTake = stop
  return () => {
    if (stopTake === stop) stopTake = null
  }
}

/**
 * May the caller take the person off the Record screen? True when no take is live. When one is, the person is asked: "OK" stops it (the
 * save goes ahead where they are, as it does from the Home link) and "Cancel" keeps recording, and either way the answer is false: the
 * caller does not go anywhere now. They leave once the take is saved.
 */
export function mayLeaveLiveTake(ask: (message: string) => boolean = (message) => window.confirm(message)): boolean {
  const stop = stopTake
  if (stop === null) return true
  if (ask(LIVE_TAKE_MESSAGE)) stop()
  return false
}
