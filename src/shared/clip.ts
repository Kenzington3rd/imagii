import type { CustomPreset } from './customPresets'

/** The built-in export presets, as data: the five platforms, with YouTube's 1080p60 row (T-130 (q)) beside the 30 fps one. `ALL_PLATFORM_IDS`
 *  (renderer) and `ALL_PRESET_IDS` (main) are the ordered display copies of this list and
 *  are pinned equal to each other by `presetTablesInSync.test.ts`; this one
 *  exists so code with no table in reach — the custom-preset parser — can
 *  still tell a real platform id from a hand-edited one. */
export const PLATFORM_IDS = ['youtube', 'youtube60', 'reels', 'tiktok', 'twitter', 'facebook'] as const

export type PlatformId = (typeof PLATFORM_IDS)[number]

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface TextOverlay {
  id: string
  text: string
  font: string
  sizePx: number
  colorHex: string
  x: number
  y: number
  startSec: number
  endSec: number
}

export interface ColorGrade {
  brightness: number
  contrast: number
  saturation: number
  temperature: number
}

export const DEFAULT_COLOR_GRADE: ColorGrade = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0
}

export interface Clip {
  id: string
  name: string
  startSec: number
  endSec: number
  cropRect: CropRect | null
  textOverlays: TextOverlay[]
  selectedPresets: PlatformId[]
  /** Ids of saved custom presets queued for this clip (T-50). They are
   *  export targets exactly like `selectedPresets`; the ids are resolved
   *  against the on-disk list, and one that no longer exists is pruned
   *  rather than queued. */
  customPresetIds?: string[]
  speedMultiplier?: number
  colorGrade?: ColorGrade
  autoZoom?: boolean
  hypeShake?: boolean
}

/**
 * The ONE reading of a clip's playback speed (T-105): a missing, zero, negative
 * or non-finite multiplier is 1x, anything else is itself. A platform export's
 * filter graph and its audio, a compilation segment's, the progress bar's
 * length, the export grid's "Too long" and the slider's readout all ask this,
 * so "what speed is this clip at" cannot be decided five ways (it had been:
 * `runExportJob` twice, `buildVideoFilter`, `outputDurationSec` and the store).
 */
export function clipSpeed(clip: Pick<Clip, 'speedMultiplier'>): number {
  const speed = clip.speedMultiplier
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1
}

/** The shortest clip any range edit makes (s): the Timeline drag's own floor, `applyRange`'s, a scanner add's (T-131 (3), T-152 (4)). */
export const MIN_CLIP_SEC = 0.1

/**
 * A clip's range with the floor held (T-153 (8)): at least `MIN_CLIP_SEC` between In and Out, inside `[0, duration]`. The ONE copy of
 * `applyRange`'s clamp, so a clip a saved project or an autosave carries as [0, 0] or [D, D] (v1.6.0 wrote them; every output then
 * said only "Export failed.") comes back with length by the same rule an I or O key press does. A source shorter than the floor
 * keeps the plain clamp (room 0); a reversed pair resolves to a start and an end at least the floor apart.
 */
export function floorRange(startSec: number, endSec: number, duration: number): { startSec: number; endSec: number } {
  const room = duration >= MIN_CLIP_SEC ? MIN_CLIP_SEC : 0
  const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)
  const start = clamp(startSec, 0, duration - room)
  return { startSec: start, endSec: clamp(endSec, start + room, duration) }
}

/**
 * Everything about a clip that decides what its exported picture and sound ARE
 * (T-105), as opposed to which part of the source it is (`startSec`/`endSec`) or
 * where it goes (`selectedPresets`). A platform export reads all of it from the
 * clip; a compilation segment travels with it, because a clip that compiles
 * differently from how it exports is a file the user did not make.
 */
export type ClipRecipe = Pick<
  Clip,
  'cropRect' | 'textOverlays' | 'speedMultiplier' | 'colorGrade' | 'autoZoom' | 'hypeShake'
>

/**
 * `clip`'s recipe, field by field — what Compile hands main for each clip.
 *
 * The speed is the one the clip PLAYS at (`clipSpeed`, T-112), not the stored
 * field: a project from an older build can hold 0, which the slider and the grid
 * already read as 1x and which main's validator (round 61) refuses as out of
 * range, so Compile failed on a clip that looked ordinary.
 */
export function clipRecipe(clip: ClipRecipe): ClipRecipe {
  return {
    cropRect: clip.cropRect,
    textOverlays: clip.textOverlays,
    speedMultiplier: clipSpeed(clip),
    colorGrade: clip.colorGrade,
    autoZoom: clip.autoZoom,
    hypeShake: clip.hypeShake
  }
}

/**
 * `clip` as an export job carries it across the bridge (T-113): the clip itself — its
 * name, its range, where it is going — with its recipe fields as the clip PLAYS
 * (`clipRecipe`). A stored speed of 0 (a hand-edited or older project) is 1x on the
 * slider, in the grid and in Compile, and main's batch validator refuses it as out of
 * range — so the Export panel and Clip Kit, which sent the stored clip raw, turned a
 * clip that looked ordinary into a refusal. Every place that builds an `ExportJobSpec`
 * sends its clip through here (`tests/unit/jobClipNormalized.test.ts` fails on one
 * that does not).
 */
export function clipForExport(clip: Clip): Clip {
  return { ...clip, ...clipRecipe(clip) }
}

/**
 * One clip of a compilation as it crosses to main: which part of the source it
 * is, what it is called, and whatever of its recipe it has (T-105). Every recipe
 * field is optional on the wire: a segment with only its range is the clip at 1x
 * with no crop and no effects, which is what it was before Compile carried any.
 */
export type CompileSegment = { startSec: number; endSec: number; name: string } & Partial<ClipRecipe>

export interface WatermarkSpec {
  text: string
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  opacity: number
  fontSizePct: number
}

export interface ExportJobSpec {
  jobId: string
  sourcePath: string
  outDir: string
  clip: Clip
  preset: PlatformId
  /** T-50 — a custom preset the user queued. When present the encode runs
   *  at ITS geometry, fps and bitrates; `preset` stays the platform it was
   *  built on, which is what the advisory tables key off. The whole preset
   *  travels with the job, so a job already handed to main keeps its
   *  dimensions even if the preset is deleted while the batch runs. */
  customPreset?: CustomPreset | null
  watermark?: WatermarkSpec | null
  outputFilename?: string
}

export interface ExportProgress {
  jobId: string
  percent: number
  fps?: number
  timemark?: string
}

export interface ExportResult {
  jobId: string
  outputPath: string
  durationMs: number
}
