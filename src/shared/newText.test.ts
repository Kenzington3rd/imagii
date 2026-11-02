import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TEXT_SIZE,
  MIN_NEW_TEXT_SIZE,
  READABLE_CONTRAST,
  contrastRatio,
  estimatedTextBox,
  inkFor,
  newTextLook,
  newTextSize,
  surfacesUnder,
  worstContrast
} from './newText'
import { PLACEMENT_MARGIN } from './imageBounds'
import type { CanvasLayer, EllipseLayer, ImageLayer, LineLayer, RectLayer, TextLayer } from './canvas'

/**
 * T-140 (2) - where a new "+ Add text" layer starts, how big it is, and what color.
 *
 * `makeTextLayer(120, 120)` put 32 px text in `#120c0c` (the app's own near-black) at a fixed point whatever the document: wholly off the 112x112 emote
 * (selected and invisible), 1.00 to 1.11:1 against every template background, and a speck on a 3840 px overlay. These are the three rules; the store's
 * `textLayerFor` hands them the open document and the app's tokens (`canvasStore.test.ts` holds that part over every template).
 *
 * The inks below are the app's tokens spelled out (`BG_BASE` #120c0c, `INK_BASE` #ece4e2): this module is in `src/shared` and takes its colors from its
 * caller, so the test says them once, here, and `canvasStore.test.ts` is where they are the tokens themselves.
 */
const INKS = { dark: '#120c0c', light: '#ece4e2', behind: '#120c0c' } as const

describe('contrastRatio - WCAG 2 relative luminance, the same arithmetic as the palette claims in tokens.ts', () => {
  it('is 21 for black on white, 1 for a color on itself, and does not care which is which', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#336699', '#336699')).toBe(1)
    expect(contrastRatio('#120c0c', '#ece4e2')).toBe(contrastRatio('#ece4e2', '#120c0c'))
  })

  it('reproduces the ratios the design tokens document (INK_BASE on BG_BASE 15.5, ACCENT on BG_BASE 5.29)', () => {
    expect(contrastRatio('#ece4e2', '#120c0c')).toBeCloseTo(15.47, 1)
    expect(contrastRatio('#ff3131', '#120c0c')).toBeCloseTo(5.29, 1)
  })

  it('refuses a color that is not #rrggbb (the callers resolve first)', () => {
    expect(() => contrastRatio('white', '#000000')).toThrow()
    expect(() => contrastRatio('#fff', '#000000')).toThrow()
  })
})

describe('inkFor - the ink with the better contrast against what the document shows', () => {
  it('a white page takes the dark ink, 19.4:1 (the blank canvas keeps its dark text)', () => {
    expect(inkFor('#ffffff', INKS)).toBe(INKS.dark)
    expect(contrastRatio(INKS.dark, '#ffffff')).toBeGreaterThan(19)
  })

  it('the three backgrounds a template uses take the light ink, at least 13:1 (the dark ink was 1.00 to 1.11:1)', () => {
    for (const bg of ['#120c0c', '#241614', '#1c1313']) {
      expect(inkFor(bg, INKS), bg).toBe(INKS.light)
      expect(contrastRatio(INKS.light, bg), bg).toBeGreaterThan(13)
      expect(contrastRatio(INKS.dark, bg), `${bg}: the old ink`).toBeLessThan(1.2)
    }
  })

  it('a transparent document counts as dark: the workspace behind it is dark, and so are most scenes an overlay sits on', () => {
    expect(inkFor('transparent', INKS)).toBe(INKS.light)
    expect(inkFor('Transparent', INKS)).toBe(INKS.light)
  })

  it('the surface is what `behind` says it is: over a LIGHT workspace the same transparent document takes the dark ink', () => {
    expect(inkFor('transparent', { ...INKS, behind: '#ffffff' })).toBe(INKS.dark)
  })

  it('a color a person set is read the way the overlay editor reads one: a name, #rgb, #rrggbb, with or without the #, in any case', () => {
    expect(inkFor('white', INKS)).toBe(INKS.dark)
    expect(inkFor(' WHITE ', INKS)).toBe(INKS.dark)
    expect(inkFor('#fff', INKS)).toBe(INKS.dark)
    expect(inkFor('FFFF00', INKS)).toBe(INKS.dark)
    expect(inkFor('black', INKS)).toBe(INKS.light)
    expect(inkFor('#000', INKS)).toBe(INKS.light)
    expect(inkFor('navy', INKS)).toBe(INKS.light)
  })

  it('a background it cannot read (a gradient, rgba(), a hand-edited project\'s garbage, nothing) counts as dark, like transparent', () => {
    for (const bg of ['rgba(255, 255, 255, 0.5)', 'linear-gradient(red, blue)', '#ffffff80', 'not a color', '']) {
      expect(inkFor(bg, INKS), JSON.stringify(bg)).toBe(INKS.light)
    }
    // ...and a document read from a project file with no background at all (not a string) does not throw.
    expect(inkFor(undefined as unknown as string, INKS)).toBe(INKS.light)
    expect(inkFor(null as unknown as string, INKS)).toBe(INKS.light)
  })

  it('on a mid grey it takes whichever ink is better, never the worse one', () => {
    expect(inkFor('#808080', INKS)).toBe(INKS.dark) // 4.9 against 3.2
    expect(inkFor('#606060', INKS)).toBe(INKS.light) // 5.0 against 3.1
  })

  it('over every grey, the ink it picks is the better of the two, and no grey leaves both under 3.9:1; AA\'s 4.5:1 holds outside the band 0x68 to 0x79', () => {
    for (let g = 0; g < 256; g++) {
      const hex = `#${g.toString(16).padStart(2, '0').repeat(3)}`
      const picked = inkFor(hex, INKS)
      const other = picked === INKS.dark ? INKS.light : INKS.dark
      const best = contrastRatio(picked, hex)
      expect(best, hex).toBeGreaterThanOrEqual(contrastRatio(other, hex))
      expect(best, hex).toBeGreaterThan(3.9)
      if (g < 0x68 || g > 0x79) expect(best, hex).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a tie goes to the dark ink, the one a new text layer has always had', () => {
    // The same color under two spellings: equal contrast by construction, told apart by the string that comes back.
    expect(inkFor('#808080', { dark: '#AABBCC', light: '#aabbcc', behind: '#000000' })).toBe('#AABBCC')
  })
})

describe('newTextSize - 32 px at the size it was chosen for, in proportion to the document, with a floor and a fit', () => {
  it('the default blank document (1200x800) is the size it always was: 32 px', () => {
    expect(newTextSize(1200, 800)).toBe(DEFAULT_TEXT_SIZE)
    expect(DEFAULT_TEXT_SIZE).toBe(32)
  })

  it('grows with the shorter side: a 4K overlay is not a speck', () => {
    expect(newTextSize(3840, 2160)).toBe(86)
    expect(newTextSize(2560, 1440)).toBe(58)
    expect(newTextSize(1920, 1080)).toBe(43)
    expect(newTextSize(1280, 720)).toBe(29)
  })

  it('it is the shorter side that counts: the same 800 px tall is 32 px on a page 1200 wide or 4000 wide, and a portrait page by its width', () => {
    expect(newTextSize(4000, 800)).toBe(32)
    expect(newTextSize(800, 4000)).toBe(32)
  })

  it('the smallest it gets is MIN_NEW_TEXT_SIZE: the 1200x480 banner and the 112x112 emote', () => {
    expect(MIN_NEW_TEXT_SIZE).toBe(20)
    expect(newTextSize(1200, 480)).toBe(20)
    expect(newTextSize(112, 112)).toBe(20)
    expect(newTextSize(100, 100)).toBe(20)
  })

  it('"Text" at that size is inside the 112 px emote with room to spare', () => {
    const box = estimatedTextBox('Text', newTextSize(112, 112))
    expect(box.width).toBeLessThan(112 / 2)
    expect(box.height).toBeLessThan(112 / 2)
  })

  it('never wider than the document, however narrow it is: a 30 px strip gets the size that fits, not the floor', () => {
    const size = newTextSize(30, 500)
    expect(size).toBeLessThan(MIN_NEW_TEXT_SIZE)
    expect(estimatedTextBox('Text', size).width).toBeLessThanOrEqual(30)
    expect(newTextSize(1, 1)).toBe(1)
  })

  it('does not shrink as the document grows (so 2K is never smaller than 1080p)', () => {
    let last = 0
    for (let side = 50; side <= 4400; side += 10) {
      const size = newTextSize(side * 1.5, side)
      expect(size, `${side}`).toBeGreaterThanOrEqual(last)
      last = size
    }
  })

  it('a size that is not one (NaN, infinite, zero, negative: a project file the editor never made) leaves the old 32 px', () => {
    for (const [w, h] of [[0, 0], [NaN, 100], [100, NaN], [-5, 20], [Infinity, 4], [100, Infinity]] as const) {
      expect(newTextSize(w, h), `${w}x${h}`).toBe(DEFAULT_TEXT_SIZE)
    }
  })

  it('takes another word: a longer one is smaller where the document is narrow', () => {
    expect(newTextSize(112, 112, 'POG')).toBeGreaterThanOrEqual(newTextSize(112, 112, 'Hello streamers'))
    expect(estimatedTextBox('Hello streamers', newTextSize(112, 112, 'Hello streamers')).width).toBeLessThanOrEqual(112)
  })
})

describe('estimatedTextBox - never narrower than the drawn word, so a box that fits by the estimate fits as drawn', () => {
  it('is 0.6 em a character wide and one em tall', () => {
    expect(estimatedTextBox('Text', 32)).toEqual({ width: 4 * 0.6 * 32, height: 32 })
    expect(estimatedTextBox('', 32)).toEqual({ width: 0, height: 32 })
  })

  it('counts a character, not a UTF-16 unit', () => {
    expect(estimatedTextBox('\u{1F600}', 10).width).toBe(0.6 * 10)
  })
})

describe('newTextLook - size, place and ink for a document', () => {
  const docs: Array<[string, number, number, string]> = [
    ['the default blank page', 1200, 800, '#ffffff'],
    ['the 112x112 emote', 112, 112, 'transparent'],
    ['the Twitch banner', 1200, 480, '#241614'],
    ['a 1280x720 thumbnail', 1280, 720, '#241614'],
    ['a clean 1280x720 thumbnail', 1280, 720, '#120c0c'],
    ['the 1080p overlay', 1920, 1080, 'transparent'],
    ['the 4K overlay', 3840, 2160, 'transparent'],
    ['the YouTube banner', 2560, 1440, '#120c0c']
  ]

  for (const [name, width, height, background] of docs) {
    it(`${name}: the word is wholly inside the document (by the estimate that is never narrower than the drawing)`, () => {
      const look = newTextLook({ width, height, background }, INKS)
      const box = estimatedTextBox('Text', look.fontSize)
      expect(look.x).toBeGreaterThanOrEqual(0)
      expect(look.y).toBeGreaterThanOrEqual(0)
      expect(look.x + box.width).toBeLessThanOrEqual(width)
      expect(look.y + box.height).toBeLessThanOrEqual(height)
    })
  }

  it('where there is room it is PLACEMENT_MARGIN in from the corner, as a picture is; the default blank page is the proof', () => {
    expect(PLACEMENT_MARGIN).toBe(60)
    expect(newTextLook({ width: 1200, height: 800, background: '#ffffff' }, INKS)).toEqual({ x: 60, y: 60, fontSize: 32, fill: '#120c0c' })
    expect(newTextLook({ width: 3840, height: 2160, background: 'transparent' }, INKS)).toMatchObject({ x: 60, y: 60, fontSize: 86, fill: '#ece4e2' })
  })

  it('where there is not, the margin gives way (the emote: the word is 20 px, and the rule is the one a picture follows)', () => {
    const look = newTextLook({ width: 112, height: 112, background: 'transparent' }, INKS)
    const box = estimatedTextBox('Text', look.fontSize)
    expect(look.x).toBe(Math.min(PLACEMENT_MARGIN, 112 - box.width))
    expect(look.x + box.width).toBeLessThanOrEqual(112)
    expect(look.fill).toBe('#ece4e2')
  })

  it('every document that is a size gets a word inside it, whatever its shape (a sweep)', () => {
    for (const w of [3, 10, 40, 112, 300, 1200, 3840]) {
      for (const h of [1, 10, 40, 112, 480, 800, 2160]) {
        const look = newTextLook({ width: w, height: h, background: 'transparent' }, INKS)
        const box = estimatedTextBox('Text', look.fontSize)
        expect(look.x, `${w}x${h} left edge`).toBeGreaterThanOrEqual(0)
        expect(look.y, `${w}x${h} top edge`).toBeGreaterThanOrEqual(0)
        expect(look.x + box.width, `${w}x${h} right edge`).toBeLessThanOrEqual(w + 1e-9)
        expect(look.y + box.height, `${w}x${h} bottom edge`).toBeLessThanOrEqual(h + 1e-9)
      }
    }
  })

  it('a document that is not a size is placed as before: 60, 60 at 32 px', () => {
    expect(newTextLook({ width: NaN, height: 800, background: '#ffffff' }, INKS)).toEqual({ x: 60, y: 60, fontSize: 32, fill: '#120c0c' })
  })
})

// ── T-141 (2): the ink is chosen against what is UNDER the word ─────────────────────────────────────────────────────────────────────────────
//
// `inkFor` was asked about the document's background alone. On both emote templates (a transparent document with a disc that fills it) the light ink landed on the disc: 1.33:1 on the gold POG
// disc, 2.92:1 on the red one; on the Bold thumbnail it landed on the sample title. `surfacesUnder` says what is drawn where a box sits, `inkFor` takes the list (the ink whose WORST contrast
// against it is best), and `newTextLook` moves the word to a place where one ink reaches 4.5:1 when its first place has none. The fixtures below are small documents with one cause each;
// `canvasStore.test.ts` holds the same rule over every template and asset, and image.spec.ts proves it on rendered pixels.

const base = { visible: true, locked: false, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, id: 'l', name: 'l' } as const

function rect(x: number, y: number, width: number, height: number, fill: string, extra: Partial<RectLayer> = {}): RectLayer {
  return { ...base, type: 'rect', x, y, width, height, fill, stroke: 'transparent', strokeWidth: 0, cornerRadius: 0, ...extra }
}

function disc(cx: number, cy: number, r: number, fill: string, extra: Partial<EllipseLayer> = {}): EllipseLayer {
  return { ...base, type: 'ellipse', x: cx, y: cy, radiusX: r, radiusY: r, fill, stroke: 'transparent', strokeWidth: 0, ...extra }
}

function words(x: number, y: number, text: string, fontSize: number, fill: string, extra: Partial<TextLayer> = {}): TextLayer {
  return { ...base, type: 'text', x, y, text, fontSize, fontFamily: 'Inter, sans-serif', fill, ...extra }
}

const WORKSPACE = INKS.behind

describe('worstContrast - the lowest ratio an ink has against any of the surfaces', () => {
  it('is the ratio against the worst of them; one surface can be a string; against nothing it is against the workspace', () => {
    const gold = '#fbbf24'
    expect(worstContrast(INKS.dark, gold, INKS)).toBeCloseTo(contrastRatio(INKS.dark, gold), 5)
    expect(worstContrast(INKS.light, [gold, '#120c0c'], INKS)).toBeCloseTo(contrastRatio(INKS.light, gold), 5)
    expect(worstContrast(INKS.light, [], INKS)).toBeCloseTo(contrastRatio(INKS.light, WORKSPACE), 5)
  })

  it('reads a surface the way inkFor does: a name, #rgb, and what it cannot read is the workspace', () => {
    expect(worstContrast(INKS.dark, ['white', '#fff'], INKS)).toBeGreaterThan(19)
    expect(worstContrast(INKS.dark, ['transparent', 'rgba(1,2,3,0.5)', 'garbage'], INKS)).toBeCloseTo(1, 5)
  })
})

describe('inkFor over a list - the ink whose WORST contrast is best (maximin)', () => {
  it('a gold disc is the dark ink even though the document around it is dark: 12:1 against 1.3:1', () => {
    expect(inkFor(['#fbbf24'], INKS)).toBe(INKS.dark)
    expect(inkFor('#fbbf24', INKS), 'the string form is the same list of one').toBe(INKS.dark)
  })

  it('a dark document with a disc under part of the box is judged against both: neither ink clears the dark corner AND the gold, so it takes the one whose worst is less bad', () => {
    const both = ['#fbbf24', '#120c0c']
    const picked = inkFor(both, INKS)
    const other = picked === INKS.dark ? INKS.light : INKS.dark
    expect(worstContrast(picked, both, INKS)).toBeGreaterThanOrEqual(worstContrast(other, both, INKS))
    expect(worstContrast(picked, both, INKS), 'and it is under 4.5: the word has to move').toBeLessThan(READABLE_CONTRAST)
  })

  it('does not depend on the order of the list, and a tie still goes to the dark ink', () => {
    const list = ['#241614', '#711b1b', '#fbbf24']
    expect(inkFor(list, INKS)).toBe(inkFor([...list].reverse(), INKS))
    expect(inkFor(['#808080', '#808080'], { dark: '#AABBCC', light: '#aabbcc', behind: '#000000' })).toBe('#AABBCC')
  })

  it('an empty list is the workspace (a document with nothing to read against is the dark behind it)', () => {
    expect(inkFor([], INKS)).toBe(INKS.light)
  })

  it('the maximin pick is never worse than either ink on every pair of greys (a sweep)', () => {
    for (let a = 0; a < 256; a += 17) {
      for (let b = 0; b < 256; b += 17) {
        const list = [`#${a.toString(16).padStart(2, '0').repeat(3)}`, `#${b.toString(16).padStart(2, '0').repeat(3)}`]
        const best = worstContrast(inkFor(list, INKS), list, INKS)
        expect(best, list.join(' ')).toBeGreaterThanOrEqual(worstContrast(INKS.dark, list, INKS) - 1e-9)
        expect(best, list.join(' ')).toBeGreaterThanOrEqual(worstContrast(INKS.light, list, INKS) - 1e-9)
      }
    }
  })
})

describe('surfacesUnder - every colour that can show under a box', () => {
  const box = { x: 10, y: 10, width: 40, height: 20 }

  it('with no layers it is the document: a colour, a name, or the workspace for transparent and for what it cannot read', () => {
    expect(surfacesUnder({ background: '#ffffff' }, box, WORKSPACE)).toEqual(['#ffffff'])
    expect(surfacesUnder({ background: 'White', layers: [] }, box, WORKSPACE)).toEqual(['#ffffff'])
    expect(surfacesUnder({ background: 'transparent', layers: [] }, box, WORKSPACE)).toEqual([WORKSPACE])
    expect(surfacesUnder({ background: 'linear-gradient(red, blue)', layers: [] }, box, WORKSPACE)).toEqual([WORKSPACE])
    expect(surfacesUnder({ background: undefined as unknown as string }, box, WORKSPACE)).toEqual([WORKSPACE])
  })

  it('a rectangle that covers the whole box replaces the document there; one that covers part of it adds its colour beside the document\'s', () => {
    expect(surfacesUnder({ background: '#ffffff', layers: [rect(0, 0, 100, 100, '#ff3131')] }, box, WORKSPACE)).toEqual(['#ff3131'])
    expect(surfacesUnder({ background: '#ffffff', layers: [rect(30, 0, 100, 100, '#ff3131')] }, box, WORKSPACE).sort()).toEqual(['#ff3131', '#ffffff'])
    expect(surfacesUnder({ background: '#ffffff', layers: [rect(60, 60, 10, 10, '#ff3131')] }, box, WORKSPACE)).toEqual(['#ffffff'])
  })

  it('a box that only touches a rectangle\'s far edge is not on it', () => {
    expect(surfacesUnder({ background: '#ffffff', layers: [rect(-30, 0, 40, 100, '#ff3131')] }, box, WORKSPACE)).toEqual(['#ffffff'])
  })

  it('an ellipse is its own shape, not its bounding box: the corner of the box outside the disc is still the document', () => {
    // A disc of radius 50 centred on (56, 56) (the emote): the box (60..108, 60..80) has its right end outside it.
    const emote = { background: 'transparent', layers: [disc(56, 56, 50, '#fbbf24')] }
    expect(surfacesUnder(emote, { x: 60, y: 60, width: 48, height: 20 }, WORKSPACE).sort()).toEqual([WORKSPACE, '#fbbf24'].sort())
    expect(surfacesUnder(emote, { x: 34, y: 40, width: 40, height: 20 }, WORKSPACE)).toEqual(['#fbbf24'])
    // ...and a box in the bounding box's corner, outside the disc, sees only the document.
    expect(surfacesUnder(emote, { x: 8, y: 8, width: 10, height: 10 }, WORKSPACE)).toEqual([WORKSPACE])
  })

  it('an ellipse with unequal radii is wide across and short down: radiusX along x, radiusY along y', () => {
    const wide = { background: 'transparent', layers: [{ ...disc(100, 100, 50, '#fbbf24'), radiusX: 80, radiusY: 20 }] }
    // 60 px to the side is inside a radiusX of 80 and outside a radiusX of 20; 25 px down is outside a radiusY of 20 and inside a radiusY of 80.
    expect(surfacesUnder(wide, { x: 160, y: 99, width: 2, height: 2 }, WORKSPACE)).toEqual(['#fbbf24'])
    expect(surfacesUnder(wide, { x: 99, y: 125, width: 2, height: 2 }, WORKSPACE)).toEqual([WORKSPACE])
  })

  it('an rgba() fill is laid over what is under it at its alpha, and so is the layer\'s own opacity', () => {
    expect(surfacesUnder({ background: '#000000', layers: [rect(0, 0, 100, 100, 'rgba(255,49,49,0.5)')] }, box, WORKSPACE)).toEqual(['#801919'])
    expect(surfacesUnder({ background: '#000000', layers: [rect(0, 0, 100, 100, '#ffffff', { opacity: 0.5 })] }, box, WORKSPACE)).toEqual(['#808080'])
    // The 18% red of a template's face placeholder is nearly the document it sits on, and it is reported as that colour.
    const [tinted] = surfacesUnder({ background: '#241614', layers: [rect(0, 0, 100, 100, 'rgba(255,49,49,0.18)')] }, box, WORKSPACE)
    expect(contrastRatio(tinted as string, '#241614')).toBeLessThan(1.4)
  })

  it('shapes are laid in layer order: the later one is on top', () => {
    const layers = [rect(0, 0, 100, 100, '#ff0000'), rect(0, 0, 100, 100, '#0000ff')]
    expect(surfacesUnder({ background: '#ffffff', layers }, box, WORKSPACE)).toEqual(['#0000ff'])
    expect(surfacesUnder({ background: '#ffffff', layers: [...layers].reverse() }, box, WORKSPACE)).toEqual(['#ff0000'])
  })

  it('a hidden layer, a transparent fill, an unreadable fill, a picture and a closed line draw nothing under the box', () => {
    const picture: ImageLayer = { ...base, type: 'image', width: 100, height: 100, src: 'data:image/png;base64,AAAA' }
    const polygon: LineLayer = { ...base, type: 'line', points: [0, 0, 100, 0, 100, 100, 0, 100], stroke: '#ff0000', strokeWidth: 3, closed: true }
    const layers: CanvasLayer[] = [
      rect(0, 0, 100, 100, '#ff0000', { visible: false }),
      rect(0, 0, 100, 100, 'transparent'),
      rect(0, 0, 100, 100, 'linear-gradient(red, blue)'),
      rect(0, 0, 100, 100, 'rgba(255,0,0,0)'),
      picture,
      polygon
    ]
    expect(surfacesUnder({ background: '#ffffff', layers }, box, WORKSPACE)).toEqual(['#ffffff'])
  })

  it('a rotated or scaled shape covers where it is drawn: a bar turned a quarter, a rectangle stretched to twice its width', () => {
    // 100 wide, 10 tall, turned 90 degrees clockwise about (50, 0): it covers x in [40, 50], y in [0, 100].
    const bar = rect(50, 0, 100, 10, '#ff0000', { rotation: 90 })
    expect(surfacesUnder({ background: '#ffffff', layers: [bar] }, { x: 42, y: 40, width: 6, height: 6 }, WORKSPACE)).toEqual(['#ff0000'])
    expect(surfacesUnder({ background: '#ffffff', layers: [bar] }, { x: 60, y: 40, width: 6, height: 6 }, WORKSPACE)).toEqual(['#ffffff'])
    const wide = rect(0, 0, 50, 50, '#ff0000', { scaleX: 2 })
    expect(surfacesUnder({ background: '#ffffff', layers: [wide] }, { x: 70, y: 10, width: 20, height: 20 }, WORKSPACE)).toEqual(['#ff0000'])
    expect(surfacesUnder({ background: '#ffffff', layers: [wide] }, { x: 110, y: 10, width: 10, height: 10 }, WORKSPACE)).toEqual(['#ffffff'])
  })

  it('a shape under the INTERIOR of the box, touching neither side edge, is seen: a badge in the middle of the word (the sampling is not an edge test)', () => {
    // 40 x 20 box from (10, 10): its middle is (30, 20). A dark disc of radius 4 there is 16 px from both side edges and 6 px from top and bottom.
    const badge = { background: '#ffffff', layers: [disc(30, 20, 4, '#000000')] }
    expect(surfacesUnder(badge, box, WORKSPACE).sort()).toEqual(['#000000', '#ffffff'])
    // ...and a narrow bar through the middle of it, from the top edge to the bottom, clear of both sides.
    const bar = { background: '#ffffff', layers: [rect(29, 0, 6, 60, '#000000')] }
    expect(surfacesUnder(bar, box, WORKSPACE).sort()).toEqual(['#000000', '#ffffff'])
  })

  it('the guarantee: a patch of the box a sixteenth of its width by a sixth of its height is seen wherever it lies, in the interior and at the edges (a sweep of its position)', () => {
    // The sample points are width/16 = 2.5 apart across and height/6 = 3.33 down, so a patch that size always holds one. (A smaller one may fall between four points; that is the
    // ceiling the `simplification:` in `surfacesUnder` names, and it is not pinned here.)
    const w = box.width / 16 + 0.01
    const h = box.height / 6 + 0.01
    for (let dx = 0; dx <= box.width - w; dx += 0.7) {
      for (let dy = 0; dy <= box.height - h; dy += 0.7) {
        const patch = { background: '#ffffff', layers: [rect(box.x + dx, box.y + dy, w, h, '#000000')] }
        expect(surfacesUnder(patch, box, WORKSPACE), `patch at +${dx.toFixed(1)}, +${dy.toFixed(1)}`).toContain('#000000')
      }
    }
  })

  it('a text layer adds its colour wherever its estimated box covers the box - beside what is there, because glyphs are partial; a hint\'s words are dimmed to 40%', () => {
    // "TITLE" at 20 px is estimated 60 x 20 from (0, 0).
    const title = words(0, 0, 'TITLE', 20, '#ffffff')
    expect(surfacesUnder({ background: '#241614', layers: [title] }, { x: 5, y: 5, width: 10, height: 10 }, WORKSPACE).sort()).toEqual(['#241614', '#ffffff'])
    expect(surfacesUnder({ background: '#241614', layers: [title] }, { x: 100, y: 5, width: 10, height: 10 }, WORKSPACE)).toEqual(['#241614'])
    const hint = surfacesUnder({ background: '#241614', layers: [{ ...title, hint: true }] }, { x: 5, y: 5, width: 10, height: 10 }, WORKSPACE)
    expect(hint).toHaveLength(2)
    expect(hint).toContain('#241614')
    expect(hint.find((c) => c !== '#241614')).toBe('#7c7372')
  })

  it('a text layer\'s box is its longest line wide and every line tall; a box under the last line is below it', () => {
    const two = words(0, 0, 'ab\nlonger line', 10, '#ffffff')
    // "longer line" is 11 characters: 66 px wide; two lines: 20 px tall.
    expect(surfacesUnder({ background: '#000000', layers: [two] }, { x: 50, y: 12, width: 5, height: 5 }, WORKSPACE).sort()).toEqual(['#000000', '#ffffff'])
    expect(surfacesUnder({ background: '#000000', layers: [two] }, { x: 70, y: 12, width: 5, height: 5 }, WORKSPACE)).toEqual(['#000000'])
    expect(surfacesUnder({ background: '#000000', layers: [two] }, { x: 5, y: 20, width: 5, height: 5 }, WORKSPACE)).toEqual(['#000000'])
  })

  it('a layer from a project file with a size or a colour that is not one does not throw and draws nothing', () => {
    const bad = [
      words(0, 0, 'x', 0, '#ffffff'),
      words(0, 0, 'x', NaN, '#ffffff'),
      words(0, 0, undefined as unknown as string, 12, '#ffffff'),
      rect(0, 0, NaN, 100, '#ff0000'),
      disc(0, 0, 0, '#ff0000'),
      rect(0, 0, 100, 100, undefined as unknown as string)
    ]
    expect(surfacesUnder({ background: '#ffffff', layers: bad }, box, WORKSPACE)).toEqual(['#ffffff'])
  })

  it('never reports a colour it was not given a reason for: every answer is a #rrggbb', () => {
    const layers = [rect(0, 0, 100, 100, 'rgba(10, 200, 30, 0.37)', { opacity: 0.61 }), words(0, 0, 'Hello', 24, 'tomato', { hint: true })]
    for (const c of surfacesUnder({ background: 'navy', layers }, box, WORKSPACE)) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('newTextLook with layers - where the word goes when its first place cannot be read', () => {
  const OPEN = { width: 1200, height: 800, background: '#ffffff' }

  /** What the rule holds a placement to, from the module's own parts: the ink against everything under the word's estimated box. */
  function worstAt(doc: Parameters<typeof newTextLook>[0], look: ReturnType<typeof newTextLook>): number {
    const box = estimatedTextBox('Text', look.fontSize)
    return worstContrast(look.fill, surfacesUnder(doc, { x: look.x, y: look.y, ...box }, WORKSPACE), INKS)
  }

  it('without layers it is exactly what it was (the blank page, a dark template, the 4K overlay)', () => {
    expect(newTextLook({ ...OPEN, layers: [] }, INKS)).toEqual(newTextLook(OPEN, INKS))
    expect(newTextLook({ ...OPEN, layers: [] }, INKS)).toEqual({ x: 60, y: 60, fontSize: 32, fill: '#120c0c' })
  })

  it('a layer that does not reach the first place changes nothing', () => {
    const far = { ...OPEN, layers: [rect(600, 400, 300, 300, '#ff3131')] }
    expect(newTextLook(far, INKS)).toEqual({ x: 60, y: 60, fontSize: 32, fill: '#120c0c' })
  })

  it('the ink follows what is under the first place, not the page: a gold plate on a dark page takes the dark ink', () => {
    const plate = { width: 1200, height: 800, background: '#120c0c', layers: [rect(0, 0, 400, 300, '#fbbf24')] }
    const look = newTextLook(plate, INKS)
    expect([look.x, look.y]).toEqual([60, 60])
    expect(look.fill).toBe(INKS.dark)
    expect(worstAt(plate, look)).toBeGreaterThanOrEqual(READABLE_CONTRAST)
  })

  it('a first place that straddles two surfaces moves to the next corner in order: top-right, then bottom-left, then bottom-right', () => {
    // A mid grey (4.3:1 against the dark ink, 3.6 against the light: neither ink reads it) over the first place, then over more.
    const grey = '#777777'
    const size = estimatedTextBox('Text', 32)
    const topRight = 1200 - size.width - 60
    const bottom = 800 - size.height - 60
    const doc = (layers: RectLayer[]): Parameters<typeof newTextLook>[0] => ({ ...OPEN, layers })
    const home = rect(0, 0, 200, 200, grey)
    expect(newTextLook(doc([home]), INKS)).toMatchObject({ x: topRight, y: 60 })
    const homeAndRight = [home, rect(900, 0, 300, 200, grey)]
    expect(newTextLook(doc(homeAndRight), INKS)).toMatchObject({ x: 60, y: bottom })
    const threeCorners = [...homeAndRight, rect(0, 600, 300, 200, grey)]
    expect(newTextLook(doc(threeCorners), INKS)).toMatchObject({ x: topRight, y: bottom })
    for (const layers of [[home], homeAndRight, threeCorners]) {
      const look = newTextLook(doc(layers), INKS)
      expect(worstAt(doc(layers), look), JSON.stringify(look)).toBeGreaterThanOrEqual(READABLE_CONTRAST)
      expect(look.fontSize).toBe(32)
    }
  })

  it('when every corner is taken it takes the nearest place on the grid where the word can be read, wholly on the document', () => {
    const grey = '#777777'
    const corners = [rect(0, 0, 300, 200, grey), rect(900, 0, 300, 200, grey), rect(0, 600, 300, 200, grey), rect(900, 600, 300, 200, grey)]
    const doc = { ...OPEN, layers: corners }
    const look = newTextLook(doc, INKS)
    const size = estimatedTextBox('Text', look.fontSize)
    expect(worstAt(doc, look)).toBeGreaterThanOrEqual(READABLE_CONTRAST)
    expect(look.x).toBeGreaterThanOrEqual(0)
    expect(look.y).toBeGreaterThanOrEqual(0)
    expect(look.x + size.width).toBeLessThanOrEqual(1200)
    expect(look.y + size.height).toBeLessThanOrEqual(800)
    // Nearest: it is the first free place going out from the first corner - just past the grey block, not across the page.
    expect(Math.hypot(look.x - 60, look.y - 60), JSON.stringify(look)).toBeLessThan(300)
  })

  it('a shape under the middle of the first place moves the word, though it touches neither side: a dark badge on a white page is unreadable in either ink', () => {
    // The first place is (60, 60), 76.8 x 32. A black disc of radius 10 at its middle (98, 76) is 38 px from both side edges: dark ink on white is 19:1 and on the disc 1.0:1, light
    // ink the other way round, so neither reads and the word goes to the next corner. (Sampled at the two side edges alone it would stay at (60, 60), in the dark ink, on the badge.)
    const size = estimatedTextBox('Text', 32)
    const doc = { ...OPEN, layers: [disc(98, 76, 10, '#000000')] }
    const look = newTextLook(doc, INKS)
    expect([look.x, look.y]).toEqual([1200 - size.width - 60, 60])
    expect(worstAt(doc, look)).toBeGreaterThanOrEqual(READABLE_CONTRAST)
    // The mirror image: a white badge on a dark page (light ink on the page is 15:1 and on the badge 1.2:1; dark ink the other way round).
    const bright = { ...OPEN, background: '#120c0c', layers: [disc(98, 76, 10, '#ffffff')] }
    const moved = newTextLook(bright, INKS)
    expect([moved.x, moved.y]).toEqual([1200 - size.width - 60, 60])
  })

  it('the scan goes out from the first corner: a clear pocket near it wins over one that comes earlier in the document', () => {
    // Grey everywhere, and two white windows laid over it: one in the top row at x 500 (the first the scan would reach reading the page like a book) and one just under the first corner.
    const doc = { ...OPEN, layers: [rect(0, 0, 1200, 800, '#777777'), rect(500, 0, 200, 40, '#ffffff'), rect(60, 120, 140, 50, '#ffffff')] }
    const look = newTextLook(doc, INKS)
    expect(look.y, JSON.stringify(look)).toBeGreaterThanOrEqual(120)
    expect(look.y + 32).toBeLessThanOrEqual(170)
    expect(look.x).toBeGreaterThanOrEqual(60)
    expect(look.x + estimatedTextBox('Text', 32).width).toBeLessThanOrEqual(200)
    expect(worstAt(doc, look)).toBeGreaterThanOrEqual(READABLE_CONTRAST)
  })

  it('the POG emote: the only room is the band under the word, and the word goes there in the dark ink', () => {
    // The shipped template: a gold disc (r 50) centred on (56, 56) with "POG" 48 px at (22, 30), on a transparent 112x112 document.
    const pog = {
      width: 112,
      height: 112,
      background: 'transparent',
      layers: [disc(56, 56, 50, '#fbbf24'), words(22, 30, 'POG', 48, '#120c0c')]
    }
    const look = newTextLook(pog, INKS)
    const word = estimatedTextBox('POG', 48)
    expect(look.fill).toBe(INKS.dark)
    expect(look.y, 'below the estimated box of POG').toBeGreaterThanOrEqual(30 + word.height)
    expect(worstAt(pog, look)).toBeGreaterThanOrEqual(READABLE_CONTRAST)
  })

  it('the emote disc alone: the dark ink, wholly inside the disc (the word cannot fit in a corner of a document a disc fills)', () => {
    const emote = { width: 112, height: 112, background: 'transparent', layers: [disc(56, 56, 50, '#ff3131')] }
    const look = newTextLook(emote, INKS)
    const box = estimatedTextBox('Text', look.fontSize)
    expect(look.fill).toBe(INKS.dark)
    for (const [cx, cy] of [[look.x, look.y], [look.x + box.width, look.y], [look.x, look.y + box.height], [look.x + box.width, look.y + box.height]] as const) {
      expect(Math.hypot(cx - 56, cy - 56), `the corner (${cx}, ${cy}) of the word is inside the disc`).toBeLessThanOrEqual(50)
    }
  })

  it('when no place can be read (grey under every place) it keeps the best, the first of a tie: the corner it always started at', () => {
    const wall = { ...OPEN, layers: [rect(0, 0, 1200, 800, '#777777')] }
    const look = newTextLook(wall, INKS)
    expect([look.x, look.y]).toEqual([60, 60])
    expect(worstAt(wall, look)).toBeLessThan(READABLE_CONTRAST)
    // ...with the better of the two inks (the dark one is 4.3:1 on this grey, the light one 3.6:1).
    expect(look.fill).toBe(INKS.dark)
  })

  it('a document that is not a size is not scanned (a project file the editor never made): the first place, and it returns', () => {
    for (const [w, h] of [[NaN, 800], [Infinity, 800], [1200, Infinity], [0, 0], [-5, 100]] as const) {
      const look = newTextLook({ width: w, height: h, background: '#ffffff', layers: [rect(0, 0, 100, 100, '#777777')] }, INKS)
      expect([look.x, look.y], `${w}x${h}`).toEqual([60, 60])
    }
  })

  it('a document with a great many layers is placed without a pause: the scan is bounded by the document\'s size, not by its layers', () => {
    const layers = Array.from({ length: 300 }, (_, i) => rect((i * 37) % 1100, (i * 91) % 700, 90, 60, '#777777'))
    const started = Date.now()
    const look = newTextLook({ ...OPEN, layers }, INKS)
    expect(Date.now() - started, 'ms').toBeLessThan(5_000)
    expect(look.fontSize).toBe(32)
  })
})
