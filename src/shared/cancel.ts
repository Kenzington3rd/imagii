/**
 * T-84 — "the user pressed Cancel" is a fact main knows, not a string the
 * renderer parses.
 *
 * Cancelling a job SIGKILLs its ffmpeg child, and a SIGKILL'd child exits
 * non-zero — exactly like a crash. Before T-84 every cancel therefore
 * travelled the failure path and reached the user as a red error, in the
 * runner's own ffmpeg words ("FFmpeg exit null", "pip exit 1", "highlight
 * scan cancelled"). The only party that can tell the two apart is the one
 * that asked for the kill, so each runner's cancel function marks the child
 * BEFORE killing it (src/main/ffmpeg/cancelMark.ts), and the runner's close
 * handler rejects with this error instead of its exit-code error. T-44
 * made the same distinction for converts; `ConvertCancelledError` is now a
 * subclass of this, so there is one sentinel, not two.
 *
 * The CLASS is for main (`instanceof`). The MESSAGE is what survives the
 * bridge: Electron re-serializes a handler's rejection as
 * "Error invoking remote method '<channel>': <Name>: <message>", so the
 * renderer recognizes the sentinel by `isCancelledError`, never by looking
 * for ffmpeg's words.
 */
export const CANCELLED_MESSAGE = 'imagii:cancelled'

export class CancelledError extends Error {
  constructor() {
    super(CANCELLED_MESSAGE)
    this.name = 'CancelledError'
  }
}

/**
 * True for a cancellation, in any form it arrives: the error object main
 * threw, the same error after it crossed the IPC bridge (envelope and
 * "CancelledError:" label around the message), or a bare string such as the
 * `reason` of a `{ ok: false }` result.
 */
export function isCancelledError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return raw.includes(CANCELLED_MESSAGE)
}
