import type { PlatformId } from '../../shared/clip'

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
    durationSweetSpot: { min: 15, max: 90 },
    durationHardLimit: 180,
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
