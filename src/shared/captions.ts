import { assert } from './assert'
import { countOf } from './plural'

export interface CaptionsInstallStatus {
  exeInstalled: boolean
  exePath: string
  modelInstalled: boolean
  modelPath: string
  modelsDir: string
  ready: boolean
}

export interface CaptionSegment {
  startSec: number
  endSec: number
  text: string
}

export interface TranscribeRequest {
  jobId: string
  sourcePath: string
  language?: string
}

export interface TranscribeResult {
  jobId: string
  srtPath: string
  segments: CaptionSegment[]
  durationMs: number
}

export type CaptionPosition = 'top' | 'middle' | 'bottom'

export interface CaptionStyle {
  /**
   * The size handed to libass `force_style` FontSize, 16-96. NOT pixels:
   * libass measures it against a 288-line script, so the picture scales it —
   * `effectiveCaptionPx` is what it comes to on a given frame (the default 32
   * is ~120 px on 1080p). Stored as-is; only its label and the readout beside
   * it changed in T-89.
   */
  fontSize: number
  /** Vertical placement: top/middle/bottom of the frame. */
  position: CaptionPosition
  /** Hex `#RRGGBB` for the text fill. Translated to ASS &Hbbggrr&. */
  primaryColor: string
  /** Hex `#RRGGBB` for the outline. Translated to ASS &Hbbggrr&. */
  outlineColor: string
}

/**
 * The sound the speech engine is given (T-111): 16 kHz mono, whisper's native
 * input. It resamples whatever it reads to this anyway, and older `whisper.exe`
 * builds refuse a WAV that is not 16 kHz. Audio Studio's extraction is 48 kHz
 * stereo (about 690 MB an hour); this is about 115 MB an hour, which is what a
 * long VOD's scratch file in %TEMP% costs. Transcription-only: nothing a person
 * hears is ever made from it.
 */
export const TRANSCRIPTION_AUDIO = { sampleRate: 16000, channels: 1 } as const

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 32,
  position: 'bottom',
  primaryColor: '#ffffff',
  outlineColor: '#000000'
}

/**
 * Phase 4A.2: named one-click caption styling presets. Each is a complete
 * CaptionStyle the renderer can apply with a single click — most users
 * will never touch the underlying sliders. Order is "most expected first":
 * TikTok-style is the default people reach for; accessibility is the most
 * conservative; subtle is for podcast-style content where captions should
 * never dominate; reels-minimal is the muted take.
 */
export interface CaptionStylePreset {
  id: 'tiktok-bold' | 'reels-minimal' | 'subtle-subtitle' | 'big-outline-accessibility'
  label: string
  hint: string
  style: CaptionStyle
}

export const CAPTION_STYLE_PRESETS: readonly CaptionStylePreset[] = [
  {
    id: 'tiktok-bold',
    label: 'TikTok bold',
    // INIT-B (round 15): the dominant TikTok caption convention sits at the
    // bottom — mid-frame collides with the creator's face. Update the hint
    // and default position to match.
    hint: 'Big white text, thick black outline, lower third — current TikTok convention.',
    style: {
      fontSize: 56,
      position: 'bottom',
      primaryColor: '#ffffff',
      outlineColor: '#000000'
    }
  },
  {
    id: 'reels-minimal',
    label: 'Reels minimal',
    hint: 'Smaller, lower-third, muted — fits Reels/IG aesthetics that punish loud captions.',
    style: {
      fontSize: 28,
      position: 'bottom',
      primaryColor: '#f5f5f5',
      outlineColor: '#222222'
    }
  },
  {
    id: 'subtle-subtitle',
    label: 'Subtle subtitle',
    hint: 'Classic small bottom subtitle. Use for podcasts/long-form where captions should never dominate.',
    style: {
      fontSize: 24,
      position: 'bottom',
      primaryColor: '#ffffff',
      outlineColor: '#000000'
    }
  },
  {
    id: 'big-outline-accessibility',
    label: 'Big-outline accessibility',
    hint: 'High-contrast yellow with thick black outline — maximum readability for low-vision viewers.',
    style: {
      fontSize: 48,
      position: 'bottom',
      primaryColor: '#ffff00',
      outlineColor: '#000000'
    }
  }
] as const

export interface BurnInRequest {
  jobId: string
  videoPath: string
  srtPath: string
  outputPath: string
  /** Legacy field — when style.fontSize is provided, that wins. */
  fontSizePct: number
  /** Phase 3.1: optional libass style overrides. */
  style?: CaptionStyle
  /** Phase 3.1: when set, burn captions only over the trimmed range. */
  startSec?: number
  endSec?: number
}

export interface CaptionsProgress {
  jobId: string
  phase: 'extracting' | 'transcribing' | 'building-srt' | 'burning-in' | 'done'
  /**
   * 0-100, only when main KNOWS how far along the phase is. Absent means the
   * phase has no measurable progress (extracting audio, running the speech
   * engine, writing the SRT) and the UI shows an indeterminate bar — T-89: the
   * transcribe phase used to send `15 + Math.random() * 10`, a number that
   * jittered between 15 and 25 and meant nothing.
   *
   * The burn-in is the one phase with a measurement (T-111): the encode position
   * ffmpeg reports (`out_time`) over the length of the file being written, from
   * `burnInPercent`. It used to be `5 + 0.5 per second encoded` — a number that
   * was ahead of the work on a short clip, stuck at its cap on a long one, and
   * never related to either. It starts at 0 (nothing is encoded yet, which is
   * true), tops out at 99 (the last percent is the file being finalized, and
   * `done` is the only 100), and is absent when the length of the output is not
   * known — then the bar is indeterminate, like the phases above.
   */
  percent?: number
  message?: string
}

/** What each phase is called to the user — never the id ("BUILDING-SRT"). */
const PHASE_LABELS: Record<CaptionsProgress['phase'], string> = {
  extracting: 'Extracting audio…',
  transcribing: 'Transcribing…',
  'building-srt': 'Building captions…',
  'burning-in': 'Burning in…',
  done: 'Done'
}

export function captionPhaseLabel(phase: CaptionsProgress['phase']): string {
  return PHASE_LABELS[phase]
}

/**
 * libass's default script height (PlayResY). An SRT carries no script size, so
 * libass scales every `force_style` FontSize against a 288-line frame: the
 * number is a fraction of the picture, not a pixel count (T-11's lesson, where
 * a nominal 24 measured ~90 px on 1080p).
 */
export const ASS_PLAY_RES_Y = 288

/** The frame height the Size readout speaks in. */
export const CAPTION_REFERENCE_HEIGHT = 1080

/**
 * The height, in pixels, a caption's size is measured against on a frame
 * `frameWidth` x `frameHeight` (T-111): the 16:9 picture that frame's WIDTH would
 * make. On 16:9 and wider that is the frame's own height, exactly libass's
 * behavior, so no landscape caption changes. On a narrower frame it is
 * `frameWidth * 9 / 16`: libass scales by frame HEIGHT, so a 1080x1920 clip got
 * text 1.78x the size it has on a 1920x1080 one in the same proportion of its
 * width, and the default 32 wrapped into an 817 px block (43% of the frame) on
 * a vertical clip. Without a width the height is all there is.
 */
export function captionBasisPx(frameHeight: number, frameWidth?: number): number {
  assert(Number.isFinite(frameHeight) && frameHeight > 0, 'frameHeight must be a positive number')
  if (frameWidth === undefined) return frameHeight
  assert(Number.isFinite(frameWidth) && frameWidth > 0, 'frameWidth must be a positive number')
  return Math.min(frameHeight, (frameWidth * 9) / 16)
}

/**
 * What a caption `fontSize` comes to in real pixels on a frame
 * `frameHeight` px tall: `fontSize * frameHeight / 288`. The default 32 is
 * ~120 px on 1080p and the slider's maximum, 96, is 360 px — a label that said
 * "px" was off by a factor of 3.75 at every setting. Give the frame's width as
 * well and a frame narrower than 16:9 is measured on its 16:9-equivalent
 * (`captionBasisPx`), which is what the burn-in now draws: 32 is ~120 px on
 * 1920x1080 and ~68 px on 1080x1920 — the same fraction of the frame's WIDTH
 * (6.3%), which is the measure that keeps the line wrapping the same way (T-111).
 */
export function effectiveCaptionPx(
  fontSize: number,
  frameHeight: number = CAPTION_REFERENCE_HEIGHT,
  frameWidth?: number
): number {
  assert(Number.isFinite(fontSize) && fontSize > 0, 'fontSize must be a positive number')
  return Math.round((fontSize * captionBasisPx(frameHeight, frameWidth)) / ASS_PLAY_RES_Y)
}

/**
 * True for a frame whose width and height are both positive, finite numbers. A probe
 * can answer 0 (a stream with no picture size, ffprobe's own "N/A") and
 * `captionBasisPx` asserts a positive one, so the burn and the size readout both ask
 * this first and treat anything else as "no frame known" — the landscape behavior (T-113).
 */
export function isUsableFrame(
  frame: { width: number; height: number } | null | undefined
): frame is { width: number; height: number } {
  return (
    frame !== null &&
    frame !== undefined &&
    Number.isFinite(frame.width) &&
    frame.width > 0 &&
    Number.isFinite(frame.height) &&
    frame.height > 0
  )
}

/**
 * The script height to give libass for a frame narrower than 16:9, or `null` when
 * the frame needs none (T-111). libass draws a `FontSize` at `frameHeight /
 * PlayResY` pixels per unit; a PlayResY of `288 * frameHeight / basis` makes that
 * `basis / 288` — the 16:9-equivalent scale of `captionBasisPx`. It is `null` on
 * 16:9 and wider, and on a frame so close to 16:9 that the answer rounds to 288,
 * so a landscape burn's command is exactly what it was before. PlayResY must be a
 * whole number, which costs under 0.1% of size.
 */
export function captionPlayResY(frameWidth: number, frameHeight: number): number | null {
  const basis = captionBasisPx(frameHeight, frameWidth)
  const playResY = Math.round((ASS_PLAY_RES_Y * frameHeight) / basis)
  return playResY === ASS_PLAY_RES_Y ? null : playResY
}

/**
 * How long the file a burn-in writes will be, in seconds, or `null` when that is
 * not known (T-111): the range when there is one — clipped to what the source
 * actually has after `startSec` — otherwise the source's own length.
 */
export function burnInLengthSec(
  sourceDurationSec: number | null,
  range: { startSec: number; endSec: number } | null
): number | null {
  if (range === null) {
    return sourceDurationSec !== null && sourceDurationSec > 0 ? sourceDurationSec : null
  }
  const asked = range.endSec - range.startSec
  if (sourceDurationSec === null || !(sourceDurationSec > 0)) return asked > 0 ? asked : null
  const left = sourceDurationSec - range.startSec
  const length = Math.min(asked, left)
  return length > 0 ? length : null
}

/**
 * A burn-in's progress, 0-99, from where the encode is (`elapsedSec`, ffmpeg's
 * `out_time` — the position in the OUTPUT, which starts at 0 even for a ranged
 * burn) and how long the output will be (T-111). `undefined` when the length is
 * unknown or the position is not a usable number. Never 100: the file is still
 * being finalized (the MP4's index is written after the last frame), and `done`
 * is the only 100. Also the MP4 convert's percent (T-115) - one mapping for every encode bar.
 */
export function burnInPercent(elapsedSec: number, totalSec: number | null): number | undefined {
  if (totalSec === null || !(totalSec > 0) || !Number.isFinite(totalSec)) return undefined
  if (!Number.isFinite(elapsedSec)) return undefined
  return Math.min(99, Math.max(0, (elapsedSec / totalSec) * 100))
}

/**
 * The readout beside the Size slider. With a video loaded it is about THAT
 * video's frame (T-112: `effectiveCaptionPx` with its height and width, so it is
 * the size the burn draws); with none — or a probe that could not size it — it
 * keeps the 1080p wording, the frame the number is quoted on.
 */
export function captionSizeReadout(
  fontSize: number,
  frame?: { width: number; height: number } | null
): string {
  if (isUsableFrame(frame)) {
    return `about ${effectiveCaptionPx(fontSize, frame.height, frame.width)} px tall on this video`
  }
  return `about ${effectiveCaptionPx(fontSize)} px tall on ${CAPTION_REFERENCE_HEIGHT}p`
}

/** The toast after a transcription: lines of caption, counted properly. */
export function captionsReadyMessage(segmentCount: number): string {
  return `Captions ready (${countOf(segmentCount, 'line')})`
}

/**
 * The toast when a transcription finishes for a video that is no longer the one open (T-113).
 * "Another video" was wrong for the case where the video was only CLOSED (nothing replaced
 * it), so it says what is true of both — closed or replaced — and what to do: the captions
 * were thrown away, not kept somewhere, so the way back is to transcribe again.
 */
export function staleCaptionsMessage(fileName: string): string {
  return (
    `Captions for ${fileName} finished after that video was closed or replaced, so they weren't added. ` +
    "Transcribe again when you're ready."
  )
}

/**
 * The toast after a burn-in. A ranged burn over a stretch nobody speaks in
 * still writes the clip — without a subtitle stage (T-81) — and "Captions
 * burned in" over a file with none is a false success.
 */
export function burnInDoneMessage(captioned: boolean): string {
  return captioned
    ? 'Captions burned in'
    : 'No captions in this range — exported without captions.'
}

/** Phase 4E: Whisper model auto-install progress events. */
export interface ModelInstallProgress {
  phase: 'starting' | 'downloading' | 'verifying' | 'done' | 'failed'
  bytesDownloaded?: number
  totalBytes?: number
  percent?: number
  message?: string
}

/** The model file imagii ships against. Pinned to base.en for English-only,
 *  reasonable accuracy, ~141 MB on disk. Changing this requires updating
 *  WHISPER_MODEL_URL together. */
export const WHISPER_MODEL_FILENAME = 'ggml-base.en.bin'

/** Canonical download URL. Hugging Face mirror is used because GitHub LFS
 *  for the same file is rate-limited per IP and unreliable. */
export const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'

/** Sanity-check bounds. Real file is ~141 MB; reject anything outside this
 *  range as either incomplete or wrong-file-served. */
export const WHISPER_MODEL_MIN_BYTES = 100 * 1024 * 1024
export const WHISPER_MODEL_MAX_BYTES = 200 * 1024 * 1024

/**
 * INIT-C (round 15): pinned SHA-256 of the canonical ggml-base.en.bin from
 * the Hugging Face mirror at WHISPER_MODEL_URL. Sourced from the model's
 * file metadata at
 *   https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-base.en.bin
 * (use the LFS pointer's `oid sha256:` line, also exposed via the
 * Hugging Face API). Verifying this AT install time defends against:
 *   1. An attacker who controls the mirror serving a backdoored model.
 *   2. A subtle network corruption that gets past the size sanity-check.
 * Mismatch deletes the .partial download and reports failure to the UI.
 *
 * If the upstream rotates this artifact (intentional model revision), the
 * size-bounds check still gates the worst class of failure, and updating
 * this constant is the explicit, auditable handoff for the new file.
 */
export const WHISPER_MODEL_SHA256 =
  'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'

/**
 * Round 18: escape a filesystem path for use as the UNQUOTED value of
 * `subtitles=` in an ffmpeg filter graph. The path passes through TWO
 * parsers — the filtergraph parser (splits on , ; and honors '…'/\x) and
 * then the filter-option parser (splits on : and honors \x) — so every
 * special character needs two rounds of backslash-escaping. The prior
 * single-quote-wrapping approach broke on any filename containing an
 * apostrophe ("Sam's Highlight.mp4"-derived SRTs failed to burn in);
 * verified against real ffmpeg for apostrophes, spaces, commas,
 * semicolons, brackets, and Windows drive colons.
 *
 * T-118: and equals signs. The burn-in passes the path as the filter's first,
 * POSITIONAL option (`subtitles=<path>:force_style=...`), so an unescaped `=`
 * made the option parser split the path into a name and a value ("Error
 * applying option '.../a' to filter 'subtitles': Option not found", exit 8) -
 * a video called "Boss=Dead.mp4" could never be captioned.
 */
export function escapeSubtitlesPath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const optionLevel = normalized.replace(/([\\':,;[\]=])/g, '\\$1')
  return optionLevel.replace(/([\\':,;[\] =])/g, '\\$1')
}

/**
 * Parse SRT-style timestamps. Supports the standard 3-digit fractional form
 * ("00:00:01,500") AND any variable-length fractional ("00:00:01,5",
 * "00:00:01,50", "00:00:01,1234") — Whisper and other tools occasionally
 * emit non-3-digit fractions and the original Number(m[4]) / 1000 was
 * silently wrong by orders of magnitude. parseFloat('0.' + frac) restores
 * the value regardless of digit count.
 */
export function tsToSeconds(ts: string): number {
  const m = ts.match(/(\d+):(\d+):(\d+)[.,](\d+)/)
  if (!m) return 0
  const h = m[1]
  const min = m[2]
  const s = m[3]
  const frac = m[4]
  if (!h || !min || !s || !frac) return 0
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + parseFloat('0.' + frac)
}

function msToSrtTimestamp(ms: number): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, '0')
  return (
    `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:` +
    `${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`
  )
}

/** Folder under userData that holds Whisper's SRTs (and the burn-in's temp copies). */
export const CAPTIONS_DIR_NAME = 'captions'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SHIFTED_SRT_NAME = new RegExp(`\\.srt\\.clip-${UUID}\\.srt$`, 'i')

/**
 * Where a ranged burn-in writes its shifted copy of `srtPath` (T-81): beside
 * the real SRT, named for it, with a UUID. Naming and sweeping live together
 * so they cannot drift: `isShiftedSrtName` is what the launch-time temp sweep
 * matches, and it is strict on purpose — the folder also holds the user's real
 * transcripts, which must never be mistaken for a temp file.
 */
export function shiftedSrtPath(srtPath: string, id: string): string {
  assert(new RegExp(`^${UUID}$`, 'i').test(id), 'shifted SRT id must be a UUID')
  return `${srtPath}.clip-${id}.srt`
}

/** True iff `fileName` is a leftover shifted copy made by `shiftedSrtPath`. */
export function isShiftedSrtName(fileName: string): boolean {
  return SHIFTED_SRT_NAME.test(fileName)
}

const SRT_TIME_LINE = /^\s*(\d+:\d+:\d+[.,]\d+)\s*-->\s*(\d+:\d+:\d+[.,]\d+)/

/**
 * T-81: re-express a SOURCE-clock SRT on the clock of a clip cut from
 * [startSec, endSec] of that source. Every cue moves by -startSec; a cue
 * wholly outside the range is dropped; a cue straddling an edge is clamped
 * to it (an SRT cannot say "starts at -0.5 s", and the visible half of a
 * sentence in progress is exactly what a viewer of the clip should see).
 * Cues are renumbered from 1 and timestamps re-serialised as hh:mm:ss,mmm
 * whatever shape they arrived in. Returns '' when nothing is left — ffmpeg's
 * `subtitles` filter cannot open a cue-less file, so the caller has to
 * decide what an empty window means.
 *
 * Arithmetic is in whole milliseconds, the SRT's own resolution, so a shift
 * never accumulates float error.
 *
 * `speed` (T-113, default 1) is the clip's playback speed: the export plays the range
 * at `setpts=PTS/speed`, so the file the cues sit beside is `(endSec - startSec) /
 * speed` long and a cue at clip-time t belongs at t / speed on ITS clock. The Clip
 * Kit bundles this SRT beside that file; the burn-in has no speed and passes none.
 * The cut to the range comes first and the division second, so a cue never outlives
 * the clip it sits beside.
 *
 * simplification: only the timestamps and the text survive. Cue settings
 * after the end time (X1:/Y1: coordinates) are not carried — libass's SRT
 * reader ignores them anyway. Upgrade path if that ever changes: capture the
 * tail of the time line in SRT_TIME_LINE and re-append it.
 */
export function shiftSrtToRange(srt: string, startSec: number, endSec: number, speed = 1): string {
  assert(Number.isFinite(startSec) && startSec >= 0, 'startSec must be finite >= 0')
  assert(Number.isFinite(endSec) && endSec > startSec, 'endSec must be finite > startSec')
  assert(Number.isFinite(speed) && speed > 0, 'speed must be a finite number > 0')
  const startMs = Math.round(startSec * 1000)
  const endMs = Math.round(endSec * 1000)
  const cues: string[] = []
  for (const block of srt.replace(/^﻿/, '').split(/\r?\n[ \t]*\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const at = lines.findIndex((l) => l.includes('-->'))
    const times = at === -1 ? null : SRT_TIME_LINE.exec(lines[at] ?? '')
    if (!times?.[1] || !times[2]) continue
    const text = lines.slice(at + 1).filter((l) => l.trim() !== '')
    if (text.length === 0) continue
    const clippedFrom = Math.max(Math.round(tsToSeconds(times[1]) * 1000), startMs) - startMs
    const clippedTo = Math.min(Math.round(tsToSeconds(times[2]) * 1000), endMs) - startMs
    if (clippedTo <= clippedFrom) continue
    const from = Math.round(clippedFrom / speed)
    const to = Math.round(clippedTo / speed)
    if (to <= from) continue
    cues.push(`${cues.length + 1}\n${msToSrtTimestamp(from)} --> ${msToSrtTimestamp(to)}\n${text.join('\n')}\n`)
  }
  return cues.join('\n')
}
