import type { ImagiiProject, PlaceRecord, ReferencesTab } from './workspace'
import { isSafeAbsolutePath } from './pathSafety'

/**
 * Tech-debt fix: schema version is now ranged. Validator accepts any
 * version in SUPPORTED_SCHEMA_VERSIONS and migrates older versions up
 * to MAX_SCHEMA_VERSION before returning. New saves always emit
 * MAX_SCHEMA_VERSION.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3] as const
export const MAX_SCHEMA_VERSION = 3

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
/** Sane bounds for an overlay font size, in pixels. */
const OVERLAY_SIZE_MIN = 8
const OVERLAY_SIZE_MAX = 512

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
 * Validate the `textOverlays` field of a clip. Absent is fine
 * (back-compat); if present it must be an array of well-formed overlays.
 * Returns a reason string on failure, or null on success.
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
      const reason = validateClipTextOverlays(v.clips[i], i)
      if (reason !== null) return { ok: false, reason }
    }
    // v2 srtPath: optional, but if present must be a safe absolute path.
    if (!isOptionalSafePath(v.srtPath))
      return { ok: false, reason: 'videoStudio.srtPath unsafe or malformed' }
  }
  if (input.audioStudio !== undefined) {
    const a = input.audioStudio
    if (!isPlainObject(a)) return { ok: false, reason: 'audioStudio not an object' }
    if (!isOptionalSafePath(a.sourcePath))
      return { ok: false, reason: 'audioStudio.sourcePath unsafe or malformed' }
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
    }
  }
  if (input.imageCanvas !== undefined) {
    const c = input.imageCanvas
    if (!isPlainObject(c)) return { ok: false, reason: 'imageCanvas not an object' }
    if (!isPlainObject(c.doc)) return { ok: false, reason: 'imageCanvas.doc missing' }
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
  if (!project.videoStudio && !project.audioStudio && !project.imageCanvas) {
    return { ok: false, reason: 'no studio state to save' }
  }
  return { ok: true }
}
