import { describe, it, expect } from 'vitest'
import { buildReframeGraph, REFRAME_FPS } from './reframe'
import { buildAudioSpeedFilter, buildVideoFilter, even, stripCrop } from './filters'
import type { ColorGrade, CropRect, TextOverlay } from '../../shared/clip'

/**
 * T-124 (16) - Reframe makes the clip the user built: the selected clip's CROP and SPEED.
 *
 * `video:reframe` took only the source, the range, a side and a size, so a clip cropped to the part of the screen that matters
 * (or sped up) was reframed from the whole frame at normal speed - the wrong-file class T-96 and T-105 closed for Compile and the
 * GIF, and the captioned-vertical route in USER_GUIDE names Reframe as its FIRST step. The filter graph is built here from the same
 * pieces a platform export uses (`cropToFrame` and the speed filters), and these tests hold the shape; `tests/integration/media.spec.ts`
 * runs it on real files.
 */

const SOURCE_1080 = { width: 1920, height: 1080 }

/** The arithmetic `reframeClip` had before this change, for the case with no crop and no speed: that graph must not move by a byte. */
function legacyFilter(position: 'left' | 'center' | 'right', sourceW: number, sourceH: number, outW: number, outH: number): string {
  const targetAspect = outW / outH
  let cropW: number
  let cropH: number
  if (sourceW / sourceH > targetAspect) {
    cropH = even(sourceH)
    cropW = even(cropH * targetAspect)
  } else {
    cropW = even(sourceW)
    cropH = even(cropW / targetAspect)
  }
  const margin = sourceW - cropW
  const cropX = Math.max(0, position === 'left' ? even(margin * 0.15) : position === 'right' ? even(margin * 0.85) : even(margin / 2))
  const cropY = Math.max(0, even((sourceH - cropH) / 2))
  // T-126 (21): the crop and the scale are the arithmetic they always were; the one thing added is the constant-rate stage ahead of them.
  return `fps=30,crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${even(outW)}:${even(outH)}:flags=lanczos,setsar=1`
}

const spec = (over: Record<string, unknown> = {}): Parameters<typeof buildReframeGraph>[0] => ({
  position: 'center',
  startSec: 0,
  outputWidth: 1080,
  outputHeight: 1920,
  ...over
})

describe('buildReframeGraph: a clip with no crop and no speed is the graph it always was', () => {
  it.each(['left', 'center', 'right'] as const)('%s on a 1080p source, byte for byte', (position) => {
    const g = buildReframeGraph(spec({ position }), SOURCE_1080)
    expect(g.filter).toBe(legacyFilter(position, 1920, 1080, 1080, 1920))
    expect(g.audioFilter).toBe('')
  })

  it('on a 4:3 source and on a source that is already vertical', () => {
    expect(buildReframeGraph(spec(), { width: 640, height: 480 }).filter).toBe(legacyFilter('center', 640, 480, 1080, 1920))
    expect(buildReframeGraph(spec(), { width: 1080, height: 1920 }).filter).toBe(legacyFilter('center', 1080, 1920, 1080, 1920))
  })

  it('a speed of 1, a missing speed, 0, a negative and NaN are all "no speed" (one reading of speed: clipSpeed)', () => {
    for (const speedMultiplier of [1, undefined, 0, -2, Number.NaN, null]) {
      const g = buildReframeGraph(spec({ speedMultiplier }), SOURCE_1080)
      expect(g.filter, String(speedMultiplier)).toBe(legacyFilter('center', 1920, 1080, 1080, 1920))
      expect(g.audioFilter, String(speedMultiplier)).toBe('')
    }
  })
})

describe('buildReframeGraph: the clip\'s crop is the frame the strip is cut from (T-124 (16))', () => {
  // A crop of 960 x 720 at (480, 180): the rectangle's own shape is 4:3.
  const crop: CropRect = { x: 480 / 1920, y: 180 / 1080, w: 960 / 1920, h: 720 / 1080 }

  it('the crop comes first, then the 9:16 strip of THAT frame, then the scale', () => {
    const { filter } = buildReframeGraph(spec({ cropRect: crop }), SOURCE_1080)
    // 960 x 720 -> a 9:16 strip is 404 wide (720 * 0.5625 = 405, made even), centered in 960: x = 278.
    expect(filter).toBe('fps=30,crop=960:720:480:180,crop=404:720:278:0,scale=1080:1920:flags=lanczos,setsar=1')
  })

  it('the side picks from the CROP, not from the whole source', () => {
    // margin 960 - 404 = 556: the left strip starts 15% in (83.4, made even: 82), the right one 85% in (472.6: 472).
    expect(buildReframeGraph(spec({ cropRect: crop, position: 'left' }), SOURCE_1080).filter).toContain(',crop=404:720:82:0,')
    expect(buildReframeGraph(spec({ cropRect: crop, position: 'right' }), SOURCE_1080).filter).toContain(',crop=404:720:472:0,')
  })

  it('a crop that is already 9:16 is cut to itself (the strip stage is the identity) and every side agrees', () => {
    const vertical: CropRect = { x: 690 / 1920, y: 60 / 1080, w: 540 / 1920, h: 960 / 1080 }
    const graphs = (['left', 'center', 'right'] as const).map((position) => buildReframeGraph(spec({ cropRect: vertical, position }), SOURCE_1080).filter)
    expect(new Set(graphs).size).toBe(1)
    expect(graphs[0]).toBe('fps=30,crop=540:960:690:60,crop=540:960:0:0,scale=1080:1920:flags=lanczos,setsar=1')
  })

  it('a crop taller than 9:16 is cut on its height, not its width', () => {
    // 400 x 1000 is 0.4: narrower than 9:16 (0.5625), so the strip keeps the width and trims the height: 400 / 0.5625 = 711, made even
    // 710, centered in 1000 (145, made even: 144).
    const tall: CropRect = { x: 100 / 1920, y: 40 / 1080, w: 400 / 1920, h: 1000 / 1080 }
    expect(buildReframeGraph(spec({ cropRect: tall }), SOURCE_1080).filter).toBe('fps=30,crop=400:1000:100:40,crop=400:710:0:144,scale=1080:1920:flags=lanczos,setsar=1')
  })

  it('every number in the strip is an even integer, whatever the crop (yuv420p)', () => {
    const odd: CropRect = { x: 0.1234, y: 0.0517, w: 0.4321, h: 0.7777 }
    const { filter } = buildReframeGraph(spec({ cropRect: odd }), { width: 1919, height: 1079 })
    for (const stage of filter.split(',').filter((s) => s.startsWith('crop='))) {
      for (const n of stage.slice(5).split(':')) expect(Number(n) % 2, `${stage}`).toBe(0)
    }
  })

  it('no crop -> no crop stage but the strip\'s own', () => {
    expect(buildReframeGraph(spec({ cropRect: null }), SOURCE_1080).filter.match(/crop=/g)).toHaveLength(1)
  })
})

describe('buildReframeGraph: the clip\'s speed is applied to the picture and the sound (T-124 (16))', () => {
  it('setpts leads the graph, and the sound gets the same tempo the export and Compile give it', () => {
    const g = buildReframeGraph(spec({ speedMultiplier: 2 }), SOURCE_1080)
    expect(g.filter.startsWith('setpts=PTS/2.0000,fps=30,crop=')).toBe(true)
    expect(g.audioFilter).toBe(buildAudioSpeedFilter(2))
    expect(g.audioFilter).not.toBe('')
  })

  it.each([0.25, 0.5, 1.5, 4])('a speed of %s: the picture and the sound agree on it', (speedMultiplier) => {
    const g = buildReframeGraph(spec({ speedMultiplier }), SOURCE_1080)
    expect(g.filter.startsWith(`setpts=PTS/${speedMultiplier.toFixed(4)},fps=30,`)).toBe(true)
    expect(g.audioFilter).toBe(buildAudioSpeedFilter(speedMultiplier))
  })

  it('crop and speed together: speed, then the crop, then the strip, then the scale', () => {
    const crop: CropRect = { x: 480 / 1920, y: 180 / 1080, w: 960 / 1920, h: 720 / 1080 }
    const g = buildReframeGraph(spec({ cropRect: crop, speedMultiplier: 2 }), SOURCE_1080)
    expect(g.filter).toBe('setpts=PTS/2.0000,fps=30,crop=960:720:480:180,crop=404:720:278:0,scale=1080:1920:flags=lanczos,setsar=1')
  })
})

describe('buildReframeGraph: the clip\'s look is the shared builder\'s, at the 9:16 frame (T-125 (9))', () => {
  // T-124 (16) built Reframe from the speed and the crop only, on the premise that "grade stays out, matching Compile" - which was
  // false (Compile's segment is `buildVideoFilter` with the compilation's frame, T-105). A Reframe is that same call with the 9:16
  // frame, and the strip of the chosen side in place of the centered cut. These pins hold the claim two ways: the stages are there,
  // in the builder's order; and, for the centered strip of an even source, the string IS the builder's own.
  const GRADE: ColorGrade = { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.4 }
  const HOOK: TextOverlay = {
    id: 'o1', text: 'WAIT FOR IT', font: 'Impact', sizePx: 64, colorHex: '#ff3b30', x: 0.1, y: 0.15, startSec: 12, endSec: 14
  }
  const FRAME = { width: 1080, height: 1920, aspectRatio: 1080 / 1920, fps: REFRAME_FPS }
  const RECIPE = { startSec: 10, textOverlays: [HOOK], colorGrade: GRADE, autoZoom: true, hypeShake: true, speedMultiplier: 2 }

  it('carries the grade, Auto Zoom, Hype Shake and the text, in the export\'s order: speed, strip, shake, scale, grade, zoom, text', () => {
    const { filter } = buildReframeGraph(spec(RECIPE), SOURCE_1080)
    const at = (needle: string): number => {
      const i = filter.indexOf(needle)
      expect(i, `${needle} in ${filter}`).toBeGreaterThan(-1)
      return i
    }
    const order = ['setpts=PTS/2.0000', 'crop=606:1080:656:0', 'crop=iw-6:ih-6', 'scale=1080:1920:flags=lanczos,setsar=1', 'eq=', 'colorbalance=', 'zoompan=', 'drawtext=']
    const places = order.map(at)
    expect(places, order.join(' < ')).toEqual([...places].sort((a, b) => a - b))
    // The zoom is built for THIS frame: the 9:16 size and the rate the encoder writes.
    expect(filter).toContain(`fps=${REFRAME_FPS},zoompan=`)
    expect(filter).toContain(`s=1080x1920:fps=${REFRAME_FPS}`)
    // The overlay's window is on the clip's clock at its speed: (12 - 10) / 2 s to (14 - 10) / 2 s.
    expect(filter).toContain("enable='between(t,1.000,2.000)'")
    // x and y are fractions of the 9:16 frame, not of the source.
    expect(filter).toContain(':x=108:y=288:')
  })

  it('a clip with a grade and no source color space has no matrix stage; a bt709 source gets its retag right after colorbalance', () => {
    expect(buildReframeGraph(spec({ colorGrade: GRADE }), SOURCE_1080).filter).not.toContain('setparams')
    const tagged = buildReframeGraph(spec({ colorGrade: GRADE }), { ...SOURCE_1080, colorSpace: 'bt709' }).filter
    expect(tagged).toMatch(/,colorbalance=[^,]+,scale=out_color_matrix=bt709,setparams=colorspace=bt709(?:,|$)/)
  })

  it.each(['center'] as const)('the %s strip of an even source is the export\'s own graph at the 9:16 frame, byte for byte (one builder, not two)', (position) => {
    const reframed = buildReframeGraph(spec({ ...RECIPE, position }), SOURCE_1080).filter
    const exported = buildVideoFilter(
      { startSec: 10, cropRect: null, textOverlays: [HOOK], colorGrade: GRADE, autoZoom: true, hypeShake: true, speedMultiplier: 2 },
      FRAME,
      SOURCE_1080
    )
    expect(reframed).toBe(exported)
  })

  it('and for Left and Right only the strip stage differs from the export\'s', () => {
    const exported = buildVideoFilter({ startSec: 10, cropRect: null, textOverlays: [HOOK], colorGrade: GRADE, autoZoom: true, hypeShake: true, speedMultiplier: 2 }, FRAME, SOURCE_1080)
    for (const position of ['left', 'right'] as const) {
      const reframed = buildReframeGraph(spec({ ...RECIPE, position }), SOURCE_1080).filter
      const strip = stripCrop(SOURCE_1080, 1080 / 1920, position)
      expect(reframed, position).toBe(exported.replace('crop=606:1080:656:0', strip))
      expect(strip, position).not.toBe('crop=606:1080:656:0')
    }
  })

  it('the clip\'s crop and the strip of it still come first, and the look follows the scale: crop, strip, scale, grade', () => {
    const crop: CropRect = { x: 480 / 1920, y: 180 / 1080, w: 960 / 1920, h: 720 / 1080 }
    const { filter } = buildReframeGraph(spec({ cropRect: crop, colorGrade: GRADE }), SOURCE_1080)
    expect(filter.startsWith('fps=30,crop=960:720:480:180,crop=404:720:278:0,scale=1080:1920:flags=lanczos,setsar=1,eq=')).toBe(true)
  })

  it('every guarantee of the old graph holds with a full recipe: an even scale target, square pixels, only even numbers in a crop', () => {
    const { filter } = buildReframeGraph({ ...spec(RECIPE), outputWidth: 1081, outputHeight: 1921 }, { width: 1919, height: 1079 })
    expect(filter).toContain('scale=1080:1920:flags=lanczos,setsar=1')
    for (const stage of filter.split(',').filter((x) => x.startsWith('crop=') && !x.includes('iw'))) {
      for (const n of stage.slice(5).split(':')) expect(Number(n) % 2, stage).toBe(0)
    }
  })

  it('no recipe: no grade, no zoom, no shake, no text', () => {
    const { filter } = buildReframeGraph(spec(), SOURCE_1080)
    for (const gone of ['eq=', 'colorbalance', 'zoompan', 'drawtext', 'crop=iw-6']) expect(filter).not.toContain(gone)
  })
})

describe('stripCrop (T-125 (9))', () => {
  it('is always a stage, even when the frame is already the target\'s shape (the cut is then the identity)', () => {
    expect(stripCrop({ width: 1080, height: 1920 }, 1080 / 1920, 'center')).toBe('crop=1080:1920:0:0')
    expect(stripCrop({ width: 1080, height: 1920 }, 1080 / 1920, 'left')).toBe('crop=1080:1920:0:0')
  })
  it('15% / 50% / 85% of the margin, each an even number', () => {
    expect(stripCrop(SOURCE_1080, 9 / 16, 'left')).toBe('crop=606:1080:196:0')
    expect(stripCrop(SOURCE_1080, 9 / 16, 'center')).toBe('crop=606:1080:656:0')
    expect(stripCrop(SOURCE_1080, 9 / 16, 'right')).toBe('crop=606:1080:1116:0')
  })
})
