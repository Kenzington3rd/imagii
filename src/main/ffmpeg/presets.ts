import type { PlatformId } from '../../shared/clip'
import type { CustomPreset } from '../../shared/customPresets'
import { even } from './filters'

export interface PlatformPreset {
  id: PlatformId
  label: string
  width: number
  height: number
  fps: number
  videoBitrate: string
  audioBitrate: string
  videoCodec: 'libx264'
  audioCodec: 'aac'
  pixFmt: 'yuv420p'
  durationSweetSpot: { min: number; max: number }
  durationHardLimit: number
  aspectRatio: number
}

export const PLATFORM_PRESETS: Record<PlatformId, PlatformPreset> = {
  youtube: {
    id: 'youtube',
    label: 'YouTube 1080p',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: '8M',
    audioBitrate: '192k',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixFmt: 'yuv420p',
    durationSweetSpot: { min: 60, max: 600 },
    durationHardLimit: 12 * 60 * 60,
    aspectRatio: 16 / 9
  },
  reels: {
    id: 'reels',
    label: 'Instagram Reels',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: '6M',
    audioBitrate: '128k',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixFmt: 'yuv420p',
    // Round 18: synced with the renderer's PLATFORM_INFO — the round-15
    // duration updates (Reels 3 min, TikTok 60 min, X Premium 3 h) only
    // landed in the renderer copy of this table. A cross-table test now
    // pins the two against each other (presetTablesInSync.test.ts).
    // T-112: 20 minutes is what Reels takes; 3 is where Instagram stops
    // recommending one (the renderer's yellow note) — see presets.ts there.
    durationSweetSpot: { min: 15, max: 90 },
    durationHardLimit: 20 * 60,
    aspectRatio: 9 / 16
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: '6M',
    audioBitrate: '128k',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixFmt: 'yuv420p',
    durationSweetSpot: { min: 21, max: 34 },
    durationHardLimit: 60 * 60,
    aspectRatio: 9 / 16
  },
  twitter: {
    id: 'twitter',
    label: 'X / Twitter',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: '5M',
    audioBitrate: '128k',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixFmt: 'yuv420p',
    durationSweetSpot: { min: 5, max: 140 },
    durationHardLimit: 4 * 60 * 60,
    aspectRatio: 16 / 9
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: '5M',
    audioBitrate: '128k',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixFmt: 'yuv420p',
    durationSweetSpot: { min: 15, max: 240 },
    durationHardLimit: 240 * 60,
    aspectRatio: 16 / 9
  }
}

export const ALL_PRESET_IDS: PlatformId[] = ['youtube', 'reels', 'tiktok', 'twitter', 'facebook']

/**
 * T-50 — the one place a job's encoder settings are decided.
 *
 * Without a custom preset this is the platform row, unchanged. With one, the
 * custom preset's own geometry, frame rate and bitrates REPLACE the base
 * platform's, and `aspectRatio` is re-derived from those dimensions — the
 * base row's aspect would auto-crop a 1280x720 custom preset built on Reels
 * to 9:16 and then stretch it, which is the wrong picture, not just the
 * wrong number. Codec, pixel format and the duration advisories stay with
 * the base platform: those are the parts the user chose a base FOR.
 *
 * T-111: the custom size is snapped to even pixels, the way a compilation's is
 * (`buildSegmentFilter`). yuv420p keeps one chroma sample per 2x2 block and
 * libx264 refuses an odd width or height outright, so a 1081x607 preset used to
 * fail EVERY export with "width not divisible by 2" — the form accepts any size
 * from 16 to 16384 and nothing downstream rounded it.
 */
export function resolveExportPreset(
  baseId: PlatformId,
  custom?: CustomPreset | null
): PlatformPreset {
  const base = PLATFORM_PRESETS[baseId]
  if (!custom) return base
  const width = even(custom.width)
  const height = even(custom.height)
  return {
    ...base,
    label: custom.name,
    width,
    height,
    fps: custom.fps,
    videoBitrate: custom.videoBitrate,
    audioBitrate: custom.audioBitrate,
    aspectRatio: width / height
  }
}
