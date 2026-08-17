import { describe, it, expect } from 'vitest'
import tailwindConfig from '../../tailwind.config.js'
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
})

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
