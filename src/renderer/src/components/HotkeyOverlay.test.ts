import { describe, it, expect } from 'vitest'
import { SHORTCUTS_BY_ROUTE, isOverlayToggleKey, shortcutsForRoute } from './HotkeyOverlay'

/**
 * T-13 regression: the overlay was never mounted, so both interactions it
 * owns — the `?` toggle and the Esc/close dismissal — were dead while
 * Player.tsx's hint copy advertised them. These pin the toggle decision; the
 * mount itself is pinned by tests/unit/interactionWiring.test.ts and the
 * route table's honesty by tests/unit/hotkeyTable.test.ts.
 */
const base: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  tagName: string
  inputType?: string | null
  openModals: number
  overlayOpen: boolean
} = {
  key: '?',
  ctrlKey: false,
  metaKey: false,
  tagName: 'DIV',
  openModals: 0,
  overlayOpen: false
}

describe('isOverlayToggleKey', () => {
  it('fires on a bare ?', () => {
    expect(isOverlayToggleKey(base)).toBe(true)
  })

  it('ignores ? with a modifier held', () => {
    expect(isOverlayToggleKey({ ...base, ctrlKey: true })).toBe(false)
    expect(isOverlayToggleKey({ ...base, metaKey: true })).toBe(false)
  })

  it.each(['INPUT', 'TEXTAREA'])('never fires while typing in %s', (tagName) => {
    // A `?` typed into the chat-log textarea belongs in the textarea.
    expect(isOverlayToggleKey({ ...base, tagName })).toBe(false)
  })

  // T-123 (2): "is it an INPUT?" also stood down for a ticked checkbox or a dragged slider, which the browser leaves
  // focused, so `?` was dead from there - against the overlay's own promise (UX and a11y found it independently).
  it.each(['checkbox', 'range', 'radio', 'color', 'file', 'button'])(
    'fires from a focused <input type=%s>: `?` means nothing to it (T-123 (2))',
    (inputType) => {
      expect(isOverlayToggleKey({ ...base, tagName: 'INPUT', inputType })).toBe(true)
    }
  )

  it.each(['text', 'number', 'search', null, undefined])('still never fires from a text <input> (type %s)', (inputType) => {
    expect(isOverlayToggleKey({ ...base, tagName: 'INPUT', inputType })).toBe(false)
  })

  // T-133 (7b): the toggle ran on every auto-repeat of a held `?` (open, shut, open... at the keyboard's repeat rate: a flicker, and a dialog
  // whose trap restores focus on every close).
  it('toggles once for a held ?: the auto-repeat is not another press (T-133 (7b))', () => {
    expect(isOverlayToggleKey({ ...base, repeat: false })).toBe(true)
    expect(isOverlayToggleKey({ ...base, repeat: true })).toBe(false)
    expect(isOverlayToggleKey({ ...base, repeat: true, overlayOpen: true, openModals: 1 }), 'nor does a repeat close it').toBe(false)
  })

  it.each(['/', 'a', 'Escape', 'Enter'])('ignores %p', (key) => {
    expect(isOverlayToggleKey({ ...base, key })).toBe(false)
  })
})

/**
 * T-72: the overlay renders its own Modal, so the "a dialog owns the window"
 * guard has to be self-exempting. These four cases ARE the mechanism — the
 * naive `openModals > 0` guard passes the first two and fails the third,
 * which is the bug where `?` could no longer close the overlay `?` opened.
 */
describe('isOverlayToggleKey — modal claims on the window', () => {
  it('opens when nothing else is open', () => {
    expect(isOverlayToggleKey({ ...base, openModals: 0, overlayOpen: false })).toBe(true)
  })

  it('is inert behind a dialog that is not its own', () => {
    // `?` behind the Variants/Templates dialog used to stack the overlay on
    // top of the dialog the user opened on purpose.
    expect(isOverlayToggleKey({ ...base, openModals: 1, overlayOpen: false })).toBe(false)
    expect(isOverlayToggleKey({ ...base, openModals: 2, overlayOpen: false })).toBe(false)
  })

  it('still closes itself — the one open modal is its own', () => {
    expect(isOverlayToggleKey({ ...base, openModals: 1, overlayOpen: true })).toBe(true)
  })

  it('yields to anything stacked above it', () => {
    // Not reachable today (the overlay's scrim covers every opener), but the
    // rule is "the topmost claim wins", not "the overlay always wins".
    expect(isOverlayToggleKey({ ...base, openModals: 2, overlayOpen: true })).toBe(false)
  })

  it('still refuses a modifier or a text field regardless of the count', () => {
    expect(isOverlayToggleKey({ ...base, openModals: 1, overlayOpen: true, ctrlKey: true })).toBe(
      false
    )
    expect(isOverlayToggleKey({ ...base, openModals: 1, overlayOpen: true, tagName: 'INPUT' })).toBe(
      false
    )
  })
})

describe('shortcutsForRoute', () => {
  it('returns the route table for a known route', () => {
    expect(shortcutsForRoute('/video')).toBe(SHORTCUTS_BY_ROUTE['/video'])
  })

  it('falls back to Home for an unlisted route', () => {
    expect(shortcutsForRoute('/nope')).toBe(SHORTCUTS_BY_ROUTE['/home'])
  })

  it('documents the ? toggle on every route, since that is how it is found', () => {
    for (const [route, rows] of Object.entries(SHORTCUTS_BY_ROUTE)) {
      expect(rows.some((r) => r.keys === '?'), `${route} lists ?`).toBe(true)
    }
  })

  it('gives every row both a key and a description', () => {
    for (const rows of Object.values(SHORTCUTS_BY_ROUTE)) {
      for (const row of rows) {
        expect(row.keys.length).toBeGreaterThan(0)
        expect(row.description.length).toBeGreaterThan(0)
      }
    }
  })
})
