import { describe, it, expect } from 'vitest'
import type { Clip, PlatformId } from '@shared/clip'
import type { CustomPreset } from '@shared/customPresets'
import { findSafeZoneIssues } from './ExportPanel'

/**
 * The safe-zone pre-flight (Phase 3.4), re-pointed at the clip's EFFECTIVE
 * frame by T-83: the manual crop when it has one, the source otherwise. The
 * pipeline cuts every platform's shape out of that frame, so that frame is
 * what any one platform's cut can take away from another's.
 */

function clip(selected: PlatformId[], cropRect: Clip['cropRect'] = null, name = 'Clip 1'): Clip {
  return {
    id: name,
    name,
    startSec: 0,
    endSec: 30,
    cropRect,
    textOverlays: [],
    selectedPresets: selected
  }
}

// A 9:16 strip out of the middle of a 3840x2160 frame: 1215 x 2160.
const TALL_CROP = { x: 0.34, y: 0, w: 1215 / 3840, h: 1 }

describe('findSafeZoneIssues', () => {
  it('a clip with fewer than two targets has nothing to collide with', () => {
    expect(findSafeZoneIssues([clip(['youtube'])], 1920, 1080)).toEqual([])
    expect(findSafeZoneIssues([clip([])], 1920, 1080)).toEqual([])
  })

  it('wide + tall on a wide source: the wide picture is cut down for the tall platform', () => {
    expect(findSafeZoneIssues([clip(['youtube', 'reels'])], 1920, 1080)).toEqual([
      { clipName: 'Clip 1', clippedZones: ['YouTube frame → cut down for Reels'] }
    ])
  })

  it('a 4:3 source loses in both directions (each cut takes something the other keeps)', () => {
    const rows = findSafeZoneIssues([clip(['youtube', 'reels'])], 320, 240)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.clippedZones.sort()).toEqual([
      'Reels frame → cut down for YouTube',
      'YouTube frame → cut down for Reels'
    ])
  })

  it('two platforms of one shape never collide', () => {
    expect(findSafeZoneIssues([clip(['youtube', 'twitter', 'facebook'])], 1920, 1080)).toEqual([])
    expect(findSafeZoneIssues([clip(['reels', 'tiktok'])], 1920, 1080)).toEqual([])
  })

  it('reads the frame from the crop: with a 9:16 crop it is the WIDE platform that loses', () => {
    // Against the 16:9 source (the pre-T-83 reading) this said the TALL
    // platform's cut loses YouTube's picture; against the crop — which is
    // what the export cuts from — the tall platform keeps all of it and
    // YouTube's is the one cut down.
    expect(findSafeZoneIssues([clip(['youtube', 'tiktok'])], 3840, 2160)).toEqual([
      { clipName: 'Clip 1', clippedZones: ['YouTube frame → cut down for TikTok'] }
    ])
    expect(findSafeZoneIssues([clip(['youtube', 'tiktok'], TALL_CROP)], 3840, 2160)).toEqual([
      { clipName: 'Clip 1', clippedZones: ['TikTok frame → cut down for YouTube'] }
    ])
  })

  it('a crop of the platforms\' own shape silences the warning it would have raised', () => {
    // A 9:16 crop and only tall platforms: nothing is cut from anything.
    expect(findSafeZoneIssues([clip(['reels', 'tiktok'], TALL_CROP)], 3840, 2160)).toEqual([])
    // A 16:9 crop of a 4:3 source with only wide platforms: likewise.
    const wideCrop = { x: 0, y: 0.125, w: 1, h: 0.75 }
    expect(findSafeZoneIssues([clip(['youtube', 'twitter'], wideCrop)], 320, 240)).toEqual([])
  })

  it('each clip is judged on its own crop', () => {
    const rows = findSafeZoneIssues(
      [clip(['youtube', 'tiktok'], null, 'Whole'), clip(['youtube', 'tiktok'], TALL_CROP, 'Cropped')],
      3840,
      2160
    )
    expect(rows).toEqual([
      { clipName: 'Whole', clippedZones: ['YouTube frame → cut down for TikTok'] },
      { clipName: 'Cropped', clippedZones: ['TikTok frame → cut down for YouTube'] }
    ])
  })

  it('custom presets take part, named as the user named them', () => {
    const square: CustomPreset = {
      id: 'p1',
      name: 'Square post',
      basePlatformId: 'youtube',
      width: 1080,
      height: 1080,
      fps: 30,
      videoBitrate: '5M',
      audioBitrate: '128k'
    }
    const c: Clip = { ...clip(['youtube']), customPresetIds: ['p1'] }
    const rows = findSafeZoneIssues([c], 1920, 1080, [square])
    expect(rows).toEqual([
      { clipName: 'Clip 1', clippedZones: ['YouTube frame → cut down for Square post'] }
    ])
  })
})
