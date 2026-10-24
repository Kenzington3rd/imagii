import { stat, unlink } from 'node:fs/promises'

/**
 * T-100 — a job that was canceled or failed does not leave its half-written
 * output behind.
 *
 * ffmpeg opens its output at the start and finishes the container at the end
 * (an MP4's moov atom, a GIF's trailer), so a killed run leaves a file that
 * has the right name and plays in nothing, in the folder whose toast says
 * "Files already finished are in your folder". The runner that spawned the
 * child knows which path it was writing, so each calls this from its failure
 * path, after the child has exited and let go of the file (a Windows file with
 * an open handle cannot be unlinked).
 *
 * Two rules keep it from deleting something that is not the job's wreckage:
 *  - `spawnedAt` is null until the child was actually spawned. A job that was
 *    canceled or failed in its probe never touched the path, and the path may
 *    hold a file from an earlier export of the same name.
 *  - even after the spawn, a file older than the spawn is not ours: ffmpeg
 *    truncates its output when it OPENS it, which for a slow input is well
 *    after the spawn, and a Cancel in between leaves the old file exactly as
 *    it was. A file this run wrote has an mtime at or after the spawn. The
 *    slack is the coarsest timestamp resolution a user's drive can have (FAT
 *    stores whole 2-second steps).
 *
 * Ceiling (T-111): on a network share whose clock runs more than 2 s behind
 * this machine's, a just-written partial can look older than the spawn and be
 * kept; the cost is a leftover file, never a lost one. That cost holds HERE, on
 * the discard path, where keeping is the safe error. T-133 (5): it did not hold
 * on the success path, which borrowed the same test (`wroteOutput` below).
 */
const MTIME_SLACK_MS = 2000

export async function discardPartialOutput(
  outputPath: string,
  spawnedAt: number | null
): Promise<void> {
  if (spawnedAt === null) return
  try {
    const info = await stat(outputPath)
    if (!info.isFile() || info.mtimeMs < spawnedAt - MTIME_SLACK_MS) return
    await unlink(outputPath)
  } catch {
    // Never created, already gone, or locked: nothing more a failed job can do,
    // and the failure being reported is the one the user needs to hear about.
  }
}

/**
 * T-132 (4): did this run leave a real file at `outputPath`? True for a non-empty regular file. `extractFrame` asks it after an exit 0,
 * because `-ss` past the last frame exits 0 and writes nothing.
 *
 * T-133 (5): it takes no clock. It borrowed `discardPartialOutput`'s "not older than the spawn, 2 s of slack" to tell this run's file from an
 * earlier one's, and on a share whose clock runs more than 2 s behind this machine's that refused a GOOD thumbnail as "no picture" and aborted
 * the kit: a wrong answer on the success path, where the discard's "a leftover file, never a lost one" is not available. The caller makes
 * "an earlier file" impossible instead: `extractFrame` writes into a fresh `makeKitDir` folder and refuses a target that already exists, so
 * whatever is at the path after the exit is this run's.
 */
export async function wroteOutput(outputPath: string): Promise<boolean> {
  try {
    const info = await stat(outputPath)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}
