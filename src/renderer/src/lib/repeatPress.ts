/**
 * The second press of a double-click (T-131 (4), (6), (8)).
 *
 * A button that REPLACES itself with another when it is pressed (the Fix wizard's answers, the tour's Next) puts the next one under the
 * pointer, and a person who double-clicks lands the second press on it. The browser says so: the `detail` of a `click` is its count in
 * the run (1, then 2), and a held key or a keyboard activation has none (0). A press with a count above 1 is a repeat of the decision the
 * first one made, not a new one - T-120 gave the held Enter key the same rule (`ignoreHeldEnter`).
 */
export function isRepeatPress(e: { detail: number }): boolean {
  return e.detail > 1
}

/** How long after a dialog goes away its double-click's second press is dropped (a person's second press lands within ~100-300 ms). */
export const REPEAT_SWALLOW_MS = 500

/**
 * Is this click the repeat of a double-click on something that has just closed? A repeat (`detail` above 1) that lands before `until`.
 * Pure, so the rule is a unit test; the listener below only feeds it.
 */
export function isSwallowedRepeat(e: { detail: number; timeStamp: number }, until: number): boolean {
  return e.detail > 1 && e.timeStamp < until
}

/**
 * T-133 (7a): the keys whose auto-repeat is a click on whatever has focus - Enter (a button's keydown clicks it, repeats included) and Space
 * (a checkbox or a button, on release; a repeat still scrolls or toggles in some controls).
 */
const HELD_KEYS: ReadonlySet<string> = new Set(['Enter', ' '])

/**
 * Which of Enter / Space are down, and which of those were down when a dialog closed. Pure (the window listeners below only feed it), so the
 * rule is a unit test.
 *
 * Why the key and not the clock: a held Enter on the tour's Done closes the tour with its FIRST press and focus goes back to the "?" that
 * opened it; the key's auto-repeats are keyboard clicks (`detail` 0) on that button, which no click rule can tell from a decision, and the
 * tour reopened. The first repeat arrives after the OS's repeat delay (250 ms to 1 s on Windows), later than a fixed window can promise, so
 * what is guarded is "the key that was down at the close, until it is let go". A fresh press (not a repeat) is a decision and clears it.
 */
export function createHeldKeyGuard(): {
  keyDown: (e: { key: string; repeat: boolean }) => boolean
  keyUp: (e: { key: string }) => void
  dialogClosed: () => void
  reset: () => void
} {
  const down = new Set<string>()
  let guarded = new Set<string>()
  return {
    /** True when this keydown must be swallowed: a repeat of a key that was held through a closing dialog. */
    keyDown(e) {
      if (!HELD_KEYS.has(e.key)) return false
      if (!e.repeat) {
        down.add(e.key)
        guarded.delete(e.key)
        return false
      }
      return guarded.has(e.key)
    },
    keyUp(e) {
      down.delete(e.key)
      guarded.delete(e.key)
    },
    dialogClosed() {
      guarded = new Set(down)
    },
    /** The window lost focus: a key-up that happens elsewhere never arrives. */
    reset() {
      down.clear()
      guarded.clear()
    }
  }
}

const heldKeys = createHeldKeyGuard()

// Listening starts when this module loads, not at the first close: the guard has to have SEEN the Enter go down to know it is held when
// the dialog goes away. (Node, where the unit tests run, has no window.)
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!heldKeys.keyDown(e)) return
      e.stopImmediatePropagation()
      e.preventDefault()
    },
    true
  )
  window.addEventListener('keyup', (e) => heldKeys.keyUp(e), true)
  window.addEventListener('blur', () => heldKeys.reset())
}

let swallowUntil = 0
let listening = false

/**
 * A dialog has just closed: for the next `REPEAT_SWALLOW_MS`, a repeat press never reaches the page under it.
 *
 * The first press of a double-click on a dialog's button closes the dialog, and the second lands where that button was, on whatever the
 * dialog covered (executed: "Keep running" double-clicked mid-batch flipped the Facebook checkbox beneath it). `Modal`'s scrim already
 * ignores a repeat on ITSELF (T-127 (8)); this covers everything else the card stood over. One listener, installed on the first close,
 * in the capture phase of the window, so it runs before React's: the click is stopped before any handler or default action (a checkbox's
 * toggle) sees it. Only clicks with a count above 1 are touched, so nothing else is delayed, and the window is half a second.
 * T-133 (7a): a HELD Enter or Space is the keyboard's double-click and gets the same protection, by key (see `createHeldKeyGuard`).
 */
export function swallowRepeatClicks(now: number = performance.now()): void {
  swallowUntil = now + REPEAT_SWALLOW_MS
  // T-133 (7a): and the same dialog's HELD KEY (Enter or Space) stops acting until it is let go.
  heldKeys.dialogClosed()
  if (listening) return
  listening = true
  window.addEventListener(
    'click',
    (e) => {
      if (!isSwallowedRepeat(e, swallowUntil)) return
      e.stopImmediatePropagation()
      e.preventDefault()
    },
    true
  )
}
