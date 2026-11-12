import { holdHeldKeys } from './repeatPress'

/**
 * T-192 (3): the keyboard keeps its place when a press swaps a studio between its importer and its editor.
 *
 * STYLE_GUIDE's swap rule says the new content's primary control takes the focus the removed control lost. Inside ONE component the swap's own render can
 * read `document.activeElement` (the other sites do), but these swaps cross components and take time: a studio's importer is unmounted by the file it
 * loaded (a native chooser, a conversion, a waveform read), and its Close is unmounted by the importer it brings back. The press therefore records "the control
 * this press came from had focus" HERE, in module scope (Record's T-189 press-recorded flags, which have to survive the swap), under the name of the control
 * the new content will put focus on; the new content's own effect asks for it once its control can take focus.
 *
 * Each held record carries its press (T-193 (1)): `record` returns a token, and a press that ends without a swap drops only ITS token, so a press turned away or failed
 * never clears the record of another press that is still on its way.
 *
 * The target is named so one press's flag can only be spent by the content it was recorded for (a Stream Graphics press never moves focus in Audio Studio),
 * and one flag is held at a time (a newer press replaces it). `take` spends it whichever way it answers; it answers yes only while focus is on `<body>` or
 * nowhere (the swap dropped it), so focus the person has put on another control is left where it is. A press that FAILS (a canceled chooser, a refused load)
 * `drop`s it, so a later swap by other means (a drop, a project opened from Home, an autosave Restore, the tour) moves nothing.
 *
 * Pure (the module's calls below only feed it `document`), so the rule is a unit test.
 */
export function createSwapFocus<Target extends string>(): {
  record: (target: Target, hadFocus: boolean) => SwapToken | null
  take: (target: Target, active: unknown, body: unknown) => boolean
  drop: (target?: Target, token?: SwapToken | null) => void
  pending: () => Target | null
} {
  let pending: { target: Target; token: SwapToken } | null = null
  let issued = 0
  return {
    /**
     * The press: `hadFocus` is whether `document.activeElement` was the pressed control. A press with focus is held under a NEW token, which is returned (T-193 (1):
     * a record carries its press, so only that press can drop it). A press without focus clears this target's flag and returns null.
     */
    record(target, hadFocus) {
      if (hadFocus) {
        issued += 1
        pending = { target, token: issued }
        return issued
      }
      if (pending !== null && pending.target === target) pending = null
      return null
    },
    /** The new content's mount: spent here, moved only while focus is on the body or nowhere. */
    take(target, active, body) {
      if (pending === null || pending.target !== target) return false
      pending = null
      return active === null || active === body
    },
    /**
     * The press failed (or the swap never came). With a `token`: only the record that press made goes (a newer press's record, or none, stays); `null` is the token of a
     * press that held no focus, so nothing goes. With no token: the target-wide form, for the studios' unmount cleanups and the waveform's playback error, drops the
     * target's record whoever made it, and with no `target` whatever is held goes.
     */
    drop(target, token) {
      if (pending === null) return
      if (target === undefined) pending = null
      else if (token === undefined) {
        if (pending.target === target) pending = null
      } else if (token !== null && pending.token === token && pending.target === target) pending = null
    },
    pending: () => (pending === null ? null : pending.target)
  }
}

/** One press's claim on the held record (`recordSwapPress`'s answer); null is a press that held no focus. */
export type SwapToken = number

/** The control each importer / editor swap puts focus on (STYLE_GUIDE's swap rule). */
export type SwapTarget = 'image-select' | 'image-import' | 'audio-play' | 'audio-choose' | 'video-play' | 'video-choose'

const swapFocus = createSwapFocus<SwapTarget>()

/**
 * A press that may swap content: call it in the press handler with whether the control it came from held focus (`document.activeElement === control`, read
 * BEFORE anything else - a confirm, a chooser, a disabled state - can move it).
 */
export function recordSwapPress(target: SwapTarget, hadFocus: boolean): SwapToken | null {
  return swapFocus.record(target, hadFocus)
}

/**
 * The press failed: nothing is swapping. Pass the press's own token (null for a press that held no focus, which drops nothing) so a press that ends without a
 * swap never clears another press's record. Only a press that PROCEEDS records, so only a press that proceeded has a token to drop; a drop, a paste or a press
 * turned away at once records nothing and drops nothing. With no token this is the target-wide drop, for the studios' unmount cleanups and the waveform's
 * playback error.
 */
export function dropSwapPress(target?: SwapTarget, token?: SwapToken | null): void {
  swapFocus.drop(target, token)
}

/**
 * The new content is here and `control` can take focus: put it there when the press that caused the swap held focus and nothing has taken it since.
 * The key that made the press may still be down, and its auto-repeats are keyboard clicks on whatever has focus now (a chooser, a Play, a tool): the keys down
 * now stop acting until let go (`holdHeldKeys`, T-191 (1)), and a fresh press on the control acts.
 */
export function focusAfterSwap(target: SwapTarget, control: HTMLElement | null | undefined): void {
  if (!swapFocus.take(target, document.activeElement, document.body)) return
  if (!control) return
  control.focus()
  holdHeldKeys()
}
