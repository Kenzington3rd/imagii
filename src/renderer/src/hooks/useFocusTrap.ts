import { useCallback, useEffect, useRef, type RefObject } from 'react'

/**
 * The one focus trap in the app (T-64), and the claim stack that decides
 * which open dialog owns the keyboard (T-73).
 *
 * Modal.tsx grew both halves in round 15 and the tutorial coachmark — which
 * has said `role="dialog" aria-modal="true"` since it shipped — grew neither,
 * so Tab walked out of it into the studio behind the scrim, where every
 * control is unreachable by mouse and reachable by keyboard. Rather than a
 * second copy of the trap (the T-15 `useUndoRedoHotkeys` precedent: one
 * binding, one implementation, two callers), both dialogs call this.
 *
 * ── Why a claim stack ─────────────────────────────────────────────────
 *
 * Each open dialog registers its own window keydown, so an Escape reaches
 * every one of them and each closes. Stack the shortcuts overlay over a
 * coachmark with `?` and one Escape took both. The same is true of Tab: two
 * live traps fight over where focus lands. A dialog is a claim over the whole
 * window and only the newest claim is real, so each one takes a numbered
 * claim on arrival and asks `isTopmost()` before acting on a key.
 *
 * The claim is an ID rather than a depth INDEX on purpose. A depth compared
 * against a count is only correct while dialogs close in the order they
 * opened; releasing by identity is right whichever one goes first.
 *
 * This is deliberately NOT `Modal.openModalCount()`. That count answers a
 * different question — "does a <Modal> own the window", the guard T-68 put on
 * the studios' bare-letter hotkeys and T-72 taught the `?` overlay to exempt
 * itself from — and the coachmark stays out of it so `?` can still be pressed
 * while a tutorial is up. The two questions have different answers and each
 * one has its own reader.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** Live claims, oldest first. The last entry is the dialog on top. */
let claims: number[] = []
let nextClaimId = 1

/**
 * Is `id` the claim on top of `stack`? The whole of the T-73 decision, pure
 * so the unit layer (node, no DOM) can drive every ordering.
 */
export function isTopmostClaim(stack: readonly number[], id: number | null): boolean {
  if (id === null || stack.length === 0) return false
  return stack[stack.length - 1] === id
}

/** Take a claim on the window. Exported for the ordering unit test. */
export function pushDialogClaim(): number {
  const id = nextClaimId++
  claims.push(id)
  return id
}

/** Drop a claim by identity — see the note above on why not by depth. */
export function releaseDialogClaim(id: number): void {
  claims = claims.filter((c) => c !== id)
}

/** Read at event time by a dialog's own key handler. */
export function isTopDialogClaim(id: number | null): boolean {
  return isTopmostClaim(claims, id)
}

/**
 * Trap focus inside `containerRef` while `active`, restore it to whatever was
 * focused before when that ends, and hand back the "am I the topmost dialog"
 * predicate the caller's own Escape branch has to consult.
 *
 * Power-of-Ten note (inherited from Modal): focus discovery is a closed-form
 * query rather than a MutationObserver. Dialog content rarely changes
 * focusability between the first focus and the next key, and the tests rely
 * on the synchronous behavior.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>
): () => boolean {
  const claimRef = useRef<number | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    const id = pushDialogClaim()
    claimRef.current = id
    return () => {
      releaseDialogClaim(id)
      claimRef.current = null
    }
  }, [active])

  const isTopmost = useCallback(() => isTopDialogClaim(claimRef.current), [])

  useEffect(() => {
    if (!active) return
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null
    const root = containerRef.current
    if (root) {
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (first) {
        first.focus()
      } else {
        // No focusable child — make the dialog itself focusable so screen
        // readers announce the title rather than the page behind it.
        root.tabIndex = -1
        root.focus()
      }
    }
    return () => {
      const prev = previouslyFocused.current
      if (prev && typeof prev.focus === 'function') {
        try {
          prev.focus()
        } catch {
          /* element may be gone */
        }
      }
    }
  }, [active, containerRef])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      // A dialog underneath must not yank focus out of the one on top.
      if (!isTopmost()) return
      const root = containerRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      if (focusables.length === 0) {
        // Trap focus on the dialog itself — Tab does nothing useful but at
        // least it doesn't escape behind the modal. The mount effect only set
        // tabIndex when the dialog opened with no focusables, so a dialog
        // whose content lost them since must be made focusable here or the
        // focus() call is a silent no-op and Tab walks out after all.
        e.preventDefault()
        root.tabIndex = -1
        root.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const activeEl = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (activeEl === last || !root.contains(activeEl)) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, containerRef, isTopmost])

  return isTopmost
}
