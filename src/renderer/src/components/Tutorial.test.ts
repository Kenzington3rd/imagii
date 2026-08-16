import { describe, it, expect } from 'vitest'
import {
  computeTooltipPosition,
  tutorialKeyIntent,
  TOOLTIP_MARGIN,
  TOOLTIP_MAX_WIDTH,
  TOOLTIP_MAX_HEIGHT,
  type Size,
  type TooltipPlacement
} from './Tutorial'

/**
 * T-34 regression, both halves.
 *
 * The coachmark's geometry only clamped 'top'/'bottom' placements, so a
 * 'left'/'right' step beside a wide target rendered past the window edge with
 * its buttons unreachable — Video Studio's step 2 at 1280x800, measured by
 * the E2E at a right edge of 1486 px. And Enter with focus off a button
 * advanced two steps at once.
 *
 * The E2E half is in tests/e2e/home-chrome.spec.ts: the clamp test drives the
 * real 1280x800 window and clicks the button that used to be off-screen, and
 * the full-run test pins Enter at exactly one step from both focus states.
 * These pin the decisions underneath, at every placement and against targets
 * the E2E cannot conveniently produce — one hard against each window edge,
 * one wider than the window, one that engulfs it.
 */
const VIEWPORT: Size = { width: 1280, height: 800 }

/** A card the size the real coachmark measures: full width, three-line copy. */
const CARD: Size = { width: TOOLTIP_MAX_WIDTH, height: 240 }

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function boxOf(style: React.CSSProperties, card = CARD): Box {
  expect(typeof style.left, `left is ${String(style.left)}`).toBe('number')
  expect(typeof style.top, `top is ${String(style.top)}`).toBe('number')
  // A placed card is positioned outright — no transform to unwind. Only the
  // centered fallback uses percentages.
  expect(style.transform).toBeUndefined()
  const left = Number(style.left)
  const top = Number(style.top)
  return { left, top, right: left + card.width, bottom: top + card.height }
}

function expectInsideViewport(
  style: React.CSSProperties,
  viewport = VIEWPORT,
  card = CARD
): void {
  const box = boxOf(style, card)
  expect(box.left).toBeGreaterThanOrEqual(TOOLTIP_MARGIN)
  expect(box.top).toBeGreaterThanOrEqual(TOOLTIP_MARGIN)
  expect(box.right).toBeLessThanOrEqual(viewport.width - TOOLTIP_MARGIN)
  expect(box.bottom).toBeLessThanOrEqual(viewport.height - TOOLTIP_MARGIN)
}

const PLACEMENTS: TooltipPlacement[] = ['top', 'bottom', 'left', 'right', 'center']
const SIDES: TooltipPlacement[] = ['top', 'bottom', 'left', 'right']

describe('computeTooltipPosition — centered fallbacks', () => {
  it.each(PLACEMENTS)('centers when no target resolved (%s)', (placement) => {
    expect(computeTooltipPosition(null, placement, VIEWPORT, CARD)).toEqual({
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)'
    })
  })

  it("centers a 'center' step even when a target did resolve", () => {
    const target = { top: 10, left: 10, width: 100, height: 100 }
    expect(computeTooltipPosition(target, 'center', VIEWPORT, CARD)).toEqual({
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)'
    })
  })

  it('treats a missing placement as bottom', () => {
    const target = { top: 100, left: 500, width: 200, height: 60 }
    expect(computeTooltipPosition(target, undefined, VIEWPORT, CARD)).toEqual(
      computeTooltipPosition(target, 'bottom', VIEWPORT, CARD)
    )
  })
})

describe('computeTooltipPosition — the requested side when it fits', () => {
  // A small target in the middle of the window: every side has room.
  const target = { top: 350, left: 560, width: 160, height: 100 }

  it('places a right step one margin past the target', () => {
    const style = computeTooltipPosition(target, 'right', VIEWPORT, CARD)
    expect(boxOf(style).left).toBe(target.left + target.width + TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('places a left step one margin before the target', () => {
    const style = computeTooltipPosition(target, 'left', VIEWPORT, CARD)
    expect(boxOf(style).right).toBe(target.left - TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('places a top step one margin above the target', () => {
    const style = computeTooltipPosition(target, 'top', VIEWPORT, CARD)
    expect(boxOf(style).bottom).toBe(target.top - TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('places a bottom step one margin below the target', () => {
    const style = computeTooltipPosition(target, 'bottom', VIEWPORT, CARD)
    expect(boxOf(style).top).toBe(target.top + target.height + TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it.each(SIDES)('centers a %s card on the target along the other axis', (placement) => {
    const box = boxOf(computeTooltipPosition(target, placement, VIEWPORT, CARD))
    if (placement === 'left' || placement === 'right') {
      expect((box.top + box.bottom) / 2).toBeCloseTo(target.top + target.height / 2, 5)
    } else {
      expect((box.left + box.right) / 2).toBeCloseTo(target.left + target.width / 2, 5)
    }
  })

  it('uses the measured card, not the pre-measurement estimate', () => {
    // Same target, a card 80 px shorter: a right-placed card is centered on
    // the target, so its top moves by half the difference. If the geometry
    // ignored the measurement these would be identical.
    const shorter = computeTooltipPosition(target, 'right', VIEWPORT, {
      width: CARD.width,
      height: CARD.height - 80
    })
    const taller = computeTooltipPosition(target, 'right', VIEWPORT, CARD)
    expect(Number(shorter.top) - Number(taller.top)).toBe(40)
  })
})

describe('computeTooltipPosition — flipping rather than shrinking', () => {
  it('flips a right step to the left when the right edge is too close', () => {
    const target = { top: 300, left: 1100, width: 120, height: 80 }
    const style = computeTooltipPosition(target, 'right', VIEWPORT, CARD)
    expect(boxOf(style).right).toBe(target.left - TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('flips a left step to the right when the left edge is too close', () => {
    const target = { top: 300, left: 40, width: 120, height: 80 }
    const style = computeTooltipPosition(target, 'left', VIEWPORT, CARD)
    expect(boxOf(style).left).toBe(target.left + target.width + TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('flips a top step below the target when there is no headroom', () => {
    const target = { top: 20, left: 500, width: 200, height: 80 }
    const style = computeTooltipPosition(target, 'top', VIEWPORT, CARD)
    expect(boxOf(style).top).toBe(target.top + target.height + TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('flips a bottom step above the target when there is no room below', () => {
    const target = { top: 700, left: 500, width: 200, height: 80 }
    const style = computeTooltipPosition(target, 'bottom', VIEWPORT, CARD)
    expect(boxOf(style).bottom).toBe(target.top - TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('falls back to the cross axis when neither side fits', () => {
    // Video Studio's importer: the whole content column, so a 'right' step has
    // no room on either side. Below it is where the card belongs.
    const target = { top: 120, left: 24, width: 1000, height: 200 }
    const style = computeTooltipPosition(target, 'right', VIEWPORT, CARD)
    expect(boxOf(style).top).toBe(target.top + target.height + TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('falls back past bottom to top when the target is wide AND low', () => {
    const target = { top: 420, left: 24, width: 1000, height: 300 }
    const style = computeTooltipPosition(target, 'right', VIEWPORT, CARD)
    expect(boxOf(style).bottom).toBe(target.top - TOOLTIP_MARGIN)
    expectInsideViewport(style)
  })

  it('never shrinks: the card keeps its full size at every placement', () => {
    const target = { top: 120, left: 24, width: 1000, height: 200 }
    for (const placement of SIDES) {
      const box = boxOf(computeTooltipPosition(target, placement, VIEWPORT, CARD))
      expect(box.right - box.left).toBe(CARD.width)
      expect(box.bottom - box.top).toBe(CARD.height)
    }
  })

  it('leaves room for the card between its own edge and the window', () => {
    // The clamp guarantee the measure/position loop depends on: whatever the
    // placement, CSS shrink-to-fit can never squeeze the card, because there
    // is always more room to its right than it occupies.
    const target = { top: 120, left: 24, width: 1000, height: 200 }
    for (const placement of SIDES) {
      const box = boxOf(computeTooltipPosition(target, placement, VIEWPORT, CARD))
      expect(VIEWPORT.width - box.left).toBeGreaterThanOrEqual(CARD.width + TOOLTIP_MARGIN)
    }
  })
})

describe('computeTooltipPosition — the clamp of last resort', () => {
  /**
   * A target that fills the window: no side fits and neither cross-axis
   * fallback does either, so the card has to overlap it. It still may not
   * leave the window — that is the whole of T-34.
   */
  const engulfing = { top: 0, left: 0, width: 1280, height: 800 }

  it.each(SIDES)('keeps a %s step inside the window anyway', (placement) => {
    expectInsideViewport(computeTooltipPosition(engulfing, placement, VIEWPORT, CARD))
  })

  it.each(SIDES)('keeps a %s step inside for a target past the right/bottom edge', (placement) => {
    const offscreen = { top: 900, left: 1400, width: 300, height: 200 }
    expectInsideViewport(computeTooltipPosition(offscreen, placement, VIEWPORT, CARD))
  })

  it.each(SIDES)('keeps a %s step inside for a target past the left/top edge', (placement) => {
    const offscreen = { top: -300, left: -500, width: 300, height: 200 }
    expectInsideViewport(computeTooltipPosition(offscreen, placement, VIEWPORT, CARD))
  })

  it.each(SIDES)('pins a %s step to the margin in a window smaller than the card', (placement) => {
    // Below the app's 1024x640 floor, but the range must not invert.
    const tiny = { width: 320, height: 240 }
    const target = { top: 100, left: 100, width: 100, height: 40 }
    const box = boxOf(computeTooltipPosition(target, placement, tiny, CARD))
    expect(box.left).toBe(TOOLTIP_MARGIN)
    expect(box.top).toBe(TOOLTIP_MARGIN)
  })

  it('discriminates: the pre-T-34 formula for that same step really was off-screen', () => {
    // The old code returned `left: target.left + target.width + margin` with
    // no clamp on that axis, which is how the E2E measured a right edge of
    // 1486 px in a 1280 px window.
    const target = { top: 120, left: 24, width: 1000, height: 200 }
    const unclamped = target.left + target.width + TOOLTIP_MARGIN
    expect(unclamped + CARD.width).toBeGreaterThan(VIEWPORT.width)
    expectInsideViewport(computeTooltipPosition(target, 'right', VIEWPORT, CARD))
  })
})

describe('computeTooltipPosition — input validation', () => {
  const target = { top: 10, left: 10, width: 10, height: 10 }

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a viewport width of %p',
    (width) => {
      expect(() => computeTooltipPosition(target, 'right', { width, height: 800 }, CARD)).toThrow(
        /viewport\.width/
      )
    }
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a viewport height of %p',
    (height) => {
      expect(() => computeTooltipPosition(target, 'right', { width: 1280, height }, CARD)).toThrow(
        /viewport\.height/
      )
    }
  )

  it('starts from an estimate wide enough for the className it mirrors', () => {
    // max-w-md is 28rem = 448px. The estimate only has to be an upper bound
    // for the single pass before the real card is measured.
    expect(TOOLTIP_MAX_WIDTH).toBe(448)
    expect(TOOLTIP_MAX_HEIGHT).toBeGreaterThan(CARD.height)
  })
})

describe('tutorialKeyIntent', () => {
  it('advances on ArrowRight from anywhere', () => {
    expect(tutorialKeyIntent({ key: 'ArrowRight', onButton: false })).toBe('next')
    expect(tutorialKeyIntent({ key: 'ArrowRight', onButton: true })).toBe('next')
  })

  it('goes back on ArrowLeft from anywhere', () => {
    expect(tutorialKeyIntent({ key: 'ArrowLeft', onButton: false })).toBe('prev')
    expect(tutorialKeyIntent({ key: 'ArrowLeft', onButton: true })).toBe('prev')
  })

  it('closes on Escape from anywhere', () => {
    expect(tutorialKeyIntent({ key: 'Escape', onButton: false })).toBe('close')
    expect(tutorialKeyIntent({ key: 'Escape', onButton: true })).toBe('close')
  })

  it('takes Enter when focus is off a button', () => {
    expect(tutorialKeyIntent({ key: 'Enter', onButton: false })).toBe('next')
  })

  it('leaves Enter to the button when focus is on one (T-34 double-advance)', () => {
    // The window handler consumes and preventDefaults the Enter it owns, so
    // if it ALSO ran here the one keypress would advance twice: once for the
    // button's own activation and once for us.
    expect(tutorialKeyIntent({ key: 'Enter', onButton: true })).toBe('none')
  })

  it.each([' ', 'a', 'Tab', 'ArrowUp', 'ArrowDown', 'Backspace'])('ignores %p', (key) => {
    expect(tutorialKeyIntent({ key, onButton: false })).toBe('none')
    expect(tutorialKeyIntent({ key, onButton: true })).toBe('none')
  })
})
