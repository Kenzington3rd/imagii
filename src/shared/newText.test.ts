import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TEXT_SIZE,
  MIN_NEW_TEXT_SIZE,
  contrastRatio,
  estimatedTextBox,
  inkFor,
  newTextLook,
  newTextSize
} from './newText'
import { PLACEMENT_MARGIN } from './imageBounds'

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
