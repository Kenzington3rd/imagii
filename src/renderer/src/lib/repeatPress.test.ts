import { describe, it, expect } from 'vitest'
import { REPEAT_SWALLOW_MS, createHeldKeyGuard, isRepeatPress, isSwallowedRepeat } from './repeatPress'

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

// T-133 (7a): the keyboard half of the same boundary. A held Enter on the tour's Done (or a Modal's confirm) closes the dialog on its first
// press; focus goes back to the control that opened it ("?"), and the key's AUTO-REPEATS are keyboard clicks on that control (`detail` 0, so no
// click rule can tell them from a decision): the tour reopened itself. The rule is about the key, not the clock: the first repeat arrives after the
// OS's repeat delay (250 ms to 1 s on Windows), which can be later than any fixed window, so what is guarded is "the Enter/Space that was down
// when the dialog closed, until it is let go".
describe('createHeldKeyGuard - a key held through a closing dialog does not act on what is under it (T-133 (7a))', () => {
  const press = (key: string, repeat = false): { key: string; repeat: boolean } => ({ key, repeat })

  it('the repeats of an Enter that was down when the dialog closed are swallowed, however late the first one comes', () => {
    const guard = createHeldKeyGuard()
    expect(guard.keyDown(press('Enter'))).toBe(false) // the press that closed the dialog
    guard.dialogClosed()
    expect(guard.keyDown(press('Enter', true))).toBe(true)
    expect(guard.keyDown(press('Enter', true))).toBe(true)
  })

  it('Space is guarded the same way (a checkbox toggles, a button clicks, on its repeats)', () => {
    const guard = createHeldKeyGuard()
    guard.keyDown(press(' '))
    guard.dialogClosed()
    expect(guard.keyDown(press(' ', true))).toBe(true)
  })

  it('letting go ends it: the next press is a decision, and so are its repeats if no dialog closed in between', () => {
    const guard = createHeldKeyGuard()
    guard.keyDown(press('Enter'))
    guard.dialogClosed()
    expect(guard.keyDown(press('Enter', true))).toBe(true)
    guard.keyUp({ key: 'Enter' })
    expect(guard.keyDown(press('Enter'))).toBe(false)
    expect(guard.keyDown(press('Enter', true)), 'a fresh hold is the tour/wizard\'s own rule (T-132 (6)), not this guard\'s').toBe(false)
  })

  it('a fresh press while still guarded (the up event was lost) clears the guard', () => {
    const guard = createHeldKeyGuard()
    guard.keyDown(press('Enter'))
    guard.dialogClosed()
    expect(guard.keyDown(press('Enter'))).toBe(false)
    expect(guard.keyDown(press('Enter', true))).toBe(false)
  })

  it('only the key that was down is guarded: a key pressed after the close, any other key, and a repeat nobody saw begin pass', () => {
    const guard = createHeldKeyGuard()
    guard.keyDown(press('Enter'))
    guard.dialogClosed()
    expect(guard.keyDown(press(' ', true)), 'Space was not down at the close').toBe(false)
    expect(guard.keyDown(press('ArrowRight', true)), 'the nudge and frame-step keys repeat by design').toBe(false)
    expect(guard.keyDown(press('a', true))).toBe(false)
    const cold = createHeldKeyGuard()
    cold.dialogClosed()
    expect(cold.keyDown(press('Enter', true)), 'nothing was held at the close').toBe(false)
  })

  it('a window that lost focus forgets what was held (its key-up never arrives)', () => {
    const guard = createHeldKeyGuard()
    guard.keyDown(press('Enter'))
    guard.dialogClosed()
    guard.reset()
    expect(guard.keyDown(press('Enter', true))).toBe(false)
  })

  it('a dialog that closes after the key was let go guards nothing', () => {
    const guard = createHeldKeyGuard()
    guard.keyDown(press('Enter'))
    guard.keyUp({ key: 'Enter' })
    guard.dialogClosed()
    expect(guard.keyDown(press('Enter', true))).toBe(false)
  })
})
