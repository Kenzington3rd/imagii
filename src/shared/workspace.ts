import type { Clip, WatermarkSpec } from './clip'
import type { ChainSpec } from './audio'
import type { CleanupSettings } from './audioPreset'
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
 *   4 — adds `audioStudio.extractedFromVideo` (T-99). When it is true the audio
 *       studio's source was pulled out of a video, and `sourcePath` is that
 *       VIDEO: the audio file itself is a scratch WAV under the OS temp folder
 *       that the next launch deletes, so a project must never point at it. Open
 *       extracts the sound again. Older snapshots have no marker and keep the
 *       shape they were written in (`sourcePath` the audio file, and for an
 *       extraction `fromVideoPath` beside it); migration is a version bump.
 *   5 — adds `videoStudio.convertedForImport` (T-107). When it is true the video
 *       studio's source was converted to an mp4 working copy on import (flv, ts,
 *       wmv, mpg, 3gp ...), and `sourcePath` is the ORIGINAL file: the working
 *       copy lives under the OS temp folder, which the next launch prunes, so a
 *       project must never point at it. Open converts again. Older snapshots have
 *       no marker and keep the shape they were written in (`sourcePath` the
 *       working copy, which may or may not still be there); migration is a
 *       version bump.
 */
export interface ImagiiProject {
  schemaVersion: 1 | 2 | 3 | 4 | 5
  savedAt: number
  appVersion: string
  /** Where the user was when this snapshot was taken (v3+). */
  place?: PlaceRecord
  videoStudio?: {
    /** The video file — or, with `convertedForImport`, the ORIGINAL it was converted from. */
    sourcePath: string | null
    /** v5+: `sourcePath` is a file that needs the import conversion, done again on open. */
    convertedForImport?: boolean
    clips: Clip[]
    selectedClipId: string | null
    watermark?: WatermarkSpec | null
    /** Phase 4-tech-debt: persisted across sessions so Clip Kit can
     *  bundle SRT and the user doesn't lose the transcribed file. */
    srtPath?: string | null
  }
  audioStudio?: {
    /** The audio file — or, with `extractedFromVideo`, the video it was taken from. */
    sourcePath: string | null
    /** v4+: `sourcePath` is a video whose sound is extracted again on open. */
    extractedFromVideo?: boolean
    /** v1-3 only: for an extraction, the video, written beside the (temp) WAV in
     *  `sourcePath`. Read, never written — see schema 4. If the WAV is gone on open,
     *  the sound is extracted again from this video (T-107). */
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
  /** T-90: cleanup settings only — never cut regions or a second track. */
  chain: CleanupSettings
  createdAt: number
}

export interface RecordingSource {
  id: string
  name: string
  thumbnailDataUrl: string
  type: 'screen' | 'window'
}

/**
 * Round 18 H1: options for `recording:finalize` in the streaming save
 * protocol (begin → appendChunk* → finalize). The bytes travel per-chunk via
 * `recording:appendChunk`, never in the spec (T-101 deleted the one-shot
 * `RecordingSpec` that carried the whole recording as one ArrayBuffer).
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
