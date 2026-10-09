import { useEffect, useState } from 'react'
import type { TutorialDef, TutorialId, TutorialStep } from '../tutorials/types'

const settingsKey = (id: TutorialId): string => `tutorialSeen.${id}`

export interface UseTutorialResult {
  /** Is the coachmark open right now? */
  active: boolean
  /**
   * The tour to hand to `<Tutorial>`: the definition cut down to the steps
   * that had something on the page to point at when it opened (T-86). The
   * step counter counts THIS list, so "3 of 7" is a tour the user can walk.
   */
  def: TutorialDef
  start: () => void
  /** Close it. Every way out — Skip, Esc, Done — is the same act (T-86). */
  stop: () => void
}

/**
 * Is there anything on the page for `selector` to point at? An element that
 * is mounted but laid out nowhere (a collapsed or hidden panel) is nothing:
 * a cutout ringed around a 0x0 box at the corner of the window is exactly the
 * coachmark-over-nothing this exists to prevent.
 */
function targetOnPage(selector: string): boolean {
  const el = document.querySelector(selector)
  return el !== null && el.getClientRects().length > 0
}

/**
 * T-86 — keep a step only when its target is on the page.
 *
 * A step with no `targetSelector` is a deliberate centered card (the welcome
 * and the sign-off) and always stays. A targeted step whose target is not
 * there is dropped, not shown floating over the studio: it used to tell a user
 * with an empty Video Studio to drag trim handles that did not exist.
 * `exists` is injected so the rule can be unit-tested without a DOM.
 */
export function resolvableSteps(
  steps: readonly TutorialStep[],
  exists: (selector: string) => boolean
): TutorialStep[] {
  return steps.filter((s) => s.targetSelector === undefined || exists(s.targetSelector))
}

/**
 * Does a (gated) tour have anything to point at? The centered steps are
 * framing; a tour of nothing but framing is a coachmark over nothing, and an
 * automatic tour that would be one must not open (and must not use up the
 * user's first-visit flag).
 */
export function pointsAtSomething(steps: readonly TutorialStep[]): boolean {
  return steps.some((s) => s.targetSelector !== undefined)
}

/** The definition cut down to what is on the page. */
export function gateTutorial(def: TutorialDef, exists: (selector: string) => boolean): TutorialDef {
  return { ...def, steps: resolvableSteps(def.steps, exists) }
}

/**
 * Drive one studio's tour.
 *
 * `ready` is whether the studio has content for a tour to describe — a loaded
 * video, a loaded audio file, a started canvas. Until it is true the tour
 * does not open on its own, and the first-visit flag is NOT touched, so the
 * first import is what opens it (T-86). Before that a first visit put the
 * coachmark over a bare importer. A studio with no such gate (References: its
 * tab strip is there from the first frame) passes nothing.
 *
 * Once ready, an automatic tour opens only if at least one of its pointed-at
 * steps is on the page. The '?' button (`start`) always opens, with whatever
 * steps are on screen at that moment — on an empty studio that is the welcome,
 * the importer, and the sign-off.
 *
 * Every way of closing persists the flag: a Skip that did not made the tour
 * come back on every visit, which is a tour you cannot dismiss.
 */
export function useTutorial(def: TutorialDef, ready = true): UseTutorialResult {
  const [shown, setShown] = useState<TutorialDef | null>(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    window.api.settings.get<boolean>(settingsKey(def.id) as never).then((seen) => {
      if (cancelled || seen) return
      const gated = gateTutorial(def, targetOnPage)
      if (!pointsAtSomething(gated.steps)) return
      setShown((open) => open ?? gated)
    })
    return () => {
      cancelled = true
    }
  }, [def, ready])

  function start(): void {
    setShown(gateTutorial(def, targetOnPage))
  }

  function stop(): void {
    setShown(null)
    window.api.settings.set(settingsKey(def.id) as never, true)
  }

  return { active: shown !== null, def: shown ?? def, start, stop }
}
