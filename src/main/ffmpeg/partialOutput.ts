import { randomBytes } from 'node:crypto'
import { rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { nextFreePath } from './outputPath'

/**
 * T-140 (1) (T-100 before it) - a render is written to a PARTIAL beside its target, and the target is replaced only by a whole one.
 *
 * ffmpeg opens its output when it starts and finishes the container when it ends (an MP4's moov atom, a GIF's trailer), and what it opens it
 * TRUNCATES. A runner that handed it the final path therefore destroyed whatever was there the moment the encode began: a Cancel, the quit, a
 * crash or a full disk (exit 228) left NEITHER the old file nor the new one (executed: a 100,000-byte file gone after `cancelAudioJob`, and after
 * ENOSPC), and the half-written file sat at the name a finished export has. T-100 removed that wreckage; it could not give back the file it had
 * replaced. This is T-139 (1)'s rule, a write over a file the person owns is the old file until the new one is whole, for the files a spawned
 * program writes.
 *
 * So every runner that writes a file imagii will leave in a person's folder:
 *  1. names its output with `partialPathFor(target)`: `<stem>.<8 hex>.partial<ext>` in the SAME folder (a rename across volumes is not atomic),
 *     the extension LAST so ffmpeg picks the muxer exactly as it would for the target (Layer 5 holds it per format on both majors);
 *  2. runs ffmpeg against the partial, and runs its own checks on the exit (`wroteNoPicture`, the join's lost-part guard, `wroteOutput`);
 *  3. calls `finishPartial` (or `commitPartial`): the partial is renamed over the target only if every check passed AND the run's cancel latch
 *     (cancelLatch.ts) has not been marked. A Cancel or the quit sweep that lands between the exit and the rename wins over a finished render.
 * On ANY failure, cancel or quit the partial is removed and the target is never touched: `discardPartial` refuses a name that is not a partial's,
 * so the failure path cannot delete the target even if a caller passes it by mistake.
 *
 * Two modes, because two kinds of target exist. `replace`: the person named the file (the Save dialog asked "replace?" and was answered; the
 * recording's save, the audio export, the burn-in). `beside`: the runner chose a free name (`nextFreePath`, T-106: an export never replaces a
 * file that is already there) - and a free name is only free at the moment it is chosen, which for a render that takes minutes is long before
 * the swap. The partial holds the name's place for nobody, so `beside` asks again at the swap and takes `name (2)` if the name has been taken
 * since. Before partials the file ffmpeg was writing occupied the name for the whole encode.
 *
 * A file that cannot be replaced. On Windows a file open in a player or an editor without FILE_SHARE_DELETE refuses the swap onto it for as long as it is
 * open (libuv: EPERM / EACCES), and before partials that showed up within a second, as ffmpeg's `-y` failing to open it. Now the person has waited through
 * the whole render, and throwing it away would be a worse answer than the one it replaced. So in `replace` mode a swap that is STILL refused with a lock
 * code after the retries, onto a name something is at, lands the render BESIDE that file under the next free name: the file that was open is not touched,
 * and the path the render landed at is the answer (`commitPartial` returns it, `finishPartial` passes it on, and every runner hands it to its caller and
 * through IPC), so the panel can say where it is and reveal it. `landedBesideNote` (`shared/landedPath.ts`) is the sentence for it.
 *
 * Leftovers. A crash or a kill -9 in the middle of a render leaves its `<stem>.<hex>.partial<ext>` next to the output, and nothing sweeps it.
 */
// simplification: nothing reaps a crashed run's partial. A Cancel, a failure and the quit (`drainRuns`) all remove it; only a crash, a kill -9 or a power loss
// leaves one, in the folder the person chose, named for what it was becoming. That is no worse than before (the same wreckage sat at the FINAL name, and
// looked like an export), and the launch sweep (`tempCleanup.ts`) only knows the folders imagii owns (%TEMP%, userData): the Save dialog's folder is not
// remembered, so a sweep of "the folders imagii wrote to" would clear some partials and not others. Upgrade: journal each in-flight partial's path in
// userData and have the launch sweep remove the journal's entries older than 6 h. The same line is the second ceiling: the swap does not fsync the partial
// first (a long render has already paid most of the flush), so a power loss in the seconds after the rename can leave the target's name on a file the drive
// had not finished writing; the old file is replaced either way, as it always was. The third is the redirect itself: a lock code on an existing target is
// read as "open in another app", which is the usual cause, but a read-only file refuses a replace with the same code, so the sentence the panel says can
// name the wrong reason (the render is kept beside the file either way). Upgrade: ask the file's attributes before choosing the words.

/** The name `partialPathFor` makes, as a pattern: for code that LISTS a folder a render may be in the middle of (the e2e helpers), and for `discardPartial`'s guard. */
export const PARTIAL_OUTPUT = /\.[0-9a-f]{8}\.partial(?:\.[^./\\]*)?$/

/** `<dir>/<stem>.<8 hex>.partial<ext>`: the file ffmpeg is handed in place of `target`. A new name on every call. */
export function partialPathFor(target: string): string {
  const { dir, name, ext } = path.parse(target)
  return path.join(dir, `${name}.${randomBytes(4).toString('hex')}.partial${ext}`)
}

/**
 * Remove a run's partial. It removes a file that carries the partial name and nothing else, and says nothing if it cannot: a failed job has no
 * more it can do, and the failure being reported is the one the person needs to hear about. Call it after the child has exited and let go of the file
 * (a Windows file with an open handle cannot be unlinked). The name is unique to the run, so unlike the clock-and-spawn rules this replaced (an mtime
 * test, which on a share whose clock ran behind left a partial for good), there is no earlier file it could be mistaken for.
 */
export async function discardPartial(partial: string): Promise<void> {
  if (!PARTIAL_OUTPUT.test(partial)) return
  try {
    await unlink(partial)
  } catch {
    // Never created, already gone, a folder, or locked.
  }
}

export type CommitMode = 'replace' | 'beside'

/** What the swap asks before it renames: a `LatchRun` (cancelLatch.ts) is one. It throws the cancel sentinel when a Cancel has landed on the run. */
export interface CancelCheck {
  check(): void
}

/**
 * How long a refused rename is waited out. On Windows a scanner (Defender, the search indexer) can hold a file ffmpeg has just closed for a moment,
 * and the rename of it is refused (EBUSY, EPERM or EACCES) - the same reason graceful-fs retries. The render is whole and took minutes, and it did not
 * have this step before, so it is tried again for about a second and a half before it is given up. The quit's wait for a run to end is 1.5 s.
 */
export const COMMIT_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 800]
const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES'])

async function renameWhenFree(run: CancelCheck, from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const delay = COMMIT_RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !LOCKED.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      await new Promise((resolve) => setTimeout(resolve, delay))
      run.check()
    }
  }
}

/** Did the disk refuse the swap with a lock code, onto a name that something is at? Only then is "the file is open in another app" the reading. */
async function targetIsHeld(err: unknown, target: string): Promise<boolean> {
  if (!LOCKED.has((err as NodeJS.ErrnoException).code ?? '')) return false
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/**
 * Swap a whole render in: rename `partial` over `target` (MoveFileEx with REPLACE_EXISTING on Windows, as `writeFileAtomic` relies on) and answer the
 * path it landed at: `target`, in `beside` mode the next free name, and in `replace` mode - when the file at `target` is held open and the disk keeps
 * refusing the swap onto it - the next free name beside it (see the module note; the held file is not touched). The run is asked once the name is
 * settled and before each rename, so a Cancel recorded before this point - including one that landed after ffmpeg exited 0, or during the retries -
 * wins. On ANY failure the partial is removed (its own error ignored) and the ORIGINAL error is rethrown, so `userFacingError` sees the disk's words;
 * the target keeps whatever it held.
 */
export async function commitPartial(run: CancelCheck, partial: string, target: string, mode: CommitMode = 'replace'): Promise<string> {
  try {
    const landing = mode === 'beside' ? await nextFreePath(target) : target
    run.check()
    try {
      await renameWhenFree(run, partial, landing)
      return landing
    } catch (err) {
      // `beside` chose a name that was free a moment ago, so a refusal there is not an open file; any other refusal (a full or read-only drive) would
      // refuse the new name just the same.
      if (mode !== 'replace' || !(await targetIsHeld(err, target))) throw err
      const beside = await nextFreePath(target)
      // The last try was refused, and the loop makes no check after it: a Cancel recorded during it wins over the new name.
      run.check()
      try {
        await rename(partial, beside)
      } catch {
        throw err
      }
      return beside
    }
  } catch (err) {
    await discardPartial(partial)
    throw err
  }
}

/**
 * The one call a runner makes once it has handed ffmpeg a partial: `work` is the promise of the child's run (it rejects on a failed exit, a cancel,
 * and any check the runner makes on a clean exit). A rejection removes the partial and passes the error on untouched. A success swaps the partial in
 * (`commitPartial`) and answers the work's value and the path the render LANDED at, which a runner must hand on (`target`, or beside it when the file
 * at `target` is held open): `tests/unit/atomicWrites.test.ts` fails a call that throws the answer away.
 */
export async function finishPartial<T>(
  work: Promise<T>,
  o: { run: CancelCheck; partial: string; target: string; mode: CommitMode }
): Promise<{ value: T; outputPath: string }> {
  let value: T
  try {
    value = await work
  } catch (err) {
    await discardPartial(o.partial)
    throw err
  }
  return { value, outputPath: await commitPartial(o.run, o.partial, o.target, o.mode) }
}

/**
 * T-132 (4): did this run leave a real file at `outputPath`? True for a non-empty regular file. `extractFrame` asks it of its partial after an exit 0,
 * because `-ss` past the last frame exits 0 and writes nothing.
 *
 * T-133 (5): it takes no clock. It borrowed the old discard's "not older than the spawn, 2 s of slack" to tell this run's file from an earlier one's, and
 * on a share whose clock runs more than 2 s behind this machine's that refused a GOOD thumbnail as "no picture" and aborted the kit. T-140 (1): the path it is
 * asked about is the run's own partial, a name that was never there before, so whatever is at it after the exit is this run's.
 */
export async function wroteOutput(outputPath: string): Promise<boolean> {
  try {
    const info = await stat(outputPath)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}
