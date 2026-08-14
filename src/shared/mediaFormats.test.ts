import { describe, it, expect } from 'vitest'
import {
  NATIVE_VIDEO_EXTENSIONS,
  CONVERT_VIDEO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  WEB_AUDIO_EXTENSIONS,
  EXTRACT_AUDIO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  hasExtension,
  isVideoFilename,
  isAudioFilename,
  isImageFilename,
  videoNeedsConversion,
  audioNeedsExtraction,
  formatHint
} from './mediaFormats'

describe('mediaFormats lists', () => {
  it('video includes the streamer set (OBS/stream-dump containers)', () => {
    for (const ext of ['mp4', 'mov', 'mkv', 'webm', 'flv', 'ts', 'm2ts', 'wmv', '3gp']) {
      expect(VIDEO_EXTENSIONS, ext).toContain(ext)
    }
  })

  // Regression: the audio picker's video filter had drifted to a
  // 5-entry list missing m4v. With one source of truth the full list is
  // what every consumer gets.
  it('m4v is in the video list (the drift the duplicates hid)', () => {
    expect(VIDEO_EXTENSIONS).toContain('m4v')
  })

  // The ts family was briefly excluded when the linux dev binary was
  // found SIGSEGVing on mpegts input. The SHIPPED binary (win32,
  // gyan.dev build) was then proven clean under wine, so the family is
  // supported product-wide. See the per-platform caveat in
  // mediaFormats.ts and the platform-gated Layer 5 matrix.
  it('the mpegts stream-dump family is supported', () => {
    for (const ext of ['ts', 'm2ts', 'mts']) {
      expect(VIDEO_EXTENSIONS).toContain(ext)
    }
  })

  it('native and convert video tiers do not overlap', () => {
    const native = new Set<string>(NATIVE_VIDEO_EXTENSIONS)
    for (const ext of CONVERT_VIDEO_EXTENSIONS) {
      expect(native.has(ext), ext).toBe(false)
    }
  })

  it('web and extract audio tiers do not overlap', () => {
    const web = new Set<string>(WEB_AUDIO_EXTENSIONS)
    for (const ext of EXTRACT_AUDIO_EXTENSIONS) {
      expect(web.has(ext), ext).toBe(false)
    }
  })

  it('no list contains duplicates or dotted/uppercase entries', () => {
    for (const list of [VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS]) {
      expect(new Set(list).size).toBe(list.length)
      for (const ext of list) {
        expect(ext).toBe(ext.toLowerCase())
        expect(ext.startsWith('.')).toBe(false)
      }
    }
  })
})

describe('filename classification', () => {
  it('is case-insensitive and requires the dot', () => {
    expect(isVideoFilename('CLIP.MP4')).toBe(true)
    expect(isVideoFilename('archive.tar.mp4')).toBe(true)
    expect(isVideoFilename('notmp4')).toBe(false)
    expect(hasExtension('clip.mp4x', VIDEO_EXTENSIONS)).toBe(false)
  })

  it('classifies across kinds without overlap on the common cases', () => {
    expect(isVideoFilename('vod #4.flv')).toBe(true)
    expect(isAudioFilename('vod #4.flv')).toBe(false)
    expect(isAudioFilename('take 2.aiff')).toBe(true)
    expect(isImageFilename('thumb.avif')).toBe(true)
    expect(isImageFilename('thumb.mp4')).toBe(false)
  })

  it('videoNeedsConversion: native plays direct, stream-dump converts', () => {
    expect(videoNeedsConversion('a.mp4')).toBe(false)
    expect(videoNeedsConversion('a.mkv')).toBe(false)
    expect(videoNeedsConversion('a.flv')).toBe(true)
    expect(videoNeedsConversion('a.TS')).toBe(true)
    expect(videoNeedsConversion('a.wmv')).toBe(true)
  })

  it('audioNeedsExtraction: video always, non-web audio yes, web audio no', () => {
    expect(audioNeedsExtraction('a.mp4')).toBe(true)
    expect(audioNeedsExtraction('a.flv')).toBe(true)
    expect(audioNeedsExtraction('a.wma')).toBe(true)
    expect(audioNeedsExtraction('a.aif')).toBe(true)
    expect(audioNeedsExtraction('a.mp3')).toBe(false)
    expect(audioNeedsExtraction('a.wav')).toBe(false)
  })
})

describe('formatHint', () => {
  it('renders uppercase comma-separated copy from the same list', () => {
    expect(formatHint(['mp4', 'mov'])).toBe('MP4, MOV')
    expect(formatHint(NATIVE_VIDEO_EXTENSIONS)).toContain('M4V')
  })
})
