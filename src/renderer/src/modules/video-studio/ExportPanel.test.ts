import { describe, it, expect } from 'vitest'
import type { Clip, PlatformId } from '@shared/clip'
import type { CustomPreset } from '@shared/customPresets'
import { findSafeZoneIssues, settleJobs, type JobStatus } from './ExportPanel'

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

/**
 * T-112 — a failed batch marks the job that failed, not the whole queue.
 *
 * The queue runs one job at a time and stops at the first that fails, but the
 * `catch` painted every unfinished row "Failed" in red, with the reason only in a
 * hover title. The USER_GUIDE promised "you can still see which one after the
 * message fades", and the panel could not say which: five rows all red for one
 * missing file. The job that was running is the FIRST row that has not finished
 * (the batch is sequential, so every row before it completed and every row after it
 * never started); it reads Failed, in red, with its reason as text. The rest read
 * "Not run" in neutral ink. A cancel is the user's own act on the whole batch and is
 * unchanged: every unfinished row is Canceled.
 */
describe('settleJobs — which row failed, and which never ran (T-112)', () => {
  const job = (n: number, patch: Partial<JobStatus> = {}): JobStatus => ({
    jobId: `j${n}`,
    clipName: `Clip ${n}`,
    presetLabel: 'YouTube',
    percent: 0,
    ...patch
  })
  const done = (n: number): JobStatus => job(n, { percent: 100, outputPath: `/out/clip${n}.mp4` })
  const REASON = "Export failed. A file imagii needs isn't there. It may have been moved or deleted."

  it('the running row is Failed, with the reason; the rows behind it are Not run', () => {
    const settled = settleJobs([done(1), job(2, { percent: 37 }), job(3), job(4)], {
      cancelled: false,
      message: REASON
    })
    expect(settled[0]).toEqual(done(1))
    expect(settled[1]).toMatchObject({ error: REASON, percent: 37 })
    expect(settled[1]?.canceled).toBeFalsy()
    expect(settled[1]?.notRun).toBeFalsy()
    for (const row of settled.slice(2)) {
      expect(row.notRun).toBe(true)
      expect(row.error).toBeUndefined()
      expect(row.canceled).toBeFalsy()
    }
  })

  it('a job that fails before it reports any progress is still the one that failed', () => {
    // A source that is gone fails in the probe, ahead of the first progress event.
    const settled = settleJobs([job(1), job(2), job(3)], { cancelled: false, message: REASON })
    expect(settled.map((j) => [j.error !== undefined, j.notRun === true])).toEqual([
      [true, false],
      [false, true],
      [false, true]
    ])
  })

  it('a single-job batch that fails is simply Failed', () => {
    const [only] = settleJobs([job(1)], { cancelled: false, message: REASON })
    expect(only).toMatchObject({ error: REASON })
    expect(only?.notRun).toBeFalsy()
  })

  it('finished rows are never touched, however the batch ended', () => {
    for (const cancelled of [false, true]) {
      const settled = settleJobs([done(1), done(2), job(3)], { cancelled, message: 'x' })
      expect(settled[0]).toEqual(done(1))
      expect(settled[1]).toEqual(done(2))
    }
  })

  it('a cancel is the user\'s decision on the whole batch: every unfinished row is Canceled, none is Not run', () => {
    const settled = settleJobs([done(1), job(2, { percent: 10 }), job(3), job(4)], {
      cancelled: true,
      message: 'Export canceled. Files already finished are in your folder.'
    })
    expect(settled.slice(1).map((j) => [j.canceled, j.notRun ?? false])).toEqual([
      [true, false],
      [true, false],
      [true, false]
    ])
    expect(settled[1]?.error).toBe('Export canceled. Files already finished are in your folder.')
  })

  it('a batch that finished every job changes nothing', () => {
    const rows = [done(1), done(2)]
    expect(settleJobs(rows, { cancelled: false, message: REASON })).toEqual(rows)
  })

  it('does not mutate the rows it is given', () => {
    const rows = [done(1), job(2), job(3)]
    const before = JSON.stringify(rows)
    settleJobs(rows, { cancelled: false, message: REASON })
    expect(JSON.stringify(rows)).toBe(before)
  })
})
