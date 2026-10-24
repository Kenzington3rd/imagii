/**
 * T-132 (4), T-131 (1): "ffmpeg exited 0" is not "ffmpeg wrote a picture".
 *
 * A range that lies past the end of the PICTURE makes ffmpeg exit 0 having written nothing a viewer can use, and the runners that only
 * looked at the exit code said "Saved" over it. Two shapes, both measured on both majors (7.0.2 and 6.1.1):
 *
 *  - the range is past the end of the whole file (OBS reusing a file name leaves a project pointing at a shorter recording): the output is
 *    a 261-byte container with no streams, and stderr says "Output file is empty, nothing was encoded";
 *  - the range is past the last frame of a file whose SOUND runs longer than its picture: the output is an audio-only mp4, and stderr says
 *    nothing of the kind. The one fact that holds in both is ffmpeg's own progress block: `frame=0` in the last of them.
 *
 * Three runners that cut a video out of a RANGE of a source read both, through `wroteNoPicture` - Export, Reframe and (T-133 (4)) the caption
 * burn-in - and a legitimate 10-20 ms segment (one frame) stays a success. A compilation's segments (`concat.ts`) read the stderr line alone,
 * which is sufficient THERE (T-134 (4), measured on both majors by three parties): a segment ends in `apad` and `-shortest`, so a range past the
 * picture comes out as a truly streamless ~970-byte stub AND the "Output file is empty" line at the verbosity the app runs, never the audio-only
 * file the other three can meet. (The Clip Kit's thumbnails ask `wroteOutput` instead: a JPEG has no frame count; and a GIF of such a range
 * already fails, exit 234, measured on both majors.) The burn-in was the one writer left out until T-133: it said "Captions burned in" over an
 * audio-only file.
 */

/**
 * What ffmpeg says (exit 0, both majors, measured) when a segment's range holds nothing to write: it wrote a ~970-byte Matroska stub.
 * Layer 5 runs the real binary against this line (T-131 (1)), so a release whose wording changed fails there, not in the field.
 */
export const FFMPEG_EMPTY_OUTPUT = /Output file is empty/

/**
 * Reads the picture frames ffmpeg's `-progress pipe:1` reports: `frame=<n>` once per block, the last block (`progress=end`) holding the
 * total. Fed the stream chunk by chunk, it keeps the unfinished line of a chunk until the rest arrives: a chunk can end in the middle of
 * "frame=" and the half that has arrived must not read as `frame=` with nothing after it (zero).
 */
export class PictureFrames {
  private rest = ''
  private frames: number | null = null

  feed(chunk: string): void {
    const lines = (this.rest + chunk).split(/\r?\n/)
    this.rest = lines.pop() ?? ''
    for (const line of lines) {
      const found = /^frame=\s*(\d+)$/.exec(line.trim())
      if (found?.[1] !== undefined) this.frames = Number(found[1])
    }
  }

  /** True only when ffmpeg SAID it encoded no frames at all. A stream that never said (a stub, a crash before the first block) is not "none". */
  get none(): boolean {
    return this.frames === 0
  }
}

/** The one yes-or-no a closing runner asks: did this run write nothing a viewer can use? */
export function wroteNoPicture(stderrSawEmpty: boolean, frames: PictureFrames): boolean {
  return stderrSawEmpty || frames.none
}

/** The longest clip name a refusal quotes: the sentence must stay one finished line (`userFacingError` lets one of at most 240 characters stand). */
const CLIP_NAME_MAX = 50

/**
 * T-132 (12): how a refusal names a clip - by the name the person sees in the list. Default names are creation-numbered ("Clip 5" is the
 * fifth clip ever made in this video, wherever it sits in a compilation), so "Clip 2 of the compilation" by POSITION named a clip the person
 * may not call that at all. One line, trimmed, shortened with an ellipsis; null for a name that is not text or is blank.
 */
export function clipNameForSentence(seg: { name?: unknown } | undefined): string | null {
  if (typeof seg?.name !== 'string') return null
  const flat = seg.name.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return null
  // T-133 (3): by code point, not UTF-16 unit - a unit cut can keep the first half of a glyph outside the BMP (an emoji) before the ellipsis.
  const glyphs = Array.from(flat)
  return glyphs.length > CLIP_NAME_MAX ? `${glyphs.slice(0, CLIP_NAME_MAX - 1).join('').trimEnd()}…` : flat
}

/** Export's refusal (T-132 (4)): the clip the person built, by its name; the cause is the clip's range (a restored project's video may be shorter now). */
export function exportNoPictureMessage(clip: { name?: unknown } | undefined): string {
  const name = clipNameForSentence(clip)
  const who = name ? `The clip "${name}"` : 'This clip'
  return `${who} has no picture in the video (check its start and end), so nothing was exported.`
}

/** Reframe's refusal (T-132 (4)): the 9:16 file is made from a range, and the range has no picture. */
export const REFRAME_NO_PICTURE_MESSAGE =
  "This part of the video has no picture (check the clip's start and end), so no 9:16 file was saved."

/** The ranged caption burn-in's refusal (T-133 (4)): the captioned file is made from a range, and the range has no picture. */
export const BURN_IN_NO_PICTURE_MESSAGE =
  "This part of the video has no picture (check the clip's start and end), so no captioned video was saved."

/** Clip Kit's thumbnail refusal (T-132 (4)): a frame is taken at a moment, and the video has no picture at that moment. */
export const FRAME_NO_PICTURE_MESSAGE =
  "The video has no picture at that point (check the clip's start and end), so the thumbnail was not saved."
