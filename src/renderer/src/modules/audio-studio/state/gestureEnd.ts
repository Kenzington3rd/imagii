import { useState } from 'react'
import { useAudioStore } from './audioStore'

/**
 * The three handlers that close a slider's undo window (T-147, T-78): pointer up and blur, on the card that holds the sliders (ColorGradePanel's pair, T-40), with the one
 * thing a bare `onBlur={endGesture}` gets wrong: a press on a slider moves focus, and the browser sends the slider its first `input` event BEFORE the control that had
 * focus (the Custom button, the slider of the last drag) loses it. That blur arrives mid-drag, closes the window, and the drag's second event starts a second step:
 * the first drag after any click inside the card was two undo steps (the e2e "Cleanup: a drag of the Custom noise floor" is red on it). A blur while the pointer is
 * down is the press moving focus, not the end of anything; the pointer going up is. A keyboard move between controls has no press, so it still ends a run of arrow keys.
 *
 * `onNextPointerUp` registers a one-shot listener for the release wherever it lands (a drag that ends outside the card is still a release), so the flag cannot stick.
 */
export interface GestureEndHandlers {
  onPointerDown: () => void
  onPointerUp: () => void
  onBlur: () => void
}

export function createGestureEnd(endGesture: () => void, onNextPointerUp: (listener: () => void) => void): GestureEndHandlers {
  let pressed = false
  return {
    onPointerDown: () => {
      pressed = true
      onNextPointerUp(() => {
        pressed = false
      })
    },
    onPointerUp: () => {
      pressed = false
      endGesture()
    },
    onBlur: () => {
      if (!pressed) endGesture()
    }
  }
}

/** Spread on the card: `<div {...useGestureEnd()}>`. One set of handlers per mount. */
export function useGestureEnd(): GestureEndHandlers {
  const endGesture = useAudioStore((s) => s.endGesture)
  const [handlers] = useState(() =>
    createGestureEnd(endGesture, (listener) => window.addEventListener('pointerup', listener, { once: true, capture: true }))
  )
  return handlers
}
