import { describe, it, expect, beforeEach } from 'vitest'
import { createGestureEnd } from './gestureEnd'

// T-147 (T-78): the handlers that close a slider's undo window. A press moves focus, and the control that LOSES it blurs after the slider's first `input` event, so a blur
// during a press must not end the gesture (it split the first drag after any click in the card into two steps); the pointer going up ends it, and a keyboard blur ends a run
// of arrow keys. The window's own release listener is faked here (`releases`): the real one is `addEventListener('pointerup', ..., { once, capture })`.
let ended = 0
let releases: Array<() => void> = []
const release = (): void => {
  const fire = releases
  releases = []
  fire.forEach((f) => f())
}
const make = () =>
  createGestureEnd(
    () => {
      ended += 1
    },
    (listener) => releases.push(listener)
  )

beforeEach(() => {
  ended = 0
  releases = []
})

describe('createGestureEnd', () => {
  it('a blur with no press ends the gesture (a keyboard move off a slider, a click outside)', () => {
    const g = make()
    g.onBlur()
    expect(ended).toBe(1)
  })

  it('a blur while the pointer is down does not: it is the press moving focus', () => {
    const g = make()
    g.onPointerDown()
    g.onBlur()
    expect(ended, 'the drag is still going').toBe(0)
  })

  it('the pointer going up on the card ends the gesture, and a blur after it ends one more (the next run is its own)', () => {
    const g = make()
    g.onPointerDown()
    g.onPointerUp()
    expect(ended).toBe(1)
    g.onBlur()
    expect(ended).toBe(2)
  })

  it('a release that lands OUTSIDE the card clears the flag, so the next keyboard blur ends a run again', () => {
    const g = make()
    g.onPointerDown()
    expect(releases, 'the one-shot release listener is registered on every press').toHaveLength(1)
    release() // the window saw the pointer go up somewhere else: the card's own onPointerUp never ran
    g.onBlur()
    expect(ended).toBe(1)
  })

  it('each press registers its own release, and two instances do not share a flag', () => {
    const a = make()
    const b = make()
    a.onPointerDown()
    b.onBlur()
    expect(ended, 'a press in one card is no reason to hold another card\'s blur').toBe(1)
    a.onPointerUp()
    a.onPointerDown()
    expect(releases).toHaveLength(2)
  })
})
