import { lstat, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * T-106 — an export never replaces a file that is already there.
 *
 * Every runner that writes into the folder the user chose named its output from
 * its settings and told ffmpeg `-y`, so the next job with the same settings
 * silently replaced the last one: a second GIF of a different part of the clip,
 * a re-ordered compilation, a clip renamed back to what an earlier clip was
 * called. And because T-100 removes the file a CANCELED job was writing, a Cancel
 * on that second job deleted the first job's finished export as well.
 *
 * `nextFreePath(wanted)` is the one place a runner turns the name it wants into a
 * name it may write: `wanted` itself when nothing is there, otherwise the first
 * of `name (2).ext`, `name (3).ext`, ... that is free (the way Explorer numbers a
 * copy). A gap in the numbering is filled before a higher number is used.
 * `lstat`, not `stat`: a dangling link at the path is still something there.
 *
 * Callers wrap it in `run.guard(...)` — it is a wait before the spawn like the
 * probe, and a Cancel in it must end the job at once (T-98) — and keep the path
 * it returns for everything after (the argument to ffmpeg, the cleanup of a
 * stopped job, the result the panel reveals).
 *
 * `{ directory: true }` is for a folder a runner is about to make (Clip Kit's):
 * a folder's name has no extension, whatever dots it holds ("Clip 1.5-kit-2026").
 *
 * simplification: the check and the write are two steps. Two jobs asking for the
 * same name in the same instant could both be told it is free; nothing in the app
 * does that (a batch runs its jobs one after another, and every panel disables its
 * button while its job works). The upgrade path is to let ffmpeg refuse — `-n`
 * instead of `-y` on the final output — and turn that exit into a retry.
 */

/** A folder with this many copies of one name is not an export folder; stop walking. */
const MAX_COPIES = 9999

async function isTaken(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

export async function nextFreePath(
  wanted: string,
  options: { directory?: boolean } = {}
): Promise<string> {
  const { dir, name, ext } = path.parse(wanted)
  const stem = options.directory ? `${name}${ext}` : name
  const suffix = options.directory ? '' : ext
  if (!(await isTaken(wanted))) return wanted
  for (let n = 2; n <= MAX_COPIES; n++) {
    const candidate = path.join(dir, `${stem} (${n})${suffix}`)
    if (!(await isTaken(candidate))) return candidate
  }
  throw new Error(
    `There are already ${MAX_COPIES} files named "${path.basename(wanted)}" in that folder. Move some of them out and try again.`
  )
}

/**
 * T-125 (10) - the folder an output goes to is there before anything is encoded.
 *
 * A remembered output folder is a path the person chose last week. If it was deleted, renamed, or lives on a drive that is not
 * plugged in, the path is still well-formed, and every runner handed it to ffmpeg, which could not open its output: the failure
 * read "A file imagii needs isn't there" and a Compile reached it only after its whole segment encode. `isExistingFolder` is the
 * test main applies where a remembered folder is READ (`settings:get`, and the chooser's start folder); `ensureOutputDir` is what a
 * runner does before it names or encodes anything: make the folder, parents included (a deleted folder simply comes back). If the
 * folder cannot be made - a drive that is not connected, a parent that is a file, a read-only volume - the person is told WHICH
 * folder, in a finished sentence that `userFacingError` lets stand (no path, no errno).
 */
export async function isExistingFolder(candidate: unknown): Promise<boolean> {
  return (await folderVerdict(candidate)) === 'folder'
}

/**
 * T-126 (10): what the check of a remembered folder could establish. `unknown` is a stat that had not answered by the deadline.
 *
 * `settings:get` stats a folder key on EVERY read, and five panels mount together with four of them reading the same key. On a
 * path that does not answer (an unreachable UNC share, a NAS that is asleep) each `stat` parks one of libuv's four threads for as
 * long as the OS takes to give up (measured: with the pool parked, a 3 ms read still waited 3000 ms, and an `imagii-file:` fetch
 * queued behind it). So the stat of one path is made ONCE while it is in flight, whoever asks (one stat, many awaiters), and no
 * caller waits longer than `FOLDER_CHECK_DEADLINE_MS` for it: past that the answer is `unknown`, and a reader that cannot tell
 * uses what was stored (the runner's `ensureOutputDir` still decides at the real write). The stat itself cannot be cancelled; it
 * stays the one in-flight entry until it settles, so a path that hangs costs one thread, not one per read.
 */
export type FolderVerdict = 'folder' | 'not-a-folder' | 'unknown'
export const FOLDER_CHECK_DEADLINE_MS = 1000
const folderStatsInFlight = new Map<string, Promise<boolean>>()

function statIsFolder(candidate: string): Promise<boolean> {
  const running = folderStatsInFlight.get(candidate)
  if (running) return running
  const started = stat(candidate)
    // `stat` follows a link: a junction or symlink to a folder is a folder, a dangling one is not.
    .then(
      (s) => s.isDirectory(),
      () => false
    )
    .finally(() => {
      folderStatsInFlight.delete(candidate)
    })
  folderStatsInFlight.set(candidate, started)
  return started
}

export async function folderVerdict(candidate: unknown, deadlineMs: number = FOLDER_CHECK_DEADLINE_MS): Promise<FolderVerdict> {
  if (typeof candidate !== 'string' || candidate === '') return 'not-a-folder'
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<FolderVerdict>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), deadlineMs)
  })
  try {
    return await Promise.race([statIsFolder(candidate).then((yes): FolderVerdict => (yes ? 'folder' : 'not-a-folder')), deadline])
  } finally {
    clearTimeout(timer)
  }
}

const FOLDER_NAME_MAX = 60

/** The sentence for a folder that cannot be made: its NAME (not its path), then what to do. */
export function outputFolderRefusal(folderName: string): string {
  const shown = folderName.length > FOLDER_NAME_MAX ? `${folderName.slice(0, FOLDER_NAME_MAX)}…` : folderName
  return `Couldn't create the folder "${shown}". If it is on a drive that isn't connected, plug the drive in or choose another folder.`
}

export async function ensureOutputDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (err) {
    console.error('[imagii] could not create the output folder', dir, err)
    throw new Error(outputFolderRefusal(path.basename(dir) || dir))
  }
}
