import type { CustomPreset } from './customPresets'

/**
 * Pure parser + validator for a custom export-preset JSON file.
 *
 * `listCustomPresets` wrapped `JSON.parse` in try/catch, but then sorted
 * the results with `a.name.localeCompare(b.name)` — so a file that is
 * *valid JSON yet structurally wrong* (`{}`, `null`, `42`, a half-written
 * file from a crash) parsed fine, then threw a `TypeError` on the
 * `.localeCompare` of an `undefined` name. The whole
 * `video:listCustomPresets` IPC then rejected and the studio's preset
 * list failed to load. This is the exact class fixed for mood boards in
 * round 13 (`moodboardParse.ts`).
 *
 * This function closes that class: it returns a fully-formed
 * `CustomPreset` or `null`, never a half-valid object. Pure (no fs, no
 * electron) so it is unit-testable under the node-env vitest config.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Parse a custom-preset JSON string. Returns the preset, or `null` if the
 * text is not JSON, not an object, or is missing/malformed any required
 * field: `id` / `name` must be non-empty strings; `width` / `height` /
 * `fps` must be finite numbers; `videoBitrate` / `audioBitrate` /
 * `basePlatformId` must be non-empty strings.
 */
export function parseCustomPreset(raw: string): CustomPreset | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  if (!isNonEmptyString(parsed.id)) return null
  if (!isNonEmptyString(parsed.name)) return null
  if (!isFiniteNumber(parsed.width)) return null
  if (!isFiniteNumber(parsed.height)) return null
  if (!isFiniteNumber(parsed.fps)) return null
  if (!isNonEmptyString(parsed.videoBitrate)) return null
  if (!isNonEmptyString(parsed.audioBitrate)) return null
  if (!isNonEmptyString(parsed.basePlatformId)) return null
  return {
    id: parsed.id,
    name: parsed.name,
    width: parsed.width,
    height: parsed.height,
    fps: parsed.fps,
    videoBitrate: parsed.videoBitrate,
    audioBitrate: parsed.audioBitrate,
    basePlatformId: parsed.basePlatformId as CustomPreset['basePlatformId']
  }
}
