import { describe, it, expect } from 'vitest'
import { CANVAS_COLOR_REFUSAL, resolveCanvasColor } from './canvasColor'
import { OVERLAY_COLOR_REFUSAL } from '@shared/textOverlay'
import { resolveOverlayColor } from '@shared/overlayColors'

// A stand-in for `CSS.supports('color', v)` in node: the functional forms, `#rgba` / `#rrggbbaa` and `transparent`, which the overlay resolver does not take.
const supports = (v: string): boolean =>
  /^(rgba?|hsla?)\([0-9.,%\s/]+\)$/i.test(v) || /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(v) || /^(transparent|currentcolor|inherit|var\(--x\))$/i.test(v)
const never = (): boolean => false
const always = (): boolean => true

describe('resolveCanvasColor (T-186 (1))', () => {
  it('a name in any case, a code with or without its #, and #rgb come back as #rrggbb, exactly as the overlay resolver answers', () => {
    for (const typed of ['red', 'Red', '  BLUE ', '#ffcc00', 'ffcc00', 'ff3131', '#FF3131', '#fc0', '#ABC']) {
      expect(resolveCanvasColor(typed, never), typed).toBe(resolveOverlayColor(typed))
    }
    expect(resolveCanvasColor('ffcc00', never)).toBe('#ffcc00')
    expect(resolveCanvasColor('ff3131', never)).toBe('#ff3131')
    expect(resolveCanvasColor('#fc0', never)).toBe('#ffcc00')
    expect(resolveCanvasColor('Red', never)).toBe('#ff0000')
  })

  it('the canvas\'s other colours are kept as typed (trimmed) when the platform accepts them: a template\'s rgba(...), transparent, #rgba', () => {
    expect(resolveCanvasColor('rgba(255,0,0,0.4)', supports)).toBe('rgba(255,0,0,0.4)')
    expect(resolveCanvasColor('  rgba(18, 12, 12, 0.85) ', supports)).toBe('rgba(18, 12, 12, 0.85)')
    expect(resolveCanvasColor('transparent', supports)).toBe('transparent')
    expect(resolveCanvasColor('#ff000080', supports)).toBe('#ff000080')
    expect(resolveCanvasColor('hsl(0 100% 50%)', supports)).toBe('hsl(0 100% 50%)')
  })

  it('the platform is asked only about text the overlay resolver does not take, and with the trimmed text', () => {
    const asked: string[] = []
    resolveCanvasColor('red', (v) => (asked.push(v), true))
    expect(asked, 'a name never reaches the platform check').toEqual([])
    resolveCanvasColor('  rgba(1,2,3,0.5)  ', (v) => (asked.push(v), true))
    expect(asked).toEqual(['rgba(1,2,3,0.5)'])
  })

  it('text no colour reads as is null: blu, #ff313, ff31, a typo, and an emptied or blank box (even for a platform that would accept anything)', () => {
    for (const typed of ['blu', '#ff313', 'ff31', 'ff31314', 'rgba(', 'not a color']) {
      expect(resolveCanvasColor(typed, never), typed).toBeNull()
      expect(resolveCanvasColor(typed, supports), `${typed} against the stand-in`).toBeNull()
    }
    expect(resolveCanvasColor('', never)).toBeNull()
    expect(resolveCanvasColor('   ', never)).toBeNull()
    expect(resolveCanvasColor('', always), 'an empty box is refused whatever the platform says').toBeNull()
    expect(resolveCanvasColor('  ', always)).toBeNull()
  })

  it('CSS-wide keywords and var() pass the platform check but are not a canvas colour, so they are null', () => {
    for (const typed of ['inherit', 'Initial', 'unset', 'revert', 'revert-layer', 'var(--x)', 'rgba(var(--x), 0.5)']) {
      expect(resolveCanvasColor(typed, always), typed).toBeNull()
    }
    expect(resolveCanvasColor('currentcolor', supports), 'a real colour keyword stays').toBe('currentcolor')
  })

  it('the refusal is one sentence in the overlay refusal\'s voice and names the forms (a name, a code, transparent)', () => {
    expect(CANVAS_COLOR_REFUSAL).toMatch(/^imagii doesn't know that color\. /)
    expect(CANVAS_COLOR_REFUSAL).toMatch(/name like white/)
    expect(CANVAS_COLOR_REFUSAL).toMatch(/#ffcc00/)
    expect(CANVAS_COLOR_REFUSAL).toMatch(/transparent/)
    expect(CANVAS_COLOR_REFUSAL.slice(0, 33)).toBe(OVERLAY_COLOR_REFUSAL.slice(0, 33))
  })
})
