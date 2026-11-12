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
 * The target is named so one press's flag can only be spent by the content it was recorded for (a Stream Graphics press never moves focus in Audio Studio),
 * and one flag is held at a time (a newer press replaces it). `take` spends it whichever way it answers; it answers yes only while focus is on `<body>` or
 * nowhere (the swap dropped it), so focus the person has put on another control is left where it is. A press that FAILS (a canceled chooser, a refused load)
 * `drop`s it, so a later swap by other means (a drop, a project opened from Home, an autosave Restore, the tour) moves nothing.
 *
 * Pure (the module's calls below only feed it `document`), so the rule is a unit test.
 */
export function createSwapFocus<Target extends string>(): {
  record: (target: Target, hadFocus: boolean) => void
  take: (target: Target, active: unknown, body: unknown) => boolean
  drop: (target?: Target) => void
  pending: () => Target | null
} {
  let pending: Target | null = null
  return {
    /** The press: `hadFocus` is whether `document.activeElement` was the pressed control. A press without focus clears this target's flag. */
    record(target, hadFocus) {
      if (hadFocus) pending = target
      else if (pending === target) pending = null
    },
    /** The new content's mount: spent here, moved only while focus is on the body or nowhere. */
    take(target, active, body) {
      if (pending !== target) return false
      pending = null
      return active === null || active === body
    },
    /** The press failed (or the swap never came): with no `target`, whatever is held goes. */
    drop(target) {
      if (target === undefined || pending === target) pending = null
    },
    pending: () => pending
  }
}

/** The control each importer / editor swap puts focus on (STYLE_GUIDE's swap rule). */
export type SwapTarget = 'image-select' | 'image-import' | 'audio-play' | 'audio-choose' | 'video-play' | 'video-choose'

const swapFocus = createSwapFocus<SwapTarget>()

/**
 * A press that may swap content: call it in the press handler with whether the control it came from held focus (`document.activeElement === control`, read
 * BEFORE anything else - a confirm, a chooser, a disabled state - can move it).
 */
export function recordSwapPress(target: SwapTarget, hadFocus: boolean): void {
  swapFocus.record(target, hadFocus)
}

/** The press failed or was refused: nothing is swapping. */
export function dropSwapPress(target?: SwapTarget): void {
  swapFocus.drop(target)
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
