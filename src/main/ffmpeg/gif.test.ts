import { describe, it, expect } from 'vitest'
import { buildGifFilter } from './gif'
import { cropToFrame } from './filters'

/**
 * T-96 — the GIF's filter graph. It took no crop, so a clip cropped to 9:16
 * came out as the whole frame. The crop now comes first (`cropToFrame`, the
 * platform export's own chain, with no target shape: the GIF keeps the shape
 * the user drew), ahead of the frame rate, the scale and the palette. Layer 5
 * ("a cropped clip compiled or GIF'd keeps its crop") proves real ffmpeg agrees.
 */

const src = { width: 1920, height: 1080 }
const TAIL =
  'split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5'
// 960x720 at (480, 180).
const fourThree = { x: 480.25 / 1920, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }

describe('buildGifFilter (T-96)', () => {
  it('an uncropped GIF\'s graph is byte for byte what it was, at 1x and at speed', () => {
    expect(buildGifFilter({ width: 480, fps: 15, speed: 1 })).toBe(
      `fps=15,scale=480:-1:flags=lanczos,${TAIL}`
    )
    expect(buildGifFilter({ width: 320, fps: 12, speed: 2, cropRect: null })).toBe(
      `setpts=PTS/2,fps=12,scale=320:-1:flags=lanczos,${TAIL}`
    )
  })

  it('a cropped GIF is cropped before anything else is computed', () => {
    expect(buildGifFilter({ width: 480, fps: 15, speed: 1, cropRect: fourThree }, src)).toBe(
      `crop=960:720:480:180,fps=15,scale=480:-1:flags=lanczos,${TAIL}`
    )
  })

  it('keeps the shape the user drew: one crop, no cut to a target shape', () => {
    const tall = { x: 690 / 1920, y: 60 / 1080, w: 540 / 1920, h: 960.25 / 1080 }
    const graph = buildGifFilter({ width: 320, fps: 10, speed: 1, cropRect: tall }, src)
    expect(graph.match(/crop=/g)).toHaveLength(1)
    expect(graph.startsWith('crop=540:960:690:60,fps=10,')).toBe(true)
  })

  it('puts the crop after the speed change and before the frame rate', () => {
    const graph = buildGifFilter({ width: 320, fps: 10, speed: 3, cropRect: fourThree }, src)
    expect(graph.startsWith('setpts=PTS/3,crop=960:720:480:180,fps=10,scale=')).toBe(true)
  })

  it('uses the same crop stages as every other caller of the chain', () => {
    const stages = cropToFrame(fourThree, src, null).join(',')
    expect(buildGifFilter({ width: 480, fps: 15, speed: 1, cropRect: fourThree }, src)).toContain(
      `${stages},fps=`
    )
  })

  it('refuses a crop it was not given the frame for (a crop is a fraction of the frame)', () => {
    expect(() => buildGifFilter({ width: 480, fps: 15, speed: 1, cropRect: fourThree })).toThrow(
      /source dimensions/
    )
  })
})
