import { lstat, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { isShiftedSrtName, type ClearTranscriptsResult } from '../shared/captions'
import { isOutsideFolder } from './pathConfine'

/**
 * T-128 (3), T-110 (s): the saved transcripts, and the one way to empty them.
 *
 * Every transcription keeps its raw `.srt` in `<userData>/captions` for good (the guide says so, and that you can delete them by hand). The
 * folder is imagii's own, but it is not only transcripts: a ranged burn-in writes its shifted copy beside the real SRT (`isShiftedSrtName`,
 * T-81) for the length of the burn, and the launch sweep removes the leftovers of that kind only. So a transcript is a regular file
 * directly in the folder whose name ends in `.srt` and that is not such a copy. A link is not a regular file (a `.srt` pointing out of the
 * folder is skipped, never followed), and a folder that is itself a link is not searched: "empties ONLY the captions folder" has to hold when
 * somebody has pointed the folder somewhere. The folder is main's (`captionsOutputDir()`); no handler takes one from the renderer.
 */
async function savedTranscripts(dir: string): Promise<string[]> {
  try {
    // lstat does not follow: a symbolic link or a Windows junction is not a directory here.
    if (!(await lstat(dir)).isDirectory()) return []
  } catch {
    return [] // not there yet: a profile that never transcribed
  }
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && /\.srt$/i.test(e.name) && !isShiftedSrtName(e.name))
    .map((e) => path.join(dir, e.name))
    .filter((p) => !isOutsideFolder(dir, p))
}

/** How many transcripts `dir` holds. */
export async function countTranscripts(dir: string): Promise<number> {
  return (await savedTranscripts(dir)).length
}

/**
 * Remove every transcript in `dir`. One that will not go (open in another program, read-only) is counted and the rest still go: the
 * folder is left holding exactly what could not be removed. `remove` is `unlink`; the tests hand in one that fails.
 */
export async function clearTranscripts(
  dir: string,
  remove: (file: string) => Promise<void> = unlink
): Promise<ClearTranscriptsResult> {
  let removed = 0
  let failed = 0
  for (const file of await savedTranscripts(dir)) {
    try {
      await remove(file)
      removed += 1
    } catch (err) {
      failed += 1
      console.warn('[imagii] could not remove a saved transcript:', err)
    }
  }
  return { removed, failed }
}
