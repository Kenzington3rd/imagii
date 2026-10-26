import { randomBytes } from 'node:crypto'
import { open, rename, unlink, writeFile } from 'node:fs/promises'

/**
 * The name of a tmp this module makes, as a pattern: `<target>.<8 hex>.tmp`. For code that LISTS a folder a write may be in the middle of (the e2e helpers
 * that count the files a save produced): the tmp is there for the length of the write, a poll on a count sees it, and it is gone by the rename. Kept beside the
 * line that builds the name; `fsAtomic.test.ts` pins that the two agree.
 */
export const ATOMIC_TMP = /\.[0-9a-f]{8}\.tmp$/

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
 * (`autosave.ts` keeps its own tmp-and-rename: it also keeps the previous snapshot, which this does not.)
 */
// simplification: the new file takes the folder's default attributes and ACL, not the old file's, and a symlink at the target is replaced rather than
// written through. A person's project, picture, subtitle or board file has neither; the upgrade is to copy the old file's mode onto the tmp before the rename.
export async function writeFileAtomic(target: string, data: string | Buffer): Promise<void> {
  const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, data)
    try {
      const handle = await open(tmp, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch {
      /* not fatal: the bytes are written, the rename below is what makes them the file */
    }
    await rename(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}
