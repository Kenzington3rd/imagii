import { describe, it, expect } from 'vitest'
import { REPEAT_SWALLOW_MS, isRepeatPress, isSwallowedRepeat } from './repeatPress'

// T-131 (4), (6), (8): the rule is the click COUNT. The e2e specs (a real double-click on the Fix wizard, the tour, a closing dialog) are
// the proof it reaches the person; this is the rule they depend on, with its edges.
describe('isRepeatPress - the second press of a double-click is not a new decision (T-131 (4), (6))', () => {
  it('the first click, and a keyboard activation (a click with no count), are decisions', () => {
    expect(isRepeatPress({ detail: 1 })).toBe(false)
    expect(isRepeatPress({ detail: 0 })).toBe(false)
  })

  it.each([2, 3, 4])('click number %i of a run is a repeat', (detail) => {
    expect(isRepeatPress({ detail })).toBe(true)
  })
})

describe('isSwallowedRepeat - a repeat that lands just after a dialog closed never reaches the page (T-131 (8))', () => {
  const until = 1_000 + REPEAT_SWALLOW_MS

  it('a repeat inside the window is dropped', () => {
    expect(isSwallowedRepeat({ detail: 2, timeStamp: 1_100 }, until)).toBe(true)
    expect(isSwallowedRepeat({ detail: 3, timeStamp: until - 1 }, until)).toBe(true)
  })

  it('a repeat after the window is a press like any other', () => {
    expect(isSwallowedRepeat({ detail: 2, timeStamp: until }, until)).toBe(false)
    expect(isSwallowedRepeat({ detail: 2, timeStamp: until + 400 }, until)).toBe(false)
  })

  it('a first click is never dropped, inside the window or not: only a repeat is', () => {
    expect(isSwallowedRepeat({ detail: 1, timeStamp: 1_100 }, until)).toBe(false)
    expect(isSwallowedRepeat({ detail: 0, timeStamp: 1_100 }, until)).toBe(false)
  })

  it('the window is half a second (a person\'s second press lands in 60-300 ms)', () => {
    expect(REPEAT_SWALLOW_MS).toBe(500)
  })
})
