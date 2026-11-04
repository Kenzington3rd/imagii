import { useState } from 'react'
import { NON_TEXT_INPUT_TYPES } from './keyOwnership'

/**
 * The one rule that closes a coalescing card's undo window (T-148; T-40, T-80, T-147). Every studio keeps a history key so a slider drag or a run of typing is ONE undo
 * step, and only a gesture END tells that stream from the next one. The card that holds the controls spreads these three handlers, and the rule is here once:
 *
 * - `onPointerDown` marks a press (and a one-shot window listener clears the mark wherever the release lands, so it cannot stick);
 * - `onPointerDown` also records which element had focus when the press began (T-149 (5));
 * - `onPointerUp(event)` ends the gesture, except a release inside the text field being typed in: that is a caret being placed and the edit goes on (T-80), so a text
 *   field's gesture ends on blur. "Being typed in" means the field that ALREADY had focus when the press began: a press that moved focus into a text field (a click
 *   from the caption into the colour box) is a new edit, and the press-caused blur was ignored, so the release is where the earlier edit's gesture has to end;
 * - `onBlur` ends the gesture unless a press is down. A press on a slider moves focus, and Chromium sends the slider its FIRST `input` event BEFORE the control that had focus
 *   (another slider, a text field, a button) loses it. That blur arrives mid-drag, would close the window, and the drag's second event would start a second step: the first
 *   drag after a click on anything else was two undo steps (T-147 found it in Audio Studio, T-148 measured it in Video Studio and Stream Graphics). A keyboard move between
 *   controls has no press, so it still ends a run of arrow keys or typing.
 */

/**
 * T-80: does this pointerup end the coalescing window? The decision needs three facts, all plain values, so it is unit-testable without a DOM. Only the field the user is
 * typing in is mid-edit: a release over a text input that is NOT focused (a slider drag that happens to finish over one) still ends the gesture it belongs to.
 */
export function endsGestureOnPointerUp(tagName: string, inputType: string | null, isActiveElement: boolean): boolean {
  if (!isActiveElement) return true
  const tag = tagName.toUpperCase()
  if (tag === 'TEXTAREA') return false
  if (tag !== 'INPUT') return true
  return NON_TEXT_INPUT_TYPES.has((inputType ?? 'text').toLowerCase())
}

/** The part of a React pointer event the rule reads. */
export interface GestureEndEvent {
  target: unknown
}

export interface GestureEndHandlers {
  onPointerDown: () => void
  onPointerUp: (event: GestureEndEvent) => void
  onBlur: () => void
}

/**
 * `onNextPointerUp` registers a one-shot listener for the release wherever it lands; `activeElement` reads the focused element. Both default to the window's in the hook
 * and are passed in by the unit test, which has no DOM.
 */
export function createGestureEnd(
  endGesture: () => void,
  onNextPointerUp: (listener: () => void) => void,
  activeElement: () => unknown = () => document.activeElement
): GestureEndHandlers {
  let pressed = false
  let focusedAtPress: unknown = null
  return {
    onPointerDown: () => {
      pressed = true
      focusedAtPress = activeElement()
      onNextPointerUp(() => {
        pressed = false
      })
    },
    onPointerUp: (event) => {
      pressed = false
      const target = event.target as { tagName?: unknown; type?: unknown } | null
      if (target !== null && typeof target.tagName === 'string') {
        const type = typeof target.type === 'string' ? target.type : null
        if (!endsGestureOnPointerUp(target.tagName, type, target === activeElement() && target === focusedAtPress)) return
      }
      endGesture()
    },
    onBlur: () => {
      if (!pressed) endGesture()
    }
  }
}

/** Spread on the card: `<div {...useGestureEnd(endGesture)}>`, with the store's `endGesture`. One set of handlers, and one flag, per mount. */
export function useGestureEnd(endGesture: () => void): GestureEndHandlers {
  const [handlers] = useState(() =>
    createGestureEnd(endGesture, (listener) => window.addEventListener('pointerup', listener, { once: true, capture: true }))
  )
  return handlers
}
