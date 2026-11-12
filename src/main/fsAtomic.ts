import { randomBytes } from 'node:crypto'
import { open, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fitFileName } from '../shared/filename'
import { NAME_UNIT } from './ffmpeg/outputPath'

/**
 * The name of a tmp this module makes, as a pattern: `<target>.<8 hex>.tmp`. For code that LISTS a folder a write may be in the middle of (the e2e helpers
 * that count the files a save produced): the tmp is there for the length of the write, a poll on a count sees it, and it is gone by the rename. Kept beside the
 * line that builds the name; `fsAtomic.test.ts` pins that the two agree.
 */
export const ATOMIC_TMP = /\.[0-9a-f]{8}\.tmp$/

/**
 * How long a refused rename is waited out. On Windows a scanner (Defender, the search indexer) can hold a file that was just closed for a moment, and the rename
 * of it is refused (EBUSY, EPERM or EACCES) - the same reason graceful-fs retries. The render swap (`partialOutput.ts`, T-140) was the first to wait it out; T-198 (1)
 * moved the wait here so every tmp-and-rename write has it. About a second and a half before it is given up; the quit's wait for a run to end is 1.5 s.
 */
export const COMMIT_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 800]
export const LOCKED_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES'])

/**
 * T-198 (1) - `rename(from, to)`, waiting out a refusal that a scanner's moment explains. A lock code (EBUSY, EPERM, EACCES) is tried again after each of
 * `COMMIT_RETRY_DELAYS_MS`; any other code, and the refusal after the last wait, is thrown as it came (the disk's own error). `check`, when given, is called after
 * each wait (the render swap passes its run's Cancel check, so a Cancel still lands between tries). A target another app really holds still refuses, after the waits.
 */
export async function renameWhenFree(from: string, to: string, check?: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const delay = COMMIT_RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !LOCKED_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      await new Promise((resolve) => setTimeout(resolve, delay))
      check?.()
    }
  }
}

/**
 * T-141 (10) - ask the disk to hold `file`'s bytes before they are renamed into place, best effort, and never leave the handle open.
 *
 * The open, the `sync` and the `close` are one unit: a `sync` that REJECTS (a drive or a share that cannot fsync) must still close what it opened. The autosave
 * kept its own copy of this with the close after the sync inside a swallowing catch, so a rejecting sync skipped it and leaked one descriptor per write for the
 * session (executed), and on Windows a handle still open blocks the unlink and the rename of that tmp. A failure anywhere in it (the open too) is swallowed: the
 * bytes are written, the rename that follows is what makes them the file, and a failed sync must not turn a good write into a refused one.
 */
export async function flushToDisk(file: string): Promise<void> {
  try {
    const handle = await open(file, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    /* not fatal */
  }
}

/**
 * T-139 (1) - write a file the person chose or owns so that it is the OLD file until the NEW one is whole.
 *
 * `writeFile(target, data)` opens the target for writing and truncates it before the first new byte lands, so a write that fails after it began
 * (a full or removed drive, a crash) leaves neither the old file nor the new one: executed on a tmpfs, ENOSPC left a 2,097,152-byte file Open
 * refused where a project had been. This writes the bytes to a tmp name of its own BESIDE the target (a rename across volumes is not atomic),
 * flushes them, and renames the tmp over the target. `rename` replaces an existing file on Windows too (MoveFileEx with REPLACE_EXISTING), and a
 * target another app holds open without delete sharing refuses the rename (EPERM/EBUSY), so the person keeps the old file and is told why. On ANY
 * failure the tmp is removed (its own error ignored) and the ORIGINAL error is rethrown, so the caller's `catch` and `userFacingError` see the
 * disk's words, not ours.
 *
 * The flush is best effort: a drive that cannot fsync still gets a whole file, and a failed sync must not turn a good write into a refused one.
 * T-198 (1): the rename waits out a scanner's moment (`renameWhenFree`) before it gives up. (`autosave.ts` keeps its own tmp-and-rename: it also keeps the previous
 * snapshot, which this does not. It flushes through `flushToDisk` and renames through `renameWhenFree` too.)
 */
// simplification: the new file takes the folder's default attributes and ACL, not the old file's, and a symlink at the target is replaced rather than
// written through. A person's project, picture, subtitle or board file has neither; the upgrade is to copy the old file's mode onto the tmp before the rename.
export async function writeFileAtomic(target: string, data: string | Buffer): Promise<void> {
  // T-183 (2): the tmp is 13 characters longer than the target, so a target of 243-255 (a transcript of a long VOD's name) got a tmp the disk could not create:
  // the name is fitted, beside the target as before.
  const tail = `.${randomBytes(4).toString('hex')}.tmp`
  const leaf = path.basename(target)
  const tmp = `${target.slice(0, target.length - leaf.length)}${fitFileName(leaf, tail, NAME_UNIT)}${tail}`
  try {
    await writeFile(tmp, data)
    await flushToDisk(tmp)
    await renameWhenFree(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}
