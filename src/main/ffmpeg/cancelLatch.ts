import { CancelledError } from '../../shared/cancel'

/**
 * T-98 — a Cancel is a latch, not a call that has to land on a live child.
 *
 * Every cancel function used to look the job up in a map of live ffmpeg
 * children and kill what it found. A runner only registers its child at the
 * spawn, so a Cancel that arrived before it (a platform export, a compilation,
 * a cropped GIF and a reframe all probe the source first; the next job of a
 * batch begins with that same probe; a frame extract creates its folder first)
 * found nothing to kill, returned false, and the job started anyway, writing a
 * file the user had just refused. The click is the user's decision; where it
 * lands in the run is none of their business.
 *
 * So a runner opens a RUN for as long as it works (`begin`) and every cancel
 * function marks the runs it is aimed at, as well as killing their children:
 *  - `check()` is asked just before a child is spawned (and before each queued
 *    job of a batch), and throws the T-84 sentinel for a run that was marked;
 *  - `guard(work)` wraps a pre-spawn await. A cancel that lands while it waits
 *    ends the wait at once — a probe of a file on a slow network share can run
 *    for seconds, and the user should not watch "Exporting…" for all of them —
 *    and work that FAILS after a cancel reads as the cancel, not as a failure
 *    the user never asked about.
 *
 * Why a run per job rather than a flag per family: the per-job cancels
 * (`cancelGifJob(id)`, `cancelReframeJob(id)`) are aimed at ONE job, so a flag
 * for the whole family would cancel a sibling that is also probing. And why a
 * run ends (`end`, in the runner's `finally`): a cancel marks the runs that
 * are open when it arrives and nothing else, so a stale Cancel — pressed with
 * nothing running, or aimed at a job that has finished — can never reach the
 * next job. Starting a new job starts clean by construction.
 *
 * The sentinel is `CancelledError`, the same one `cancelledOr(child, …)`
 * rejects with after a kill (cancelMark.ts), so the renderer's neutral-cancel
 * path (`reportFailure`) needs no new case.
 */
export interface LatchRun {
  /** Throws the cancel sentinel when a cancel has landed on this run. */
  check(): void
  /** `work` (a probe, a mkdir), unless a cancel lands first or while it runs. */
  guard<T>(work: Promise<T>): Promise<T>
  /** The run is over: a later cancel finds nothing, so it cannot reach the next run. */
  end(): void
}

interface OpenRun {
  readonly id: string
  cancelled: boolean
  /** Settles `stopped` — the thing `guard` races its work against. */
  stop(): void
}

/**
 * T-127 (3): the runs open ANYWHERE in the process, counted, so the quit can wait for what the kills it issues only START.
 *
 * `cancelAll*` signals the children (SIGKILL) and marks the runs, and returns. Everything that deletes wreckage runs LATER, on the
 * event loop: the child's `close`, then the runner's failure path (`discardPartialOutput`, an intermediate's unlink), then `run.end()`
 * in its `finally`. The window's X and `app.quit()` let the process exit before any of it ran, so a quit in the middle of an export left
 * a half-written `name.mp4` at its FINAL name (no moov atom, and the next export of the same clip landed at "(2)") and a re-attach left its
 * ~0.7 GB-per-hour `.cleaned.wav`: Cancel deleted them (T-100) and a quit did not. `run.end()` is the last thing every runner does, after
 * its cleanup (each is `try { return await work } finally { run.end() }`), so "every run has ended" is "the cleanup is done".
 */
let openRuns = 0
const idleWaiters = new Set<() => void>()

/** How many runs are open right now, in every latch. */
export const openRunCount = (): number => openRuns

/** The longest a quit waits for the canceled runs to finish their cleanup (the `QUIT_FLUSH_TIMEOUT_MS` pattern: bounded, then it quits). */
export const QUIT_DRAIN_TIMEOUT_MS = 1500

/**
 * Resolves `drained` once no run is open anywhere, or `timeout` after `timeoutMs`, whichever comes first. It never rejects and never
 * waits past the ceiling: a run that will not end (a hung network share) costs the quit `timeoutMs` and no more.
 */
export function drainRuns(timeoutMs: number = QUIT_DRAIN_TIMEOUT_MS): Promise<'drained' | 'timeout'> {
  if (openRuns === 0) return Promise.resolve('drained')
  return new Promise((resolve) => {
    const wake = (): void => {
      clearTimeout(timer)
      resolve('drained')
    }
    const timer = setTimeout(() => {
      idleWaiters.delete(wake)
      resolve('timeout')
    }, timeoutMs)
    idleWaiters.add(wake)
  })
}

export class CancelLatch {
  private readonly open = new Set<OpenRun>()

  /**
   * Open a run. `id` is what a per-job cancel names (a job id); a run nobody
   * cancels by name (a whole batch, a frame extract) passes none and is only
   * reachable through `cancelAll`.
   */
  begin(id = ''): LatchRun {
    let stop: () => void = () => undefined
    const stopped = new Promise<never>((_, reject) => {
      stop = () => reject(new CancelledError())
    })
    // `stopped` is raced, not awaited: a run nobody ever cancels must not
    // leave a rejected promise behind it.
    stopped.catch(() => undefined)
    const run: OpenRun = { id, cancelled: false, stop }
    this.open.add(run)
    openRuns += 1
    const check = (): void => {
      if (run.cancelled) throw new CancelledError()
    }
    return {
      check,
      guard: async <T>(work: Promise<T>): Promise<T> => {
        let value: T
        try {
          value = await Promise.race([work, stopped])
        } catch (err) {
          check()
          throw err
        }
        check()
        return value
      },
      end: () => {
        // Once: a second `end()` must not count a run that is already gone.
        if (!this.open.delete(run)) return
        openRuns -= 1
        if (openRuns === 0) for (const wake of [...idleWaiters]) wake()
      }
    }
  }

  /** Mark the open run(s) named `id`. True when there was one. */
  cancel(id: string): boolean {
    let hit = false
    for (const run of this.open) {
      if (run.id === id && id !== '') hit = mark(run) || hit
    }
    return hit
  }

  /** Mark every open run. True when there was one. */
  cancelAll(): boolean {
    let hit = false
    for (const run of this.open) hit = mark(run) || hit
    return hit
  }
}

function mark(run: OpenRun): boolean {
  run.cancelled = true
  run.stop()
  return true
}
