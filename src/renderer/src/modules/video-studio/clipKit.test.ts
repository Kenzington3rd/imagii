import { describe, it, expect } from 'vitest'
import type { Clip, WatermarkSpec } from '@shared/clip'
import {
  buildKitQueue,
  describeKitLimit,
  formatClipLength,
  kitEffectivePresets,
  platformsOverLimit
} from './clipKit'
import { ALL_PLATFORM_IDS, PLATFORM_INFO } from './presets'

/**
 * T-85. The kit's queue used to be built inline in ClipKitButton with
 * `watermark: null` hard-coded, so the watermark a user had saved never
 * reached a kit file. These pin the jobs the button hands to main.
 */

const CLIP: Clip = {
  id: 'c1',
  name: 'Clip 1',
  startSec: 2,
  endSec: 12,
  cropRect: null,
  textOverlays: [],
  selectedPresets: ['youtube']
}
const LANDSCAPE = { filePath: '/v/stream.mp4', width: 1920, height: 1080 }
const PORTRAIT = { filePath: '/v/phone.mp4', width: 1080, height: 1920 }
const WM: WatermarkSpec = { text: '@imagii', position: 'top-left', opacity: 0.85, fontSizePct: 3.5 }

function queue(source = LANDSCAPE, watermark: WatermarkSpec | null = WM) {
  let n = 0
  return buildKitQueue({
    source,
    clip: CLIP,
    kitDir: '/out/Clip_1-kit',
    safeName: 'Clip_1',
    watermark,
    newJobId: () => `job${++n}`
  })
}

describe('buildKitQueue — the saved watermark rides on every platform file', () => {
  it('puts the watermark on all five jobs, not just the first', () => {
    const jobs = queue()
    expect(jobs).toHaveLength(5)
    for (const job of jobs) {
      expect(job.watermark, `${job.preset} carries the watermark`).toEqual(WM)
    }
  })

  it('no saved watermark is no watermark (the kit stays clean for a user who set none)', () => {
    for (const job of queue(LANDSCAPE, null)) expect(job.watermark).toBeNull()
  })
})

describe('buildKitQueue — one job per platform slot', () => {
  it('queues the five platforms in the order the kit has always run them', () => {
    expect(queue().map((j) => j.preset)).toEqual(['youtube', 'reels', 'tiktok', 'twitter', 'facebook'])
    expect(queue().map((j) => j.outputFilename)).toEqual([
      'Clip_1_youtube.mp4',
      'Clip_1_reels.mp4',
      'Clip_1_tiktok.mp4',
      'Clip_1_twitter.mp4',
      'Clip_1_facebook.mp4'
    ])
  })

  it('each job is for its own platform only, in the kit folder, from the loaded source', () => {
    for (const job of queue()) {
      expect(job.clip.selectedPresets).toEqual([job.preset])
      expect(job.outDir).toBe('/out/Clip_1-kit')
      expect(job.sourcePath).toBe('/v/stream.mp4')
      // The clip's own range and edits are the user's, untouched.
      expect(job.clip.startSec).toBe(2)
      expect(job.clip.endSec).toBe(12)
    }
  })

  it('gives every job its own id', () => {
    const ids = queue().map((j) => j.jobId)
    expect(new Set(ids).size).toBe(5)
  })

  it('a vertical source exports its YouTube slot as a Short: reels geometry, youtube_short filename', () => {
    const jobs = queue(PORTRAIT)
    expect(jobs[0]?.preset).toBe('reels')
    expect(jobs[0]?.clip.selectedPresets).toEqual(['reels'])
    expect(jobs[0]?.outputFilename).toBe('Clip_1_youtube_short.mp4')
    // The real reels slot is still its own file.
    expect(jobs[1]?.outputFilename).toBe('Clip_1_reels.mp4')
  })

  it('kitEffectivePresets mirrors the queue, and duplicates only on a vertical source', () => {
    expect(kitEffectivePresets(LANDSCAPE)).toEqual(queue(LANDSCAPE).map((j) => j.preset))
    expect(kitEffectivePresets(PORTRAIT)).toEqual(queue(PORTRAIT).map((j) => j.preset))
    expect(kitEffectivePresets(PORTRAIT)).toEqual(['reels', 'reels', 'tiktok', 'twitter', 'facebook'])
  })
})

describe('platformsOverLimit — the kit asks once, and only about a platform that is over', () => {
  const kit = kitEffectivePresets(LANDSCAPE)

  it('a short clip is inside every typical limit', () => {
    expect(platformsOverLimit(30, kit)).toEqual([])
    expect(platformsOverLimit(PLATFORM_INFO.reels.durationHardLimit, kit)).toEqual([])
  })

  it('one second past Reels\' 3 minutes names Reels alone', () => {
    const over = platformsOverLimit(181, kit)
    expect(over.map((p) => p.id)).toEqual(['reels'])
  })

  it('a 20-minute clip is still only Reels; an hour-plus adds TikTok', () => {
    expect(platformsOverLimit(1200, kit).map((p) => p.id)).toEqual(['reels'])
    expect(platformsOverLimit(3601, kit).map((p) => p.id)).toEqual(['reels', 'tiktok'])
  })

  it('a long enough clip names all five, in the kit order', () => {
    const over = platformsOverLimit(13 * 3600, kit)
    expect(over.map((p) => p.id)).toEqual(ALL_PLATFORM_IDS.slice().sort((a, b) => kit.indexOf(a) - kit.indexOf(b)))
    expect(over).toHaveLength(5)
  })

  it('a vertical source lists Reels once, not once per slot that uses it', () => {
    const over = platformsOverLimit(1200, kitEffectivePresets(PORTRAIT))
    expect(over.map((p) => p.id)).toEqual(['reels'])
  })

  it('uses the same limits as the export grid\'s "Too long"', () => {
    // Exactly at the cap is not over; the grid says "Longer than" for more.
    for (const p of Object.values(PLATFORM_INFO)) {
      expect(platformsOverLimit(p.durationHardLimit, [p.id])).toEqual([])
      expect(platformsOverLimit(p.durationHardLimit + 1, [p.id])).toEqual([p])
    }
  })
})

describe('the question\'s words', () => {
  it('a row reads as a typical limit, never a fact', () => {
    expect(describeKitLimit(PLATFORM_INFO.reels)).toBe('Reels — the typical 3-minute limit')
    expect(describeKitLimit(PLATFORM_INFO.tiktok)).toBe('TikTok — the typical 60-minute limit')
    expect(describeKitLimit(PLATFORM_INFO.youtube)).toBe('YouTube — the typical 12-hour limit')
    for (const info of Object.values(PLATFORM_INFO)) {
      expect(describeKitLimit(info)).not.toMatch(/reject|refuse|not allowed|fail/i)
    }
  })

  it('formats a clip\'s length as m:ss, with hours when it has them', () => {
    expect(formatClipLength(9)).toBe('0:09')
    expect(formatClipLength(250)).toBe('4:10')
    expect(formatClipLength(1200)).toBe('20:00')
    expect(formatClipLength(3725)).toBe('1:02:05')
    expect(formatClipLength(-5)).toBe('0:00')
  })
})
