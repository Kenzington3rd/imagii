import { assert } from './assert'

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
  /** Pixel font size used directly in libass force_style. Min 16, max 96. */
  fontSize: number
  /** Vertical placement: top/middle/bottom of the frame. */
  position: CaptionPosition
  /** Hex `#RRGGBB` for the text fill. Translated to ASS &Hbbggrr&. */
  primaryColor: string
  /** Hex `#RRGGBB` for the outline. Translated to ASS &Hbbggrr&. */
  outlineColor: string
}

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
  percent: number
  message?: string
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
 */
export function escapeSubtitlesPath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const optionLevel = normalized.replace(/([\\':,;[\]])/g, '\\$1')
  return optionLevel.replace(/([\\':,;[\] ])/g, '\\$1')
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
 * simplification: only the timestamps and the text survive. Cue settings
 * after the end time (X1:/Y1: coordinates) are not carried — libass's SRT
 * reader ignores them anyway. Upgrade path if that ever changes: capture the
 * tail of the time line in SRT_TIME_LINE and re-append it.
 */
export function shiftSrtToRange(srt: string, startSec: number, endSec: number): string {
  assert(Number.isFinite(startSec) && startSec >= 0, 'startSec must be finite >= 0')
  assert(Number.isFinite(endSec) && endSec > startSec, 'endSec must be finite > startSec')
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
    const from = Math.max(Math.round(tsToSeconds(times[1]) * 1000), startMs) - startMs
    const to = Math.min(Math.round(tsToSeconds(times[2]) * 1000), endMs) - startMs
    if (to <= from) continue
    cues.push(`${cues.length + 1}\n${msToSrtTimestamp(from)} --> ${msToSrtTimestamp(to)}\n${text.join('\n')}\n`)
  }
  return cues.join('\n')
}
