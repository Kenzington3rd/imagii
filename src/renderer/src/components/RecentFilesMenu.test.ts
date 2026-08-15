import { describe, it, expect } from 'vitest'
import { shouldDismissMenu } from './RecentFilesMenu'

/**
 * T-18 regression: the recent-files popover dismissed on mouse-leave only —
 * no Escape, no click-outside — which left it unreachable by keyboard and
 * flaky to drive headless.
 */
describe('shouldDismissMenu', () => {
  it('dismisses on Escape', () => {
    expect(shouldDismissMenu({ kind: 'key', key: 'Escape' })).toBe(true)
  })

  it.each(['Enter', 'Tab', 'ArrowDown', 'a', ' '])('keeps the menu open on %p', (key) => {
    expect(shouldDismissMenu({ kind: 'key', key })).toBe(false)
  })

  it('dismisses on a press outside the menu', () => {
    expect(shouldDismissMenu({ kind: 'pointer', inside: false })).toBe(true)
  })

  it('does NOT dismiss on a press inside the menu', () => {
    // Includes the toggle button: it lives inside the same wrapper on
    // purpose, so mousedown can't close the menu a heartbeat before the
    // button's own click reopens it.
    expect(shouldDismissMenu({ kind: 'pointer', inside: true })).toBe(false)
  })
})
