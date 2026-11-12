import { describe, it, expect } from 'vitest'
import { CSS_COLORS, resolveOverlayColor } from './overlayColors'
import { newTextOverlay } from './textOverlay'
import { isValidTextOverlay } from './projectValidation'

/**
 * T-113 (1) - a name the editor invites ("white or #ffcc00") becomes the hex every
 * gate takes BEFORE it is stored. The gates stay hex-only (they guard the IPC
 * boundary against filter injection); these tests are the other half of that
 * bargain: nothing but a hex ever reaches them from the editor. T-114: the table
 * and the resolver moved to a leaf module so the project restore can migrate a
 * name an older build stored (`projectValidation.test.ts`), and `#rgb` shorthand
 * expands.
 */

const HEX = /^#[0-9a-f]{6}$/

describe('CSS_COLORS — the standard named colors', () => {
  it('has all 148 CSS color names, each a lowercase #rrggbb', () => {
    const names = Object.keys(CSS_COLORS)
    expect(names).toHaveLength(148)
    for (const name of names) {
      expect(name).toBe(name.toLowerCase())
      expect(CSS_COLORS[name]).toMatch(HEX)
    }
  })

  it('carries the values people actually type', () => {
    expect(CSS_COLORS.white).toBe('#ffffff')
    expect(CSS_COLORS.black).toBe('#000000')
    expect(CSS_COLORS.red).toBe('#ff0000')
    expect(CSS_COLORS.yellow).toBe('#ffff00')
    expect(CSS_COLORS.gold).toBe('#ffd700')
    expect(CSS_COLORS.rebeccapurple).toBe('#663399')
  })

  it('spells gray both ways, to the same value', () => {
    expect(CSS_COLORS.gray).toBe('#808080')
    expect(CSS_COLORS.grey).toBe(CSS_COLORS.gray)
    expect(CSS_COLORS.darkgrey).toBe(CSS_COLORS.darkgray)
    expect(CSS_COLORS.lightslategrey).toBe(CSS_COLORS.lightslategray)
  })

  it('every value is a color the overlay gate accepts', () => {
    for (const hex of Object.values(CSS_COLORS)) {
      expect(isValidTextOverlay({ ...newTextOverlay(0, 1), colorHex: hex })).toBe(true)
    }
  })
})

describe('resolveOverlayColor', () => {
  it('turns a name into its hex, in any case, with stray spaces', () => {
    expect(resolveOverlayColor('white')).toBe('#ffffff')
    expect(resolveOverlayColor('White')).toBe('#ffffff')
    expect(resolveOverlayColor('  RED ')).toBe('#ff0000')
    expect(resolveOverlayColor('Grey')).toBe('#808080')
  })

  it('takes a hex with or without the # and writes it lowercase with one', () => {
    expect(resolveOverlayColor('#ffcc00')).toBe('#ffcc00')
    expect(resolveOverlayColor('FFCC00')).toBe('#ffcc00')
    expect(resolveOverlayColor(' #AaBbCc ')).toBe('#aabbcc')
  })

  it('expands the #rgb shorthand to #rrggbb (T-114)', () => {
    expect(resolveOverlayColor('#fff')).toBe('#ffffff')
    expect(resolveOverlayColor('#f00')).toBe('#ff0000')
    expect(resolveOverlayColor(' #AbC ')).toBe('#aabbcc')
    expect(resolveOverlayColor('#000')).toBe('#000000')
  })

  it('does not read a bare three-letter word as a shorthand: the # is what says it is a code', () => {
    expect(resolveOverlayColor('fff')).toBeNull()
    expect(resolveOverlayColor('red')).toBe('#ff0000')
    expect(resolveOverlayColor('tan')).toBe('#d2b48c')
  })

  it('refuses what it does not know', () => {
    for (const bad of ['', '   ', 'notacolor', '#ggg', '#ggg000', '#ff', '#ffcc0', '#ffcc000', '#ffff', 'rgb(1,2,3)', 'transparent']) {
      expect(resolveOverlayColor(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('never lets an inherited property pass for a color name', () => {
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(resolveOverlayColor(bad), bad).toBeNull()
    }
  })

  it('refuses a filter-injection string (it is neither a name nor a hex)', () => {
    expect(resolveOverlayColor('white,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]')).toBeNull()
    expect(resolveOverlayColor("white':fontsize=99'")).toBeNull()
  })
})
