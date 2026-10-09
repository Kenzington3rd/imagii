import { describe, it, expect } from 'vitest'
import type { Clip } from '../../src/shared/clip'
import { buildWatermark } from '../../src/shared/watermark'
import { buildKitQueue } from '../../src/renderer/src/modules/video-studio/clipKit'
import { buildVideoFilter } from '../../src/main/ffmpeg/filters'
import { PLATFORM_PRESETS } from '../../src/main/ffmpeg/presets'

/**
 * T-85 — the kit's watermark, followed from the renderer's job spec into the
 * filter graph main builds from it.
 *
 * Clip Kit passed `watermark: null`, so no kit file ever carried the watermark
 * a user had saved. This is the cross-tree half (it reads renderer AND main,
 * which is why it lives here): the jobs the button queues, handed to the real
 * `buildVideoFilter`, produce a watermark drawtext for every platform — and
 * none when the user saved none. It asserts what the graph LOOKS like; whether
 * ffmpeg accepts and paints it is the Layer 5 suite's job (media.spec.ts,
 * "Clip Kit watermark"), because a string-shape test cannot know.
 */

const CLIP: Clip = {
  id: 'c1',
  name: 'Clip 1',
  startSec: 0,
  endSec: 5,
  cropRect: null,
  textOverlays: [],
  selectedPresets: ['youtube']
}
const SOURCE = { filePath: '/v/stream.mp4', width: 1920, height: 1080 }

function kitJobs(handle: unknown, corner: unknown) {
  let n = 0
  return buildKitQueue({
    source: SOURCE,
    clip: CLIP,
    kitDir: '/out/kit',
    safeName: 'Clip_1',
    watermark: buildWatermark(handle, corner),
    newJobId: () => `j${++n}`
  })
}

function graphFor(job: ReturnType<typeof kitJobs>[number]): string {
  return buildVideoFilter(
    job.clip,
    PLATFORM_PRESETS[job.preset],
    { width: SOURCE.width, height: SOURCE.height },
    job.watermark
  )
}

describe('the kit\'s jobs, through main\'s filter graph', () => {
  it('every platform file gets a watermark drawtext with the saved handle', () => {
    const jobs = kitJobs('@kit_unit', 'top-left')
    expect(jobs).toHaveLength(5)
    for (const job of jobs) {
      const graph = graphFor(job)
      expect(graph, `${job.preset} graph`).toMatch(/drawtext=/)
      expect(graph, `${job.preset} graph carries the handle`).toContain('@kit_unit')
      // The saved corner: top-left anchors at the 20 px padding on both axes.
      expect(graph, `${job.preset} graph uses the saved corner`).toMatch(/:x=20:y=20:/)
    }
  })

  it('a user who saved no handle gets a kit with no drawtext at all', () => {
    for (const job of kitJobs(undefined, undefined)) {
      expect(graphFor(job), job.preset).not.toMatch(/drawtext/)
    }
    for (const job of kitJobs('   ', 'top-left')) {
      expect(graphFor(job), job.preset).not.toMatch(/drawtext/)
    }
  })

  it('an unrecognised saved corner cannot reach the graph: it draws bottom-right', () => {
    for (const job of kitJobs('@a', 'sideways')) {
      expect(graphFor(job), job.preset).toMatch(/x=w-tw-20:y=h-th-20/)
    }
  })
})
