import { describe, it, expect, beforeEach } from 'vitest'
import { createGestureEnd, endsGestureOnPointerUp } from './gestureEnd'

// T-148: the one rule that closes a coalescing card's undo window, for the slider cards and the cards with text fields alike. The window's own one-shot release
// listener is faked here (`releases`): the real one is `addEventListener('pointerup', ..., { once, capture })`. The DOM is faked too: a target is `{ tagName, type }`
// and `focused` is the element `document.activeElement` would be.
let ended = 0
let releases: Array<() => void> = []
let focused: unknown = null
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
    (listener) => releases.push(listener),
    () => focused
  )
const field = (tagName: string, type?: string): { tagName: string; type?: string } => ({ tagName, type })

beforeEach(() => {
  ended = 0
  releases = []
  focused = null
})

describe('createGestureEnd: the press and the blur (T-147, T-78)', () => {
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

  it('the pointer going up ends the gesture, and a blur after it ends one more (the next run is its own)', () => {
    const g = make()
    g.onPointerDown()
    g.onPointerUp({ target: field('INPUT', 'range') })
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
    a.onPointerUp({ target: field('DIV') })
    a.onPointerDown()
    expect(releases).toHaveLength(2)
  })
})

describe('createGestureEnd: the text-field rule on the release (T-80)', () => {
  it('a release inside the focused text field is not an end: a caret click mid-edit', () => {
    const g = make()
    const text = field('INPUT', 'text')
    focused = text
    g.onPointerDown()
    g.onPointerUp({ target: text })
    expect(ended).toBe(0)
    const area = field('TEXTAREA')
    focused = area
    g.onPointerDown()
    g.onPointerUp({ target: area })
    expect(ended).toBe(0)
  })

  it('the same release ends the gesture once the field is not the focused one, and on anything that is not a field', () => {
    const g = make()
    focused = field('INPUT', 'text') // some other element has focus
    g.onPointerUp({ target: field('INPUT', 'text') })
    expect(ended, 'a slider drag that finished over an unfocused text box').toBe(1)
    g.onPointerUp({ target: field('DIV') })
    expect(ended).toBe(2)
  })

  it('a slider, a box or a button released while focused still ends the gesture (T-40)', () => {
    const g = make()
    for (const type of ['range', 'checkbox', 'color', 'button']) {
      const el = field('INPUT', type)
      focused = el
      g.onPointerUp({ target: el })
    }
    expect(ended).toBe(4)
  })

  it('a release with no usable target (an SVG child, no target at all) ends the gesture', () => {
    const g = make()
    g.onPointerUp({ target: null })
    g.onPointerUp({ target: {} })
    expect(ended).toBe(2)
  })

  it('the release inside a focused text field still clears the press, so the blur that follows ends the edit', () => {
    const g = make()
    const text = field('INPUT', 'text')
    focused = text
    g.onPointerDown()
    g.onPointerUp({ target: text })
    g.onBlur()
    expect(ended, 'a text field\'s gesture ends on blur').toBe(1)
  })
})

describe('endsGestureOnPointerUp - a caret click is not a gesture end (T-80)', () => {
  const FOCUSED = true

  it('lets a release inside the focused text field through', () => {
    expect(endsGestureOnPointerUp('INPUT', 'text', FOCUSED)).toBe(false)
    expect(endsGestureOnPointerUp('TEXTAREA', null, FOCUSED)).toBe(false)
  })

  it('treats every text-like input type the same', () => {
    for (const type of ['text', 'number', 'search', 'url', 'email', 'password']) {
      expect(endsGestureOnPointerUp('INPUT', type, FOCUSED), type).toBe(false)
    }
  })

  it('treats a missing or unrecognized type as text entry', () => {
    // The DOM reports 'text' for both, but the predicate is handed whatever the caller read: neither answer may end an edit in progress.
    expect(endsGestureOnPointerUp('INPUT', null, FOCUSED)).toBe(false)
    expect(endsGestureOnPointerUp('INPUT', 'not-a-real-type', FOCUSED)).toBe(false)
  })

  it('still ends the gesture when a slider or a box is released: T-40 stands', () => {
    for (const type of ['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset']) {
      expect(endsGestureOnPointerUp('INPUT', type, FOCUSED), type).toBe(true)
    }
  })

  it('ends the gesture on anything that is not a field', () => {
    for (const tag of ['DIV', 'BUTTON', 'SELECT', 'SPAN', 'LABEL', 'svg']) {
      expect(endsGestureOnPointerUp(tag, null, FOCUSED), tag).toBe(true)
    }
  })

  it('ends the gesture over a text field that is NOT focused', () => {
    // A drag that began on a slider and happens to finish over a caption box is still the slider's gesture ending. Only the focused field is mid-edit.
    expect(endsGestureOnPointerUp('INPUT', 'text', false)).toBe(true)
    expect(endsGestureOnPointerUp('TEXTAREA', null, false)).toBe(true)
  })

  it('reads the tag and type case-insensitively, as the DOM spells them', () => {
    expect(endsGestureOnPointerUp('input', 'TEXT', FOCUSED)).toBe(false)
    expect(endsGestureOnPointerUp('input', 'Range', FOCUSED)).toBe(true)
    expect(endsGestureOnPointerUp('textarea', null, FOCUSED)).toBe(false)
  })
})
