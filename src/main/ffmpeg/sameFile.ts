import { realpath } from 'node:fs/promises'
import path from 'node:path'

/**
 * T-141 (1) - a job never writes over a file it READS.
 *
 * ffmpeg used to refuse this itself: handed an output equal to an input it exits 234, "FFmpeg cannot edit existing files in-place" (executed on 7.0.2, 6.1.1 and the
 * shipped win32 exe), with the input untouched. T-140 (1) hands it a PARTIAL beside the target instead - never an input - and the runner renames the partial over the
 * target when whole, so that refusal stopped happening: an output the Save dialog aimed at the audio source, the second track, the video a re-attach is putting sound
 * on, or the video and the .srt a burn-in reads was rendered and swapped over it behind one confirmed OS "replace?" (executed: the export over its source, the mux
 * over its video, a ranged burn-in that turned a whole VOD into the captioned range). The refusal is ours now, asked before ANY spawn - not even a probe - by every
 * runner that writes a file a person keeps (`audio/process.ts`: the export, the mux, the re-attach; `sidecars/whisperManager.ts`: the burn-in). The other writers name
 * their output with `nextFreePath` (T-106), so the output is by construction a name nothing is at.
 *
 * "The same file" is the resolved path: `realpath` where the file is there (a symlink, a symlinked folder, a `..` detour, and on Windows the canonical case and the
 * long form of an 8.3 name), `path.resolve` where it is not (a name nothing is at is no input's file, so a lexical compare is all it can need), and a
 * case-insensitive compare on win32 for what the canonical form leaves (NTFS folds case; a name the OS has not seen yet is compared as typed).
 */
// simplification: a hard link is not "the same file" here, on purpose. The swap renames the partial over the TARGET'S directory entry, so a target that is a second link
// to an input is replaced and the input keeps its bytes (the same holds for a symlink as the final component, which the rename replaces rather than follows; it is refused
// anyway, because a person who aimed the output at a link to their source meant to replace what it points at). If a swap is ever changed to write through the target, an
// inode compare (dev + ino from `stat`) is the upgrade.

/** What the person reads when the output they picked is a file the job reads. One finished line `userFacingError` lets stand (main owns this copy). */
export const OUTPUT_IS_AN_INPUT_MESSAGE =
  "That is the file imagii is reading from, so it can't be replaced by the new one. Pick a different name, then try again."

async function canonical(file: string): Promise<string> {
  try {
    return await realpath(file)
  } catch {
    // Nothing is there (or the file cannot be reached): the path as it resolves.
    return path.resolve(file)
  }
}

/** True when `a` and `b` name one file. `platform` is a parameter so the Windows rule is a unit on any host. */
export async function sameFile(a: string, b: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const [x, y] = await Promise.all([canonical(a), canonical(b)])
  return platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

/**
 * Throw `OUTPUT_IS_AN_INPUT_MESSAGE` when any of `outputs` is any of `inputs`. An input that is not set (no second track, no .srt) is skipped. The paths go to the
 * console, not into the sentence: they are the person's, they are long, and they are not what the person can act on.
 */
export async function refuseOutputOverInputs(outputs: readonly string[], inputs: ReadonlyArray<string | null | undefined>): Promise<void> {
  for (const output of outputs) {
    for (const input of inputs) {
      if (!input) continue
      if (await sameFile(output, input)) {
        console.error(`[imagii] refused an output that is a file the job reads: ${output} (reads ${input})`)
        throw new Error(OUTPUT_IS_AN_INPUT_MESSAGE)
      }
    }
  }
}
