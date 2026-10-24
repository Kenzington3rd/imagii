import type { ImagiiProject, PlaceRecord, ReferencesTab } from './workspace'
import { isSafeAbsolutePath } from './pathSafety'
import { resolveOverlayColor } from './overlayColors'
import { secondaryTrackProblem } from './audio'
import { PLATFORM_IDS } from './clip'

/**
 * Tech-debt fix: schema version is now ranged. Validator accepts any
 * version in SUPPORTED_SCHEMA_VERSIONS and migrates older versions up
 * to MAX_SCHEMA_VERSION before returning. New saves always emit
 * MAX_SCHEMA_VERSION.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4, 5] as const
export const MAX_SCHEMA_VERSION = 5

/** Every route the app can restore to (App.tsx's <Route path> set). */
export const KNOWN_ROUTES = [
  '/home',
  '/video',
  '/audio',
  '/image',
  '/record',
  '/references'
] as const

/** Mirrors the ReferencesTab union in shared/workspace.ts. */
export const REFERENCES_TABS: readonly ReferencesTab[] = ['reference', 'moodboards', 'assets']

/** Cap on a restored playhead: a day of video is already absurd, and an
 *  unbounded number here reaches a media element's currentTime. */
const MAX_PLAYHEAD_SEC = 24 * 60 * 60
/** Cap on a stored id. Real ids are nanoid(8); this only stops a snapshot
 *  from smuggling a megabyte string through a field nobody bounds later. */
const MAX_ID_LENGTH = 64

export type ValidationResult =
  | { ok: true; project: ImagiiProject }
  | { ok: false; reason: string }

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB sanity cap on a project file

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Optional path fields in project files (sourcePath, srtPath, etc.)
 * must be either absent/null OR a safe absolute path. A malicious project
 * file with `sourcePath: "../../etc/passwd"` would otherwise reach the
 * file protocol handler and trigger an arbitrary file read.
 */
function isOptionalSafePath(v: unknown): boolean {
  if (v === undefined || v === null) return true
  return isSafeAbsolutePath(v)
}

/** Allowed hex-color form for a text overlay (`#RRGGBB` or `RRGGBB`). */
const COLOR_HEX_RE = /^#?[0-9A-Fa-f]{6}$/
/** Sane bounds for an overlay font size, in pixels (the editor clamps to these — `textOverlay.ts`). */
export const OVERLAY_SIZE_MIN = 8
export const OVERLAY_SIZE_MAX = 512

/**
 * Validate a single clip text overlay. A malicious `.imagii.json` can set
 * `colorHex` / `sizePx` to FFmpeg filter-graph injection payloads that
 * `drawTextFilter` interpolates raw — so every field that reaches the
 * filter string must be structurally sound here. Returns true only for a
 * fully well-formed overlay; never throws.
 */
export function isValidTextOverlay(v: unknown): boolean {
  if (!isPlainObject(v)) return false
  if (typeof v.text !== 'string') return false
  if (typeof v.colorHex !== 'string' || !COLOR_HEX_RE.test(v.colorHex)) return false
  if (
    !isFiniteNumber(v.sizePx) ||
    v.sizePx < OVERLAY_SIZE_MIN ||
    v.sizePx > OVERLAY_SIZE_MAX
  ) {
    return false
  }
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return false
  if (!isFiniteNumber(v.startSec) || !isFiniteNumber(v.endSec)) return false
  return true
}

/**
 * Migrate what an older build stored in a clip's text overlays, in place, before the gate looks
 * (T-114, T-115). Two things the gate refuses today were things the editor wrote:
 *
 * - A NAMED color. The overlay editor's default was the name "white" until T-113, so an autosave
 *   or a saved project written by that build holds `"colorHex": "white"`, which the hex-only gate
 *   refuses - the person's whole session was unrecoverable. A string that fails the hex gate and
 *   IS a CSS color name is replaced by the table's hex (`resolveOverlayColor`: a literal table,
 *   so what is written is the table's value and never the string that was typed). Anything else -
 *   a filter-graph payload, an unknown word, a non-string - is left exactly as it is and the gate
 *   refuses it, so the injection pin does not move.
 * - A SIZE outside the gate's range. The old editor had no upper clamp (it took whatever was
 *   typed), so a project can hold 800 or 3. A finite number is clamped into
 *   [OVERLAY_SIZE_MIN, OVERLAY_SIZE_MAX], which is what the editor does today. A value that is
 *   not a finite number - a string, null, Infinity - is left for the gate to refuse; the clamp
 *   produces a number from a number and nothing else, so it cannot carry text into `drawtext`.
 *
 * The gate itself (`isValidTextOverlay`) is unchanged and strict. Export and Compile run it on every
 * overlay they are sent (`assertOptionalClipRecipe`) and still refuse one outside the range; Save
 * project and a restore both go through `validateProject`, which migrates first, so neither refuses a
 * legacy size - Save writes the clamped number.
 */
function migrateLegacyOverlays(clip: unknown): void {
  if (!isPlainObject(clip) || !Array.isArray(clip.textOverlays)) return
  for (const overlay of clip.textOverlays as unknown[]) {
    if (!isPlainObject(overlay)) continue
    const typed = overlay.colorHex
    if (typeof typed === 'string' && !COLOR_HEX_RE.test(typed)) {
      const hex = resolveOverlayColor(typed)
      if (hex !== null) overlay.colorHex = hex
    }
    if (isFiniteNumber(overlay.sizePx)) {
      overlay.sizePx = Math.min(OVERLAY_SIZE_MAX, Math.max(OVERLAY_SIZE_MIN, overlay.sizePx))
    }
  }
}

/**
 * Validate the `textOverlays` field of a clip: if present it must be an array of well-formed overlays.
 * Returns a reason string on failure, or null on success. Absent is not judged HERE - the overlays are
 * checked first so a payload in one is named as an overlay problem - but it is refused one gate later,
 * by `validateClipRequiredFields` (T-121): the studio reads the array bare.
 */
function validateClipTextOverlays(clip: unknown, idx: number): string | null {
  if (!isPlainObject(clip)) return `videoStudio.clips[${idx}] not an object`
  const overlays = clip.textOverlays
  if (overlays === undefined) return null
  if (!Array.isArray(overlays)) {
    return `videoStudio.clips[${idx}].textOverlays not an array`
  }
  for (let i = 0; i < overlays.length; i++) {
    if (!isValidTextOverlay(overlays[i])) {
      return `videoStudio.clips[${idx}].textOverlays[${i}] malformed`
    }
  }
  return null
}

/**
 * T-119: the fields of a clip the app reads without a guard. `validateProject` used to look only at a
 * clip's text overlays, so `clips: [{}]` was a valid studio and the first render threw on
 * `for (const p of clip.selectedPresets)`. T-121 added `textOverlays`: the T-119 text called it "read with a
 * default", and it is not - `videoStore` (`clip.textOverlays.length`, `.map`, `.filter`, `[...c.textOverlays]`),
 * the overlay editor and `buildVideoFilter` all read it bare, so a restored clip without it crashed the studio.
 * It has been in the saved shape since the first build, so no older file lacks it. The rest of the clip stays
 * optional exactly as an older build left it: `cropRect`, the speed, the grade and the flags are read with a
 * default. Reasons are `videoStudio.clips[i].<field> <what is wrong>`, like the overlay reasons beside them.
 */
function validateClipRequiredFields(clip: unknown, idx: number): string | null {
  if (!isPlainObject(clip)) return `videoStudio.clips[${idx}] not an object`
  const at = `videoStudio.clips[${idx}]`
  if (!isBoundedId(clip.id)) return `${at}.id missing`
  if (typeof clip.name !== 'string') return `${at}.name not a string`
  if (!isFiniteNumber(clip.startSec)) return `${at}.startSec not a number`
  if (!isFiniteNumber(clip.endSec)) return `${at}.endSec not a number`
  if (!Array.isArray(clip.textOverlays)) return `${at}.textOverlays not an array`
  if (!Array.isArray(clip.selectedPresets)) return `${at}.selectedPresets not an array`
  for (let i = 0; i < clip.selectedPresets.length; i++) {
    if (typeof clip.selectedPresets[i] !== 'string') return `${at}.selectedPresets[${i}] not a string`
  }
  return null
}

/**
 * T-135 (10): a preset id this build has no preset for is dropped from the clip, in place, after the shape has been checked. The Export panel
 * reads `PLATFORM_INFO[id]` for every id a clip holds, so one it has no row for (a hand-edited project, or a newer build's preset) made
 * `findSafeZoneIssues` and the queue builder throw, and Export did nothing. DROPPED, not refused: an older build still opens a newer build's
 * project, and what is left is the clip's own list. Only the string entries `validateClipRequiredFields` has already passed are judged;
 * the custom preset ids are not touched (the panel prunes them against the folder it reads).
 */
function dropUnknownPresetIds(clip: unknown): void {
  if (!isPlainObject(clip) || !Array.isArray(clip.selectedPresets)) return
  const known: readonly string[] = PLATFORM_IDS
  clip.selectedPresets = clip.selectedPresets.filter((id: unknown) => typeof id === 'string' && known.includes(id))
}

/**
 * T-119: the chain's fields the Audio Studio reads without a guard: `chain.gainDb.toFixed(1)` in the Levels
 * panel, the loudness box, `chain.cutRegions.length` in Close and Export, and each cut's times in its chip.
 * `audioStudio.chain` was only required to be an object, so `chain: {}` opened a studio that threw in render.
 * The switches and the named choices (`denoise`, `compressor`, `hum60`...) are not here: an absent one reads as
 * off, and main checks every value it prints into a filter graph at export (`audio:*` handlers, T-111).
 * `humHz`, `denoiseParams` and `secondaryTrack` are optional, as they always were.
 */
function validateChainRequiredFields(chain: Record<string, unknown>): string | null {
  if (!isFiniteNumber(chain.gainDb)) return 'audioStudio.chain.gainDb not a number'
  if (!isFiniteNumber(chain.loudnormTargetLufs)) return 'audioStudio.chain.loudnormTargetLufs not a number'
  if (!Array.isArray(chain.cutRegions)) return 'audioStudio.chain.cutRegions not an array'
  for (let i = 0; i < chain.cutRegions.length; i++) {
    const cut: unknown = chain.cutRegions[i]
    if (!isPlainObject(cut) || !isFiniteNumber(cut.startSec) || !isFiniteNumber(cut.endSec)) {
      return `audioStudio.chain.cutRegions[${i}] malformed`
    }
  }
  return null
}

/**
 * Migrate a v1 project to v2 in-place on the input object. v2 added an
 * optional videoStudio.srtPath field; the migration just bumps
 * schemaVersion. No data is dropped.
 */
function migrateV1ToV2(input: Record<string, unknown>): void {
  input.schemaVersion = 2
  // No field changes required — srtPath is optional and absent === null.
}

/**
 * Migrate a v2 project to v3. v3 added the optional `place` record; a v2
 * snapshot simply has none, and a restore of one behaves exactly as it did
 * before T-47 (data applied, route and selections untouched).
 */
function migrateV2ToV3(input: Record<string, unknown>): void {
  input.schemaVersion = 3
}

/**
 * Migrate a v3 project to v4. v4 added `audioStudio.extractedFromVideo` (T-99);
 * a v3 snapshot has no marker and is read in the shape it was written in — the
 * migration is a version bump with no data change. It deliberately does NOT
 * turn an old extraction's `fromVideoPath` into the marker: that would
 * re-extract a sound whose scratch file may still be there, and an old project
 * whose scratch file is gone keeps saying so, as it always did.
 */
function migrateV3ToV4(input: Record<string, unknown>): void {
  input.schemaVersion = 4
}

/**
 * Migrate a v4 project to v5. v5 added `videoStudio.convertedForImport` (T-107);
 * a v4 snapshot has no marker and is read in the shape it was written in — the
 * migration is a version bump with no data change. It cannot recover an old
 * project whose converted working copy was already pruned: that file's path
 * says nothing about the original it was made from (the name carries a random
 * suffix and the original's folder is not in it), so such a project keeps
 * saying the file is gone, as it always did.
 */
function migrateV4ToV5(input: Record<string, unknown>): void {
  input.schemaVersion = 5
}

function isBoundedId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH
}

/**
 * T-47 — validate the place record FIELD BY FIELD, keeping what is sound
 * and dropping what is not, rather than refusing the whole project.
 *
 * That asymmetry is deliberate. The studio state is the user's work; a
 * malformed byte in it means the file cannot be trusted at all, so
 * `validateProject` refuses outright. The place record is only where they
 * were standing — throwing away a session's work because a route string is
 * a number would be the worse failure by far. So a bad place degrades to
 * exactly the pre-T-47 restore (data only, lands on Home), and a bad single
 * field degrades to that field's default while its siblings still apply.
 *
 * Returns undefined when nothing survives, so `place` reads as absent —
 * the same shape every v1/v2 snapshot has.
 */
export function sanitizePlace(input: unknown): PlaceRecord | undefined {
  if (!isPlainObject(input)) return undefined
  const place: PlaceRecord = {}
  if (typeof input.route === 'string' && (KNOWN_ROUTES as readonly string[]).includes(input.route)) {
    place.route = input.route
  }
  if (isBoundedId(input.videoClipId)) place.videoClipId = input.videoClipId
  if (isBoundedId(input.canvasLayerId)) place.canvasLayerId = input.canvasLayerId
  if (
    typeof input.referencesTab === 'string' &&
    (REFERENCES_TABS as readonly string[]).includes(input.referencesTab)
  ) {
    place.referencesTab = input.referencesTab as ReferencesTab
  }
  if (
    isFiniteNumber(input.videoTimeSec) &&
    input.videoTimeSec >= 0 &&
    input.videoTimeSec <= MAX_PLAYHEAD_SEC
  ) {
    place.videoTimeSec = input.videoTimeSec
  }
  return Object.keys(place).length > 0 ? place : undefined
}

/**
 * Strict runtime validator for ImagiiProject. Returns either a typed project
 * or a reason string. Never throws. Older schema versions are migrated up
 * before structural validation.
 */
export function validateProject(input: unknown): ValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, reason: 'project is not an object' }
  }
  const schemaVersion = input.schemaVersion
  if (
    typeof schemaVersion !== 'number' ||
    !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(schemaVersion)
  ) {
    return {
      ok: false,
      reason: `unsupported schemaVersion ${String(schemaVersion)} (supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')})`
    }
  }
  // Migrate older versions up. The migration steps are linear; future
  // bumps add another `if (current === N) migrateNToN+1(input)` step.
  if (schemaVersion === 1) migrateV1ToV2(input)
  if (schemaVersion <= 2) migrateV2ToV3(input)
  if (schemaVersion <= 3) migrateV3ToV4(input)
  if (schemaVersion <= 4) migrateV4ToV5(input)

  if (!isFiniteNumber(input.savedAt) || input.savedAt <= 0) {
    return { ok: false, reason: 'savedAt missing or invalid' }
  }
  if (typeof input.appVersion !== 'string') {
    return { ok: false, reason: 'appVersion missing' }
  }
  if (input.videoStudio !== undefined) {
    const v = input.videoStudio
    if (!isPlainObject(v)) return { ok: false, reason: 'videoStudio not an object' }
    // Path fields are validated for safety (no `..` traversal, no Windows
    // reserved names, must be absolute) — see shared/pathSafety.ts.
    if (!isOptionalSafePath(v.sourcePath))
      return { ok: false, reason: 'videoStudio.sourcePath unsafe or malformed' }
    if (!Array.isArray(v.clips)) return { ok: false, reason: 'videoStudio.clips not array' }
    // Descend into each clip's text overlays. `colorHex` / `sizePx` reach
    // FFmpeg's drawtext filter string raw — a malicious project can smuggle
    // a filter-graph injection payload through them, so reject here.
    for (let i = 0; i < v.clips.length; i++) {
      migrateLegacyOverlays(v.clips[i])
      const reason = validateClipTextOverlays(v.clips[i], i)
      if (reason !== null) return { ok: false, reason }
    }
    // T-119: and the fields the studio reads without a guard. After the overlays, so a payload in an
    // overlay is still named as an overlay problem.
    for (let i = 0; i < v.clips.length; i++) {
      const reason = validateClipRequiredFields(v.clips[i], i)
      if (reason !== null) return { ok: false, reason }
      // T-135 (10): after the shape is known to be sound (every entry a string), before the studio reads the ids.
      dropUnknownPresetIds(v.clips[i])
    }
    // v5: the marker says `sourcePath` is the original of a file converted on import.
    if (v.convertedForImport !== undefined && typeof v.convertedForImport !== 'boolean')
      return { ok: false, reason: 'videoStudio.convertedForImport not a boolean' }
    // v2 srtPath: optional, but if present must be a safe absolute path.
    if (!isOptionalSafePath(v.srtPath))
      return { ok: false, reason: 'videoStudio.srtPath unsafe or malformed' }
  }
  if (input.audioStudio !== undefined) {
    const a = input.audioStudio
    if (!isPlainObject(a)) return { ok: false, reason: 'audioStudio not an object' }
    if (!isOptionalSafePath(a.sourcePath))
      return { ok: false, reason: 'audioStudio.sourcePath unsafe or malformed' }
    // v1-3 wrote the video of an extraction here; it reaches `ffmpeg -i` on
    // export, so it is held to the same gate as every other path in the file.
    if (!isOptionalSafePath(a.fromVideoPath))
      return { ok: false, reason: 'audioStudio.fromVideoPath unsafe or malformed' }
    // v4: the marker says `sourcePath` is a video to extract from.
    if (a.extractedFromVideo !== undefined && typeof a.extractedFromVideo !== 'boolean')
      return { ok: false, reason: 'audioStudio.extractedFromVideo not a boolean' }
    if (!isPlainObject(a.chain)) return { ok: false, reason: 'audioStudio.chain missing' }
    // chain.secondaryTrack carries a filePath that reaches `ffmpeg -i`
    // during audio export. A malicious project pointing it at an SSH key
    // would mix an arbitrary file into the output. Optional/null for
    // back-compat, but if present it must be a safe absolute path.
    const secondary = a.chain.secondaryTrack
    if (secondary !== undefined && secondary !== null) {
      if (!isPlainObject(secondary))
        return { ok: false, reason: 'audioStudio.chain.secondaryTrack not an object' }
      if (!isSafeAbsolutePath(secondary.filePath))
        return {
          ok: false,
          reason: 'audioStudio.chain.secondaryTrack.filePath unsafe or malformed'
        }
      // T-111: gain and ducking numbers are printed into the filter graph on
      // export, and this is the file a person can edit. The loudness target is
      // deliberately NOT held here: a project that saved an odd one is still the
      // person's project, and main refuses it at export with a sentence that
      // says what to change.
      const problem = secondaryTrackProblem(secondary)
      if (problem) return { ok: false, reason: `audioStudio.chain.${problem}` }
    }
    // T-119: after the second track, whose refusals are the ones with a security reason.
    const chainProblem = validateChainRequiredFields(a.chain)
    if (chainProblem !== null) return { ok: false, reason: chainProblem }
  }
  if (input.imageCanvas !== undefined) {
    const c = input.imageCanvas
    if (!isPlainObject(c)) return { ok: false, reason: 'imageCanvas not an object' }
    if (!isPlainObject(c.doc)) return { ok: false, reason: 'imageCanvas.doc missing' }
    // T-119: `doc: {}` opened an empty-looking canvas whose autosave capture then threw on
    // `doc.layers.length` for the rest of the session. The layers are what the capture and the canvas read.
    if (!Array.isArray(c.doc.layers)) return { ok: false, reason: 'imageCanvas.doc.layers not an array' }
  }
  // T-47: the place record is sanitized, never fatal — see sanitizePlace.
  if (input.place !== undefined) input.place = sanitizePlace(input.place)
  return { ok: true, project: input as unknown as ImagiiProject }
}

export function validateProjectJsonString(raw: string): ValidationResult {
  if (raw.length === 0) return { ok: false, reason: 'empty file' }
  if (raw.length > MAX_BYTES) {
    return { ok: false, reason: `project too large (${raw.length} > ${MAX_BYTES} bytes)` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: `invalid JSON: ${err instanceof Error ? err.message : 'parse error'}` }
  }
  return validateProject(parsed)
}

/**
 * Does this project carry any studio state at all (a video, a sound, or a canvas with a layer)? The one definition of
 * "has work in it": the autosave gate below refuses a project without it, and (T-124 (5)) the Home page's autosave
 * banner is not shown over a session that has it.
 */
export function hasStudioState(project: ImagiiProject): boolean {
  return Boolean(project.videoStudio || project.audioStudio || project.imageCanvas)
}

/**
 * Reject suspicious payloads before they ever reach disk. Renderer-side use.
 */
export function isSafeToAutosave(project: ImagiiProject): { ok: true } | { ok: false; reason: string } {
  let raw: string
  try {
    raw = JSON.stringify(project)
  } catch (err) {
    return {
      ok: false,
      reason: `serialization failed: ${err instanceof Error ? err.message : 'unknown'}`
    }
  }
  if (raw.length > MAX_BYTES) {
    return {
      ok: false,
      reason: `project would be ${raw.length} bytes, exceeds ${MAX_BYTES}`
    }
  }
  // Only autosave if there is actual user state. Empty project (default) shouldn't overwrite.
  if (!hasStudioState(project)) {
    return { ok: false, reason: 'no studio state to save' }
  }
  return { ok: true }
}
