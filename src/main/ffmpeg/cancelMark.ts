import type { ChildProcess } from 'node:child_process'
import { CancelledError } from '../../shared/cancel'

/**
 * T-84 — the half of "Cancel is a fact" that lives where the kill happens.
 *
 * A runner's cancel function kills its child with `killAsCancelled`, which
 * writes the fact down BEFORE the signal goes out; the runner's close/error
 * handler then rejects with `cancelledOr(child, <its own failure>)` and gets
 * the sentinel back for a child the app killed on purpose, and its own
 * exit-code error for one that died by itself. Flag first, kill second —
 * the close event can fire the instant the signal lands, and a SIGKILL
 * mid-encode is indistinguishable from a crash without the mark (the same
 * ordering convert.ts's `cancelWhere` has used since T-44).
 *
 * Why a WeakSet and not a field on each registry: the runners keep a bare
 * `Map<string, ChildProcess>` (export, gif, concat, reframe, audio, burn-in,
 * transcribe) or a single slot (highlights, frame). The child IS the job's
 * handle in all of them, so marking the child needs no change to any registry
 * — and a mark that dies with its child leaks nothing. convert.ts keeps its
 * owner-keyed `ActiveConvert` entry (it needs the owner anyway) and shares
 * only the sentinel, via `ConvertCancelledError extends CancelledError`.
 */
const cancelled = new WeakSet<ChildProcess>()

/** Kill `child` on the user's behalf (or the before-quit sweep's): marked first. */
export function killAsCancelled(child: ChildProcess): void {
  cancelled.add(child)
  try {
    child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

/** What a runner's close/error handler rejects with for `child`. */
export function cancelledOr(child: ChildProcess, failure: Error): Error {
  return cancelled.has(child) ? new CancelledError() : failure
}
