import { describe, it, expect } from 'vitest'
import tailwindConfig from '../../tailwind.config.js'
import {
  BG_BASE,
  BG_ELEVATED,
  BG_HOVER,
  ACCENT,
  ACCENT_MUTED,
  INK_BASE,
  INK_MUTED,
  INK_DIM
} from '../../src/renderer/src/styles/tokens'

/**
 * Round 19: tailwind.config.js cannot import the TS tokens module, so the
 * palette exists in two files by necessity. This test is the drift gate.
 */
interface ThemeColors {
  bg: { base: string; elevated: string; hover: string }
  accent: { DEFAULT: string; muted: string }
  ink: { base: string; muted: string; dim: string }
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
})
