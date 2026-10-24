import { describe, it, expect } from 'vitest'
import { buildSegmentFilter, buildSegmentFilters, COMPILE_FPS } from './concat'
import { buildAudioSpeedFilter, buildVideoFilter, cropToFrame } from './filters'
import { PLATFORM_PRESETS } from './presets'
import type { Clip, ColorGrade, TextOverlay } from '../../shared/clip'

/**
 * T-96 / T-105 — the filters that make ONE compilation segment.
 *
 * It began as a bare `scale=W:H`, which forced the compilation's shape on
 * whatever the segment was (a 9:16 crop came out three times too wide), and then
 * carried the clip's crop and nothing else: a clip at 2x compiled at 1x with its
 * color, text and effects gone. A segment is now made by the platform export's
 * own builder (`buildVideoFilter`) with the compilation as the frame, and its
 * sound by the same `atempo` chain. Layer 5 ("a compiled clip is the clip the
 * user built") proves real ffmpeg agrees with every claim below.
 */

const src = { width: 1920, height: 1080 }
const SCALE = 'scale=1920:1080:flags=lanczos,setsar=1'
// T-126 (21): the picture is made constant-rate at the compilation's rate (30 fps) right after the retime and ahead of the crop.
const CFR = 'fps=30'
// 960x720 at (480, 180): a 4:3 crop of the 16:9 source.
const fourThree = { x: 480.25 / 1920, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }
const seg = { startSec: 0, endSec: 2 }

const GRADE: ColorGrade = { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 }
const OVERLAY: TextOverlay = {
  id: 'o1',
  text: 'GG',
  font: 'Arial',
  sizePx: 48,
  colorHex: '#ff3b30',
  x: 0.1,
  y: 0.85,
  startSec: 12.4,
  endSec: 13.6
}

describe('buildSegmentFilter — the crop (T-96)', () => {
  it('a 16:9 segment with no recipe is exactly the scale it always was', () => {
    expect(buildSegmentFilter(seg, src, 1920, 1080)).toBe(`${CFR},${SCALE}`)
    expect(buildSegmentFilter({ ...seg, cropRect: null }, src, 1920, 1080)).toBe(`${CFR},${SCALE}`)
  })

  it('a cropped segment is the crop, a cut of it to 16:9, then the scale', () => {
    expect(buildSegmentFilter({ ...seg, cropRect: fourThree }, src, 1920, 1080)).toBe(
      `${CFR},crop=960:720:480:180,crop=960:540:0:90,${SCALE}`
    )
  })

  it('a 9:16 crop is cut to the compilation\'s shape rather than stretched to fill it', () => {
    const tall = { x: 690 / 1920, y: 60 / 1080, w: 540 / 1920, h: 960.25 / 1080 }
    expect(buildSegmentFilter({ ...seg, cropRect: tall }, src, 1920, 1080)).toBe(
      `${CFR},crop=540:960:690:60,crop=540:302:0:328,${SCALE}`
    )
  })

  it('a crop that already has the compilation\'s shape is only cropped and scaled', () => {
    expect(
      buildSegmentFilter({ ...seg, cropRect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }, src, 1920, 1080)
    ).toBe(`${CFR},crop=960:540:480:270,${SCALE}`)
  })

  it('a source that is not the compilation\'s shape is cut to it even with no crop', () => {
    // 640x480 into 1280x720: the widest 16:9 of the frame, then the scale.
    expect(buildSegmentFilter(seg, { width: 640, height: 480 }, 1280, 720)).toBe(
      'fps=30,crop=640:360:0:60,scale=1280:720:flags=lanczos,setsar=1'
    )
  })

  it('uses the same crop stages as every other caller of the chain', () => {
    const stages = cropToFrame(fourThree, src, 16 / 9).join(',')
    expect(
      buildSegmentFilter({ ...seg, cropRect: fourThree }, src, 1920, 1080).startsWith(`${CFR},${stages},scale=`)
    ).toBe(true)
  })

  it('snaps the compilation\'s size to even pixels, and cuts to the snapped shape', () => {
    // 1281x721 is 1280x720 to the encoder, which is 16:9.
    expect(buildSegmentFilter(seg, src, 1281, 721)).toBe('fps=30,scale=1280:720:flags=lanczos,setsar=1')
    expect(buildSegmentFilter(seg, { width: 640, height: 480 }, 1281, 721)).toBe(
      'fps=30,crop=640:360:0:60,scale=1280:720:flags=lanczos,setsar=1'
    )
  })
})

describe('buildSegmentFilter — the rest of the clip\'s recipe (T-105)', () => {
  const full = {
    startSec: 12,
    endSec: 16,
    cropRect: fourThree,
    speedMultiplier: 2,
    colorGrade: GRADE,
    autoZoom: true,
    hypeShake: true,
    textOverlays: [OVERLAY]
  }

  it('is byte for byte the platform export\'s graph at the same geometry — one implementation', () => {
    // YouTube is 1920x1080, 16:9, 30 fps: the same frame as this compilation.
    const clip = {
      id: 'c',
      name: 'c',
      selectedPresets: ['youtube'],
      ...full
    } as Clip
    expect(buildSegmentFilter(full, src, 1920, 1080)).toBe(
      buildVideoFilter(clip, PLATFORM_PRESETS.youtube, src)
    )
    // ...and the same again from a 4:3 source, where the cut to 16:9 is real.
    const small = { width: 640, height: 480 }
    expect(buildSegmentFilter({ ...full, cropRect: null }, small, 1920, 1080)).toBe(
      buildVideoFilter({ ...clip, cropRect: null }, PLATFORM_PRESETS.youtube, small)
    )
  })

  it('puts every stage in the export\'s order: speed, crop, shake, scale, grade, zoom, text', () => {
    const graph = buildSegmentFilter(full, src, 1920, 1080)
    const at = (needle: string): number => graph.indexOf(needle)
    const order = [
      'setpts=PTS/2.0000',
      'fps=30,',
      'crop=960:720:480:180',
      'crop=iw-6:ih-6',
      'scale=1920:1080',
      'eq=brightness=0.100',
      'colorbalance=',
      'zoompan=',
      'drawtext='
    ].map(at)
    expect(order.every((i) => i >= 0), graph).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('carries each stage on its own', () => {
    expect(buildSegmentFilter({ ...seg, speedMultiplier: 4 }, src, 1920, 1080)).toBe(
      `setpts=PTS/4.0000,${CFR},${SCALE}`
    )
    expect(buildSegmentFilter({ ...seg, colorGrade: GRADE }, src, 1920, 1080)).toMatch(
      /^fps=30,scale=1920:1080:flags=lanczos,setsar=1,eq=brightness=0\.100:contrast=1\.200:saturation=0\.800,colorbalance=/
    )
    expect(buildSegmentFilter({ ...seg, hypeShake: true }, src, 1920, 1080)).toMatch(
      /^fps=30,crop=iw-6:ih-6:.*,scale=1920:1080/
    )
    expect(buildSegmentFilter({ ...seg, autoZoom: true }, src, 1920, 1080)).toContain('zoompan=')
  })

  it('a segment with an untouched recipe adds nothing', () => {
    const idle = {
      ...seg,
      speedMultiplier: 1,
      colorGrade: { brightness: 0, contrast: 1, saturation: 1, temperature: 0 },
      autoZoom: false,
      hypeShake: false,
      textOverlays: []
    }
    expect(buildSegmentFilter(idle, src, 1920, 1080)).toBe(`${CFR},${SCALE}`)
  })

  it('a nonsense speed is 1x, as it is for the export', () => {
    for (const speedMultiplier of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildSegmentFilter({ ...seg, speedMultiplier }, src, 1920, 1080)).toBe(`${CFR},${SCALE}`)
    }
  })

  it('the overlay window is on the segment\'s own clock: rebased by its start, divided by its speed', () => {
    // Stored source-absolute (12.4-13.6) on a clip that starts at 12: 0.4-1.6 s
    // into the segment, and 0.2-0.8 s at 2x (setpts has already halved the clock).
    const at1x = buildSegmentFilter({ ...full, speedMultiplier: 1, cropRect: null }, src, 1920, 1080)
    expect(at1x).toContain("enable='between(t,0.400,1.600)'")
    const at2x = buildSegmentFilter({ ...full, cropRect: null }, src, 1920, 1080)
    expect(at2x).toContain("enable='between(t,0.200,0.800)'")
  })

  it('writes the zoom at the compilation\'s rate, so the clip keeps its length', () => {
    // zoompan stamps its frames at its own fps (25 by default), not its input's.
    expect(COMPILE_FPS).toBe(30)
    const graph = buildSegmentFilter({ ...seg, autoZoom: true }, src, 1920, 1080)
    expect(graph).toContain(`fps=${COMPILE_FPS},zoompan=`)
    expect(graph).toContain(`:s=1920x1080:fps=${COMPILE_FPS}`)
  })
})

describe('buildSegmentFilters — the fades follow the clip\'s length in the output (T-105)', () => {
  const FADE = 0.4

  it('a 1x segment fades out 0.4 s before the end of its range, exactly as before', () => {
    const f = buildSegmentFilters({ startSec: 2, endSec: 6 }, src, 1920, 1080, 0.4, FADE)
    expect(f.video).toBe(`${CFR},${SCALE},fade=t=in:st=0:d=0.4,fade=t=out:st=3.600:d=0.4`)
    expect(f.audio).toBe('afade=t=in:st=0:d=0.4,afade=t=out:st=3.600:d=0.4,apad=whole_dur=4.000')
  })

  it('a 2x segment is half as long, so its fade-out starts at half the time', () => {
    // 4 source seconds at 2x are 2 s of output: out at 1.6, not 3.6 (past the end).
    const f = buildSegmentFilters(
      { startSec: 2, endSec: 6, speedMultiplier: 2 },
      src,
      1920,
      1080,
      0,
      FADE
    )
    expect(f.video).toBe(`setpts=PTS/2.0000,${CFR},${SCALE},fade=t=out:st=1.600:d=0.4`)
    expect(f.audio).toBe('atempo=2.0000,afade=t=out:st=1.600:d=0.4,apad=whole_dur=2.000')
  })

  it('a slowed segment is longer, so its fade-out starts later', () => {
    const f = buildSegmentFilters(
      { startSec: 0, endSec: 2, speedMultiplier: 0.5 },
      src,
      1920,
      1080,
      0,
      FADE
    )
    expect(f.video).toContain('fade=t=out:st=3.600:d=0.4')
    expect(f.audio).toBe('atempo=0.5000,afade=t=out:st=3.600:d=0.4,apad=whole_dur=4.000')
  })

  it('the tempo comes BEFORE the fades, so the fades are in output time', () => {
    const f = buildSegmentFilters(
      { startSec: 0, endSec: 8, speedMultiplier: 4 },
      src,
      1920,
      1080,
      FADE,
      FADE
    )
    expect(f.audio).toBe('atempo=2,atempo=2.0000,afade=t=in:st=0:d=0.4,afade=t=out:st=1.600:d=0.4,apad=whole_dur=2.000')
  })

  it('a clip shorter than its fade never asks for a negative start', () => {
    const f = buildSegmentFilters(
      { startSec: 0, endSec: 1, speedMultiplier: 4 },
      src,
      1920,
      1080,
      0,
      0.5
    )
    expect(f.video).toContain('fade=t=out:st=0.000:d=0.5')
    expect(f.audio).toContain('afade=t=out:st=0.000:d=0.5')
  })

  it('no fades and 1x: the sound is still padded to the clip\'s length, so -af is always there (T-131 (1))', () => {
    expect(buildSegmentFilters({ startSec: 0, endSec: 2 }, src, 1920, 1080, 0, 0)).toEqual({
      video: `${CFR},${SCALE}`,
      audio: 'apad=whole_dur=2.000'
    })
  })

  it('the audio chain is the export\'s own, then the pad', () => {
    for (const speedMultiplier of [0.25, 0.5, 1.5, 2, 3, 4]) {
      const f = buildSegmentFilters({ startSec: 0, endSec: 4, speedMultiplier }, src, 1920, 1080, 0, 0)
      expect(f.audio).toBe(`${buildAudioSpeedFilter(speedMultiplier)},apad=whole_dur=${(4 / speedMultiplier).toFixed(3)}`)
    }
  })
})

describe('the compilation\'s rate follows the source (T-130 (q))', () => {
  it('the fps stage and the zoom carry the rate they are given, at the head of the chain', () => {
    expect(buildSegmentFilter(seg, src, 1920, 1080, 60)).toBe(`fps=60,${SCALE}`)
    expect(buildSegmentFilter(seg, src, 1920, 1080, 25)).toBe(`fps=25,${SCALE}`)
    const zoom = buildSegmentFilter({ ...seg, autoZoom: true }, src, 1920, 1080, 60)
    expect(zoom).toContain('fps=60,zoompan=')
    expect(zoom).toContain(':s=1920x1080:fps=60')
    expect(zoom, 'no 30 left over from the old constant').not.toContain('fps=30')
  })

  it('an NTSC rate goes into the graph as it is, not rounded to a whole number', () => {
    const ntsc = 60000 / 1001
    expect(buildSegmentFilter(seg, src, 1920, 1080, ntsc)).toBe(`fps=${ntsc},${SCALE}`)
  })

  it('with no rate given it is the fallback, so a caller with nothing to derive from is what it always was', () => {
    expect(buildSegmentFilter(seg, src, 1920, 1080)).toBe(`fps=${COMPILE_FPS},${SCALE}`)
  })

  it('buildSegmentFilters hands the rate on to the picture and leaves the fades and the sound alone', () => {
    const f = buildSegmentFilters({ startSec: 2, endSec: 6 }, src, 1920, 1080, 0.4, 0.4, 60)
    expect(f.video).toBe(`fps=60,${SCALE},fade=t=in:st=0:d=0.4,fade=t=out:st=3.600:d=0.4`)
    // The T-131 (1) pad rides at the end of every segment's sound, whatever the rate.
    expect(f.audio).toBe('afade=t=in:st=0:d=0.4,afade=t=out:st=3.600:d=0.4,apad=whole_dur=4.000')
  })
})

describe('buildSegmentFilters — the sound is padded to the picture\'s length (T-131 (1))', () => {
  // A segment is written with `-shortest`, so it ends where its shorter stream does. A source whose sound does not cover the range
  // (a microphone that dropped, a sound that starts late) made the SOUND that stream: a range past its end came out as an empty stub
  // and the join silently dropped it and every segment after it. The pad makes the picture the shorter stream. Layer 5 (T-131 (1))
  // proves it on real files, on both majors; this is the shape of the argument it depends on.
  const pad = (f: { audio: string }): string => f.audio.split(',').at(-1) ?? ''

  it('the pad is the LAST stage, after the tempo and the fades', () => {
    const f = buildSegmentFilters({ startSec: 2, endSec: 6, speedMultiplier: 2 }, src, 1920, 1080, 0.4, 0.4)
    expect(f.audio.split(',').slice(-2)).toEqual(['afade=t=out:st=1.600:d=0.4', 'apad=whole_dur=2.000'])
  })

  it('it is finite: whole_dur, the clip\'s length IN THE OUTPUT (range over speed, three decimals), never a bare apad', () => {
    for (const [startSec, endSec, speedMultiplier, want] of [
      [1.37, 4.91, undefined, '3.540'],
      [0, 10, 2, '5.000'],
      [0, 2, 0.5, '4.000'],
      [3.333, 9.001, 3, '1.889']
    ] as const) {
      const f = buildSegmentFilters({ startSec, endSec, ...(speedMultiplier ? { speedMultiplier } : {}) }, src, 1920, 1080, 0.3, 0.3)
      expect(pad(f), `${startSec}-${endSec} at ${speedMultiplier ?? 1}x`).toBe(`apad=whole_dur=${want}`)
      expect(f.audio).not.toMatch(/apad(?!=whole_dur=\d)/)
    }
  })

  it('a clip shorter than a tenth of a second is padded to the tenth the fades already use', () => {
    expect(pad(buildSegmentFilters({ startSec: 0, endSec: 0.05 }, src, 1920, 1080, 0, 0))).toBe('apad=whole_dur=0.100')
  })
})
