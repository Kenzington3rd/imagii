import { isCancelledError } from './cancel'
import { ipcErrorMessage } from './ipcError'

/**
 * T-84 — the one place a caught error becomes something a streamer can read.
 *
 * Every `catch` around a `window.api.*` call used to toast `err.message`, so
 * the user read "Error invoking remote method 'video:exportBatch': Error:
 * FFmpeg exit 1: Conversion failed!" for four seconds — a channel name, the
 * word "remote" for work that never left the machine, and an encoder's
 * stderr. `ipcErrorMessage` strips the envelope; this goes the rest of the
 * way, in three tiers and a verdict:
 *
 *   0. Cancelled. A job the user stopped is not an error at all
 *      (`shared/cancel.ts`). `cancelled: true`; the caller shows ITS OWN
 *      neutral line ("GIF canceled."), which only the feature knows.
 *   1. A known failure shape — the encoder exited non-zero, a file is missing
 *      or locked, the disk is full, the network is down, a capture device
 *      refused — becomes the caller's context sentence plus a plain cause:
 *      "Export failed. A file imagii needs isn't there. It may have been
 *      moved or deleted."
 *   2. A finished sentence a person wrote in main ("This file is text, not a
 *      video — pick a video file such as MP4, MOV, or MKV.") stands alone:
 *      main still owns its own copy, exactly as `ipcErrorMessage` says.
 *   3. Anything else — a validator's path-shaped assertion, a stack, an empty
 *      message — is not for the user. They get the caller's context sentence.
 *
 * The raw error is ALWAYS written to the console (a failure at error level, a
 * cancel at info level — a cancel is not an error). That is the contract that
 * makes the rest safe: nothing the user no longer reads is lost, it is moved
 * to where a bug report can find it.
 */

/** How long a failure toast stays up. The default 4 s is shorter than the
 *  sentence takes to read, and the failure is the one toast the user must not
 *  miss. */
export const ERROR_TOAST_MS = 8000
/** A cancel toast can run to two sentences ("…Files already finished are in
 *  your folder."), so it outlives a plain toast too. */
export const CANCEL_TOAST_MS = 6000

export interface UserFacingError {
  /** The user stopped the job. `message` is a neutral default; the caller's
   *  own cancel copy replaces it. */
  cancelled: boolean
  message: string
}

const CANCELED_DEFAULT = 'Canceled.'

/**
 * A runner's own failure, as main words it: "<one or two words> exit <code>"
 * ("FFmpeg exit 1: …", "segment 0 exit 1: …", "convert-to-mp4 exit signal
 * SIGSEGV: …", "ebur128 exit SIGKILL"). Anchored at the start and capped at
 * two words before `exit`, so a sentence main wrote that merely MENTIONS an
 * exit code ("Converting the recording to MP4 failed (ffmpeg exit code 1).")
 * is not mistaken for the raw form.
 */
const RUNNER_EXIT = /^[\w-]+(?: [\w-]+)? exit [\w-]+/

/**
 * Failure shapes recognised ANYWHERE in the message, most specific first —
 * an ffmpeg run that died on a missing file is "a file is missing", not
 * "ffmpeg exited", so these are tried before the generic runner-exit rule.
 */
const KNOWN_CAUSES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bENOSPC\b|no space left on device/i, 'Your disk is full. Free up some space and try again.'],
  [
    /\bENOENT\b|no such file or directory|system cannot find the (?:file|path)/i,
    "A file imagii needs isn't there. It may have been moved or deleted."
  ],
  [
    /\b(?:EBUSY|EPERM|EACCES)\b|resource busy|operation not permitted|access is denied/i,
    'Windows blocked access to a file. Close any app using it, or check your antivirus.'
  ],
  [
    /net::ERR_|\b(?:ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH)\b/,
    "imagii couldn't reach the internet. Check your connection and try again."
  ],
  [
    /invalid data found when processing input|moov atom not found|could not find codec parameters/i,
    "That file looks damaged or isn't a format imagii can read."
  ],
  // The model download's own failures (main/sidecars/whisperManager.ts): the
  // server answered with an error page, or the bytes that arrived were wrong.
  [/^HTTP [45]\d\d$/, "The website didn't send the file. Try again in a few minutes."],
  [/SHA-256 mismatch|Downloaded file size/, 'The download arrived damaged. Try again.']
]

/**
 * Browser media-device failures, keyed on the DOMException NAME (getUserMedia
 * and friends reject with `NotAllowedError`, `NotFoundError`, …). The name is
 * the discriminator rather than the message because the messages are the
 * browser's ("Permission denied" is also what ffmpeg says about an unwritable
 * folder) — and an error that crossed the IPC bridge is always named
 * `Error`, so these can only fire for an error raised in the renderer.
 */
const DEVICE_CAUSES: Readonly<Record<string, string>> = {
  NotAllowedError:
    "imagii isn't allowed to use that device. Check Windows Settings > Privacy, then try again.",
  NotFoundError: "That device wasn't found. Check it's plugged in, then try again.",
  NotReadableError: 'That device is busy or unavailable. Close any app using it, then try again.'
}

const GENERIC_EXIT_CAUSE =
  "imagii's video tool stopped before it finished. " +
  'Check that the source file still plays and the folder has room, then try again.'

/** "A sentence a person wrote": one line, at most 240 characters, ending like one. */
function isFinishedSentence(text: string): boolean {
  return text.length > 0 && text.length <= 240 && !text.includes('\n') && /[.!?]$/.test(text)
}

export function userFacingError(err: unknown, fallback: string): UserFacingError {
  if (isCancelledError(err)) {
    console.info('[imagii] canceled by the user:', err)
    return { cancelled: true, message: CANCELED_DEFAULT }
  }
  console.error(`[imagii] ${fallback}`, err)

  const raw = ipcErrorMessage(err, '')
  const name = err instanceof Error ? err.name : ''
  const deviceCause = DEVICE_CAUSES[name]
  if (deviceCause) return { cancelled: false, message: `${fallback} ${deviceCause}` }
  for (const [pattern, cause] of KNOWN_CAUSES) {
    if (pattern.test(raw)) return { cancelled: false, message: `${fallback} ${cause}` }
  }
  if (RUNNER_EXIT.test(raw)) return { cancelled: false, message: `${fallback} ${GENERIC_EXIT_CAUSE}` }
  if (isFinishedSentence(raw)) return { cancelled: false, message: raw }
  return { cancelled: false, message: fallback }
}
