import { describe, it, expect } from 'vitest'
import { buildSegmentFilter } from './concat'
import { cropToFrame } from './filters'

/**
 * T-96 — the filter that makes ONE compilation segment. It was a bare
 * `scale=W:H`, which forced the compilation's shape on whatever the segment
 * was: a 9:16 crop came out three times too wide. Now it is the clip's crop and
 * a centered cut to the compilation's shape (`cropToFrame`, the platform
 * export's own chain) followed by the same normalizing scale. Layer 5
 * ("a cropped clip compiled or GIF'd keeps its crop") proves real ffmpeg
 * agrees and that nothing is stretched.
 */

const src = { width: 1920, height: 1080 }
const SCALE = 'scale=1920:1080:flags=lanczos,setsar=1'
// 960x720 at (480, 180): a 4:3 crop of the 16:9 source.
const fourThree = { x: 480.25 / 1920, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }

describe('buildSegmentFilter (T-96)', () => {
  it('a 16:9 segment with no crop is exactly the scale it always was', () => {
    expect(buildSegmentFilter(null, src, 1920, 1080)).toBe(SCALE)
    expect(buildSegmentFilter(undefined, src, 1920, 1080)).toBe(SCALE)
  })

  it('a cropped segment is the crop, a cut of it to 16:9, then the scale', () => {
    expect(buildSegmentFilter(fourThree, src, 1920, 1080)).toBe(
      `crop=960:720:480:180,crop=960:540:0:90,${SCALE}`
    )
  })

  it('a 9:16 crop is cut to the compilation\'s shape rather than stretched to fill it', () => {
    const tall = { x: 690 / 1920, y: 60 / 1080, w: 540 / 1920, h: 960.25 / 1080 }
    expect(buildSegmentFilter(tall, src, 1920, 1080)).toBe(
      `crop=540:960:690:60,crop=540:302:0:328,${SCALE}`
    )
  })

  it('a crop that already has the compilation\'s shape is only cropped and scaled', () => {
    expect(buildSegmentFilter({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, src, 1920, 1080)).toBe(
      `crop=960:540:480:270,${SCALE}`
    )
  })

  it('a source that is not the compilation\'s shape is cut to it even with no crop', () => {
    // 640x480 into 1280x720: the widest 16:9 of the frame, then the scale.
    expect(buildSegmentFilter(null, { width: 640, height: 480 }, 1280, 720)).toBe(
      'crop=640:360:0:60,scale=1280:720:flags=lanczos,setsar=1'
    )
  })

  it('uses the same crop stages as every other caller of the chain', () => {
    const stages = cropToFrame(fourThree, src, 16 / 9).join(',')
    expect(buildSegmentFilter(fourThree, src, 1920, 1080).startsWith(`${stages},scale=`)).toBe(true)
  })

  it('snaps the compilation\'s size to even pixels, and cuts to the snapped shape', () => {
    // 1281x721 is 1280x720 to the encoder, which is 16:9.
    expect(buildSegmentFilter(null, src, 1281, 721)).toBe(
      'scale=1280:720:flags=lanczos,setsar=1'
    )
    expect(buildSegmentFilter(null, { width: 640, height: 480 }, 1281, 721)).toBe(
      'crop=640:360:0:60,scale=1280:720:flags=lanczos,setsar=1'
    )
  })
})
