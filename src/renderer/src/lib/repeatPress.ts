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
 */
export function swallowRepeatClicks(now: number = performance.now()): void {
  swallowUntil = now + REPEAT_SWALLOW_MS
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
