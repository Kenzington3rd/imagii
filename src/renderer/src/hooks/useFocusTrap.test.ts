import { describe, it, expect } from 'vitest'
import {
  isTopmostClaim,
  isTopDialogClaim,
  pushDialogClaim,
  releaseDialogClaim
} from './useFocusTrap'

/**
 * T-73 regression: the claim that decides which open dialog owns a keypress.
 *
 * Every dialog registers its own window keydown, so an Escape is delivered to
 * all of them and each one closed on it — stack the `?` shortcuts overlay
 * over a tutorial coachmark and one press took both. The E2E in
 * tests/e2e/home-chrome.spec.ts drives that stack in the real app; these pin
 * the decision underneath, including the orderings a running app cannot
 * conveniently produce.
 *
 * The unit layer is node with no DOM (STYLE_GUIDE), so the hook itself is not
 * rendered here — `isTopmostClaim` is the whole of its policy and is pure on
 * purpose, the same split T-15 used for `undoRedoIntent`.
 */
describe('isTopmostClaim', () => {
  it('says yes to the only claim', () => {
    expect(isTopmostClaim([7], 7)).toBe(true)
  })

  it('says yes to the newest claim and no to the one underneath', () => {
    // The whole bug in one case: the outer dialog must sit an Escape out.
    expect(isTopmostClaim([1, 2], 2)).toBe(true)
    expect(isTopmostClaim([1, 2], 1)).toBe(false)
  })

  it('answers for three deep, not just two', () => {
    expect(isTopmostClaim([1, 2, 3], 3)).toBe(true)
    expect(isTopmostClaim([1, 2, 3], 2)).toBe(false)
    expect(isTopmostClaim([1, 2, 3], 1)).toBe(false)
  })

  it('says no when nothing is claimed', () => {
    expect(isTopmostClaim([], 1)).toBe(false)
  })

  it('says no for a dialog that never claimed', () => {
    // `claimRef` is null before the mount effect runs and again after the
    // release, and a keydown can land in either window.
    expect(isTopmostClaim([1, 2], null)).toBe(false)
    expect(isTopmostClaim([], null)).toBe(false)
  })

  it('says no for a claim that has already been released', () => {
    expect(isTopmostClaim([1, 3], 2)).toBe(false)
  })
})

describe('the claim stack', () => {
  it('hands the window to each new dialog and back when it leaves', () => {
    const outer = pushDialogClaim()
    expect(isTopDialogClaim(outer)).toBe(true)

    const inner = pushDialogClaim()
    expect(isTopDialogClaim(inner)).toBe(true)
    expect(isTopDialogClaim(outer)).toBe(false)

    // Closing the inner one must not leave the outer inert — the failure
    // this ticket was filed against is one Escape closing both, and the one
    // it must not trade for is a second Escape closing neither.
    releaseDialogClaim(inner)
    expect(isTopDialogClaim(outer)).toBe(true)

    releaseDialogClaim(outer)
    expect(isTopDialogClaim(outer)).toBe(false)
  })

  it('never reuses an id, so a released claim cannot be answered for', () => {
    const first = pushDialogClaim()
    releaseDialogClaim(first)
    const second = pushDialogClaim()
    expect(second).not.toBe(first)
    expect(isTopDialogClaim(first)).toBe(false)
    releaseDialogClaim(second)
  })

  it('releases by identity, so an out-of-order close is still correct', () => {
    // Why the claim is an ID and not a depth compared against a count: React
    // does not promise that a stack of dialogs unmounts newest-first, and a
    // depth-vs-count test would silently make the SURVIVING dialog inert.
    const outer = pushDialogClaim()
    const inner = pushDialogClaim()
    releaseDialogClaim(outer)
    expect(isTopDialogClaim(inner)).toBe(true)
    releaseDialogClaim(inner)
  })

  it('ignores a release for a claim it does not hold', () => {
    const only = pushDialogClaim()
    releaseDialogClaim(-1)
    expect(isTopDialogClaim(only)).toBe(true)
    releaseDialogClaim(only)
    releaseDialogClaim(only)
    expect(isTopDialogClaim(only)).toBe(false)
  })
})
