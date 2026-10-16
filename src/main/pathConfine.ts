import path from 'node:path'

/**
 * Is `target` outside `root`? The one answer to that question in main (T-117).
 *
 * `path.relative(root, target)` leaves the folder only when its FIRST SEGMENT is `..` - the whole
 * of `..` (`rel === '..'`, the parent itself) or `..` followed by a separator - or when it is
 * absolute (a different drive: `D:\x` from `C:\captions`). The three sites that used to ask
 * `rel.startsWith('..')` also refused a file INSIDE the folder whose own name starts with two
 * dots: transcripts are named from the video, and `..intro.mp4` or `...and then-123.srt` is a
 * legal name on Windows. A name is not a segment.
 *
 * `target === root` is not outside (the relative path is empty); a caller that wants a file under
 * the folder, not the folder, finds that out when it reads it. `flavor` is for the tests: the app
 * ships on Windows and CI runs elsewhere, so they hand in `path.win32` to hold the Windows rules.
 */
export function isOutsideFolder(root: string, target: string, flavor: typeof path = path): boolean {
  const rel = flavor.relative(root, target)
  return rel === '..' || rel.startsWith('..' + flavor.sep) || flavor.isAbsolute(rel)
}
