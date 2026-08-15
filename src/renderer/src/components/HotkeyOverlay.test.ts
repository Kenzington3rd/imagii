import { describe, it, expect } from 'vitest'
import { SHORTCUTS_BY_ROUTE, isOverlayToggleKey, shortcutsForRoute } from './HotkeyOverlay'

/**
 * T-13 regression: the overlay was never mounted, so both interactions it
 * owns — the `?` toggle and the Esc/close dismissal — were dead while
 * Player.tsx's hint copy advertised them. These pin the toggle decision; the
 * mount itself is pinned by tests/unit/interactionWiring.test.ts and the
 * route table's honesty by tests/unit/hotkeyTable.test.ts.
 */
const base = { key: '?', ctrlKey: false, metaKey: false, tagName: 'DIV' }

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

  it.each(['/', 'a', 'Escape', 'Enter'])('ignores %p', (key) => {
    expect(isOverlayToggleKey({ ...base, key })).toBe(false)
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
