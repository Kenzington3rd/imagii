import { describe, it, expect, vi, afterEach } from 'vitest'
import { REPEAT_SWALLOW_MS, createHeldKeyGuard, holdHeldKeys, ignoreHeldEnter, isRepeatPress, isSwallowedRepeat } from './repeatPress'

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

// T-141 (4): the Fix wizard's rule (T-120), now shared with the two preset Save buttons. The e2e specs hold the press itself (a held Enter on the focused
// button saves once, in Audio Studio and in the Custom export presets dialog, and the wizard's own case); this is the rule they depend on, with its edges.
describe('ignoreHeldEnter - a held Enter is one press (T-120, T-141 (4))', () => {
  /** A keyboard event stand-in that says whether its default action (the click) was canceled. */
  const press = (key: string, repeat: boolean): { key: string; repeat: boolean; preventDefault: () => void; canceled: boolean } => {
    const e = { key, repeat, canceled: false, preventDefault: () => { e.canceled = true } }
    return e
  }

  it('the auto-repeat of Enter has its default action (the click) canceled', () => {
    const e = press('Enter', true)
    ignoreHeldEnter(e)
    expect(e.canceled).toBe(true)
  })

  it('a fresh Enter is a decision: its default action is left alone', () => {
    const e = press('Enter', false)
    ignoreHeldEnter(e)
    expect(e.canceled).toBe(false)
  })

  it('only Enter is guarded: a repeat of any other key (a nudge, Space, a letter) keeps its default action', () => {
    for (const key of [' ', 'ArrowRight', 'a', 'Tab', 'Escape']) {
      const e = press(key, true)
      ignoreHeldEnter(e)
      expect(e.canceled, key).toBe(false)
    }
  })
})

// T-168 (6): the swallow covered `click` only. The repeat's `mousedown` still landed - on the tour's Done (the card closes on the first press) that
// focused and opened the Watermark position <select> under it, and its native popup swallowed the next key. The rule is the same one for all three
// events a press is made of, from ONE handler; the e2e case (a real double-click on Done) is the proof it reaches the person.
describe('swallowRepeatClicks - the whole repeat press is stopped, not only its click (T-168 (6))', () => {
  type Handler = (e: unknown) => void
  /** Install the listeners on a stand-in window, in a fresh module (its `listening` flag is module state), and hand back what was registered. */
  async function install(): Promise<{ handlers: Map<string, Handler>; capture: Map<string, unknown>; swallow: (now: number) => void }> {
    vi.resetModules()
    const handlers = new Map<string, Handler>()
    const capture = new Map<string, unknown>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: Handler, useCapture: unknown) => {
        handlers.set(type, fn)
        capture.set(type, useCapture)
      }
    })
    const mod = await import('./repeatPress')
    return { handlers, capture, swallow: (now) => mod.swallowRepeatClicks(now) }
  }
  const press = (detail: number, timeStamp: number): { detail: number; timeStamp: number; stopped: boolean; canceled: boolean; stopImmediatePropagation: () => void; preventDefault: () => void } => {
    const e = {
      detail, timeStamp, stopped: false, canceled: false,
      stopImmediatePropagation: () => { e.stopped = true },
      preventDefault: () => { e.canceled = true }
    }
    return e
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['mousedown', 'mouseup', 'click'])('a detail-2 %s inside the window is stopped and its default action is canceled', async (type) => {
    const { handlers, capture, swallow } = await install()
    swallow(1_000)
    const handler = handlers.get(type)
    expect(handler, `a ${type} listener is registered`).toBeTypeOf('function')
    expect(capture.get(type), `${type} is heard in the capture phase, before React's handlers`).toBe(true)
    const e = press(2, 1_100)
    handler?.(e)
    expect(e.stopped).toBe(true)
    expect(e.canceled).toBe(true)
  })

  it.each(['mousedown', 'mouseup', 'click'])('a first %s (detail 1) inside the window is a press like any other', async (type) => {
    const { handlers, swallow } = await install()
    swallow(1_000)
    const e = press(1, 1_100)
    handlers.get(type)?.(e)
    expect(e.stopped).toBe(false)
    expect(e.canceled).toBe(false)
  })

  it.each(['mousedown', 'mouseup', 'click'])('a detail-2 %s after the window has passed is a press like any other', async (type) => {
    const { handlers, swallow } = await install()
    swallow(1_000)
    const e = press(2, 1_000 + REPEAT_SWALLOW_MS)
    handlers.get(type)?.(e)
    expect(e.stopped).toBe(false)
    expect(e.canceled).toBe(false)
  })

  it('a second close does not stack listeners, but it does move the window', async () => {
    const { handlers, swallow } = await install()
    swallow(1_000)
    const first = handlers.get('mousedown')
    swallow(5_000)
    expect(handlers.get('mousedown')).toBe(first)
    const e = press(2, 5_100)
    first?.(e)
    expect(e.stopped).toBe(true)
  })
})

// T-191 (1), (2): a press that hands focus to another control inside its own keydown (a dialog's first control, the control before an unmounted menu) leaves the
// key down, and the key's auto-repeats are clicks on that control. `holdHeldKeys` is the held-key guard's rule applied at an OPEN or a focus move instead of a
// close; the e2e cases (Variants, Templates, the safe-zone question, Clear list, a pick) are the proof it reaches the person, this is the rule with its edges.
describe('holdHeldKeys - a key still down when a press hands focus elsewhere stops acting until it is let go (T-191)', () => {
  type Handler = (e: unknown) => void
  type KeyEvent = { key: string; repeat: boolean; stopped: boolean; canceled: boolean; stopImmediatePropagation: () => void; preventDefault: () => void }
  const key = (k: string, repeat: boolean): KeyEvent => {
    const e: KeyEvent = { key: k, repeat, stopped: false, canceled: false, stopImmediatePropagation: () => { e.stopped = true }, preventDefault: () => { e.canceled = true } }
    return e
  }
  /** The module in a fresh state, listening on a stand-in window; `send` runs the registered handler for one event type. */
  async function install(): Promise<{ hold: () => void; send: (type: 'keydown' | 'keyup' | 'blur', e?: unknown) => void }> {
    vi.resetModules()
    const handlers = new Map<string, Handler>()
    vi.stubGlobal('window', { addEventListener: (type: string, fn: Handler) => { handlers.set(type, fn) } })
    const mod = await import('./repeatPress')
    return { hold: () => mod.holdHeldKeys(), send: (type, e) => handlers.get(type)?.(e) }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is exported, and the guard has a method for it beside dialogClosed (which still works)', () => {
    expect(holdHeldKeys).toBeTypeOf('function')
    const guard = createHeldKeyGuard()
    guard.keyDown({ key: 'Enter', repeat: false })
    guard.hold()
    expect(guard.keyDown({ key: 'Enter', repeat: true })).toBe(true)
    const closed = createHeldKeyGuard()
    closed.keyDown({ key: 'Enter', repeat: false })
    closed.dialogClosed()
    expect(closed.keyDown({ key: 'Enter', repeat: true })).toBe(true)
  })

  it('an Enter that is down is stopped and its default action (the click) canceled for every repeat, until it is let go', async () => {
    const { hold, send } = await install()
    send('keydown', key('Enter', false))
    hold()
    for (let i = 0; i < 3; i++) {
      const repeat = key('Enter', true)
      send('keydown', repeat)
      expect(repeat.stopped, `repeat ${i + 1} is stopped before any handler`).toBe(true)
      expect(repeat.canceled, `repeat ${i + 1} has no click`).toBe(true)
    }
    send('keyup', { key: 'Enter' })
    const next = key('Enter', true)
    send('keydown', next)
    expect(next.stopped, 'let go ends it').toBe(false)
  })

  it('a fresh press acts, and clears the hold', async () => {
    const { hold, send } = await install()
    send('keydown', key('Enter', false))
    hold()
    const fresh = key('Enter', false)
    send('keydown', fresh)
    expect(fresh.stopped).toBe(false)
    expect(fresh.canceled).toBe(false)
    const after = key('Enter', true)
    send('keydown', after)
    expect(after.stopped, 'the key pressed again is a new hold, not the old one').toBe(false)
  })

  it('does nothing for keys that were up: a dialog the mouse opened, another key, and a repeat nobody saw begin', async () => {
    const { hold, send } = await install()
    hold()
    const mouse = key('Enter', true)
    send('keydown', mouse)
    expect(mouse.stopped, 'nothing was down at the open').toBe(false)
    send('keydown', key('Enter', false))
    hold()
    for (const other of [' ', 'ArrowRight', 'a']) {
      const e = key(other, true)
      send('keydown', e)
      expect(e.stopped, `${other} was not down`).toBe(false)
      expect(e.canceled).toBe(false)
    }
  })

  it('a window that lost focus forgets the hold (its key-up never arrives)', async () => {
    const { hold, send } = await install()
    send('keydown', key('Enter', false))
    hold()
    send('blur')
    const e = key('Enter', true)
    send('keydown', e)
    expect(e.stopped).toBe(false)
  })
})
