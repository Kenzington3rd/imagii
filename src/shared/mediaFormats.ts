/**
 * Supported import formats — the single source of truth.
 *
 * Round 20 (2026-08-14): before this module, FIVE hand-rolled extension
 * lists lived across the pickers and drop zones (ipc/video, ipc/audio,
 * Importer, AudioImporter, ImportPanel) and had already drifted — the
 * audio picker's video filter was missing m4v. Same disease that broke
 * the imagii-file:// round-trip: two copies agreeing by luck. Every
 * picker filter, drop-zone check, and hint string now derives from
 * here.
 *
 * The video tiering is honest about what Chromium can do. Electron's
 * <video> element plays mp4/mov/m4v/webm/mkv (and usually avi) but NOT
 * flv/ts/wmv/mpg/3gp — ffmpeg reads those fine, the preview just can't.
 * So natively-playable containers load directly, and the rest are
 * transcoded to an mp4 working copy on import (src/main/ffmpeg/
 * convert.ts, proven per-container in the Layer 5 suite). Audio is the
 * same split: WebAudio decodes the common formats; aiff/wma route
 * through the existing extract-to-wav path.
 */

/** Containers Electron's <video> element can preview directly. */
export const NATIVE_VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'] as const

/**
 * Containers ffmpeg reads but Chromium cannot preview — converted to an
 * mp4 working copy on import. flv/ts/m2ts are the OBS-and-stream-dump
 * family; the rest are the long tail of "a friend sent me this".
 *
 * PER-PLATFORM CAVEAT (ts/m2ts/mts): ffmpeg-static ships binaries from
 * DIFFERENT upstream builders per platform. The linux x64 binary
 * (johnvansickle 7.0.2-static) SIGSEGVs on any muxed output from an
 * mpegts input; the win32 x64 binary (gyan.dev 6.1.1) — the one that
 * ships in the product — handles the whole family cleanly, proven by
 * running the exact repro under wine (2026-08-14: transcode from
 * mpeg2-in-ts and h264-in-ts, m2ts, and wav extraction all exit 0).
 * Consequence: importing a .ts works in the shipped Windows app but
 * crashes the convert child in linux dev runs. The Layer 5 matrix gates
 * these entries by platform, and a linux-only test pins the segfault so
 * an ffmpeg-static upgrade that fixes it surfaces loudly.
 */
export const CONVERT_VIDEO_EXTENSIONS = [
  'flv',
  'ts',
  'm2ts',
  'mts',
  'wmv',
  'mpg',
  'mpeg',
  '3gp'
] as const

export const VIDEO_EXTENSIONS: readonly string[] = [
  ...NATIVE_VIDEO_EXTENSIONS,
  ...CONVERT_VIDEO_EXTENSIONS
]

/** Audio formats WebAudio decodes directly (waveform + playback). */
export const WEB_AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'] as const

/** Audio formats that need the ffmpeg extract-to-wav path first. */
export const EXTRACT_AUDIO_EXTENSIONS = ['aiff', 'aif', 'wma'] as const

export const AUDIO_EXTENSIONS: readonly string[] = [
  ...WEB_AUDIO_EXTENSIONS,
  ...EXTRACT_AUDIO_EXTENSIONS
]

/** Image formats Chromium decodes natively (Stream Graphics import). */
export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'bmp',
  'svg',
  'webp',
  'gif',
  'avif'
] as const

/** Case-insensitive "does this filename end in one of these extensions". */
export function hasExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase()
  return extensions.some((ext) => lower.endsWith(`.${ext}`))
}

export function isVideoFilename(name: string): boolean {
  return hasExtension(name, VIDEO_EXTENSIONS)
}

export function isAudioFilename(name: string): boolean {
  return hasExtension(name, AUDIO_EXTENSIONS)
}

export function isImageFilename(name: string): boolean {
  return hasExtension(name, IMAGE_EXTENSIONS)
}

/** True when a video file must be transcoded to mp4 before preview. */
export function videoNeedsConversion(name: string): boolean {
  return hasExtension(name, CONVERT_VIDEO_EXTENSIONS)
}

/**
 * True when the Audio studio must route a file through ffmpeg
 * extract-to-wav: any video container, or an audio format WebAudio
 * can't decode.
 */
export function audioNeedsExtraction(name: string): boolean {
  return isVideoFilename(name) || hasExtension(name, EXTRACT_AUDIO_EXTENSIONS)
}

/**
 * What the Player says when it cannot draw a video's picture (T-135 (2)). The preview is Chromium's `<video>`, which decodes what Chromium has a
 * decoder for (H.264, VP9, AV1); ProRes and 10-bit HEVC probe fine, load ("Video loaded"), play their sound and draw nothing, with no error to hear.
 * Everything else reads the file with ffmpeg, so the sentence says what still works (the person's next worry is whether the file is lost) and does
 * not blame the file. The Player offers a preview copy beside it.
 */
export const PREVIEW_UNAVAILABLE_MESSAGE =
  "imagii can't preview this video's picture format — trimming, scanning and export still work."

/**
 * What the Output preview says in place of "Live snapshot at the playhead position..." while the Player cannot draw the video's picture (T-136 (6)).
 * The preview mirrors the Player's element onto a canvas, so the same video that leaves the Player black leaves this box black; a caption promising a
 * live snapshot under a black box is the silent dead end T-135 (2) fixed in the Player. One line: what the box shows, why, and that the export is not
 * affected. The Player's note beside the picture is the one that offers the preview copy.
 */
export const OUTPUT_PREVIEW_UNAVAILABLE_MESSAGE =
  "No snapshot to show: imagii can't preview this video's picture format. Your exports are not affected."

/** "MP4, MOV, AVI" — uppercase hint copy for drop zones, from one list. */
export function formatHint(extensions: readonly string[]): string {
  return extensions.map((e) => e.toUpperCase()).join(', ')
}

/**
 * The video codecs (ffprobe's `codec_name`) an MP4 can carry as they are
 * (T-111): what a stream-copy mux into `.mp4` may be handed. Anything else —
 * wmv2 from a .wmv, vp8/vp9 from a .webm, theora, mpeg2video, prores, dv — makes
 * `-c:v copy` into an mp4 fail ("Could not find tag for codec wmv2 in stream
 * #0, codec not currently supported in container") or write a file that no
 * player opens, so those pictures are re-encoded instead. VP9 is on the wrong
 * side of the line on purpose: ffmpeg will write it into an MP4, and half the
 * players a streamer's audience owns will not play it.
 */
export const MP4_COPYABLE_VIDEO_CODECS: readonly string[] = ['h264', 'hevc', 'av1', 'mpeg4', 'mjpeg']

/** True when a picture in `codec` can be stream-copied into an mp4. */
export function canStreamCopyIntoMp4(codec: string | null | undefined): boolean {
  return typeof codec === 'string' && MP4_COPYABLE_VIDEO_CODECS.includes(codec.toLowerCase())
}
