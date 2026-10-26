/**
 * How a new "+ Add text" layer first appears on the Stream Graphics canvas (T-140 (2)): its size, where it is, and what color.
 *
 * It was `makeTextLayer(120, 120)` - 32 px text in the app's near-black at a fixed point - whatever the document: wholly off the 112x112 emote (selected and
 * invisible), 1.00 to 1.11:1 against every template background (#120c0c, #241614, transparent), and a speck on a 3840 px overlay. Where a layer first lands is a fact
 * about the document it lands on, as a picture's is (`placementFor`, `@shared/imageBounds`); these are the three rules, pure, and `canvasStore.textLayerFor` hands them
 * the open document and the app's own tokens (this module takes its colors from its caller, so no hex lives here).
 */
import { placementFor } from './imageBounds'
import { resolveOverlayColor } from './overlayColors'
import { assert } from './assert'

/** The size a new text layer has always had (px of the document), and still has on the default blank page. */
export const DEFAULT_TEXT_SIZE = 32

/** The shorter side of the document `DEFAULT_TEXT_SIZE` was chosen for: the default blank page, 1200x800. The size scales from here. */
const TEXT_REFERENCE_SIDE = 800

/**
 * The least a new text layer is (px): below this the proportional rule is a speck, and a 112 px emote would get 4. "Text" at 20 px is about 43 px wide, a little over a
 * third of the emote and clear of its edges.
 */
export const MIN_NEW_TEXT_SIZE = 20

/** The word a new text layer holds. */
export const NEW_TEXT_WORD = 'Text'

/**
 * A character's width as a share of the font size, for the estimate. Inter's average advance is about 0.5 em ("Text" measures 2.02 em, 64.7 px at 32 px, in the shipped
 * font), so 0.6 is an UPPER bound: a word that fits by the estimate fits as drawn, which is the direction that matters (a layer placed by an estimate that was too
 * narrow could poke past the edge; one placed by an estimate that is too wide is a few px short of where it could be). Konva sizes a one-line Text `fontSize` tall.
 */
const TEXT_EM_PER_CHAR = 0.6

/** The box, in document px, `text` is estimated to take at `fontSize`: never narrower than what is drawn. */
export function estimatedTextBox(text: string, fontSize: number): { width: number; height: number } {
  assert(Number.isFinite(fontSize) && fontSize > 0, `estimatedTextBox expects a size above 0, got ${fontSize}`)
  return { width: [...text].length * TEXT_EM_PER_CHAR * fontSize, height: fontSize }
}

/**
 * The font size of a new text layer on a `docWidth` x `docHeight` document: `DEFAULT_TEXT_SIZE` in proportion to the shorter side against the default page's (so
 * 1200x800 stays 32 px, a 1080p overlay is 43 and a 4K one 86), never under `MIN_NEW_TEXT_SIZE`, and never so big that the word is wider or taller than the document
 * (a 30 px strip gets the size that fits, not the floor). A document that is not a size (NaN, infinite, zero or negative: a project file the editor never made)
 * leaves the old 32 px.
 */
export function newTextSize(docWidth: number, docHeight: number, word: string = NEW_TEXT_WORD): number {
  const isSize = Number.isFinite(docWidth) && Number.isFinite(docHeight) && docWidth > 0 && docHeight > 0
  if (!isSize) return DEFAULT_TEXT_SIZE
  const proportional = Math.round((DEFAULT_TEXT_SIZE * Math.min(docWidth, docHeight)) / TEXT_REFERENCE_SIDE)
  const fits = Math.floor(Math.min(docWidth / estimatedTextBox(word, 1).width, docHeight))
  return Math.max(1, Math.min(Math.max(proportional, MIN_NEW_TEXT_SIZE), fits))
}

function channelLuminance(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG 2 relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channelLuminance((n >> 16) & 255) + 0.7152 * channelLuminance((n >> 8) & 255) + 0.0722 * channelLuminance(n & 255)
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** WCAG 2 contrast ratio between two `#rrggbb` colors (1 to 21), whichever is lighter. */
export function contrastRatio(a: string, b: string): number {
  assert(HEX6.test(a) && HEX6.test(b), `contrastRatio expects #rrggbb colors, got ${a} and ${b}`)
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** The colors the ink is chosen from: the app's tokens, handed in by the caller. */
export interface TextInks {
  /** The ink for a light surface (the near-black token). */
  dark: string
  /** The ink for a dark surface (the light ink token). */
  light: string
  /** What a `transparent` (or unreadable) document background shows: the dark workspace behind the canvas. */
  behind: string
}

/**
 * The ink for text on a document with this `background`: whichever of `dark` and `light` has the better WCAG contrast against what the document shows, a tie going to
 * `dark` (the long-standing default). The background is read as the overlay editor reads a color (a name, `#rgb`, `#rrggbb`, with or without the `#`); `transparent` and
 * anything else (an `rgba()`, a gradient, a hand-edited project's garbage) show `behind`, so they count as dark, which the workspace behind an overlay is and most scenes
 * an overlay sits on are. Against a white page that is the near-black at 19.4:1; against #120c0c, #241614 or transparent the light ink at 13:1 or better. Only a grey
 * between #686868 and #797979 leaves both inks under 4.5:1 (the better is 3.95 at worst), and a person cannot pick one: no control sets the background.
 */
export function inkFor(background: string, inks: TextInks): string {
  // (`typeof`: a project file is read, not made by the editor, and a canvas document with no background at all opens and draws.)
  const surface = (typeof background === 'string' ? resolveOverlayColor(background) : null) ?? inks.behind
  assert(HEX6.test(surface) && HEX6.test(inks.dark) && HEX6.test(inks.light), 'inkFor expects #rrggbb inks and a #rrggbb workspace color')
  return contrastRatio(inks.dark, surface) >= contrastRatio(inks.light, surface) ? inks.dark : inks.light
}

/** What a new text layer starts as, on a document. */
export interface NewTextLook {
  x: number
  y: number
  fontSize: number
  fill: string
}

/**
 * Size, place and ink for a new text layer on `doc`: the size from `newTextSize`; the position from `placementFor` - the rule a picture follows, `PLACEMENT_MARGIN` in
 * from the corner when the document has the room and less when it does not - using the word's estimated box, so it is wholly inside; the ink from `inkFor`.
 */
export function newTextLook(doc: { width: number; height: number; background: string }, inks: TextInks, word: string = NEW_TEXT_WORD): NewTextLook {
  const fontSize = newTextSize(doc.width, doc.height, word)
  assert(fontSize >= 1, `a new text layer has a size of at least 1 px, got ${fontSize}`)
  const box = estimatedTextBox(word, fontSize)
  const { x, y } = placementFor(box.width, box.height, doc.width, doc.height)
  return { x, y, fontSize, fill: inkFor(doc.background, inks) }
}
