/**
 * How a new "+ Add text" layer first appears on the Stream Graphics canvas (T-140 (2)): its size, where it is, and what color.
 *
 * It was `makeTextLayer(120, 120)` - 32 px text in the app's near-black at a fixed point - whatever the document: wholly off the 112x112 emote (selected and
 * invisible), 1.00 to 1.11:1 against every template background (#120c0c, #241614, transparent), and a speck on a 3840 px overlay. Where a layer first lands is a fact
 * about the document it lands on, as a picture's is (`placementFor`, `@shared/imageBounds`); these are the three rules, pure, and `canvasStore.textLayerFor` hands them
 * the open document and the app's own tokens (this module takes its colors from its caller, so no hex lives here).
 *
 * T-141 (2): "the document it lands on" is the document AND what is drawn on it. The ink was chosen against the document's background alone, and on the emotes (a transparent
 * document, a disc that fills it) the word was inked for the dark workspace and landed on the disc: 1.33:1 on the gold one, 2.92:1 on the red one. `surfacesUnder` says what
 * can show under a box, `inkFor` takes that list, and `newTextLook` moves the word to the first of a fixed list of places where one ink reads against all of it.
 */
import { PLACEMENT_MARGIN } from './imageBounds'
import { resolveOverlayColor } from './overlayColors'
import { assert } from './assert'
import { displayOpacity, type CanvasLayer } from './canvas'

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
 * A character's width as a share of the font size, for the estimate: an UPPER bound for that character (T-167), the direction that matters (a layer placed by an estimate that was too
 * narrow could poke past the edge; one placed by an estimate that is too wide is a few px short of where it could be). Konva sizes a one-line Text `fontSize` tall.
 *
 * It was one number for every character, 0.6 em, called an upper bound on the strength of Inter's average advance (about 0.5 em; "Text" drawn measures 2.02 em, 64.7 px at 32 px). It is
 * not one for capitals: an all-caps sentence measured 0.607 em a character at 400 and 0.614 at 700, "WWWW MMMM" 0.87, so a long all-caps line sized to the page's width overhung its right
 * edge by 20-80 px; and it was short for 46 of the 94 printable characters at 400 and 51 at 700 (the widest: W 0.985 / 1.020, % 0.982 / 1.004, @ 0.966 / 0.999, M 0.903 / 0.922,
 * m 0.876 / 0.900, w 0.818 / 0.839, Q 0.765 / 0.773 at 400 / 700, and every digit but 1, 5 and 7 at 400 up to 0.666). Each entry below is the advance MEASURED in the built app (a canvas
 * 2d context, `ctx.font = '<weight> 100px Inter'` after `document.fonts.ready`, `measureText` of the one character), the wider of 400 and 700, rounded UP to two decimals;
 * `newText.test.ts` holds the whole measured table and holds every entry to it. A sum of single advances ignores kerning, which narrows Inter's Latin pairs ("Text" draws at 2.02 em, its characters sum to 2.10), so it is an upper bound for the line.
 *
 * Per character, not per class (the first cut was five classes: W M m w % @ 1.03, other capitals 0.78, digits and ~ < > = + & $ # 0.68, b d g p q u h n o 0.63, the rest 0.6): "Text" is
 * 2.58 em by classes (a capital T at 0.78 beside three letters at 0.6) against 2.20 here, and the POG emote's band under its word has room for about 2.4 em (the disc's chord at the
 * word's bottom edge, less its stroke), so the classes put "+ Add text" on the stroke and then light on gold (image.spec.ts, "+ Add text is readable against what is drawn under it").
 *
 * Index = character code - 32 (space to `~`). A character outside printable ASCII (an accented capital, CJK, an emoji) takes `EM_UNMEASURED`, which is an estimate, not a bound.
 */
const ADVANCE_EM = [
  0.29, 0.33, 0.53, 0.65, 0.66, 1.01, 0.67, 0.33, 0.38, 0.38, 0.54, 0.68,
  0.32, 0.47, 0.32, 0.38, 0.66, 0.43, 0.63, 0.64, 0.67, 0.62, 0.64, 0.58,
  0.65, 0.64, 0.32, 0.33, 0.68, 0.68, 0.68, 0.55, 1.00, 0.73, 0.66, 0.74,
  0.73, 0.61, 0.60, 0.75, 0.75, 0.28, 0.58, 0.71, 0.57, 0.93, 0.76, 0.77,
  0.65, 0.78, 0.66, 0.66, 0.67, 0.75, 0.73, 1.03, 0.72, 0.72, 0.66, 0.38,
  0.38, 0.38, 0.49, 0.47, 0.36, 0.58, 0.63, 0.59, 0.63, 0.60, 0.39, 0.63,
  0.62, 0.27, 0.27, 0.57, 0.27, 0.91, 0.62, 0.61, 0.63, 0.63, 0.40, 0.55,
  0.36, 0.62, 0.59, 0.84, 0.57, 0.59, 0.57, 0.46, 0.36, 0.46, 0.68
] as const

/** What a character outside printable ASCII is taken to be: the old flat estimate. */
const EM_UNMEASURED = 0.6

/** The width of one character as a share of the font size. */
function emOf(ch: string): number {
  return ADVANCE_EM[(ch.codePointAt(0) as number) - 32] ?? EM_UNMEASURED
}

/**
 * The box, in document px, `text` is estimated to take at `fontSize`: never narrower than what is drawn. It is LINE-AWARE (T-166 (1)): as wide as the longest line (a break is
 * `\n` or `\r\n`, which is what a Windows clipboard carries) and a `fontSize` tall for each line, which is how Konva draws a Text (line height 1, width the longest line's). A line is
 * as wide as its characters' advances add up to (T-167): an upper bound per character, so a line of capitals or digits is not taken for one of lowercase.
 */
export function estimatedTextBox(text: string, fontSize: number): { width: number; height: number } {
  assert(Number.isFinite(fontSize) && fontSize > 0, `estimatedTextBox expects a size above 0, got ${fontSize}`)
  const lines = text.split(/\r?\n/)
  // (a reduce, not `Math.max(...)`: a paste can be hundreds of thousands of lines, more than a call takes as arguments)
  const longest = lines.reduce((most, line) => {
    let em = 0
    for (const ch of line) em += emOf(ch)
    return Math.max(most, em)
  }, 0)
  return { width: longest * fontSize, height: lines.length * fontSize }
}

/**
 * The font size of a new text layer on a `docWidth` x `docHeight` document: `DEFAULT_TEXT_SIZE` in proportion to the shorter side against the default page's (so
 * 1200x800 stays 32 px, a 1080p overlay is 43 and a 4K one 86), never under `MIN_NEW_TEXT_SIZE`, and never so big that the word is wider or taller than the document
 * (a 30 px strip gets the size that fits, not the floor). T-166 (1): "the word" is the whole text, so a pasted two-line title is fitted by its height too. A document that is not a size (NaN, infinite, zero or negative: a project file the editor never made)
 * leaves the old 32 px.
 */
export function newTextSize(docWidth: number, docHeight: number, word: string = NEW_TEXT_WORD): number {
  const isSize = Number.isFinite(docWidth) && Number.isFinite(docHeight) && docWidth > 0 && docHeight > 0
  if (!isSize) return DEFAULT_TEXT_SIZE
  const proportional = Math.round((DEFAULT_TEXT_SIZE * Math.min(docWidth, docHeight)) / TEXT_REFERENCE_SIDE)
  // simplification: a long paragraph is sized DOWN to fit, one canvas line per line it has - there is no wrap, so a pasted paragraph of a few hundred characters gets a small
  // size. The upgrade is a wrap width on text layers (the box would then be a width and the lines it wraps to).
  const box = estimatedTextBox(word, 1)
  const fits = Math.floor(Math.min(docWidth / box.width, docHeight / box.height))
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

/** The least contrast a new word is held to against everything drawn under it: WCAG AA for normal text, the bar every token pairing in the app clears. */
export const READABLE_CONTRAST = 4.5

/** A surface as `inkFor` reads it: a name, `#rgb`, `#rrggbb` (with or without the `#`); `transparent`, an `rgba()` and anything else show `behind`, so they count as dark. */
function surfaceColor(surface: unknown, inks: TextInks): string {
  // (`typeof`: a project file is read, not made by the editor, and a canvas document with no background at all opens and draws.)
  return (typeof surface === 'string' ? resolveOverlayColor(surface) : null) ?? inks.behind
}

/** The worst (lowest) WCAG contrast `ink` has against any of `surfaces`; against no surface at all it is against `inks.behind`. */
export function worstContrast(ink: string, surfaces: string | readonly string[], inks: TextInks): number {
  // (a canvas document with no background at all opens and draws, so the one-surface form takes whatever it is given)
  const list = Array.isArray(surfaces) ? (surfaces as readonly string[]) : [surfaces as string]
  const resolved = list.length === 0 ? [inks.behind] : list.map((s) => surfaceColor(s, inks))
  assert(HEX6.test(ink) && HEX6.test(inks.behind), 'worstContrast expects a #rrggbb ink and a #rrggbb workspace color')
  return Math.min(...resolved.map((s) => contrastRatio(ink, s)))
}

/**
 * The ink for text over these surfaces (T-141 (2)): whichever of `dark` and `light` has the better WORST contrast against any of them (maximin), a tie going to `dark`
 * (the long-standing default). One surface can be given as a string, which is how the document's background alone was judged (T-140 (2)); a word that lands on several
 * (the document, and the shapes under it) is judged against all of them, because a light ink on a gold disc is 1.3:1 however dark the document around the disc is.
 * Each is read as the overlay editor reads a color (a name, `#rgb`, `#rrggbb`, with or without the `#`); `transparent` and anything else (an `rgba()`, a gradient, a
 * hand-edited project's garbage) show `behind`, so they count as dark, which the workspace behind an overlay is and most scenes an overlay sits on are. Against a white
 * page that is the near-black at 19.4:1; against #120c0c, #241614 or transparent the light ink at 13:1 or better. Only a grey between #686868 and #797979 leaves both inks
 * under 4.5:1 (the better is 3.95 at worst), and a person cannot pick one: no control sets the background.
 */
export function inkFor(surfaces: string | readonly string[], inks: TextInks): string {
  assert(HEX6.test(inks.dark) && HEX6.test(inks.light) && HEX6.test(inks.behind), 'inkFor expects #rrggbb inks and a #rrggbb workspace color')
  return worstContrast(inks.dark, surfaces, inks) >= worstContrast(inks.light, surfaces, inks) ? inks.dark : inks.light
}

type Rgb = readonly [number, number, number]

function rgbOf(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hexOf(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

/** `top` laid over `under` at `alpha` (0 to 1), channel by channel as the canvas mixes them. */
function over(under: Rgb, top: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => (under[i] as number) * (1 - alpha) + (top[i] as number) * alpha) as unknown as Rgb
}

const RGBA = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i

/** What a fill draws: its color and how much of it, or null when it draws nothing (`transparent`, a gradient, a spelling nothing reads). Shapes use `rgba()` as well as hex. */
function paintOf(fill: unknown): { rgb: Rgb; alpha: number } | null {
  if (typeof fill !== 'string') return null
  const rgba = RGBA.exec(fill.trim())
  if (rgba) {
    const alpha = rgba[4] === undefined ? 1 : Math.min(1, Number(rgba[4]))
    return alpha > 0 ? { rgb: [1, 2, 3].map((i) => Math.min(255, Number(rgba[i]))) as unknown as Rgb, alpha } : null
  }
  const hex = resolveOverlayColor(fill)
  return hex ? { rgb: rgbOf(hex), alpha: 1 } : null
}

/** A box in document px. */
interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Does the document point (px, py) fall inside this layer's drawn area? `width` x `height` is the box of a rectangle or of a text layer's words; an ellipse uses its radii. The
 * point is taken into the layer's own units the way Konva places a node: translate to its x, y, rotate (degrees), then scale. Built once per layer, called for every sample.
 * (A point on a far edge is outside: a word that ends where a shape begins does not touch it.)
 */
function coverageOf(layer: CanvasLayer, extent: { width: number; height: number } | null): (px: number, py: number) => boolean {
  const rad = (layer.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const ellipse = layer.type === 'ellipse' ? layer : null
  return (px, py) => {
    const dx = px - layer.x
    const dy = py - layer.y
    const lx = (dx * cos + dy * sin) / layer.scaleX
    const ly = (-dx * sin + dy * cos) / layer.scaleY
    if (ellipse) return (lx / ellipse.radiusX) ** 2 + (ly / ellipse.radiusY) ** 2 <= 1
    return extent !== null && lx >= 0 && lx < extent.width && ly >= 0 && ly < extent.height
  }
}

/** How many points of a word's box `surfacesUnder` looks at, across and down (the corners and edges included). */
const SAMPLES_ACROSS = 17
const SAMPLES_DOWN = 7

/**
 * Every color that can show under `box`: what the document draws there, as `#rrggbb` (T-141 (2)).
 *
 * The ink used to be chosen against the document's background alone, so on both emote templates (a transparent document with a disc that fills it) the light ink landed on
 * the disc at 1.33:1, and on the Bold thumbnail it landed on the sample title. A word is read against what is DRAWN where it sits. This walks a grid of points over the box
 * and, at each, lays the shapes' fills over the document in layer order: a rectangle or an ellipse by its own geometry (so the emote's corners outside the disc are still the
 * document), through its `rgba()` alpha and its layer's opacity; then each text layer whose estimated box covers the point, as a second color there (glyphs are partial:
 * both a letter and what is between the letters can show). Hidden layers draw nothing. Pure geometry: nothing is rendered or measured.
 */
export function surfacesUnder(doc: { background: string; layers?: readonly CanvasLayer[] }, box: Box, behind: string): string[] {
  assert(HEX6.test(behind), 'surfacesUnder expects a #rrggbb workspace color')
  const ground = rgbOf((typeof doc.background === 'string' ? resolveOverlayColor(doc.background) : null) ?? behind)
  interface Drawn {
    covers: (px: number, py: number) => boolean
    rgb: Rgb
    alpha: number
  }
  const shapes: Drawn[] = []
  const words: Drawn[] = []
  for (const layer of doc.layers ?? []) {
    if (!layer.visible) continue
    const paint = layer.type === 'rect' || layer.type === 'ellipse' || layer.type === 'text' ? paintOf(layer.fill) : null
    // (a hint's words are drawn dimmed: `displayOpacity`, the one rule the canvas draws by)
    const alpha = paint ? paint.alpha * displayOpacity(layer) : 0
    if (!paint || !(alpha > 0)) continue
    if (layer.type === 'rect') {
      shapes.push({ covers: coverageOf(layer, layer), rgb: paint.rgb, alpha })
    } else if (layer.type === 'ellipse') {
      shapes.push({ covers: coverageOf(layer, null), rgb: paint.rgb, alpha })
    } else if (layer.type === 'text' && Number.isFinite(layer.fontSize) && layer.fontSize > 0 && typeof layer.text === 'string') {
      // (Konva's line height is 1 and its width is the longest line's: `estimatedTextBox`)
      words.push({ covers: coverageOf(layer, estimatedTextBox(layer.text, layer.fontSize)), rgb: paint.rgb, alpha })
    }
  }
  // simplification: the ceilings of a pure answer, each making it a little kinder than the pixels. A picture is not a surface (its pixels are not in the store: `src` is a
  // data URL the canvas decodes, and this runs synchronously at the press); a stroke and a rectangle's rounded corner are not drawn into the fill; a closed line has no fill
  // to draw; a gradient or an unreadable fill counts as nothing. And the box is SAMPLED, not intersected: 17 columns x 7 rows, a point every width/16 across and height/6
  // down with both edges included. The guarantee is that a shape covering a patch of the box at least that big (width/16 by height/6) is seen wherever it sits, the
  // interior included (an edge-only grid would miss a badge in the middle: `newText.test.ts` sweeps a patch of exactly that size across the whole box); a thinner or smaller
  // feature (a hairline bar, a dot under a sixteenth of the word's width) can fall between two points and be missed. The upgrade is to intersect each shape's bounds with the
  // box exactly (rectangle against rectangle, rectangle and ellipse against the box) instead of sampling, and to decode the stored copy of a picture; what covers the gap
  // meanwhile is the Color field in Properties.
  const seen = new Set<string>()
  for (let i = 0; i < SAMPLES_ACROSS; i++) {
    for (let j = 0; j < SAMPLES_DOWN; j++) {
      const px = box.x + (box.width * i) / (SAMPLES_ACROSS - 1)
      const py = box.y + (box.height * j) / (SAMPLES_DOWN - 1)
      let under = ground
      for (const shape of shapes) if (shape.covers(px, py)) under = over(under, shape.rgb, shape.alpha)
      seen.add(hexOf(under))
      for (const word of words) if (word.covers(px, py)) seen.add(hexOf(over(under, word.rgb, word.alpha)))
    }
  }
  return [...seen]
}

/** What a new text layer starts as, on a document. */
export interface NewTextLook {
  x: number
  y: number
  fontSize: number
  fill: string
}

/** The most places along one side the last-resort scan tries: the grid is never more than about 60 x 60, whatever the document's size or shape. */
const SCAN_PLACES_PER_SIDE = 60

/**
 * Where a word of this `size` is tried, in order (T-141 (2)):
 *   1. the place a picture starts: `PLACEMENT_MARGIN` in from the top-left corner, less when the document has not the room - for the word's REAL box (T-167 (1));
 *   2. the same margin in from each of the other three corners: top-right, bottom-left, bottom-right;
 *   3. every place on a grid anchored at (1), nearest to it first. A crowded document has no free corner (the POG emote is a disc filled by one big word: the only room is the
 *      band under the word, 6 px wide at the disc's chord), so the corners alone cannot place a word on it; a grid at about 1/60 of the document's sides (2 px on the
 *      emote) finds the nearest place where the word is readable, and costs at most 3,700 tries, each a few hundred point tests, only when the corners all failed.
 * A document that is not a size (a project file the editor never made) has the first place only.
 */
function candidatePlaces(size: { width: number; height: number }, doc: { width: number; height: number }): Array<{ x: number; y: number }> {
  const isSize = Number.isFinite(doc.width) && Number.isFinite(doc.height) && doc.width > 0 && doc.height > 0
  // T-167 (1): the margin rule on the word's REAL box. `placementFor` is a PICTURE rule - it first shrinks a box to LAYER_DRAWN_MAX_DIM (800 px), which is right for a picture the canvas
  // then draws that small and wrong for a word, whose box is never shrunk (it is sized to fit): a box over 800 px on a side got its margin from the shrunken box and its real bottom
  // overhung the page (25 lines on 1200x800 ended at 859). For a box up to 800 px this is exactly what `placementFor` gave (`newText.test.ts` sweeps that), so a one-word or one-line
  // placement does not move; a document that is not a size keeps the corner `placementFor` returned for it.
  const home = isSize
    ? { x: Math.max(0, Math.min(PLACEMENT_MARGIN, doc.width - size.width)), y: Math.max(0, Math.min(PLACEMENT_MARGIN, doc.height - size.height)) }
    : { x: PLACEMENT_MARGIN, y: PLACEMENT_MARGIN }
  if (!isSize) return [home]
  const maxX = doc.width - size.width
  const maxY = doc.height - size.height
  const right = maxX - home.x
  const bottom = maxY - home.y
  const places = [home, { x: right, y: home.y }, { x: home.x, y: bottom }, { x: right, y: bottom }]
  const stepX = Math.max(2, Math.ceil(doc.width / SCAN_PLACES_PER_SIDE))
  const stepY = Math.max(2, Math.ceil(doc.height / SCAN_PLACES_PER_SIDE))
  const grid: Array<{ x: number; y: number }> = []
  for (let y = home.y % stepY; y <= maxY; y += stepY) {
    for (let x = home.x % stepX; x <= maxX; x += stepX) grid.push({ x, y })
  }
  const away = (p: { x: number; y: number }): number => Math.hypot(p.x - home.x, p.y - home.y)
  return [...places, ...grid.sort((a, b) => away(a) - away(b))]
}

/**
 * Size, place and ink for a new text layer on `doc`: the size from `newTextSize`; the position by the margin rule a picture follows (`PLACEMENT_MARGIN` in
 * from the corner when the document has the room and less when it does not) on the word's own estimated box (T-167 (1)), so it is wholly inside; the ink from `inkFor`.
 *
 * T-141 (2): the ink is chosen against what is under the word (`surfacesUnder`: the document, and the shapes and words its box overlaps), not the document alone, and when
 * neither ink reaches `READABLE_CONTRAST` against all of it the word moves, through `candidatePlaces` in order, to the first place where one does. When none does (a
 * document with nothing but mid greys under every place), the place whose better ink is best, the first of a tie: a crowded document never leaves the word worse off than
 * the corner it started at.
 */
export function newTextLook(
  doc: { width: number; height: number; background: string; layers?: readonly CanvasLayer[] },
  inks: TextInks,
  word: string = NEW_TEXT_WORD
): NewTextLook {
  const fontSize = newTextSize(doc.width, doc.height, word)
  assert(fontSize >= 1, `a new text layer has a size of at least 1 px, got ${fontSize}`)
  const size = estimatedTextBox(word, fontSize)
  let best: NewTextLook | null = null
  let bestWorst = -Infinity
  for (const at of candidatePlaces(size, doc)) {
    const surfaces = surfacesUnder(doc, { ...at, ...size }, inks.behind)
    const fill = inkFor(surfaces, inks)
    const worst = worstContrast(fill, surfaces, inks)
    if (worst >= READABLE_CONTRAST) return { x: at.x, y: at.y, fontSize, fill }
    if (worst > bestWorst) {
      best = { x: at.x, y: at.y, fontSize, fill }
      bestWorst = worst
    }
  }
  // (`candidatePlaces` always holds the first place, so there is a best)
  return best as NewTextLook
}
