import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import tailwindConfig from '../../tailwind.config.js'
import { RENDERER_ROOT } from './routeSources'
import { sourceFilesUnder } from './renderedStrings'
import { CANVAS_TEMPLATES } from '../../src/renderer/src/modules/image-studio/templates'
import {
  makeEllipseLayer,
  makeImageLayer,
  makeLineLayer,
  makeRectLayer,
  makeReferenceLayer,
  makeTextLayer,
  textLayerFor,
  useCanvasStore
} from '../../src/renderer/src/modules/image-studio/state/canvasStore'
import {
  BG_BASE,
  BG_ELEVATED,
  BG_HOVER,
  ACCENT,
  ACCENT_MUTED,
  EMBER,
  INK_BASE,
  INK_MUTED,
  INK_DIM,
  DANGER,
  DANGER_SOFT,
  DANGER_STRONG,
  WARN,
  OK,
  OK_STRONG,
  SIGNAL_PINK,
  SIGNAL_CYAN,
  withAlpha
} from '../../src/renderer/src/styles/tokens'

/**
 * Round 19: tailwind.config.js cannot import the TS tokens module, so the
 * palette exists in two files by necessity. This test is the drift gate.
 */
interface ThemeColors {
  bg: { base: string; elevated: string; hover: string }
  accent: { DEFAULT: string; muted: string }
  ink: { base: string; muted: string; dim: string }
  ember: string
  danger: { DEFAULT: string; soft: string; strong: string }
  warn: string
  ok: { DEFAULT: string; strong: string }
  signal: { pink: string; cyan: string }
}

const colors = (tailwindConfig as { theme: { extend: { colors: ThemeColors } } }).theme.extend
  .colors

describe('design tokens stay in sync (tokens.ts vs tailwind.config.js)', () => {
  it('backgrounds match', () => {
    expect(colors.bg.base).toBe(BG_BASE)
    expect(colors.bg.elevated).toBe(BG_ELEVATED)
    expect(colors.bg.hover).toBe(BG_HOVER)
  })

  it('accents match', () => {
    expect(colors.accent.DEFAULT).toBe(ACCENT)
    expect(colors.accent.muted).toBe(ACCENT_MUTED)
  })

  it('inks match', () => {
    expect(colors.ink.base).toBe(INK_BASE)
    expect(colors.ink.muted).toBe(INK_MUTED)
    expect(colors.ink.dim).toBe(INK_DIM)
  })

  // T-56: `bg-ember` is what the Timeline playhead is drawn with, so the
  // className half of the ember token has to exist and has to match.
  it('the ember highlight matches', () => {
    expect(colors.ember).toBe(EMBER)
  })

  // T-71: the semantic tier is consumed almost entirely through classNames,
  // so the tailwind half is the one that can silently vanish — a typo in a
  // key name just makes `text-danger` resolve to nothing and the label
  // renders in inherited ink. Pin both halves like the rest of the palette.
  it('the danger tier matches', () => {
    expect(colors.danger.DEFAULT).toBe(DANGER)
    expect(colors.danger.soft).toBe(DANGER_SOFT)
    expect(colors.danger.strong).toBe(DANGER_STRONG)
  })

  it('warn matches', () => {
    expect(colors.warn).toBe(WARN)
  })

  it('the ok tier matches', () => {
    expect(colors.ok.DEFAULT).toBe(OK)
    expect(colors.ok.strong).toBe(OK_STRONG)
  })

  // T-104: the two categorical marks that used to be raw hex in HighlightPanel
  // and SafeZoneOverlay. Used from JS (inline style, SVG stroke), so the
  // tailwind half could silently drift or vanish with nothing drawing it.
  it('the signal pair matches', () => {
    expect(colors.signal.pink).toBe(SIGNAL_PINK)
    expect(colors.signal.cyan).toBe(SIGNAL_CYAN)
  })

  it('the signal pair is its own two colors: not the ember hex, not each other', () => {
    expect(SIGNAL_PINK).not.toBe(EMBER)
    expect(SIGNAL_CYAN).not.toBe(EMBER)
    expect(SIGNAL_PINK).not.toBe(SIGNAL_CYAN)
    // Three series share the crop-guide overlay (9:16, 1:1, 4:5): no two may share a hue,
    // or the guides cannot be told apart. (T-112: there used to be a fourth, 16:9, in
    // ACCENT — a color for a guide no caller ever drew. It is gone with its pin.)
    expect(new Set([SIGNAL_PINK, EMBER, SIGNAL_CYAN]).size).toBe(3)
  })

  // T-112: dead data. The guides' color table held a 16:9 entry (and the ratio table a
  // 16:9 shape) that Player never asked for; the guide, the palette claim and the type
  // said four guides while the screen drew three.
  it('the crop-guide overlay carries exactly the three guides it draws', () => {
    const src = code(path.join(RENDERER_ROOT, 'modules', 'video-studio', 'SafeZoneOverlay.tsx'))
    expect(src).not.toMatch(/['"]16:9['"]/)
    expect(src).not.toMatch(/\bACCENT\b/)
    for (const ratio of ['9:16', '1:1', '4:5']) expect(src).toContain(`'${ratio}'`)
    const player = code(path.join(RENDERER_ROOT, 'modules', 'video-studio', 'Player.tsx'))
    expect(player).toMatch(/ratios=\{\['9:16', '1:1', '4:5'\]\}/)
  })

  /**
   * T-71's one deliberate omission. Every amber-400 surface in the app moved
   * onto `ember` rather than a new `warn.strong`, because the two values are
   * the same color — and two names for one hex is the drift this whole file
   * exists to prevent. If a future retheme wants them to differ, that is a
   * real decision: mint the token, migrate the sites, and delete this test.
   */
  it('has no second name for the ember hex', () => {
    expect(WARN).not.toBe(EMBER)
    const others = Object.entries(
      colors as unknown as Record<string, string | Record<string, string>>
    )
      .filter(([name]) => name !== 'ember')
      .flatMap(([, value]) => (typeof value === 'string' ? [value] : Object.values(value)))
    expect(others).not.toContain(EMBER)
  })
})

/** A source file with its comments removed: these pins are about what the code DOES, and a
 *  comment that explains a removal has to be free to name what it removed. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** WCAG relative-luminance contrast — pins the palette's AA claims. */
function luminance(hex: string): number {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi as number) + 0.05) / ((lo as number) + 0.05)
}

/** `fg` at `alpha` composited over opaque `bg` — what a `/25` fill really is. */
function over(fg: string, bg: string, alpha: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const mixed = [0, 1, 2].map((i) =>
    Math.round(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i))
  )
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

describe('palette contrast stays WCAG AA', () => {
  it('accent is readable on both backgrounds', () => {
    expect(contrast(ACCENT, BG_BASE)).toBeGreaterThan(4.5)
    expect(contrast(ACCENT, BG_ELEVATED)).toBeGreaterThan(4.5)
  })

  it('dark text is readable on filled accent buttons', () => {
    expect(contrast(BG_BASE, ACCENT)).toBeGreaterThan(4.5)
  })

  it('every ink tier is readable on both backgrounds', () => {
    for (const ink of [INK_BASE, INK_MUTED, INK_DIM]) {
      expect(contrast(ink, BG_BASE)).toBeGreaterThan(4.5)
      expect(contrast(ink, BG_ELEVATED)).toBeGreaterThan(4.5)
    }
  })

  /**
   * T-56 — the Timeline playhead. It is drawn on the bare `bg-hover` track
   * AND across the selected clip's `bg-accent/25` fill, so it has to clear
   * AA against the fill as well as the track. (The `bg-pink-400` it replaced
   * managed 6.3:1 and 4.63:1 — passing, but on a raw palette color that no
   * retheme would ever have found.)
   */
  it('the playhead stays readable on the track AND on the clip range', () => {
    expect(contrast(EMBER, BG_HOVER)).toBeGreaterThan(4.5)
    expect(contrast(EMBER, over(ACCENT, BG_HOVER, 0.25))).toBeGreaterThan(4.5)
  })

  /**
   * T-71 — the semantic tier. Every one of these is a pairing that exists on
   * screen today, not a hypothetical: danger/warn/ok text sits on the three
   * app surfaces, and three of them sit on a wash of their OWN strong tone
   * (HookIndicator's three badges, CaptionsPanel's setup notice,
   * AutosaveRestore's recovery card) which is the case a naive
   * "token on background" check would miss entirely.
   */
  it('every semantic text tone is readable on all three surfaces', () => {
    for (const tone of [DANGER, DANGER_SOFT, DANGER_STRONG, WARN, OK, OK_STRONG]) {
      for (const surface of [BG_BASE, BG_ELEVATED, BG_HOVER]) {
        expect(contrast(tone, surface), `${tone} on ${surface}`).toBeGreaterThan(4.5)
      }
    }
  })

  it('semantic text stays readable on a wash of its own strong tone', () => {
    // HookIndicator: `bg-*-strong/20 text-* border-*-strong/40`, on a card.
    expect(contrast(DANGER, over(DANGER_STRONG, BG_ELEVATED, 0.2))).toBeGreaterThan(4.5)
    expect(contrast(OK, over(OK_STRONG, BG_ELEVATED, 0.2))).toBeGreaterThan(4.5)
    expect(contrast(WARN, over(EMBER, BG_ELEVATED, 0.2))).toBeGreaterThan(4.5)
    // CaptionsPanel's "Captions need setup" card is the /10 version.
    expect(contrast(WARN, over(EMBER, BG_ELEVATED, 0.1))).toBeGreaterThan(4.5)
    // AutosaveRestore's recovery card is a danger-strong/5 wash.
    expect(contrast(DANGER, over(DANGER_STRONG, BG_ELEVATED, 0.05))).toBeGreaterThan(4.5)
  })

  /**
   * T-104 — the signal pair. Pinned on every surface it is drawn on or near:
   * the highlight finder's signal bars sit on a `bg-bg-base` track inside a
   * `bg-bg-hover` row, and the crop guides' labels are drawn over video (no
   * surface to measure), so the three app surfaces stand in for "dark".
   */
  it('the signal marks are readable on all three surfaces', () => {
    for (const mark of [SIGNAL_PINK, SIGNAL_CYAN]) {
      for (const surface of [BG_BASE, BG_ELEVATED, BG_HOVER]) {
        expect(contrast(mark, surface), `${mark} on ${surface}`).toBeGreaterThan(4.5)
      }
    }
  })

  /**
   * The one place a semantic token is a FILL under text: MoodBoardPanel's
   * per-item remove chip turns solid on hover. It carried `hover:bg-rose-500`
   * with the glyph left at inherited ink-base — 2.93:1, under AA, and nobody
   * could have found it because neither color was a token. Dark-on-fill is
   * how `.btn-primary` already solves this against accent.
   */
  it('dark text is readable on a filled danger surface', () => {
    expect(contrast(BG_BASE, DANGER_STRONG)).toBeGreaterThan(4.5)
    expect(contrast(INK_BASE, DANGER_STRONG)).toBeLessThan(4.5)
  })
})

/**
 * T-112 — three pairings the review gate measured under AA, recomputed here from the
 * tokens (the review's figures were 3.60, 4.10, ~3.6 and 4.09; the tokens give the
 * numbers asserted below). All three were an accent-family text color on a wash of
 * its own hue — the case "token on background" checks miss, because the background
 * is a composite. The fix is the DESIGN_GUIDE's: the readable partner of a wash is
 * the ink (or, on the ember wash, the `warn` text tone that is pinned for it), and
 * the accent border carries the identity.
 */
describe('accent-family text on its own wash clears AA (T-112)', () => {
  const pill = over(ACCENT, BG_HOVER, 0.2) // HighlightPanel's score pill, on the row's bg-hover
  const kitRest = over(ACCENT, BG_HOVER, 0.1) // Clip Kit's button at rest, on the selected row's bg-hover
  const kitHover = over(ACCENT, BG_HOVER, 0.2) // ...and hovered
  const setupCard = over(EMBER, BG_ELEVATED, 0.1) // CaptionsPanel's setup card

  it('records what the old pairings measured, so the repair has something to be measured against', () => {
    expect(contrast(ACCENT, pill)).toBeCloseTo(3.58, 1)
    expect(contrast(ACCENT, kitRest)).toBeCloseTo(4.12, 1)
    expect(contrast(ACCENT, kitHover)).toBeCloseTo(3.58, 1)
    expect(contrast(ACCENT, setupCard)).toBeCloseTo(4.1, 1)
    for (const wash of [pill, kitRest, kitHover, setupCard]) {
      expect(contrast(ACCENT, wash)).toBeLessThan(4.5)
    }
  })

  it('the pill, the kit button (rest and hover) and the setup card links read at 4.5:1 or better', () => {
    expect(contrast(INK_BASE, pill)).toBeGreaterThan(4.5)
    expect(contrast(INK_BASE, kitRest)).toBeGreaterThan(4.5)
    expect(contrast(INK_BASE, kitHover)).toBeGreaterThan(4.5)
    expect(contrast(WARN, setupCard)).toBeGreaterThan(4.5)
  })

  it('no renderer className sets accent text on an accent or ember wash', () => {
    const offenders: string[] = []
    for (const file of sourceFilesUnder(RENDERER_ROOT)) {
      if (!file.endsWith('.tsx')) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\btext-accent\b/.test(line) && /\bbg-(?:accent|ember)\/\d+/.test(line)) {
            offenders.push(`${path.relative(RENDERER_ROOT, file)}:${i + 1}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })

  it('the setup card has no accent-colored text at all (its links are warn, underlined)', () => {
    const src = code(path.join(RENDERER_ROOT, 'modules', 'video-studio', 'CaptionsPanel.tsx'))
    expect(src).not.toMatch(/text-accent/)
    expect(src).not.toMatch(/hover:underline/)
  })
})

/**
 * T-56 — `withAlpha` is the only sanctioned way to get a translucent token
 * into a JS context. The exact string matters: it is handed to wavesurfer as
 * a CSS color and asserted in the E2E suite through `getComputedStyle`.
 */
describe('withAlpha — a token at partial alpha', () => {
  it('renders a token as rgba with the alpha it was given', () => {
    expect(withAlpha(ACCENT, 0.25)).toBe('rgba(255, 49, 49, 0.25)')
    expect(withAlpha(ACCENT, 0.35)).toBe('rgba(255, 49, 49, 0.35)')
    expect(withAlpha(EMBER, 0.5)).toBe('rgba(251, 191, 36, 0.5)')
  })

  it('keeps both ends of the alpha range', () => {
    expect(withAlpha(BG_BASE, 0)).toBe('rgba(18, 12, 12, 0)')
    expect(withAlpha(BG_BASE, 1)).toBe('rgba(18, 12, 12, 1)')
  })

  it('parses every channel independently (no shared-nibble shortcuts)', () => {
    expect(withAlpha('#010203', 0.5)).toBe('rgba(1, 2, 3, 0.5)')
    expect(withAlpha('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
  })

  it('refuses anything that is not a #rrggbb token at a 0..1 alpha', () => {
    expect(() => withAlpha('ff3131', 0.25)).toThrow(/withAlpha expects #rrggbb/)
    expect(() => withAlpha('#f31', 0.25)).toThrow(/withAlpha expects #rrggbb/)
    expect(() => withAlpha('rgba(255,49,49,0.25)', 0.25)).toThrow(/withAlpha expects #rrggbb/)
    expect(() => withAlpha(ACCENT, 1.5)).toThrow(/alpha in 0\.\.1/)
    expect(() => withAlpha(ACCENT, -0.1)).toThrow(/alpha in 0\.\.1/)
  })
})

/**
 * T-125 (13): the browser draws its own controls (checkbox, radio, range, the scrollbar, the select's list, the number spinner) from
 * `color-scheme` and `accent-color`, and with neither set they were stock Chromium on the near-black window: blue ticks and sliders,
 * light scrollbars, a second accent color against the one BRANDING allows. The two properties are one `:root` rule that reads the
 * accent from the Tailwind theme (the same token the buttons use), and react-hot-toast's green and red toast marks come from the tokens.
 */
describe('native controls and toast marks take their colors from the palette (T-125 (13))', () => {
  const css = code(path.resolve(RENDERER_ROOT, 'styles/index.css'))

  it('one :root rule makes the native controls dark and gives them the accent token', () => {
    const rules = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => (m[1] as string).replace(/\s+/g, ' ').trim())
    expect(rules).toEqual(["color-scheme: dark; accent-color: theme('colors.accent.DEFAULT');"])
  })

  it('and that token is the accent the buttons use (no second red)', () => {
    expect(colors.accent.DEFAULT).toBe(ACCENT)
  })

  it('the toast marks are the palette\'s ok and danger, with the glyph in bg-base at AA or better', () => {
    const toaster = readFileSync(path.resolve(RENDERER_ROOT, 'components/AppToaster.tsx'), 'utf8')
    const src = toaster.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).toMatch(/success: \{ primary: OK_STRONG, secondary: BG_BASE \}/)
    expect(src).toMatch(/error: \{ primary: DANGER_STRONG, secondary: BG_BASE \}/)
    expect(src).toMatch(/success: \{ iconTheme: TOAST_ICON_THEME\.success \}/)
    expect(src).toMatch(/error: \{ iconTheme: TOAST_ICON_THEME\.error \}/)
    expect(contrast(BG_BASE, OK_STRONG)).toBeGreaterThan(4.5)
    expect(contrast(BG_BASE, DANGER_STRONG)).toBeGreaterThan(4.5)
  })
})

/**
 * T-126 (16): selected text wore Chromium's stock blue on the near-black window, a second accent beside the one BRANDING allows (the
 * number, text and file-name boxes are where a person selects). `::selection` in `@layer base` is the accent at a stated alpha with
 * ink-base on it. The ink is drawn over the wash, and the wash over whatever surface the text is on, so the question is the same one the
 * toast marks answer: ink-base over (accent at alpha over the surface) at AA or better, on EVERY surface text is selected on. The alpha is
 * READ from the stylesheet, so the number this pins cannot differ from the number that ships.
 */
describe('selected text wears the palette, and stays readable on every surface (T-126 (16))', () => {
  const css = code(path.resolve(RENDERER_ROOT, 'styles/index.css'))
  const rule = /::selection\s*\{([^}]*)\}/.exec(css)
  const body = (rule?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const parsed = /^background-color: theme\('colors\.accent\.DEFAULT \/ (\d+)%'\); color: theme\('colors\.ink\.base'\);$/.exec(body)
  const SURFACES: Array<[string, string]> = [
    ['bg-base', BG_BASE],
    ['bg-elevated', BG_ELEVATED],
    ['bg-hover', BG_HOVER]
  ]

  it('is one rule, in the base layer, that is the accent wash with ink-base on it', () => {
    expect(rule, 'index.css has a ::selection rule').not.toBeNull()
    expect(css.match(/::selection/g), 'exactly one').toHaveLength(1)
    expect(parsed, `the rule is the accent wash and ink-base (got "${body}")`).not.toBeNull()
    const at = css.indexOf('::selection')
    expect(css.lastIndexOf('@layer base', at), 'inside @layer base').toBeGreaterThan(-1)
    expect(css.lastIndexOf('@layer base', at), 'and after no other layer opened').toBeGreaterThan(Math.max(css.lastIndexOf('@layer components', at), css.lastIndexOf('@layer utilities', at)))
    // The two tokens it names are the palette's.
    expect(colors.accent.DEFAULT).toBe(ACCENT)
    expect(colors.ink.base).toBe(INK_BASE)
  })

  it('ink-base on the wash clears AA, with room, on every surface text is selected on', () => {
    const alpha = Number(parsed?.[1]) / 100
    expect(alpha, 'a real alpha, not 0 or 1').toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)
    const ratios: Record<string, number> = {}
    for (const [name, surface] of SURFACES) {
      ratios[name] = contrast(INK_BASE, over(ACCENT, surface, alpha))
      expect(ratios[name], `${name}: ink-base over the ${Math.round(alpha * 100)}% wash`).toBeGreaterThanOrEqual(7)
    }
    // Pinned the way the toast marks are: the numbers the guide quotes (DESIGN_GUIDE) are these, to one place.
    expect(ratios['bg-base']).toBeCloseTo(8.94, 1)
    expect(ratios['bg-elevated']).toBeCloseTo(8.38, 1)
    expect(ratios['bg-hover']).toBeCloseTo(7.74, 1)
  })

  it('the computation can fail: a heavy wash, or a muted ink, is under AA on the same surfaces', () => {
    expect(contrast(INK_BASE, over(ACCENT, BG_HOVER, 0.9)), 'a 90% wash').toBeLessThan(4.5)
    expect(contrast(INK_DIM, over(ACCENT, BG_HOVER, 0.4)), 'ink-dim on the 40% wash').toBeLessThan(4.5)
  })
})

/**
 * T-127 (16): no `::placeholder` rule existed, so Tailwind's Preflight drew every placeholder in its stock `#9ca3af`: a cool blue-gray,
 * brighter than ink-dim, and the one colour in the app that belongs to no token (the Watermark, Filename, chat-log, caption and name boxes
 * all show one). One `@layer base` rule gives `input` and `textarea` placeholders ink-dim, the way `::selection` has its one rule above,
 * and the pairing is held where every new pairing is: AA (4.5:1) on every surface an input sits on, computed from the tokens.
 */
describe('placeholder text wears the palette, and stays readable on every surface an input sits on (T-127 (16))', () => {
  const css = code(path.resolve(RENDERER_ROOT, 'styles/index.css'))
  const rule = /(input::placeholder\s*,\s*textarea::placeholder)\s*\{([^}]*)\}/.exec(css)
  const body = (rule?.[2] ?? '').replace(/\s+/g, ' ').trim()
  const SURFACES: Array<[string, string]> = [
    ['bg-base', BG_BASE],
    ['bg-elevated', BG_ELEVATED],
    ['bg-hover', BG_HOVER]
  ]

  it('is one rule, in the base layer, that is ink-dim from the theme and nothing else', () => {
    expect(rule, 'index.css has an input / textarea ::placeholder rule').not.toBeNull()
    expect(css.match(/::placeholder/g), 'one rule: the two selectors are in it together').toHaveLength(2)
    expect(body, 'the colour is the palette\'s ink-dim, through the theme').toBe("color: theme('colors.ink.dim');")
    const at = css.indexOf('::placeholder')
    expect(css.lastIndexOf('@layer base', at), 'inside @layer base').toBeGreaterThan(-1)
    expect(css.lastIndexOf('@layer base', at), 'and after no other layer opened').toBeGreaterThan(Math.max(css.lastIndexOf('@layer components', at), css.lastIndexOf('@layer utilities', at)))
    expect(colors.ink.dim, 'the token it names is the palette\'s').toBe(INK_DIM)
    expect(css, 'no raw hex colour is written for it').not.toMatch(/::placeholder[^}]*#[0-9a-f]{3,8}/i)
  })

  it('ink-dim clears AA on every surface an input sits on, and is dimmer than the stock colour it replaces', () => {
    const ratios: Record<string, number> = {}
    for (const [name, surface] of SURFACES) {
      ratios[name] = contrast(INK_DIM, surface)
      expect(ratios[name], `${name}: ink-dim`).toBeGreaterThanOrEqual(4.5)
    }
    // The numbers the guide quotes (DESIGN_GUIDE) are these, to one place.
    expect(ratios['bg-base']).toBeCloseTo(6.2, 1)
    expect(ratios['bg-elevated']).toBeCloseTo(5.83, 1)
    expect(ratios['bg-hover']).toBeCloseTo(5.33, 1)
    // Preflight's stock colour was brighter than a placeholder in this palette should be, and in no token.
    const STOCK = '#9ca3af'
    expect(contrast(STOCK, BG_BASE), 'the stock colour is brighter on bg-base').toBeGreaterThan(ratios['bg-base'] as number)
    expect([INK_BASE, INK_MUTED, INK_DIM].map((c) => c.toLowerCase())).not.toContain(STOCK)
  })

  it('the computation can fail: a dimmer ink than ink-dim is under AA on the same surfaces', () => {
    expect(contrast('#5a4f4c', BG_HOVER), 'a darker placeholder colour').toBeLessThan(4.5)
    expect(contrast('#5a4f4c', BG_BASE)).toBeLessThan(4.5)
  })
})

/**
 * T-164 (8): react-konva's <Transformer> draws its border and anchors in Konva's stock rgb(0, 161, 255), a second accent against the one BRANDING allows
 * (the same finding as the toast marks above: a library's own colors). The three props are token imports, and the anchors stay visible on a light and on a dark
 * document. E2E: image.spec.ts "the selection handles wear the palette (T-164 (8))" reads them off the real stage.
 */
describe('the selection handles take their colors from the palette (T-164 (8))', () => {
  const canvas = readFileSync(path.resolve(RENDERER_ROOT, 'modules/image-studio/Canvas.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const transformer = canvas.slice(canvas.indexOf('<Transformer'), canvas.indexOf('/>', canvas.indexOf('<Transformer')))

  it('borderStroke and anchorStroke are ACCENT, anchorFill is INK_BASE, all imported from the tokens module', () => {
    expect(transformer).toMatch(/borderStroke=\{ACCENT\}/)
    expect(transformer).toMatch(/anchorStroke=\{ACCENT\}/)
    expect(transformer).toMatch(/anchorFill=\{INK_BASE\}/)
    expect(canvas).toMatch(/import \{[^}]*\bACCENT\b[^}]*\bINK_BASE\b[^}]*\} from '\.\.\/\.\.\/styles\/tokens'/)
    expect(transformer, 'no raw color is written on it').not.toMatch(/(?:Stroke|Fill)=["'{]\s*["']?(#|rgb)/i)
  })

  it('an anchor (a light fill with an accent stroke) is visible on a white document and on the dark one, at the 3:1 a UI component needs', () => {
    expect(Math.max(contrast(INK_BASE, '#ffffff'), contrast(ACCENT, '#ffffff')), 'on white: the stroke carries it').toBeGreaterThanOrEqual(3)
    expect(contrast(ACCENT, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast(INK_BASE, BG_BASE), 'on the app\'s own near-black: the fill carries it').toBeGreaterThanOrEqual(3)
    expect(contrast(ACCENT, BG_BASE), 'and the border (the accent) does too').toBeGreaterThanOrEqual(3)
  })

  it('the pin can fail: the stock blue is not a token', () => {
    expect([ACCENT, INK_BASE].map((c) => c.toLowerCase())).not.toContain('#00a1ff')
  })
})

/**
 * T-184 (1): text drawn over a picture or a document, through a translucent backing, is judged against the WORST content under it (white). The Stream Graphics
 * readout was `text-ink-dim` on `bg-bg-elevated/80` (3.13:1 over a white document's corner) and the Reference Search tile's source line `text-ink-dim` on the
 * hover scrim `bg-black/60` (1.84:1 over a white thumbnail). The fixes: the readout's backing is opaque, the source line is ink-base. E2E: image.spec.ts "the size
 * readout stays readable over a white document (T-184 (1))" and references.spec.ts "the Reference Search tile's source line is ink-base (T-184 (1))".
 */
describe('text over a picture clears AA over white content (T-184 (1))', () => {
  const WHITE = '#ffffff'
  const BLACK = '#000000' // `bg-black/60` is the documented raw-colour exception (DESIGN_GUIDE)
  const read = (rel: string): string => code(path.resolve(RENDERER_ROOT, rel))

  it('ink-dim on the opaque bg-elevated is 5.8:1, and the translucent backing it replaces failed over white', () => {
    expect(contrast(INK_DIM, BG_ELEVATED)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(INK_DIM, over(BG_ELEVATED, WHITE, 0.8)), 'the old /80 composite over a white corner').toBeLessThan(4.5)
  })

  it('ink-base on the bg-black/60 scrim clears 4.5:1 over white, and ink-dim does not', () => {
    const scrim = over(BLACK, WHITE, 0.6)
    expect(contrast(INK_BASE, scrim)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(INK_DIM, scrim), 'the old source-line pairing').toBeLessThan(4.5)
  })

  it('the mood board\'s remove button (ink-base on bg-base/80) clears it over white', () => {
    expect(contrast(INK_BASE, over(BG_BASE, WHITE, 0.8))).toBeGreaterThanOrEqual(4.5)
  })

  it('wiring: the Canvas readout sits on the opaque bg-elevated, no alpha', () => {
    const canvas = read('modules/image-studio/Canvas.tsx')
    const readout = canvas.slice(canvas.lastIndexOf('<div className="absolute bottom-2 right-2'))
    const classes = /className="([^"]*)"/.exec(readout)?.[1] ?? ''
    expect(classes).toMatch(/\btext-ink-dim\b/)
    expect(classes).toMatch(/\bbg-bg-elevated\b(?!\/)/)
    expect(classes, 'no translucent backing').not.toMatch(/bg-bg-elevated\/|bg-bg-base\/|bg-black\//)
  })

  it('wiring: the Reference Search tile\'s source line is ink-base', () => {
    const panel = read('modules/references/ReferencePanel.tsx')
    expect(panel).toMatch(/<span className="text-xs text-ink-base">\{result\.source\}<\/span>/)
    expect(panel).not.toMatch(/text-ink-dim">\{result\.source\}/)
  })
})

/**
 * T-192 (1): DESIGN_GUIDE says `accent-muted` is the hover state of accent elements and nothing else (1.08:1 from `accent`, so it cannot tell
 * two drawn things apart). The pin: no renderer source but styles/tokens.ts names the ACCENT_MUTED identifier (a fill or stroke in JS can never
 * be a hover), and every `accent-muted` class token in a source or a stylesheet carries a `hover:` variant (`md:hover:bg-accent-muted` passes,
 * `focus:bg-accent-muted` and `bg-accent-muted` do not). An `@apply` passes by the same test: index.css's `.btn-primary` applies
 * `hover:bg-accent-muted`, a hover variant itself; its rule is not a hover state, so a bare `bg-accent-muted` in an `@apply` is refused too.
 * `accent.muted` (a `theme('colors.accent.muted')` read) is refused outright: it has no hover form.
 */
function nonHoverAccentMuted(text: string): string[] {
  const bad: string[] = []
  for (const m of text.matchAll(/[^\s"'`{}();,]*accent-muted[^\s"'`{}();,]*/g)) {
    const head = m[0].slice(0, m[0].indexOf('accent-muted'))
    if (!/(?:^|:)hover:/.test(head)) bad.push(m[0])
  }
  for (const m of text.matchAll(/accent\.muted/g)) bad.push(m[0])
  return bad
}

function stylesheetsUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.css')).map((f) => path.join(dir, f))
}

describe('accent-muted is a hover state and nothing else (T-192 (1))', () => {
  it('no renderer source but styles/tokens.ts names ACCENT_MUTED', () => {
    const tokens = path.resolve(RENDERER_ROOT, 'styles/tokens.ts')
    const offenders = sourceFilesUnder(RENDERER_ROOT)
      .filter((f) => path.resolve(f) !== tokens && /\bACCENT_MUTED\b/.test(code(f)))
      .map((f) => path.relative(RENDERER_ROOT, f))
    expect(offenders).toEqual([])
  })

  it('every accent-muted class in a source or a stylesheet is a hover: variant', () => {
    const offenders: string[] = []
    for (const file of [...sourceFilesUnder(RENDERER_ROOT), ...stylesheetsUnder(RENDERER_ROOT)]) {
      for (const t of nonHoverAccentMuted(code(file))) offenders.push(`${path.relative(RENDERER_ROOT, file)}: ${t}`)
    }
    expect(offenders).toEqual([])
  })

  it('the scan is not vacuous: the hover uses it allows exist (Timeline trim handles, .btn-primary)', () => {
    expect(code(path.resolve(RENDERER_ROOT, 'modules/video-studio/Timeline.tsx'))).toMatch(/hover:bg-accent-muted/)
    expect(code(path.resolve(RENDERER_ROOT, 'styles/index.css'))).toMatch(/hover:bg-accent-muted/)
  })

  it('control: a bare, a focus:, an @apply and a theme() use are refused; hover: and stacked hover: pass', () => {
    expect(nonHoverAccentMuted('className="bg-accent-muted"')).toEqual(['bg-accent-muted'])
    expect(nonHoverAccentMuted('className="x focus:bg-accent-muted"')).toEqual(['focus:bg-accent-muted'])
    expect(nonHoverAccentMuted('@apply px-2 border-accent-muted;')).toEqual(['border-accent-muted'])
    expect(nonHoverAccentMuted("theme('colors.accent.muted')")).toEqual(['accent.muted'])
    expect(nonHoverAccentMuted('className="hover:bg-accent-muted"')).toEqual([])
    expect(nonHoverAccentMuted('className="md:hover:bg-accent-muted bg-accent"')).toEqual([])
  })
})

/**
 * T-193 (3): the sibling of the pin above that it could not see. The "Emote · Blank circle" template drew its ring in `#f52e2e`, accent-muted's VALUE, as a raw hex in
 * document content (1.08:1 from its `#ff3131` fill: no ring was drawn or exported, and the Stroke field read `#f52e2e` and 2 px). The identifier pin only reads source
 * that names ACCENT_MUTED, so the value is pinned here: no template layer and no layer factory default (the default document included) holds it, in any case, as a hex or
 * as its rgb triple. And every template layer that strokes over an opaque fill clears 1.5:1 from that fill (the floor under which a ring is not a ring).
 */
const ACCENT_MUTED_VALUE = /#f52e2e|\b245\s*,\s*46\s*,\s*46\b/i

function namesAccentMuted(text: string): boolean {
  return ACCENT_MUTED_VALUE.test(text)
}

/** A color the document paints with no see-through: `#rrggbb`, or an `rgba()` at alpha 1. Anything else is not opaque (or not a color). */
function opaqueHex(color: unknown): string | null {
  if (typeof color !== 'string') return null
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  const m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (!m || (m[4] !== undefined && Number(m[4]) !== 1)) return null
  return `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`
}

describe('no template layer and no layer default names accent-muted\'s value (T-193 (3))', () => {
  const factoryDefaults = (): unknown[] => {
    useCanvasStore.getState().resetDocument()
    const blank = useCanvasStore.getState().doc
    return [
      blank,
      makeRectLayer(0, 0),
      makeEllipseLayer(0, 0),
      makeLineLayer([0, 0, 1, 1]),
      makeLineLayer([0, 0, 1, 1, 2, 0], 'Pencil'),
      makeTextLayer(0, 0),
      textLayerFor(blank),
      makeImageLayer('data:image/png;base64,AA==', 10, 10),
      makeReferenceLayer('data:image/png;base64,AA==', 10, 10, 'ref')
    ]
  }

  it('no template names it, in any layer field or the document\'s background', () => {
    const offenders = CANVAS_TEMPLATES.filter((t) => namesAccentMuted(JSON.stringify(t.doc))).map((t) => t.id)
    expect(offenders).toEqual([])
  })

  it('no layer factory default (nor the blank document) names it', () => {
    const defaults = factoryDefaults()
    expect(defaults.length).toBeGreaterThan(5)
    expect(defaults.filter((d) => namesAccentMuted(JSON.stringify(d)))).toEqual([])
  })

  it('the scan is not vacuous: it reads the layers, and the value it refuses is the token\'s', () => {
    expect(CANVAS_TEMPLATES.flatMap((t) => t.doc.layers).length).toBeGreaterThan(20)
    expect(namesAccentMuted(JSON.stringify(CANVAS_TEMPLATES.map((t) => t.doc)))).toBe(false)
    expect(namesAccentMuted(ACCENT_MUTED)).toBe(true)
  })

  it('control: a hex in either case and the rgb and rgba triples are refused; the accent, the base and a near miss are not', () => {
    for (const bad of ['#f52e2e', '#F52E2E', '"stroke":"#F52e2E"', 'rgb(245,46,46)', 'rgba(245, 46, 46, 0.4)']) expect(namesAccentMuted(bad), bad).toBe(true)
    for (const ok of [ACCENT, BG_BASE, '#f52e2f', 'rgba(245, 46, 47, 0.4)', 'rgba(2245, 46, 46, 1)']) expect(namesAccentMuted(ok), ok).toBe(false)
  })

  it('the Blank circle\'s ring is the base colour and clears 3:1 against its fill (a Stroke edit is visible)', () => {
    const t = CANVAS_TEMPLATES.find((x) => x.id === 'emote-blank-112')
    const ring = t?.doc.layers.find((l) => l.name === 'Base circle')
    expect(ring?.type).toBe('ellipse')
    const { stroke, fill, strokeWidth } = ring as unknown as { stroke: string; fill: string; strokeWidth: number }
    expect(strokeWidth).toBeGreaterThan(0)
    expect(stroke).toBe(BG_BASE)
    expect(contrast(stroke, fill)).toBeGreaterThan(3)
  })

  it('every template layer that strokes over an opaque fill clears 1.5:1 from that fill', () => {
    const rows: Array<{ id: string; layer: string; stroke: string; fill: string; ratio: number }> = []
    for (const t of CANVAS_TEMPLATES) {
      for (const l of t.doc.layers) {
        const { stroke, fill, strokeWidth } = l as unknown as { stroke?: unknown; fill?: unknown; strokeWidth?: number }
        const s = opaqueHex(stroke)
        const f = opaqueHex(fill)
        if (!s || !f || !((strokeWidth ?? 0) > 0)) continue
        rows.push({ id: t.id, layer: l.name, stroke: s, fill: f, ratio: contrast(s, f) })
      }
    }
    expect(rows.length, 'the scan finds the Blank circle and the POG disc').toBeGreaterThanOrEqual(2)
    expect(rows.filter((r) => r.ratio < 1.5)).toEqual([])
  })

  it('control: the rule discriminates (the old ring is under 1.5:1 and the opaque test reads hex, opaque rgba, and nothing else)', () => {
    expect(contrast('#f52e2e', '#ff3131')).toBeLessThan(1.5)
    expect(opaqueHex('#FF3131')).toBe('#ff3131')
    expect(opaqueHex('rgba(18,12,12,1)')).toBe('#120c0c')
    expect(opaqueHex('rgba(18,12,12,0.85)')).toBeNull()
    expect(opaqueHex('transparent')).toBeNull()
  })
})
