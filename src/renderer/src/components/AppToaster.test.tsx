import { describe, it, expect } from 'vitest'
import type { ReactElement } from 'react'
import { AppToaster, TOAST_STYLE } from './AppToaster'

/**
 * T-92 regression: an 8-second action toast made the old behavior four times
 * worse. react-hot-toast draws every card with `pointer-events: auto`, so a toast
 * sitting over the Export button swallowed the click for its whole life (and the
 * library pauses a hovered toast, so a parked pointer kept it alive). The card is
 * click-through now; this pins the one style that makes it so, on the element the
 * app actually mounts. The behavior itself — a click landing on the control
 * UNDER a live toast — is image.spec.ts's emote-pack test and the hit-test in
 * video-pipelines.spec.ts (`expectToastClickThrough`).
 */
describe('AppToaster', () => {
  it('styles every toast card click-through', () => {
    expect(TOAST_STYLE.pointerEvents).toBe('none')
    const toaster = AppToaster() as ReactElement<{
      toastOptions?: { style?: { pointerEvents?: string } }
    }>
    expect(toaster.props.toastOptions?.style?.pointerEvents).toBe('none')
  })

  // T-133 (2): react-hot-toast styles the message `white-space: pre-line` in a 350 px card with no overflow-wrap, so a file name with no
  // break opportunity (an underscores-only name, a long hash) ran outside the card in a real render, by as much as the name was long (81 px for
  // one name, 228 px for the 90-underscore one the e2e uses). The six `Saved ${basename}`
  // sites and T-132's "Extracted the sound from" toast all quote a file name the person chose. `anywhere` (not `break-word`) also lets the
  // card's min-content shrink, so the word breaks inside the 350 px instead of widening the card.
  it('lets a long unbroken file name wrap inside the card (T-133 (2))', () => {
    expect(TOAST_STYLE.overflowWrap).toBe('anywhere')
    const toaster = AppToaster() as ReactElement<{
      toastOptions?: { style?: { overflowWrap?: string } }
    }>
    expect(toaster.props.toastOptions?.style?.overflowWrap).toBe('anywhere')
  })

  it('keeps the look the token tests pin (colors still come from the tokens)', () => {
    expect(TOAST_STYLE.background).toMatch(/^#/)
    expect(TOAST_STYLE.border).toMatch(/^1px solid /)
  })
})
