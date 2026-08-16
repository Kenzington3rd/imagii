import type { Clip, WatermarkSpec } from './clip'
import type { ChainSpec } from './audio'
import type { CanvasDocument } from './canvas'

/** The tabs the References studio can be sitting on. Declared here rather
 *  than in the store because a snapshot records it — `referencesStore.ts`
 *  re-exports this so there is exactly one list. */
export type ReferencesTab = 'reference' | 'moodboards' | 'assets'

/**
 * T-47 — where the user WAS, as opposed to what they had. Every field is
 * optional and independently validated: a snapshot with a malformed place
 * still restores the user's WORK, which is the load-bearing half. See
 * `sanitizePlace` in shared/projectValidation.ts for the per-field
 * degradation rules.
 */
export interface PlaceRecord {
  /** Active route, e.g. `/video`. One of the app's real routes or absent. */
  route?: string
  /** Selected clip in Video Studio. */
  videoClipId?: string
  /** Selected layer on the image canvas. */
  canvasLayerId?: string
  /** Selected References tab. */
  referencesTab?: ReferencesTab
  /** Player playhead, in seconds from the start of the source. */
  videoTimeSec?: number
}

/**
 * Schema versions:
 *   1 — initial
 *   2 — adds optional videoStudio.srtPath (path to a previously-transcribed
 *       SRT file). Migration is automatic on load: v1 projects get an
 *       implicit srtPath: undefined and are bumped to v2 in memory.
 *   3 — adds the optional `place` record (T-47: session continuity). Older
 *       snapshots have no place and restore exactly as they always did;
 *       migration is a version bump with no data change.
 */
export interface ImagiiProject {
  schemaVersion: 1 | 2 | 3
  savedAt: number
  appVersion: string
  /** Where the user was when this snapshot was taken (v3+). */
  place?: PlaceRecord
  videoStudio?: {
    sourcePath: string | null
    clips: Clip[]
    selectedClipId: string | null
    watermark?: WatermarkSpec | null
    /** Phase 4-tech-debt: persisted across sessions so Clip Kit can
     *  bundle SRT and the user doesn't lose the transcribed file. */
    srtPath?: string | null
  }
  audioStudio?: {
    sourcePath: string | null
    fromVideoPath?: string | null
    chain: ChainSpec
  }
  imageCanvas?: {
    doc: CanvasDocument
  }
}

export interface ChainPreset {
  id: string
  name: string
  chain: ChainSpec
  createdAt: number
}

export interface RecordingSource {
  id: string
  name: string
  thumbnailDataUrl: string
  type: 'screen' | 'window'
}

export interface RecordingSpec {
  webmBytes: ArrayBuffer
  filename: string
  sourceLabel?: string
  durationMs?: number
  convertToMp4: boolean
}

/**
 * Round 18 H1: options for `recording:finalize` in the streaming save
 * protocol (begin → appendChunk* → finalize). Same fields the legacy
 * one-shot RecordingSpec carries, minus the giant webmBytes payload —
 * bytes travel per-chunk via `recording:appendChunk` instead.
 */
export interface RecordingFinalizeSpec {
  filename: string
  durationMs?: number
  convertToMp4: boolean
}

export interface RecordingResult {
  outputPath: string
  sizeBytes: number
  format: 'webm' | 'mp4'
  durationMs: number
}
