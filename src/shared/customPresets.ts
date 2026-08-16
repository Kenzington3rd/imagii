import type { PlatformId } from './clip'

export interface CustomPreset {
  id: string
  name: string
  width: number
  height: number
  fps: number
  videoBitrate: string
  audioBitrate: string
  basePlatformId: PlatformId
}

/**
 * An FFmpeg bitrate literal: digits with an optional decimal part and an
 * optional k/M suffix — "192k", "8M", "2.5M", "5000000".
 *
 * T-50 put custom presets on the export path, which means these two strings
 * now reach `-b:v` / `-b:a` in the encoder's argv. They are checked in both
 * directions: `CustomPresetManager` refuses to SAVE a preset it could not
 * later export (a preset that cannot be used is the exact defect T-50 is
 * about), and `validateExportJob` refuses to RUN one, because the renderer
 * is a trust boundary and an on-disk preset file can be edited by hand.
 */
const BITRATE_RE = /^\d{1,9}(\.\d{1,3})?[kKmM]?$/

export function isValidBitrate(v: unknown): v is string {
  return typeof v === 'string' && BITRATE_RE.test(v)
}
