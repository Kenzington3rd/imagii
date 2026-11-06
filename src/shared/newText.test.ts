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
import { PLACEMENT_MARGIN, placementFor } from './imageBounds'
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
  // T-167 (fold): was `4 * 0.6 * 32` (76.8); each character is its own measured advance now ("Text": T 0.67, e 0.60, x 0.57, t 0.36 = 2.20 em, 70.4 at 32 px).
  it('is its characters\' own advances wide (a capital more than 0.6 em, a narrow letter less) and one em tall', () => {
    expect(estimatedTextBox('Text', 32).width).toBeCloseTo((0.67 + 0.6 + 0.57 + 0.36) * 32, 9)
    expect(estimatedTextBox('Text', 32).height).toBe(32)
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

// T-166 (1): a pasted sentence was sized, placed and inked for the word "Text" because `textLayerFor` did not hand its words to `newTextLook` (canvasStore.test.ts holds that
// wiring). The other half is here: a box that is only ever one line tall cannot fit a pasted two-line title, so `estimatedTextBox` is line-aware (the longest line wide, one
// `fontSize` tall per line: Konva's line height is 1 and its width the longest line's, the rule `surfacesUnder` already applied to an existing text layer) and `newTextSize` fits both.
describe('estimatedTextBox is line-aware - the longest line wide, a line tall each (T-166 (1))', () => {
  it('"ab\\ncdef" at 10 px is 4 characters wide (the longer line) and two lines tall', () => {
    // (T-167: was `4 * 0.6 * 10` = 24; "cdef" is c 0.59, d 0.63, e 0.60, f 0.39 = 2.21 em: 22.1)
    const box = estimatedTextBox('ab\ncdef', 10)
    expect(box.width).toBeCloseTo(22.1, 9)
    expect(box.height).toBe(20)
  })

  // (T-167: this control said a one-line string is `length * 0.6 * size`; each character is its own measured advance now, so the control holds the shape that did not change: a one-line
  // string is the sum of its characters' widths, one em tall, '' is no width, and a character outside printable ASCII is the old 0.6.)
  it('control: a one-line string is the sum of its characters\' advances wide and one em tall', () => {
    for (const [text, size] of [['Text', 32], ['Subscribe now for more streams', 29], ['', 10], ['\u{1F600}', 10]] as const) {
      const box = estimatedTextBox(text, size)
      const ascii = [...text].every((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126)
      const em = [...text].reduce((sum, ch) => sum + (ascii ? Math.ceil(Math.max(measuredEm(ch, 400), measuredEm(ch, 700)) * 100 - 1e-9) / 100 : 0.6), 0)
      expect(box.width, text).toBeCloseTo(em * size, 9)
      expect(box.height, text).toBe(size)
    }
  })

  it('a Windows clipboard\'s \\r\\n is one line break, not a character at the end of the line', () => {
    expect(estimatedTextBox('ab\r\ncdef', 10)).toEqual(estimatedTextBox('ab\ncdef', 10))
    // (the longer line first: a \r left on it would make it 5 characters, not 4)
    // (T-167: was `4 * 0.6 * 10` = 24; "abcd" is a 0.58, b 0.63, c 0.59, d 0.63 = 2.43 em: 24.3)
    const box = estimatedTextBox('abcd\r\nef', 10)
    expect(box.width).toBeCloseTo(24.3, 9)
    expect(box.height).toBe(20)
    expect(estimatedTextBox('a\r\nb\r\nc', 10).height).toBe(30)
  })

  it('a blank line is a line (the box is as tall as the text is drawn)', () => {
    // (T-167: was `0.6 * 10` = 6; "b" is the wider of the two letters at 0.63 em: 6.3)
    expect(estimatedTextBox('a\n\nb', 10)).toEqual({ width: 0.63 * 10, height: 30 })
  })
})

describe('newTextSize fits the whole pasted text, not just its width (T-166 (1))', () => {
  const SENTENCE = 'Subscribe now for more streams'

  it('control: the sentence on a 1280x720 page fits the width (one line was always fitted)', () => {
    const size = newTextSize(1280, 720, SENTENCE)
    expect(estimatedTextBox(SENTENCE, size).width).toBeLessThanOrEqual(1280)
    expect(size).toBe(29)
  })

  it('control: the sentence on a 112x112 emote fits the width, at the size that fits rather than the floor', () => {
    const size = newTextSize(112, 112, SENTENCE)
    expect(size).toBeLessThan(MIN_NEW_TEXT_SIZE)
    expect(estimatedTextBox(SENTENCE, size).width).toBeLessThanOrEqual(112)
    expect(estimatedTextBox(SENTENCE, size + 1).width, 'and one px more would not').toBeGreaterThan(112)
  })

  it('a two-line title fits the height: on a 4000x30 strip each line is 15 px, not the 20 px floor that stacks to 40', () => {
    const size = newTextSize(4000, 30, 'Subscribe now\nfor more streams')
    expect(size).toBe(15)
    expect(estimatedTextBox('Subscribe now\nfor more streams', size).height).toBeLessThanOrEqual(30)
  })

  it('a title of three short lines on a square emote keeps the proportional size (the floor, 20 px: three lines of it are 60 px, inside 112) - the fit is a ceiling, not a target', () => {
    expect(newTextSize(112, 112, 'a\nb\nc')).toBe(20)
    expect(newTextSize(112, 112, 'a\nb\nc\nd\ne\nf\ng')).toBe(16)
  })

  // (T-167: "Text" is 2.20 em wide now, was 2.4; the one page that moved is the 30 px strip, whose width-fit size is 13, was 12. The rest are sized by the proportional rule.)
  it('control: a one-line word is sized exactly as before (the default word on every page)', () => {
    for (const [w, h] of [[1200, 800], [112, 112], [1280, 720], [30, 500], [3840, 2160]] as const) {
      const old = Math.max(1, Math.min(Math.max(Math.round((DEFAULT_TEXT_SIZE * Math.min(w, h)) / 800), MIN_NEW_TEXT_SIZE), Math.floor(Math.min(w / 2.2, h))))
      expect(newTextSize(w, h), `${w}x${h}`).toBe(old)
    }
  })
})

describe('newTextLook with a pasted two-line title stays inside a page too short for the one-line box (T-166 (1))', () => {
  it('a two-line title on a strip too short for the one-line box stays inside it (4000x30)', () => {
    const word = 'Subscribe now\nfor more streams'
    const look = newTextLook({ width: 4000, height: 30, background: 'transparent' }, INKS, word)
    const box = estimatedTextBox(word, look.fontSize)
    expect(look.fontSize).toBe(15)
    expect(look.y + box.height).toBeLessThanOrEqual(30)
  })
})

// ── T-167 Track A: a pasted text stays on its page, by its REAL box; and the estimate is an upper bound for capitals too ────────────────────────────────────────────────────────────
//
// (1) `candidatePlaces` took its home from `placementFor`, a PICTURE rule that first scales a box down to `LAYER_DRAWN_MAX_DIM` (800 px): a text box over 800 px on a side got its margin
// from the shrunken box and its real (line-aware since T-166) bottom overhung the page (25 lines of 45 characters on 1200x800: size 32 at (60, 59.26), bottom 859). A word's box is never shrunk,
// it is sized to fit, so the home is the margin rule on the real box. (fold) `estimatedTextBox` called 0.6 em a character an UPPER bound, which it was not for capitals: an all-caps sentence
// measured 0.607 em a character at 400 and 0.614 at 700 in the bundled Inter, "WWWW MMMM" 0.87, so a long all-caps line sized to the page's width overhung its right edge by 20-80 px.
//
// INTER_ADVANCES are the advances MEASURED in the built app (a canvas 2d context, `ctx.font = '<weight> 100px Inter'` after `document.fonts.ready`, `measureText` for each printable ASCII
// character), at 100 px, so each number is also the advance in em times 100; index 0 is character code 32. Weight 700 is not a bundled face (400, 500 and 600 are), so Chromium draws
// it with the 600 face; the table is kept for both because the estimate is held to the wider of the two.
const INTER_400 = [
  28.125, 28.759765625, 46.58203125, 63.330078125, 64.16015625, 98.193359375, 64.404296875, 29.98046875,
  36.474609375, 36.474609375, 50.09765625, 66.162109375, 28.80859375, 45.99609375, 28.80859375, 36.03515625,
  63.0859375, 40.673828125, 60.986328125, 61.767578125, 64.599609375, 59.326171875, 62.01171875, 56.591796875,
  61.865234375, 62.01171875, 28.80859375, 30.17578125, 66.162109375, 66.162109375, 66.162109375, 51.123046875,
  96.58203125, 68.994140625, 65.4296875, 73.046875, 72.16796875, 60.107421875, 59.033203125, 74.609375,
  74.31640625, 26.85546875, 57.080078125, 67.1875, 56.54296875, 90.33203125, 75.341796875, 76.46484375,
  63.8671875, 76.46484375, 64.35546875, 64.16015625, 64.55078125, 74.4140625, 68.994140625, 98.53515625,
  68.212890625, 67.87109375, 62.890625, 36.474609375, 36.03515625, 36.474609375, 47.119140625, 45.60546875,
  32.275390625, 56.15234375, 61.23046875, 57.12890625, 61.23046875, 58.30078125, 37.01171875, 61.328125,
  59.130859375, 24.21875, 24.21875, 54.8828125, 24.21875, 87.59765625, 59.08203125, 59.9609375,
  61.23046875, 61.23046875, 37.646484375, 52.783203125, 32.71484375, 59.130859375, 56.201171875, 81.8359375,
  54.58984375, 56.201171875, 55.224609375, 42.626953125, 33.251953125, 42.626953125, 66.162109375
]
const INTER_700 = [
  25.1953125, 32.12890625, 52.294921875, 64.35546875, 65.0390625, 100.439453125, 66.259765625, 32.568359375,
  37.3046875, 37.3046875, 53.955078125, 67.28515625, 31.884765625, 46.533203125, 31.884765625, 37.890625,
  65.966796875, 42.28515625, 62.3046875, 63.623046875, 66.6015625, 61.23046875, 63.96484375, 57.6171875,
  64.013671875, 63.96484375, 31.884765625, 32.91015625, 67.28515625, 67.28515625, 67.28515625, 54.345703125,
  99.90234375, 72.75390625, 65.91796875, 73.681640625, 72.216796875, 60.546875, 58.7890625, 74.90234375,
  74.560546875, 27.685546875, 57.958984375, 70.3125, 56.54296875, 92.236328125, 75.927734375, 76.85546875,
  64.501953125, 77.294921875, 65.234375, 65.0390625, 66.015625, 73.583984375, 72.75390625, 102.001953125,
  71.97265625, 71.337890625, 65.234375, 37.3046875, 37.890625, 37.3046875, 48.14453125, 46.923828125,
  35.107421875, 57.421875, 62.40234375, 58.251953125, 62.40234375, 59.130859375, 38.8671875, 62.548828125,
  61.23046875, 26.171875, 26.171875, 56.93359375, 26.171875, 90.0390625, 61.181640625, 60.888671875,
  62.40234375, 62.40234375, 39.697265625, 54.931640625, 35.302734375, 61.23046875, 58.69140625, 83.935546875,
  56.884765625, 58.837890625, 56.591796875, 45.458984375, 35.888671875, 45.458984375, 67.28515625
]
const INTER_ADVANCES = { 400: INTER_400, 700: INTER_700 } as const
/** The measured advance of `ch` in em, at the weight. */
const measuredEm = (ch: string, weight: 400 | 700): number => (INTER_ADVANCES[weight][ch.charCodeAt(0) - 32] as number) / 100

describe('a pasted text stays wholly on its page: the home place is the margin rule on the REAL box (T-167 (1))', () => {
  const WHITE = (width: number, height: number): { width: number; height: number; background: string } => ({ width, height, background: '#ffffff' })
  const lines = (count: number, line: string): string => Array.from({ length: count }, () => line).join('\n')
  const EPS = 1e-6

  function expectInside(doc: { width: number; height: number; background: string }, word: string, what: string): void {
    const look = newTextLook(doc, INKS, word)
    const box = estimatedTextBox(word, look.fontSize)
    expect(look.x, `${what}: left`).toBeGreaterThanOrEqual(0)
    expect(look.y, `${what}: top`).toBeGreaterThanOrEqual(0)
    expect(look.x + box.width, `${what}: right ${look.x + box.width} of ${doc.width}`).toBeLessThanOrEqual(doc.width + EPS)
    expect(look.y + box.height, `${what}: bottom ${look.y + box.height} of ${doc.height}`).toBeLessThanOrEqual(doc.height + EPS)
  }

  it('25 lines of 45 characters on the default 1200x800 page: the bottom is the page\'s, not 859 (size 32 fills the height, so the margin gives way to y 0)', () => {
    const word = lines(25, 'a'.repeat(45))
    const look = newTextLook(WHITE(1200, 800), INKS, word)
    expect(look.fontSize).toBe(32)
    expect(look.y).toBe(0)
    expect(look.x).toBe(PLACEMENT_MARGIN)
    expectInside(WHITE(1200, 800), word, '25 x 45 on 1200x800')
  })

  it('24 and 25 short lines on a 1080p and a 4K page keep their bottom on the page (they ended at 1092 and 1135 on the 1080p one)', () => {
    for (const [w, h] of [[1920, 1080], [3840, 2160]] as const) {
      for (const count of [24, 25]) expectInside(WHITE(w, h), lines(count, 'Line of text'), `${count} lines on ${w}x${h}`)
    }
    // (the numbers behind it: 25 lines at the 43 px the 1080p page fits is 1075 tall, so only 5 px of margin are left, not 60)
    expect(newTextLook(WHITE(1920, 1080), INKS, lines(25, 'Line of text'))).toMatchObject({ fontSize: 43, y: 5 })
  })

  it('a sweep: lines 1-60 x characters 1-300, on five page sizes, finds no box outside its page (a combination too big for the 1 px floor is not a placement and is skipped)', () => {
    const started = Date.now()
    // (a mix of the classes, so the estimate's widths are in play: a capital, a wide glyph, a digit, a lowercase and a space)
    const pattern = 'WaQ8m e'
    const lineOf = (n: number): string => pattern.repeat(Math.ceil(n / pattern.length)).slice(0, n)
    let checked = 0
    let skipped = 0
    for (const [w, h] of [[1200, 800], [1280, 720], [1920, 1080], [3840, 2160], [112, 112]] as const) {
      for (let count = 1; count <= 60; count += 3) {
        for (let chars = 1; chars <= 300; chars += 7) {
          const word = lines(count, lineOf(chars))
          const atOnePx = estimatedTextBox(word, 1)
          if (atOnePx.width > w || atOnePx.height > h) {
            skipped++
            continue
          }
          expectInside(WHITE(w, h), word, `${count} lines x ${chars} characters on ${w}x${h}`)
          checked++
        }
      }
    }
    expect(checked, 'most of the grid is a real placement').toBeGreaterThan(1500)
    expect(checked + skipped).toBe(5 * 20 * 43)
    // (the grid is 4,300 placements; this is here so a slow sweep is noticed, not to time the machine)
    expect(Date.now() - started).toBeLessThan(20_000)
  })

  it('a line that fills the page\'s width starts at the page\'s edge, not the margin: the right edge is the page\'s (a one-line text over 800 px wide)', () => {
    // (1000 'a' is 580 em: the width-fit size is 2, a box 1160 px wide on a 1200 px page, so the margin gives way to x 40)
    const word = 'a'.repeat(1000)
    const look = newTextLook(WHITE(1200, 800), INKS, word)
    const box = estimatedTextBox(word, look.fontSize)
    expect(box.width, 'a box wider than 800 px').toBeGreaterThan(800)
    expect(look.x).toBeCloseTo(40, 6)
    expect(look.x).toBe(Math.min(PLACEMENT_MARGIN, 1200 - box.width))
    expect(look.x + box.width).toBeLessThanOrEqual(1200 + EPS)
    // and one that cannot fit even at 1 px (300 characters on the 112 px emote is 180 px wide) starts at the edge, never left of it
    const wide = newTextLook(WHITE(112, 112), INKS, 'a'.repeat(300))
    expect(wide.fontSize).toBe(1)
    expect(wide.x).toBe(0)
    // ...and one too tall for it (200 lines on the same page) starts at the top edge, never above it
    const tall = newTextLook(WHITE(112, 112), INKS, lines(200, 'a'))
    expect(tall.fontSize).toBe(1)
    expect(tall.y).toBe(0)
  })

  it('control: a box up to 800 px on each side is placed exactly as `placementFor` placed it (the margin, less where the page has not the room)', () => {
    let compared = 0
    for (const [w, h] of [[1200, 800], [1280, 720], [1920, 1080], [3840, 2160], [112, 112]] as const) {
      for (let count = 1; count <= 30; count += 2) {
        for (let chars = 1; chars <= 60; chars += 3) {
          const word = lines(count, 'a'.repeat(chars))
          const look = newTextLook(WHITE(w, h), INKS, word)
          const box = estimatedTextBox(word, look.fontSize)
          if (box.width > 800 || box.height > 800 || box.width > w || box.height > h) continue
          const old = placementFor(box.width, box.height, w, h)
          expect({ x: look.x, y: look.y }, `${count} x ${chars} on ${w}x${h}`).toEqual({ x: old.x, y: old.y })
          compared++
        }
      }
    }
    expect(compared, 'a real sweep of small boxes').toBeGreaterThan(400)
  })
})

describe('estimatedTextBox is an upper bound per character (T-167 fold)', () => {
  const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
  const em = (ch: string): number => estimatedTextBox(ch, 100).width / 100
  const ceil2 = (n: number): number => Math.ceil(n * 100 - 1e-9) / 100
  /** The sum of the measured advances of `text` at a weight, in px at `size`: what a canvas would draw it at if no pair kerned. */
  const measured = (text: string, weight: 400 | 700, size = 100): number => [...text].reduce((sum, ch) => sum + measuredEm(ch, weight), 0) * size

  it('control: the table is the 95 printable ASCII characters at both weights, and the widest are the ones the ticket measured (W 98.5 at 400, 102.0 at 700)', () => {
    expect(INTER_400).toHaveLength(95)
    expect(INTER_700).toHaveLength(95)
    expect(measuredEm('W', 400)).toBeCloseTo(0.985, 3)
    expect(measuredEm('W', 700)).toBeCloseTo(1.02, 3)
    expect(measuredEm(' ', 400)).toBeCloseTo(0.281, 3)
    // ("Text" sums to about 2.1 em here, not the 2.02 the comment on the estimate gives for it drawn: `measureText` of one character cannot see the T-e kerning pair.)
  })

  it('no printable character is wider than the estimate, at 400 or at 700', () => {
    for (const ch of PRINTABLE) {
      for (const weight of [400, 700] as const) {
        expect(em(ch), `"${ch}" at ${weight}: measured ${measuredEm(ch, weight)} em`).toBeGreaterThanOrEqual(measuredEm(ch, weight))
      }
    }
  })

  it('each character is the wider of its two measured advances rounded UP to two decimals, and no more (so no entry is padded past what was measured)', () => {
    for (const ch of PRINTABLE) {
      expect(em(ch), `"${ch}": ${measuredEm(ch, 400)} / ${measuredEm(ch, 700)}`).toBeCloseTo(ceil2(Math.max(measuredEm(ch, 400), measuredEm(ch, 700))), 10)
    }
    // (the numbers, for whoever reads this: W 1.0200 -> 1.03, Q 0.7729 -> 0.78, "~" 0.6729 -> 0.68, "d" 0.6240 -> 0.63, "i" 0.2422 -> 0.27 (700), a space 0.2812 -> 0.29)
    expect([em('W'), em('Q'), em('~'), em('d'), em('i'), em(' ')]).toEqual([1.03, 0.78, 0.68, 0.63, 0.27, 0.29])
  })

  it('"WWWW MMMM" and an all-caps sentence are at least as wide as they measure at 400 and 700 (they were 0.6 em a character: 540 against 802 at 100 px)', () => {
    for (const text of ['WWWW MMMM', 'SUBSCRIBE NOW FOR MORE STREAMS', 'WE ARE LIVE IN FIVE MINUTES WITH MORE MAYHEM THAN WEMBLEY']) {
      for (const weight of [400, 700] as const) {
        expect(estimatedTextBox(text, 100).width, `"${text}" at ${weight}`).toBeGreaterThanOrEqual(measured(text, weight))
      }
    }
    expect(measured('WWWW MMMM', 700)).toBeGreaterThan(800)
  })

  it('an all-caps 90-character line sized to the page\'s width fits it as drawn, at 400 and at 700 (it was sized by 0.6 em a character and overhung by hundreds of px)', () => {
    const word = 'GOWNMOMWHOMEWOMENDOHAMMER'.repeat(4).slice(0, 90)
    expect(word).toHaveLength(90)
    const size = newTextSize(1280, 720, word)
    for (const weight of [400, 700] as const) {
      expect(measured(word, weight, size), `drawn at ${weight}, size ${size}`).toBeLessThanOrEqual(1280)
    }
    // (and the size is still the fitting one: a pixel more would not fit by the estimate)
    expect(estimatedTextBox(word, size + 1).width).toBeGreaterThan(1280)
  })

  it('a line is the sum of its characters\' widths, the longest line sets the width, and a character the table does not cover is 0.6 em', () => {
    expect(estimatedTextBox('Wa', 100).width).toBeCloseTo(103 + 58, 6)
    expect(estimatedTextBox('Wa\nQaaa', 100).width).toBeCloseTo(78 + 3 * 58, 6)
    expect(estimatedTextBox('\u{1F600}', 100).width, 'an emoji is a single character of the fallback width').toBeCloseTo(60, 6)
    expect(estimatedTextBox('\u00C9', 100).width, 'so is an accented capital').toBeCloseTo(60, 6)
  })

  it('"Text", the default word, is 2.20 em: narrower than the 2.4 em of the flat 0.6 estimate (and than the 2.58 of a class estimate, which left the POG emote\'s band no room)', () => {
    expect(estimatedTextBox('Text', 100).width).toBeCloseTo(220, 6)
  })
})
