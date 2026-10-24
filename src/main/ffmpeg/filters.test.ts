import { describe, it, expect } from 'vitest'
import {
  __testing__,
  buildAudioSpeedFilter,
  buildVideoFilter,
  cropToFrame,
  even,
  EVEN_PICTURE,
  type FilterClip,
  type FilterFrame
} from './filters'
import { PLATFORM_PRESETS, resolveExportPreset } from './presets'
import { OVERLAY_FONTS } from '../../shared/textOverlay'
import type { Clip, TextOverlay } from '../../shared/clip'

const { escapeDrawtext, safeOverlaySize, safeOverlayColor } = __testing__

/**
 * Regression tests for the drawtext escape helper. Round 6 caught that
 * newlines weren't being escaped, which broke the entire export for any
 * text overlay or watermark with embedded line breaks. Pin the escape
 * behavior in tests so a future "simplification" of the function can't
 * regress.
 *
 * T-111: the round-6 escape assumed ffmpeg reads `text='…'` once. It reads it
 * THREE times (the filtergraph, the option list, drawtext's own expansion), so
 * an apostrophe closed the graph-level quote and killed the export ("No such
 * filter: '0.000'"), a percent sign silently drew nothing, and a newline drew
 * the letter n. The first block pins the exact strings; the second parses them
 * back the way ffmpeg does and demands the original text out of the third pass
 * with the rest of the filter intact; Layer 5 (the win32 twin in
 * tests/integration/media.spec.ts) renders them for real.
 */
describe('escapeDrawtext', () => {
  it('escapes the offenders for the three passes ffmpeg makes over the text', () => {
    // An apostrophe: close the quote after a literal backslash, escape the
    // quote outside it, reopen.
    expect(escapeDrawtext("o'reilly")).toBe("o\\'\\''reilly")
    expect(escapeDrawtext('12:30')).toBe('12\\:30')
    // A percent: `\\%` so that drawtext's pass sees `\%`, a literal percent.
    expect(escapeDrawtext('50%')).toBe('50\\\\%')
    // A backslash: four, because two passes each halve them.
    expect(escapeDrawtext('path\\file')).toBe('path\\\\\\\\file')
  })

  it('keeps a newline as a real newline, never a backslash-n', () => {
    // `\n` reached drawtext as `\` + `n`, which draws the letter n.
    expect(escapeDrawtext('line1\nline2')).toBe('line1\nline2')
    expect(escapeDrawtext('a\r\nb')).toBe('a\nb')
    expect(escapeDrawtext('a\rb')).toBe('a\nb')
  })

  it('handles all offenders together without escaping an escape', () => {
    const out = escapeDrawtext("it's 50%:\nfoo\\bar")
    expect(out).toBe("it\\'\\''s 50\\\\%\\:\nfoo\\\\\\\\bar")
  })

  it('protects whitespace the option parser would trim, and drops edge newlines', () => {
    // Pass 2 trims a value's ends, so " lead" came out as "lead".
    expect(escapeDrawtext(' lead')).toBe('\\ lead')
    expect(escapeDrawtext('end  ')).toBe('end\\ \\ ')
    expect(escapeDrawtext('\ttab')).toBe('\\\ttab')
    // drawtext 6.1 draws NOTHING for a text whose first or last line is empty.
    expect(escapeDrawtext('\nabove')).toBe('above')
    expect(escapeDrawtext('below\n\n')).toBe('below')
    expect(escapeDrawtext('a\n\nb')).toBe('a\n\nb')
  })

  it('returns empty string for empty input', () => {
    expect(escapeDrawtext('')).toBe('')
  })

  it('passes through safe alphanumeric text', () => {
    expect(escapeDrawtext('Hello World 123')).toBe('Hello World 123')
  })
})

/**
 * ffmpeg's own parsing of a drawtext filter, in the three passes that matter,
 * so the escape is judged by what comes OUT of the third rather than by what it
 * looks like. `av_get_token` (libavutil/avstring.c) is the first two: outside
 * quotes `\x` is `x`; inside quotes everything is literal to the next `'`; the
 * quotes themselves are dropped; the token ends at an unquoted terminator;
 * trailing whitespace is trimmed unless it was quoted or escaped. The third is
 * drawtext's expansion: `\x` is `x`, a bare `%` starts a `%{…}` function call
 * (which a plain "50% off" is not), and anything else is itself.
 */
const WS = ' \n\t\r'
function avGetToken(src: string, from: number, term: string): { token: string; end: number } {
  let i = from
  while (i < src.length && WS.includes(src.charAt(i))) i++
  let out = ''
  let keep = 0
  while (i < src.length && !term.includes(src.charAt(i))) {
    const c = src.charAt(i++)
    if (c === '\\' && i < src.length) {
      out += src.charAt(i++)
      keep = out.length
    } else if (c === "'") {
      while (i < src.length && src.charAt(i) !== "'") out += src.charAt(i++)
      if (i < src.length) {
        i++
        keep = out.length
      }
    } else {
      out += c
    }
  }
  while (out.length > keep && WS.includes(out.charAt(out.length - 1))) out = out.slice(0, -1)
  return { token: out, end: i }
}

function drawtextExpand(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (c === '\\' && i + 1 < text.length) out += text.charAt(++i)
    else if (c === '%') throw new Error(`unescaped % at ${i}: drawtext starts a %{…} expansion`)
    else out += c
  }
  return out
}

/** Pass 1 and 2 of one filter's argument string, then pass 3 of its text. */
function parseDrawtext(args: string): { options: Record<string, string>; text: string } {
  const whole = avGetToken(args, 0, '[],;')
  // A comma or bracket left outside the quotes would end the filter here and
  // make the rest of the line a new filter ("No such filter: '0.000'").
  if (whole.end !== args.length) {
    throw new Error(`the graph parser stopped at ${whole.end} of ${args.length}: ${args.slice(whole.end, whole.end + 24)}`)
  }
  const options: Record<string, string> = {}
  let i = 0
  const rest = whole.token
  while (i < rest.length) {
    const key = avGetToken(rest, i, '=')
    const value = avGetToken(rest, key.end + 1, ':')
    options[key.token] = value.token
    i = value.end + 1
  }
  return { options, text: drawtextExpand(options.text ?? '') }
}

describe('the escaped text survives ffmpeg\'s three passes (T-111)', () => {
  const overlay = (text: string): TextOverlay => ({
    id: 'ov',
    text,
    font: 'Arial',
    sizePx: 48,
    colorHex: '#ffffff',
    x: 0.1,
    y: 0.2,
    startSec: 0,
    endSec: 5
  })
  const clip = (text: string): FilterClip => ({
    startSec: 0,
    cropRect: null,
    textOverlays: [overlay(text)]
  })
  const argsOf = (graph: string): string => graph.slice(graph.indexOf('drawtext=') + 'drawtext='.length)

  // The strings a streamer actually types, and the shapes that broke.
  const TEXTS = [
    "Let's go",
    'Sale 50% off',
    "Joe's stream: 50% off",
    'Line one\nLine two',
    'C:\\games\\run',
    "100%'s: a\\b '' \\' \\\\ %{n}",
    'a,b;c[d]=e',
    '@handle',
    "''",
    '%',
    '\\',
    ' leading and trailing  '
  ]

  it.each(TEXTS)('draws %j exactly as typed, with the rest of the filter intact', (text) => {
    const parsed = parseDrawtext(argsOf(buildVideoFilter(clip(text), PLATFORM_PRESETS.twitter, { width: 1280, height: 720 })))
    expect(parsed.text).toBe(text)
    expect(parsed.options.fontsize).toBe('48')
    expect(parsed.options.fontcolor).toBe('#ffffff')
    expect(parsed.options.x).toBe('128')
    expect(parsed.options.y).toBe('144')
    expect(parsed.options.enable).toBe('between(t,0.000,5.000)')
    expect(parsed.options.fontfile).toBe('C:/Windows/Fonts/arial.ttf')
  })

  it('does the same for a watermark, whose box and opacity must also survive', () => {
    const graph = buildVideoFilter(
      { startSec: 0, cropRect: null, textOverlays: [] },
      PLATFORM_PRESETS.twitter,
      { width: 1280, height: 720 },
      { text: "Joe's 50%: live", position: 'bottom-right', fontSizePct: 4, opacity: 0.85 }
    )
    const parsed = parseDrawtext(argsOf(graph))
    expect(parsed.text).toBe("Joe's 50%: live")
    expect(parsed.options.box).toBe('1')
    expect(parsed.options.fontcolor).toBe('white@0.85')
    expect(parsed.options.x).toBe('w-tw-20')
  })

  it('pins the whole graph for the two texts the reviewer broke on real ffmpeg 6.1.1', () => {
    const graph = (text: string): string =>
      buildVideoFilter(clip(text), PLATFORM_PRESETS.twitter, { width: 1280, height: 720 })
    expect(graph("Let's go")).toBe(
      "fps=30,scale=1280:720:flags=lanczos,setsar=1," +
        "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Let\\'\\''s go':fontsize=48:fontcolor=#ffffff:x=128:y=144:enable='between(t,0.000,5.000)'"
    )
    expect(graph('Sale 50% off')).toBe(
      "fps=30,scale=1280:720:flags=lanczos,setsar=1," +
        "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Sale 50\\\\% off':fontsize=48:fontcolor=#ffffff:x=128:y=144:enable='between(t,0.000,5.000)'"
    )
  })

  it('the parser model discriminates: the round-6 escape fails it on an apostrophe and on a percent', () => {
    const old = (t: string): string =>
      "fontfile='C\\:/Windows/Fonts/arial.ttf':text='" +
      t.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%') +
      "':fontsize=48:enable='between(t,0.000,5.000)'"
    expect(() => parseDrawtext(old("Let's go"))).toThrow(/graph parser stopped/)
    expect(() => parseDrawtext(old('Sale 50% off'))).toThrow(/unescaped %/)
  })
})

/**
 * T-114 - the Font box was a dead control: the editor stored one of six names and the filter printed
 * `arial.ttf` whatever it said. The stored name is now a KEY into a literal table; what is printed is the
 * table's value, and a name that is not a key is Arial and is never printed. Layer 5 (the win32 block)
 * draws each font for real; this is the command text.
 */
describe('the overlay font is a key into a table, never printed (T-114)', () => {
  const ARGS = { width: 1280, height: 720 }
  const graphWith = (font: unknown): string =>
    buildVideoFilter(
      {
        startSec: 0,
        cropRect: null,
        textOverlays: [
          { id: 'ov', text: 'Hi', font: font as string, sizePx: 48, colorHex: '#ffffff', x: 0.1, y: 0.2, startSec: 0, endSec: 5 }
        ]
      },
      PLATFORM_PRESETS.twitter,
      ARGS
    )
  const fontfileOf = (graph: string): string | undefined => /fontfile='([^']*)'/.exec(graph)?.[1]

  it.each([
    ['Arial', 'arial.ttf'],
    ['Impact', 'impact.ttf'],
    ['Verdana', 'verdana.ttf'],
    ['Georgia', 'georgia.ttf'],
    ['Courier New', 'cour.ttf'],
    ['Comic Sans MS', 'comic.ttf']
  ])('%s is %s', (font, file) => {
    expect(fontfileOf(graphWith(font))).toBe(`C\\:/Windows/Fonts/${file}`)
  })

  it('the table is exactly the editor\'s list: every offered font has its own file, in the offered order', () => {
    const files = OVERLAY_FONTS.map((f) => fontfileOf(graphWith(f)))
    expect(new Set(files).size, 'six fonts, six different files').toBe(OVERLAY_FONTS.length)
    expect(files).toEqual(
      ['arial.ttf', 'impact.ttf', 'verdana.ttf', 'georgia.ttf', 'cour.ttf', 'comic.ttf'].map(
        (f) => `C\\:/Windows/Fonts/${f}`
      )
    )
  })

  it.each([
    ['an unknown font', 'Papyrus'],
    ['no font', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a number', 7],
    ['the right name in the wrong case', 'impact'],
    ['a name with trailing space', 'Impact '],
    ['an inherited property', 'constructor'],
    ['__proto__', '__proto__'],
    ['a file name', 'impact.ttf'],
    ['a path', 'C:/Windows/Fonts/../../Users/victim/secret.ttf'],
    ["an option break-out", "arial.ttf':text='injected':fontsize=200,drawtext=text='x"],
    ['a filter injection', 'Arial,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]']
  ])('%s falls back to Arial, and the stored string is nowhere in the filter', (_label, font) => {
    const graph = graphWith(font)
    expect(fontfileOf(graph)).toBe('C\\:/Windows/Fonts/arial.ttf')
    if (typeof font === 'string' && font.length > 2 && font !== 'Arial') {
      expect(graph).not.toContain(font)
    }
    expect((graph.match(/drawtext=/g) ?? []).length, 'still exactly one drawtext').toBe(1)
  })

  it('the watermark keeps its own bold face and is not affected by any overlay font', () => {
    const graph = buildVideoFilter(
      { startSec: 0, cropRect: null, textOverlays: [] },
      PLATFORM_PRESETS.twitter,
      ARGS,
      { text: '@imagii', position: 'bottom-right', fontSizePct: 4, opacity: 0.85 }
    )
    expect(fontfileOf(graph)).toBe('C\\:/Windows/Fonts/arialbd.ttf')
  })
})

/**
 * Regression for round 14: drawTextFilter interpolated `overlay.sizePx`
 * and `overlay.colorHex` raw. A malicious .imagii.json could set colorHex
 * to `white,movie=C\:/Users/victim/.ssh/id_rsa[k]...` and inject arbitrary
 * FFmpeg filter directives. These sink-side coercers are the last-line
 * defense — they must never let a non-numeric size or non-hex color reach
 * the filter string.
 */
describe('safeOverlaySize', () => {
  it('passes through a valid in-range size, rounded', () => {
    expect(safeOverlaySize(48)).toBe(48)
    expect(safeOverlaySize(64.4)).toBe(64)
  })

  it('clamps to the 8..512 range', () => {
    expect(safeOverlaySize(2)).toBe(8)
    expect(safeOverlaySize(9999)).toBe(512)
  })

  it('falls back to 48 for non-finite / non-numeric input', () => {
    expect(safeOverlaySize(NaN)).toBe(48)
    expect(safeOverlaySize(Infinity)).toBe(48)
    expect(safeOverlaySize('64; movie=secret' as unknown)).toBe(48)
    expect(safeOverlaySize(undefined as unknown)).toBe(48)
  })
})

/**
 * M4 fix (round 15): yuv420p chroma subsampling needs even W/H/X/Y. The
 * previous Math.round() let odd values through which crashed libx264 in
 * strict mode. `even()` clears the low bit.
 */
describe('even', () => {
  it('rounds odd positives down to the nearest even', () => {
    expect(even(1081)).toBe(1080)
    expect(even(3)).toBe(2)
    expect(even(101.7)).toBe(100)
  })

  it('passes even values through unchanged', () => {
    expect(even(1080)).toBe(1080)
    expect(even(0)).toBe(0)
    expect(even(2)).toBe(2)
  })

  it('rounds negatives toward -infinity (-1 → -2)', () => {
    // Only consumer that sees a negative is the Math.max(0, …) clamp, so
    // the exact rule for negatives doesn't matter functionally — pin it
    // anyway so a refactor can't drift the contract.
    expect(even(-1)).toBe(-2)
    expect(even(-2)).toBe(-2)
  })

  it('returns 0 for non-finite input', () => {
    expect(even(NaN)).toBe(0)
    expect(even(Infinity)).toBe(0)
    expect(even(-Infinity)).toBe(0)
  })
})

/**
 * T-74 — the overlay `enable` window is stored SOURCE-absolute (the editor's
 * Time fields) and consumed in the FILTER GRAPH's timebase, which starts at 0
 * for every clip because `runExportJob` seeks with `-ss` before `-i`, and is
 * divided again by `setpts=PTS/speed`. These pin the conversion; the Layer 5
 * drawbox stand-in (`npm run test:media`) proves real ffmpeg agrees.
 */
describe('text-overlay enable window (T-74)', () => {
  const preset = PLATFORM_PRESETS.youtube
  const source = { width: 1920, height: 1080 }

  function overlay(startSec: number, endSec: number): TextOverlay {
    return {
      id: 'ov1',
      text: 'HELLO',
      font: 'Arial',
      sizePx: 48,
      colorHex: '#ffffff',
      x: 0.1,
      y: 0.85,
      startSec,
      endSec
    }
  }

  function clipWith(startSec: number, endSec: number, overlays: TextOverlay[]): Clip {
    return {
      id: 'c1',
      name: 'clip',
      startSec,
      endSec,
      cropRect: null,
      textOverlays: overlays,
      selectedPresets: ['youtube']
    }
  }

  function windowsIn(chain: string): string[] {
    return [...chain.matchAll(/enable='between\(t,([-\d.]+),([-\d.]+)\)'/g)].map(
      (m) => `${m[1]},${m[2]}`
    )
  }

  it("rebases the editor default (the clip's own range) onto the clip", () => {
    // What TextOverlayEditor creates for a clip that starts at 10: the
    // overlay covers 10 -> 13, and the graph must draw it for all 3 seconds.
    const chain = buildVideoFilter(clipWith(10, 13, [overlay(10, 13)]), preset, source)
    expect(windowsIn(chain)).toEqual(['0.000,3.000'])
  })

  it('rebases a sub-range the same way', () => {
    const chain = buildVideoFilter(clipWith(10, 13, [overlay(11, 12)]), preset, source)
    expect(windowsIn(chain)).toEqual(['1.000,2.000'])
  })

  it('leaves a clip that starts at 0 exactly as it was (the only case that ever worked)', () => {
    const chain = buildVideoFilter(clipWith(0, 3, [overlay(0.4, 1.6)]), preset, source)
    expect(windowsIn(chain)).toEqual(['0.400,1.600'])
  })

  it('divides by the clip speed, because setpts already did', () => {
    // 2x: the clip's 3 source seconds become 1.5 output seconds, so an
    // overlay covering source 11 -> 12 lands at 0.5 -> 1.0 in the graph.
    const clip = { ...clipWith(10, 13, [overlay(11, 12)]), speedMultiplier: 2 }
    const chain = buildVideoFilter(clip, preset, source)
    expect(chain.startsWith('setpts=PTS/2.0000,')).toBe(true)
    expect(windowsIn(chain)).toEqual(['0.500,1.000'])
  })

  it('converts every overlay on the clip, not just the first', () => {
    const chain = buildVideoFilter(
      clipWith(10, 13, [overlay(10, 13), overlay(11.5, 12.5)]),
      preset,
      source
    )
    expect(windowsIn(chain)).toEqual(['0.000,3.000', '1.500,2.500'])
  })

  it('keeps the visible half of a window that opens before the clip', () => {
    // Unclamped on purpose: `between()` cannot match before t=0 anyway, so
    // a negative start is exactly "already on when the clip begins".
    const chain = buildVideoFilter(clipWith(10, 13, [overlay(8, 11)]), preset, source)
    expect(windowsIn(chain)).toEqual(['-2.000,1.000'])
  })
})

/**
 * T-83 — a manual crop is the new SOURCE FRAME: crop (the user's) ->
 * aspect cut (against the CROPPED size, the same code the no-crop path runs
 * against the source) -> scale. These pin the geometry of that chain; the
 * Layer 5 marker tests prove real ffmpeg agrees and that nothing is stretched.
 */
describe('a manual crop is the frame each platform is cut from (T-83)', () => {
  function clipWithCrop(cropRect: Clip['cropRect']): Clip {
    return {
      id: 'c1',
      name: 'clip',
      startSec: 0,
      endSec: 3,
      cropRect,
      textOverlays: [],
      selectedPresets: ['youtube']
    }
  }

  /** Every `crop=w:h:x:y` in a chain, in order. */
  function crops(chain: string): Array<{ w: number; h: number; x: number; y: number }> {
    return [...chain.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => ({
      w: Number(m[1]),
      h: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4])
    }))
  }

  const src = { width: 1920, height: 1080 }

  it('cuts the platform shape out of the crop: a 4:3 crop for Reels gets a second, centered crop', () => {
    // 960x720 at (480, 180); 9:16 of that is 404x720, centered at x = 278.
    const chain = buildVideoFilter(
      clipWithCrop({ x: 0.25, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }),
      PLATFORM_PRESETS.reels,
      src
    )
    expect(crops(chain)).toEqual([
      { w: 960, h: 720, x: 480, y: 180 },
      { w: 404, h: 720, x: 278, y: 0 }
    ])
    // crop, aspect cut, scale — in that order, and nothing between the two crops.
    // (T-126 (21): and the picture is made constant-rate before any of it, so `fps=30` leads.)
    expect(chain).toMatch(/^fps=30,crop=960:720:480:180,crop=404:720:278:0,scale=1080:1920:/)
  })

  it('cuts the other way for a tall crop on a wide platform', () => {
    // 540x960 at (690, 60); 16:9 of that is 540x302 (even), centered at y = 328.
    const chain = buildVideoFilter(
      clipWithCrop({ x: 690 / 1920, y: 60 / 1080, w: 540 / 1920, h: 960.25 / 1080 }),
      PLATFORM_PRESETS.youtube,
      src
    )
    expect(crops(chain)).toEqual([
      { w: 540, h: 960, x: 690, y: 60 },
      { w: 540, h: 302, x: 0, y: 328 }
    ])
  })

  it('adds nothing when the crop already has the platform shape', () => {
    const chain = buildVideoFilter(
      clipWithCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }),
      PLATFORM_PRESETS.youtube,
      src
    )
    expect(crops(chain)).toEqual([{ w: 960, h: 540, x: 480, y: 270 }])
  })

  it('leaves the no-crop path as it was: one aspect cut, against the source', () => {
    const chain = buildVideoFilter(clipWithCrop(null), PLATFORM_PRESETS.reels, src)
    expect(crops(chain)).toEqual([{ w: 606, h: 1080, x: 656, y: 0 }])
  })

  it('every chain ends in a frame of the preset shape, whatever was cropped', () => {
    // The invariant the bug broke: the last crop before `scale` has the
    // preset's aspect, so `scale` only resizes. Within one even pixel of
    // rounding (a ~200 px frame is the smallest tested).
    const rects: Array<NonNullable<Clip['cropRect']>> = [
      { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.3, y: 0.05, w: 0.28, h: 0.89 },
      { x: 0.2, y: 0.2, w: 0.6, h: 0.3 },
      { x: 0.4, y: 0.4, w: 0.13, h: 0.5 },
      { x: 0.05, y: 0.45, w: 0.9, h: 0.1 }
    ]
    for (const rect of rects) {
      for (const preset of Object.values(PLATFORM_PRESETS)) {
        const chain = buildVideoFilter(clipWithCrop(rect), preset, src)
        const list = crops(chain)
        const last = list[list.length - 1]
        expect(last, `a crop exists for ${JSON.stringify(rect)} / ${preset.id}`).toBeDefined()
        if (!last) continue
        const tolerance = 2 / Math.min(last.w, last.h)
        expect(
          Math.abs(last.w / last.h / preset.aspectRatio - 1),
          `${JSON.stringify(rect)} -> ${preset.id}: ${last.w}x${last.h}`
        ).toBeLessThan(Math.max(tolerance, 0.01))
        // ...and each crop sits inside the frame the one before it left.
        let frame = { w: src.width, h: src.height }
        for (const c of list) {
          expect(c.x + c.w).toBeLessThanOrEqual(frame.w)
          expect(c.y + c.h).toBeLessThanOrEqual(frame.h)
          frame = { w: c.w, h: c.h }
        }
      }
    }
  })

  it('every dimension and offset of every crop is even, on an odd source too', () => {
    // yuv420p / libx264 refuse odd values; the cropped size feeds the second
    // crop, so an odd intermediate would only fail at runtime.
    const rect = { x: 0.137, y: 0.061, w: 0.4413, h: 0.7219 }
    for (const dims of [
      { width: 1920, height: 1080 },
      { width: 1919, height: 1079 },
      { width: 1281, height: 721 }
    ]) {
      for (const preset of Object.values(PLATFORM_PRESETS)) {
        for (const c of crops(buildVideoFilter(clipWithCrop(rect), preset, dims))) {
          for (const n of [c.w, c.h, c.x, c.y]) {
            expect(n % 2, `${dims.width}x${dims.height} -> ${preset.id}: ${JSON.stringify(c)}`).toBe(0)
          }
        }
      }
    }
  })

  it('works through a custom-preset aspect too (the aspect is whatever the preset resolves to)', () => {
    const custom = { ...PLATFORM_PRESETS.youtube, width: 1000, height: 1000, aspectRatio: 1 }
    const chain = buildVideoFilter(
      clipWithCrop({ x: 0.25, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }),
      custom,
      src
    )
    expect(crops(chain)).toEqual([
      { w: 960, h: 720, x: 480, y: 180 },
      { w: 720, h: 720, x: 120, y: 0 }
    ])
  })
})

/**
 * T-96 — `cropToFrame` is the one place a manual crop becomes filter stages.
 * A platform export, a compilation segment and a GIF all call it; these pin
 * its two modes and that `buildVideoFilter` really delegates to it, so the
 * chain cannot quietly grow a second copy.
 */
describe('cropToFrame — one chain for exports, compilation segments and GIFs (T-96)', () => {
  const src = { width: 1920, height: 1080 }
  // 960x720 at (480, 180): the 4:3 crop T-83 uses.
  const fourThree = { x: 480.25 / 1920, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }

  it('with a target shape: the crop, then a centered cut of the CROPPED frame to it', () => {
    expect(cropToFrame(fourThree, src, 16 / 9)).toEqual([
      'crop=960:720:480:180',
      'crop=960:540:0:90'
    ])
    expect(cropToFrame(fourThree, src, 9 / 16)).toEqual([
      'crop=960:720:480:180',
      'crop=404:720:278:0'
    ])
  })

  it('with no target shape: the crop alone — the frame keeps the shape the user drew', () => {
    expect(cropToFrame(fourThree, src, null)).toEqual(['crop=960:720:480:180'])
  })

  it('with no crop: the whole source is the frame, so a target shape is one cut and no shape is nothing', () => {
    expect(cropToFrame(null, src, 9 / 16)).toEqual(['crop=606:1080:656:0'])
    expect(cropToFrame(undefined, src, 9 / 16)).toEqual(['crop=606:1080:656:0'])
    expect(cropToFrame(null, src, null)).toEqual([])
    // Already the target's shape: no stage at all.
    expect(cropToFrame(null, src, 16 / 9)).toEqual([])
  })

  it('adds no second stage when the crop already has the target shape', () => {
    expect(cropToFrame({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, src, 16 / 9)).toEqual([
      'crop=960:540:480:270'
    ])
  })

  it('buildVideoFilter\'s crop stages ARE cropToFrame\'s, byte for byte, for every preset', () => {
    const clip: Clip = {
      id: 'c1',
      name: 'clip',
      startSec: 0,
      endSec: 3,
      cropRect: fourThree,
      textOverlays: [],
      selectedPresets: ['youtube']
    }
    for (const preset of Object.values(PLATFORM_PRESETS)) {
      const stages = cropToFrame(fourThree, src, preset.aspectRatio).join(',')
      expect(buildVideoFilter(clip, preset, src).startsWith(`fps=${preset.fps},${stages},scale=`), preset.id).toBe(true)
    }
  })
})

/**
 * T-123 (13) - a crop the validator accepts must not reach past the frame.
 *
 * The editor stores `offsetWidth / pictureWidth`, and Chromium rounds a box to whole pixels: an 800 px box in a
 * 799.5 px parent reads 1.000625. The validator accepts up to 1.01 (`CROP_SLACK`) so the editor's own crop is never
 * refused, and `manualCropRegion` scaled and even-rounded without ever clamping, so `crop=3842:2160:0:0` reached a
 * 3840 px source and the whole export died ("Invalid too big or non positive size", no output). Compile, GIF and
 * Clip Kit share `cropToFrame`, so the one clamp covers them. Layer 5 runs the real binary on the 3840x2160 case.
 */
describe('a crop the validator accepts never reaches past the frame (T-123 (13))', () => {
  /** `crop=w:h:x:y` of a one-stage chain. */
  const region = (
    crop: { x: number; y: number; w: number; h: number },
    source: { width: number; height: number }
  ): { w: number; h: number; x: number; y: number } => {
    const stage = cropToFrame(crop, source, null)[0] ?? ''
    const m = /^crop=(\d+):(\d+):(\d+):(\d+)$/.exec(stage)
    if (!m) throw new Error(`not a crop stage: ${stage}`)
    return { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }
  }
  const UHD = { width: 3840, height: 2160 }

  it('the measured case: 800 px in a 799.5 px parent (ratio 1.000625) on a 3840x2160 source is the whole frame', () => {
    expect(cropToFrame({ x: 0, y: 0, w: 800 / 799.5, h: 1 }, UHD, null)).toEqual(['crop=3840:2160:0:0'])
    expect(cropToFrame({ x: 0, y: 0, w: 1, h: 800 / 799.5 }, UHD, null)).toEqual(['crop=3840:2160:0:0'])
  })

  it('the validator\'s own ceiling, 1.01 on both axes, is the whole frame too', () => {
    expect(region({ x: 0, y: 0, w: 1.01, h: 1.01 }, { width: 1920, height: 1080 })).toEqual({ w: 1920, h: 1080, x: 0, y: 0 })
    expect(region({ x: 0, y: 0, w: 1.01, h: 1.01 }, UHD)).toEqual({ w: 3840, h: 2160, x: 0, y: 0 })
  })

  it('an offset crop is cut at the frame\'s edge, not carried past it: x + w and y + h stop at the source', () => {
    // x = 0.5 and w = 0.505 sum to 1.005, which the validator allows (<= 1.01).
    expect(region({ x: 0.5, y: 0.25, w: 0.505, h: 0.755 }, UHD)).toEqual({ w: 1920, h: 1620, x: 1920, y: 540 })
  })

  it('a crop that starts at the very edge keeps the 2 px minimum inside the frame', () => {
    // x = 1 is legal (0..1); the old minimum-size guard put a 2 px crop at x = 3840, past the frame.
    expect(region({ x: 1, y: 1, w: 0.01, h: 0.01 }, UHD)).toEqual({ w: 2, h: 2, x: 3838, y: 2158 })
  })

  it('an odd source keeps every number even and inside', () => {
    expect(region({ x: 0, y: 0, w: 1.005, h: 1.005 }, { width: 1919, height: 1079 })).toEqual({
      w: 1918,
      h: 1078,
      x: 0,
      y: 0
    })
  })

  it('a crop that was already inside is byte for byte what it was', () => {
    expect(cropToFrame({ x: 480.25 / 1920, y: 180.25 / 1080, w: 960.25 / 1920, h: 720.25 / 1080 }, { width: 1920, height: 1080 }, null)).toEqual([
      'crop=960:720:480:180'
    ])
    expect(region({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, UHD)).toEqual({ w: 1920, h: 1080, x: 960, y: 540 })
  })

  it('the centered cut to a target shape reads the clamped frame', () => {
    // 1.000625 wide is the whole 3840x2160 frame, which already is 16:9: one stage, no second cut.
    expect(cropToFrame({ x: 0, y: 0, w: 800 / 799.5, h: 1 }, UHD, 16 / 9)).toEqual(['crop=3840:2160:0:0'])
    expect(cropToFrame({ x: 0, y: 0, w: 800 / 799.5, h: 1 }, UHD, 9 / 16)).toEqual(['crop=3840:2160:0:0', 'crop=1214:2160:1312:0'])
  })

  it('whatever the validator lets through, the region is even, at least 2 px, and inside the source', () => {
    const sources = [
      { width: 1919, height: 1079 },
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
      { width: 321, height: 241 },
      { width: 640, height: 480 },
      { width: 2, height: 2 },
      { width: 3, height: 5 }
    ]
    const fractions = [0, 0.0001, 0.3333, 0.5, 0.9999, 1]
    const sizes = [Number.MIN_VALUE, 0.0001, 0.01, 0.5, 0.9999, 1, 1.000625, 1.005, 1.01]
    let checked = 0
    for (const source of sources) {
      for (const x of fractions) {
        for (const y of fractions) {
          for (const w of sizes) {
            for (const h of sizes) {
              // The validator's own rule (assertOptionalCropRect): each edge within 1% of the frame.
              if (x + w > 1.01 || y + h > 1.01) continue
              const r = region({ x, y, w, h }, source)
              const label = JSON.stringify({ source, x, y, w, h, r })
              expect(r.w % 2 === 0 && r.h % 2 === 0 && r.x % 2 === 0 && r.y % 2 === 0, `even ${label}`).toBe(true)
              expect(r.w >= 2 && r.h >= 2 && r.x >= 0 && r.y >= 0, `positive ${label}`).toBe(true)
              expect(r.x + r.w <= source.width, `inside on x ${label}`).toBe(true)
              expect(r.y + r.h <= source.height, `inside on y ${label}`).toBe(true)
              checked++
            }
          }
        }
      }
    }
    expect(checked, 'the sweep reached a real number of cases').toBeGreaterThan(1000)
  })
})

describe('safeOverlayColor', () => {
  it('passes through a well-formed hex color', () => {
    expect(safeOverlayColor('#ffffff')).toBe('#ffffff')
    expect(safeOverlayColor('00FF00')).toBe('00FF00')
  })

  it('falls back to white for an injection payload', () => {
    expect(
      safeOverlayColor('white,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]')
    ).toBe('white')
    expect(safeOverlayColor('red')).toBe('white')
    expect(safeOverlayColor('#fff')).toBe('white')
    expect(safeOverlayColor(42 as unknown)).toBe('white')
  })
})

/**
 * T-105 — the sound of a clip's speed, and the pieces of the picture graph that
 * sit beside it. `buildAudioSpeedFilter` had no test of its own: a platform export
 * was the only caller and the only evidence was a Layer 5 duration check. A
 * compilation segment is the second caller now. Layer 5 ("a compiled clip is the
 * clip the user built") proves real ffmpeg accepts every chain below and that the
 * burst of sound lands where the speed says.
 */
describe('buildAudioSpeedFilter (T-105)', () => {
  it('1x is no filter at all', () => {
    expect(buildAudioSpeedFilter(1)).toBe('')
  })

  it('a factor inside atempo\'s 0.5-2.0 range is one stage', () => {
    expect(buildAudioSpeedFilter(2)).toBe('atempo=2.0000')
    expect(buildAudioSpeedFilter(0.5)).toBe('atempo=0.5000')
    expect(buildAudioSpeedFilter(1.5)).toBe('atempo=1.5000')
    expect(buildAudioSpeedFilter(0.75)).toBe('atempo=0.7500')
  })

  it('4x is two stages of 2x, and 0.25x two of 0.5x — the chain\'s product is the speed', () => {
    expect(buildAudioSpeedFilter(4)).toBe('atempo=2,atempo=2.0000')
    expect(buildAudioSpeedFilter(0.25)).toBe('atempo=0.5,atempo=0.5000')
  })

  it('a factor between a stage and the next is a stage and a remainder', () => {
    expect(buildAudioSpeedFilter(3)).toBe('atempo=2,atempo=1.5000')
    expect(buildAudioSpeedFilter(0.4)).toBe('atempo=0.5,atempo=0.8000')
  })

  it('no stage is ever outside what one atempo accepts, and the product is the speed', () => {
    for (const speed of [0.1, 0.25, 0.3, 0.5, 0.7, 1.2, 1.9, 2, 2.5, 3, 4, 7, 10]) {
      const stages = [...buildAudioSpeedFilter(speed).matchAll(/atempo=([\d.]+)/g)].map((m) => Number(m[1]))
      expect(stages.length, `speed ${speed}`).toBeGreaterThan(0)
      for (const stage of stages) {
        expect(stage, `speed ${speed}`).toBeGreaterThanOrEqual(0.5)
        expect(stage, `speed ${speed}`).toBeLessThanOrEqual(2)
      }
      const product = stages.reduce((a, b) => a * b, 1)
      expect(Math.abs(product / speed - 1), `speed ${speed}: ${stages.join(' x ')}`).toBeLessThan(0.001)
    }
  })

  it('a speed that makes no sense is no filter, never a malformed one', () => {
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildAudioSpeedFilter(speed), String(speed)).toBe('')
    }
  })
})

describe('buildVideoFilter reads a clip\'s speed through clipSpeed (T-105)', () => {
  const clip: FilterClip = { startSec: 0, cropRect: null, textOverlays: [] }
  const src = { width: 1920, height: 1080 }

  it('a speed that is set divides the clock', () => {
    expect(buildVideoFilter({ ...clip, speedMultiplier: 2 }, PLATFORM_PRESETS.youtube, src)).toMatch(
      /^setpts=PTS\/2\.0000,/
    )
    expect(buildVideoFilter({ ...clip, speedMultiplier: 0.5 }, PLATFORM_PRESETS.youtube, src)).toMatch(
      /^setpts=PTS\/0\.5000,/
    )
  })

  it('a missing, zero, negative or non-finite speed adds no stage', () => {
    for (const speedMultiplier of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const chain = buildVideoFilter({ ...clip, speedMultiplier }, PLATFORM_PRESETS.youtube, src)
      expect(chain, String(speedMultiplier)).not.toContain('setpts')
    }
  })
})

/** The x/y pair that keeps Auto Zoom's window centered (T-109). */
const CENTRED = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"

describe('buildVideoFilter takes any frame, not only a platform (T-105)', () => {
  const clip: FilterClip = { startSec: 0, cropRect: null, textOverlays: [], autoZoom: true }
  const src = { width: 1920, height: 1080 }
  const frame = (over: Partial<FilterFrame>): FilterFrame => ({
    width: 1280,
    height: 720,
    aspectRatio: 16 / 9,
    fps: 30,
    ...over
  })

  it('scales to the frame it is given', () => {
    expect(buildVideoFilter({ ...clip, autoZoom: false }, frame({}), src)).toBe(
      'fps=30,scale=1280:720:flags=lanczos,setsar=1'
    )
  })

  it('Auto Zoom makes its frames at the output rate, in and out: zoompan counts frames at its own fps, not its input\'s', () => {
    // zoompan emits `d` frames per input frame stamped at ITS fps (25 unless
    // told): a 30 fps clip came out 20% long with the sound at its real length.
    expect(buildVideoFilter(clip, frame({}), src)).toBe(
      `fps=30,scale=1280:720:flags=lanczos,setsar=1,fps=30,zoompan=z='1.0+0.05*abs(sin(time*0.6))':${CENTRED}:d=1:s=1280x720:fps=30`
    )
    expect(buildVideoFilter(clip, frame({ fps: 24 }), src)).toContain(
      `fps=24,zoompan=z='1.0+0.05*abs(sin(time*0.6))':${CENTRED}:d=1:s=1280x720:fps=24`
    )
  })

  it('Auto Zoom zooms about the CENTER: the crop window is iw/zoom wide and starts half the rest in (T-109)', () => {
    // zoompan's x and y default to 0, so the window started at the top-left corner and
    // the picture grew out of it — a centered subject walked toward the bottom-right.
    // The window is iw/zoom x ih/zoom; centering it is (iw - iw/zoom) / 2 each way.
    const chain = buildVideoFilter(clip, frame({}), src)
    expect(chain).toContain(":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':")
    // Every preset, since the expression is a function of the input only.
    for (const preset of Object.values(PLATFORM_PRESETS)) {
      expect(buildVideoFilter(clip, preset, src), preset.id).toContain(CENTRED)
    }
    // And the expression, evaluated, IS the center of the window at the pulse's extremes:
    // at zoom 1 the window starts at 0; at zoom 1.05 it starts 2.38% of the width in.
    const x = (iw: number, zoom: number): number => iw / 2 - iw / zoom / 2
    expect(x(1280, 1)).toBe(0)
    expect(x(1280, 1.05)).toBeCloseTo((1280 - 1280 / 1.05) / 2, 9)
    expect(x(1280, 1.05) + 1280 / 1.05 / 2).toBeCloseTo(640, 9)
  })

  it('every platform preset\'s Auto Zoom runs at that platform\'s own rate', () => {
    for (const preset of Object.values(PLATFORM_PRESETS)) {
      const chain = buildVideoFilter(clip, preset, src)
      expect(chain, preset.id).toContain(`fps=${preset.fps},zoompan=`)
      expect(chain, preset.id).toContain(`:s=${preset.width}x${preset.height}:fps=${preset.fps}`)
    }
  })

  // T-126 (21): this used to say "without Auto Zoom there is no fps stage - the encoder's -r does that", and that was the bug. `-r N` is
  // the encoder's rate and the output vsync drops a frame only once the output runs more than 1.1 frames ahead, so a source above the
  // preset's rate (60 / 59.94 / 50 / 120 / 48 fps) or a clip sped up past it left the picture ~2 output frames behind its sound
  // (+67 ms measured at 60 -> 30 fps). The picture is made constant-rate IN THE CHAIN, right after the retime and before anything
  // that costs per frame; `-r` stays to pin the muxer. The real-media cases (Layer 5 "T-126 (21)") measure it on the output.
  it('without Auto Zoom the chain still carries ONE fps stage, at the preset\'s rate, ahead of the scale', () => {
    const chain = buildVideoFilter({ ...clip, autoZoom: false }, PLATFORM_PRESETS.tiktok, src)
    expect(chain.match(/fps=/g)).toHaveLength(1)
    expect(chain.startsWith(`fps=${PLATFORM_PRESETS.tiktok.fps},`)).toBe(true)
    expect(chain.indexOf('fps=')).toBeLessThan(chain.indexOf('scale='))
  })
})

describe('the picture is made constant-rate right after the retime (T-126 (21))', () => {
  const src = { width: 1920, height: 1080 }
  const base: Clip = { id: 'c', name: 'c', startSec: 0, endSec: 10, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] }

  it('every preset gets its own rate, as the first stage of an untouched clip', () => {
    for (const preset of Object.values(PLATFORM_PRESETS)) {
      expect(buildVideoFilter(base, preset, src).startsWith(`fps=${preset.fps},`), preset.id).toBe(true)
    }
  })

  it('a sped-up or slowed clip is retimed FIRST and resampled right after, so the resample honors the speed', () => {
    for (const speed of [0.5, 1.25, 2, 4]) {
      const chain = buildVideoFilter({ ...base, speedMultiplier: speed }, PLATFORM_PRESETS.youtube, src)
      expect(chain.startsWith(`setpts=PTS/${speed.toFixed(4)},fps=${PLATFORM_PRESETS.youtube.fps},`), `${speed}x`).toBe(true)
    }
  })

  it('it comes before the crop, the shake, the scale, the grade and the text, whatever the clip carries', () => {
    const chain = buildVideoFilter(
      {
        ...base,
        speedMultiplier: 2,
        cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
        hypeShake: true,
        colorGrade: { brightness: 0.1, contrast: 1.1, saturation: 1, temperature: 0 },
        textOverlays: [{ id: 't', text: 'hi', font: 'Arial', sizePx: 48, colorHex: '#ffffff', x: 0.1, y: 0.8, startSec: 0, endSec: 5 }]
      },
      PLATFORM_PRESETS.youtube,
      src
    )
    const fps = chain.indexOf('fps=')
    expect(fps).toBeGreaterThan(chain.indexOf('setpts='))
    for (const later of ['crop=', 'scale=', 'eq=', 'drawtext=']) expect(fps, later).toBeLessThan(chain.indexOf(later))
  })

  it('a clip with Auto Zoom has two (the second is zoompan\'s own, unchanged), and the rate is the same in both', () => {
    const chain = buildVideoFilter({ ...base, autoZoom: true }, PLATFORM_PRESETS.twitter, src)
    expect(chain.match(/fps=30/g)).toHaveLength(3) // the stage, zoompan's input rate, zoompan's output rate
    expect(chain.startsWith('fps=30,')).toBe(true)
  })
})

describe('the Temperature slider reaches the whole picture, not only the shadows (T-109)', () => {
  const src = { width: 1920, height: 1080 }
  const graded = (temperature: number): string =>
    buildVideoFilter(
      {
        startSec: 0,
        cropRect: null,
        textOverlays: [],
        colorGrade: { brightness: 0, contrast: 1, saturation: 1, temperature }
      },
      PLATFORM_PRESETS.youtube,
      src
    )
  /** The six colorbalance numbers out of a graph, by their ffmpeg names. */
  const balance = (graph: string): Record<string, number> => {
    const m = /colorbalance=([^,]+)/.exec(graph)
    if (!m) throw new Error(`no colorbalance in ${graph}`)
    return Object.fromEntries(
      (m[1] as string).split(':').map((kv) => {
        const [k, v] = kv.split('=')
        return [k as string, Number(v)]
      })
    )
  }

  it('no temperature, no stage', () => {
    expect(graded(0)).not.toContain('colorbalance')
  })

  it('warm sets shadows, mid-tones AND highlights: red up, blue down', () => {
    const b = balance(graded(1))
    expect(Object.keys(b).sort()).toEqual(['bh', 'bm', 'bs', 'rh', 'rm', 'rs'])
    for (const k of ['rs', 'rm', 'rh']) expect(b[k], k).toBeGreaterThan(0)
    for (const k of ['bs', 'bm', 'bh']) expect(b[k], k).toBeLessThan(0)
  })

  it('cool is the same three bands with the signs the other way round', () => {
    const b = balance(graded(-1))
    for (const k of ['rs', 'rm', 'rh']) expect(b[k], k).toBeLessThan(0)
    for (const k of ['bs', 'bm', 'bh']) expect(b[k], k).toBeGreaterThan(0)
  })

  it('the shadows keep exactly the strength they always had', () => {
    expect(balance(graded(1))).toMatchObject({ rs: 0.4, bs: -0.3 })
    expect(balance(graded(-1))).toMatchObject({ rs: -0.3, bs: 0.4 })
    expect(balance(graded(0.5))).toMatchObject({ rs: 0.2, bs: -0.15 })
  })

  it('the mid-tones take a quarter and the highlights half of the shadows\' strength', () => {
    const warm = balance(graded(1))
    expect(warm.rm).toBeCloseTo((warm.rs as number) * 0.25, 3)
    expect(warm.bm).toBeCloseTo((warm.bs as number) * 0.25, 3)
    expect(warm.rh).toBeCloseTo((warm.rs as number) * 0.5, 3)
    expect(warm.bh).toBeCloseTo((warm.bs as number) * 0.5, 3)
  })

  it('every number stays inside colorbalance\'s -1..1 at the ends of the slider and beyond what it offers', () => {
    for (const t of [-1, -0.5, -0.05, 0.05, 0.5, 1]) {
      for (const [k, v] of Object.entries(balance(graded(t)))) {
        expect(Math.abs(v), `${k} at ${t}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('a bigger slider move is a bigger cast, on every band', () => {
    const small = balance(graded(0.2))
    const big = balance(graded(0.8))
    for (const k of ['rs', 'rm', 'rh']) expect(big[k], k).toBeGreaterThan(small[k] as number)
    for (const k of ['bs', 'bm', 'bh']) expect(big[k], k).toBeLessThan(small[k] as number)
  })
})

// T-118 (6): on the shipped win32 ffmpeg (6.1.1) `colorbalance` is an RGB filter whose round trip back to
// YUV uses the bt601 matrix and writes color_space=unknown, so a bt709-TAGGED source (OBS's default) was
// encoded in the wrong matrix while players read the file as bt709: a no-op `colorbalance=rs=0.0001` on a
// tagged source turned player-view SMPTE green (0,157,0) into (0,130,0) and stripped the tag. 7.0.2
// preserves both. A `scale=out_color_matrix=bt709` right after the stage converts back into bt709 (the
// pixels), and `setparams=colorspace=bt709` after it writes the tag back (6.1.1's scale does not; 7.0.2's
// does). T-119 (4): a bt601-TAGGED source (`smpte170m`, `bt470bg`: OBS's Rec.601 profile, SD captures) lost
// the same tag the same way (smpte170m in, `unknown` out) and every built-in preset is at least 1280 px on its long side, where a
// player that guesses reads an untagged file as bt709. Its round trip is pixel-symmetric (swscale reads
// bt601 and writes bt601: measured on 6.1.1, the tag comes back and the pixels are within 3 levels of the
// control on the suite's own fixture, as for bt709), so it gets the TAG alone, `setparams=colorspace=<its
// tag>`, and no `scale`. Untagged is skipped for the same symmetry (swscale's default is bt601 both ways,
// nothing is lost and there is no tag to restore); `unknown` and any other tag (bt2020nc, the ledgered residual:
// a retag alone would restore its tag and pixels as it does bt709's, measured on 6.1.1) get nothing. T-120: the bt709 `scale` is
// kept for what a retag cannot do, survive an Auto Zoom after the grade (`zoompan` drops the tag, and a frame
// still in RGB is then converted as an untagged one); the Layer 5 case "... with a grade AND Auto Zoom on" tests
// it. The real-binary proof is the Layer 5 block, whose bt601 cases are the ones titled "... (T-119)":
// the temperature grade keeps a bt709-tagged source in bt709 (real ffmpeg, T-118)
describe('the temperature stage keeps a bt709 source in the bt709 matrix (T-118)', () => {
  const MATRIX = 'scale=out_color_matrix=bt709'
  const RETAG = 'setparams=colorspace=bt709'
  const clip = (temperature: number, extra: Partial<FilterClip> = {}): FilterClip => ({
    startSec: 0,
    cropRect: null,
    textOverlays: [],
    colorGrade: { brightness: 0, contrast: 1, saturation: 1, temperature },
    ...extra
  })
  const graph = (temperature: number, colorSpace?: string | null, extra: Partial<FilterClip> = {}): string =>
    buildVideoFilter(clip(temperature, extra), PLATFORM_PRESETS.youtube, {
      width: 1920,
      height: 1080,
      colorSpace
    })
  const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

  it('a bt709 source gets the matrix stage immediately after colorbalance, then the tag, in the same graph', () => {
    for (const t of [-1, -0.3, 0.05, 0.5, 1]) {
      const g = graph(t, 'bt709')
      expect(g, `at ${t}`).toMatch(
        /,colorbalance=[^,]+,scale=out_color_matrix=bt709,setparams=colorspace=bt709(?:,|$)/
      )
      expect(count(g, MATRIX), `at ${t}`).toBe(1)
      expect(count(g, RETAG), `at ${t}`).toBe(1)
    }
  })

  it.each([
    ['no color space at all', undefined],
    ['null (nothing probed)', null],
    ['an empty string', ''],
    ['unknown', 'unknown'],
    ['bt2020nc (a different matrix: the ledgered residual, not covered by this stage)', 'bt2020nc'],
    ['bt470m', 'bt470m'],
    ['fcc', 'fcc'],
    ['smpte240m', 'smpte240m'],
    ['a tag with a filter smuggled behind it', 'smpte170m,movie=/etc/passwd'],
    ['a tag in the wrong case', 'SMPTE170M']
  ])('%s gets no matrix stage and no tag: nothing to put back', (_label, colorSpace) => {
    const g = graph(0.5, colorSpace)
    expect(g).toContain('colorbalance=')
    expect(g).not.toContain('out_color_matrix')
    expect(g).not.toContain('setparams')
    expect(g).not.toContain('movie')
  })

  // T-119 (4): bt601 is retagged and NOT rescaled - its round trip is already pixel-symmetric.
  it.each(['smpte170m', 'bt470bg'])(
    '%s (bt601) gets its own tag back right after colorbalance and nothing else: no scale, no matrix',
    (tag) => {
      for (const t of [-1, -0.3, 0.05, 0.5, 1]) {
        const g = graph(t, tag)
        expect(g, `${tag} at ${t}`).toMatch(
          new RegExp(`,colorbalance=[^,]+,setparams=colorspace=${tag}(?:,|$)`)
        )
        expect(count(g, `setparams=colorspace=${tag}`), `${tag} at ${t}`).toBe(1)
        expect(count(g, 'setparams'), `${tag} at ${t}`).toBe(1)
        expect(g, `${tag} at ${t}`).not.toContain('out_color_matrix')
        expect(g, `${tag} at ${t}`).not.toContain('scale=out_color')
      }
    }
  )

  it('the two bt601 tags are told apart: each writes back its own, never the other\'s and never bt709', () => {
    expect(graph(0.5, 'smpte170m')).not.toContain('colorspace=bt470bg')
    expect(graph(0.5, 'smpte170m')).not.toContain('colorspace=bt709')
    expect(graph(0.5, 'bt470bg')).not.toContain('colorspace=smpte170m')
    expect(graph(0.5, 'bt470bg')).not.toContain('colorspace=bt709')
    expect(graph(0.5, 'bt709')).not.toContain('colorspace=smpte170m')
  })

  it('no temperature means no colorbalance and so no matrix stage or tag, even on a tagged source', () => {
    for (const tag of ['bt709', 'smpte170m', 'bt470bg']) {
      expect(graph(0, tag), tag).not.toContain('colorbalance')
      expect(graph(0, tag), tag).not.toContain('out_color_matrix')
      expect(graph(0, tag), tag).not.toContain('setparams')
    }
  })

  it('a grade with only brightness, contrast or saturation (no RGB round trip) gets none', () => {
    for (const colorSpace of ['bt709', 'smpte170m', 'bt470bg']) {
      const g = buildVideoFilter(
        clip(0, { colorGrade: { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0 } }),
        PLATFORM_PRESETS.youtube,
        { width: 1920, height: 1080, colorSpace }
      )
      expect(g, colorSpace).toContain('eq=')
      expect(g, colorSpace).not.toContain('out_color_matrix')
      expect(g, colorSpace).not.toContain('setparams')
    }
  })

  it('keeps the stage order: eq, then colorbalance, then the matrix, then the tag, then whatever follows the grade', () => {
    const g = buildVideoFilter(
      clip(0.5, {
        colorGrade: { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 },
        autoZoom: true
      }),
      PLATFORM_PRESETS.youtube,
      { width: 1920, height: 1080, colorSpace: 'bt709' }
    )
    const at = (needle: string): number => g.indexOf(needle)
    expect(at('eq=')).toBeGreaterThan(at('scale=1920:1080'))
    expect(at('colorbalance=')).toBeGreaterThan(at('eq='))
    expect(at(MATRIX)).toBeGreaterThan(at('colorbalance='))
    expect(at(RETAG)).toBeGreaterThan(at(MATRIX))
    expect(at('fps=30,zoompan')).toBeGreaterThan(at(RETAG))
  })

  it.each(['smpte170m', 'bt470bg'])(
    'keeps the stage order for %s: eq, then colorbalance, then the tag, then whatever follows the grade',
    (tag) => {
      const g = buildVideoFilter(
        clip(0.5, {
          colorGrade: { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 },
          autoZoom: true
        }),
        PLATFORM_PRESETS.youtube,
        { width: 1920, height: 1080, colorSpace: tag }
      )
      const at = (needle: string): number => g.indexOf(needle)
      expect(at('eq=')).toBeGreaterThan(at('scale=1920:1080'))
      expect(at('colorbalance=')).toBeGreaterThan(at('eq='))
      expect(at(`setparams=colorspace=${tag}`)).toBeGreaterThan(at('colorbalance='))
      expect(at('fps=30,zoompan')).toBeGreaterThan(at(`setparams=colorspace=${tag}`))
    }
  )

  it('a manual crop does not hide the source from the stage (the matrix is the SOURCE\'s, not the crop\'s)', () => {
    const g = graph(0.5, 'bt709', { cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    expect(g).toContain('crop=')
    expect(g).toContain(MATRIX)
    const g601 = graph(0.5, 'smpte170m', { cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    expect(g601).toContain('crop=')
    expect(g601).toContain('setparams=colorspace=smpte170m')
  })
})

describe('EVEN_PICTURE - the stage every re-encoding command opens with (T-113, T-114, T-115)', () => {
  it('trims width and height DOWN to a multiple of 2 with a crop, nothing else', () => {
    // The literal, once, so a command that imports the constant cannot drift with it.
    expect(EVEN_PICTURE).toBe('crop=trunc(iw/2)*2:trunc(ih/2)*2')
  })

  it('is a crop, never a scale (T-115): a scale resamples the picture to lose one pixel', () => {
    // A 321-wide window capture through `scale=320` is bicubic-resampled: only the four corners
    // stay hard, every edge is soft at its middle and the center is a flat gray - a 1-px
    // checkerboard came out with about half its pixels (48 percent) in the mid-gray band strictly between 80 and 175 -
    // so one-pixel text strokes blur across the picture, the exact captures the stage exists for.
    // A crop leaves every surviving pixel as it was. Layer 5 proves it on a 1-px checkerboard.
    expect(EVEN_PICTURE.startsWith('crop=')).toBe(true)
    expect(EVEN_PICTURE).not.toMatch(/scale/)
  })
})

/**
 * T-130 (an) - the watermark's position expressions, per frame shape. Landscape frames keep the margin they always had, byte for byte; a
 * vertical frame (the shape decides, not the platform's name: a custom 1280x720 built on Reels is landscape) takes the inset that clears the
 * platform's header and caption. Layer 5 (win32, T-51's block) draws them and measures the bands; ffmpeg's drawtext evaluates `h-th-480`
 * itself, so the numbers below are the only place they are written.
 */
describe('the watermark clears the platform interface on a vertical frame (T-130 (an))', () => {
  const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
  const mark = (position: (typeof POSITIONS)[number]) => ({ text: '@imagii', position, fontSizePct: 3.5, opacity: 0.85 })
  const placeOn = (frame: FilterFrame, position: (typeof POSITIONS)[number]): { x: string | undefined; y: string | undefined } => {
    const graph = buildVideoFilter({ startSec: 0, cropRect: null, textOverlays: [] }, frame, { width: 1920, height: 1080 }, mark(position))
    const { options } = parseDrawtext(graph.slice(graph.indexOf('drawtext=') + 'drawtext='.length))
    return { x: options.x, y: options.y }
  }

  it('landscape presets: the flat 20 px on every side, exactly as before', () => {
    for (const id of ['youtube', 'youtube60', 'twitter', 'facebook'] as const) {
      const frame = PLATFORM_PRESETS[id]
      expect(placeOn(frame, 'top-left'), id).toEqual({ x: '20', y: '20' })
      expect(placeOn(frame, 'top-right'), id).toEqual({ x: 'w-tw-20', y: '20' })
      expect(placeOn(frame, 'bottom-left'), id).toEqual({ x: '20', y: 'h-th-20' })
      expect(placeOn(frame, 'bottom-right'), id).toEqual({ x: 'w-tw-20', y: 'h-th-20' })
    }
  })

  it('Reels and TikTok (1080x1920): 288 px down from the top, 480 px up from the bottom, 20 px from the sides', () => {
    for (const id of ['reels', 'tiktok'] as const) {
      const frame = PLATFORM_PRESETS[id]
      expect(placeOn(frame, 'top-left'), id).toEqual({ x: '20', y: '288' })
      expect(placeOn(frame, 'top-right'), id).toEqual({ x: 'w-tw-20', y: '288' })
      expect(placeOn(frame, 'bottom-left'), id).toEqual({ x: '20', y: 'h-th-480' })
      expect(placeOn(frame, 'bottom-right'), id).toEqual({ x: 'w-tw-20', y: 'h-th-480' })
    }
  })

  it('a custom preset is judged by its own shape: 720x1280 on a YouTube base is vertical, 1280x720 on a Reels base is not', () => {
    const custom = (width: number, height: number, basePlatformId: 'youtube' | 'reels') =>
      resolveExportPreset(basePlatformId, { id: 'cp', name: 'Mine', width, height, fps: 30, videoBitrate: '5M', audioBitrate: '128k', basePlatformId })
    expect(placeOn(custom(720, 1280, 'youtube'), 'bottom-right')).toEqual({ x: 'w-tw-20', y: 'h-th-320' })
    expect(placeOn(custom(720, 1280, 'youtube'), 'top-left')).toEqual({ x: '20', y: '192' })
    expect(placeOn(custom(1280, 720, 'reels'), 'bottom-right')).toEqual({ x: 'w-tw-20', y: 'h-th-20' })
    expect(placeOn(custom(1280, 720, 'reels'), 'top-left')).toEqual({ x: '20', y: '20' })
  })

  it('a square or 4:5 custom preset has no caption rail to clear and keeps the flat margin', () => {
    const custom = (width: number, height: number) =>
      resolveExportPreset('reels', { id: 'cp', name: 'Mine', width, height, fps: 30, videoBitrate: '5M', audioBitrate: '128k', basePlatformId: 'reels' })
    expect(placeOn(custom(1080, 1080), 'bottom-right')).toEqual({ x: 'w-tw-20', y: 'h-th-20' })
    expect(placeOn(custom(1080, 1350), 'top-right')).toEqual({ x: 'w-tw-20', y: '20' })
  })

  it('nothing else about the drawtext moved: the face, the size, the box and the opacity are the vertical frame\'s own', () => {
    const graph = buildVideoFilter({ startSec: 0, cropRect: null, textOverlays: [] }, PLATFORM_PRESETS.reels, { width: 1080, height: 1920 }, mark('bottom-right'))
    const { options } = parseDrawtext(graph.slice(graph.indexOf('drawtext=') + 'drawtext='.length))
    expect(options.fontsize).toBe('67')
    expect(options.fontcolor).toBe('white@0.85')
    expect(options.box).toBe('1')
    expect(options.boxborderw).toBe('8')
    expect(options.fontfile).toBe('C:/Windows/Fonts/arialbd.ttf')
  })
})
