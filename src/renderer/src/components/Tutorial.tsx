import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { assert } from '@shared/assert'
import type { TutorialDef, TutorialStep } from '../tutorials/types'
import { Icon } from './Icon'
import { ACCENT } from '../styles/tokens'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

interface TutorialProps {
  def: TutorialDef
  onClose: (didFinish: boolean) => void
}

export function Tutorial({ def, onClose }: TutorialProps): JSX.Element | null {
  const [stepIndex, setStepIndex] = useState(0)
  const step: TutorialStep | undefined = def.steps[stepIndex]

  const [targetRect, setTargetRect] = useState<Rect | null>(null)

  // A11y: the coachmark is a dialog, so keyboard/AT users need focus to
  // land inside it. Move focus to the Next button on mount and on every
  // step change.
  const nextBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    nextBtnRef.current?.focus()
  }, [stepIndex])

  // T-34: the geometry places a card of a known size, so measure the real
  // one instead of guessing at it — a guessed height decides "this does not
  // fit below the target" for a card that plainly does. Runs after every
  // render (each step's copy is a different height) and only writes state on
  // a real change, so the loop settles in one extra pass: the clamp
  // guarantees the card always has more room than it wants, so its width
  // cannot depend on where it was put. A layout effect, so the corrected
  // position is in the DOM before the browser paints.
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [cardSize, setCardSize] = useState<Size>({
    width: TOOLTIP_MAX_WIDTH,
    height: TOOLTIP_MAX_HEIGHT
  })
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const measured = el.getBoundingClientRect()
    if (
      Math.abs(measured.width - cardSize.width) > 0.5 ||
      Math.abs(measured.height - cardSize.height) > 0.5
    ) {
      setCardSize({ width: measured.width, height: measured.height })
    }
  })

  useLayoutEffect(() => {
    // M13 fix (round 15): capture the narrowed selector in a const so the
    // closure doesn't need a `!` to convince TS that it survived the
    // outer guard.
    const selector = step?.targetSelector
    if (!selector) {
      setTargetRect(null)
      return
    }
    const update = (): void => {
      const el = document.querySelector(selector)
      if (!el) {
        setTargetRect(null)
        return
      }
      const r = (el as HTMLElement).getBoundingClientRect()
      setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      try {
        ;(el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {
        /* ignore */
      }
    }
    update()
    const id = setInterval(update, 300)
    window.addEventListener('resize', update)
    return () => {
      clearInterval(id)
      window.removeEventListener('resize', update)
    }
  }, [step?.targetSelector])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const onButton = e.target instanceof HTMLElement && e.target.tagName === 'BUTTON'
      const intent = tutorialKeyIntent({ key: e.key, onButton })
      if (intent === 'none') return
      // The key is ours, so the browser must not also run its default action
      // against whatever is focused once the step has changed — see
      // tutorialKeyIntent for the double-advance that produced (T-34).
      e.preventDefault()
      if (intent === 'close') onClose(false)
      else if (intent === 'next') next()
      else prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex])

  function next(): void {
    if (stepIndex < def.steps.length - 1) setStepIndex(stepIndex + 1)
    else onClose(true)
  }

  function prev(): void {
    if (stepIndex > 0) setStepIndex(stepIndex - 1)
  }

  // Defensive: stepIndex should always be in range, but a malformed
  // tutorial def or stale state could land us out of bounds. Return null
  // rather than crashing.
  if (!step) return null

  const tooltipStyle = computeTooltipPosition(
    targetRect,
    step.placement,
    { width: window.innerWidth, height: window.innerHeight },
    cardSize
  )
  const cutoutPad = 8

  return (
    <div className="fixed inset-0 z-[1000] pointer-events-none">
      <svg className="absolute inset-0 w-full h-full pointer-events-auto">
        <defs>
          <mask id="tutorial-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect ? (
              <rect
                x={targetRect.left - cutoutPad}
                y={targetRect.top - cutoutPad}
                width={targetRect.width + cutoutPad * 2}
                height={targetRect.height + cutoutPad * 2}
                rx={10}
                ry={10}
                fill="black"
              />
            ) : null}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(12, 8, 8, 0.78)"
          mask="url(#tutorial-mask)"
          onClick={() => next()}
        />
        {targetRect ? (
          <rect
            x={targetRect.left - cutoutPad}
            y={targetRect.top - cutoutPad}
            width={targetRect.width + cutoutPad * 2}
            height={targetRect.height + cutoutPad * 2}
            rx={10}
            ry={10}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2}
          />
        ) : null}
      </svg>

      <div
        ref={cardRef}
        className="absolute pointer-events-auto bg-bg-elevated border border-accent/60 rounded-xl shadow-2xl p-5 max-w-md"
        style={tooltipStyle}
        role="dialog"
        aria-modal="true"
        aria-label={`${def.title} tutorial — step ${stepIndex + 1} of ${def.steps.length}: ${step.title}`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wide text-accent font-semibold">
            {def.title} · {stepIndex + 1} of {def.steps.length}
          </span>
          <button
            className="text-xs text-ink-dim hover:text-ink-base"
            onClick={() => onClose(false)}
            title="Skip tutorial (Esc)"
          >
            Skip
          </button>
        </div>
        <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
        <p className="text-sm text-ink-base leading-relaxed">{step.body}</p>
        <div className="flex items-center gap-2 mt-5">
          {stepIndex > 0 ? (
            <button
              className="btn-ghost px-3 py-1.5 text-sm inline-flex items-center gap-1.5"
              onClick={prev}
            >
              <Icon name="arrow-left" size={14} /> Back
            </button>
          ) : null}
          <div className="flex-1" />
          <button
            ref={nextBtnRef}
            className="btn-primary px-4 py-1.5 text-sm inline-flex items-center gap-1.5"
            onClick={next}
          >
            {stepIndex === def.steps.length - 1 ? (
              <>
                Done <Icon name="check" size={14} />
              </>
            ) : (
              <>
                Next <Icon name="arrow-right" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export type TutorialKeyIntent = 'next' | 'prev' | 'close' | 'none'

/**
 * What a window-level keydown means for the coachmark.
 *
 * Enter is the subtle one (T-34). Focus lands on the Next button after every
 * step change, and Enter there is ALREADY that button's own activation — so
 * the window handler must stay out of it, or one keypress advances twice.
 * Off a button the window owns Enter, and the caller preventDefaults it:
 * without that, our handler advances the step, React flushes, the
 * step-change effect pulls focus onto the new Next button, and Chromium then
 * applies the same keypress's default action to whatever is focused by
 * then — clicking Next a second time. A user paging through with Enter read
 * every other step.
 *
 * Deferring and preventing are mutually exclusive by construction: 'none' is
 * exactly the case the button handles itself.
 */
export function tutorialKeyIntent(e: { key: string; onButton: boolean }): TutorialKeyIntent {
  if (e.key === 'Escape') return 'close'
  if (e.key === 'ArrowRight') return 'next'
  if (e.key === 'ArrowLeft') return 'prev'
  if (e.key === 'Enter' && !e.onButton) return 'next'
  return 'none'
}

export type TooltipPlacement = NonNullable<TutorialStep['placement']>

/** A width/height pair in CSS pixels — the window, or the card itself. */
export interface Size {
  width: number
  height: number
}

/** Gap between the card and both the thing it points at and the window edge. */
export const TOOLTIP_MARGIN = 16

/**
 * The card's size before it has been measured once — `max-w-md` from the
 * className above, and a height that clears the tallest step copy we ship.
 * Only the very first layout pass uses these: `Tutorial` measures the real
 * card and re-runs the geometry with it before the browser paints, so a step
 * whose copy grows makes the estimate stale for one pass, never wrong.
 */
export const TOOLTIP_MAX_WIDTH = 448
export const TOOLTIP_MAX_HEIGHT = 320

/** The card's box in viewport coordinates. */
interface Box extends Size {
  left: number
  top: number
}

type Side = Exclude<TooltipPlacement, 'center'>

/**
 * T-34 — one clamp for all four placements.
 *
 * The old math clamped 'top'/'bottom' cards into the viewport horizontally
 * and left 'left'/'right' cards unclamped along the axis they are placed on.
 * A 'right' card was laid out one margin past the target and left there, so
 * beside a wide target — Video Studio's importer is the whole content
 * column — it ran to 1486 px inside a 1280 px window, with Skip, Back and
 * Next off the edge and unclickable.
 *
 * The policy is to MOVE the card rather than shrink it — a narrower card is a
 * card whose copy is harder to read, and the copy is the point of a tutorial.
 * In order:
 *
 *   1. the requested side, if the card fits between the target and the edge;
 *   2. the OPPOSITE side (right <-> left, top <-> bottom);
 *   3. the cross axis — a left/right request falls back to bottom then top,
 *      and vice versa. This is where a target too wide for either of its own
 *      sides ends up;
 *   4. the requested side anyway, clamped hard into the window. Only this
 *      case can overlap the target, and it beats the alternative: the cutout
 *      still rings the target through the scrim, and a coachmark you cannot
 *      click is worse than one you have to read over the top of.
 *
 * Every branch ends at the same clamp, so no placement can leave the window.
 * `card` is the measured card, which is what makes the fit test honest: a
 * guessed height decides "it does not fit below" for a card that plainly
 * does, and the user gets a coachmark beside the thing instead of under it.
 */
export function computeTooltipPosition(
  target: Rect | null,
  placement: TooltipPlacement | undefined,
  viewport: Size,
  card: Size
): React.CSSProperties {
  assert(
    Number.isFinite(viewport.width) && viewport.width > 0,
    'viewport.width must be a positive finite number'
  )
  assert(
    Number.isFinite(viewport.height) && viewport.height > 0,
    'viewport.height must be a positive finite number'
  )
  if (!target || placement === 'center') {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }

  const requested: Side = placement ?? 'bottom'
  for (const side of ORDER[requested]) {
    const box = boxFor(target, side, card)
    if (fits(box, side, viewport)) return toStyle(clampBox(box, viewport))
  }
  return toStyle(clampBox(boxFor(target, requested, card), viewport))
}

/** Preference order per requested side: itself, its opposite, then the cross axis. */
const ORDER: Record<Side, readonly Side[]> = {
  right: ['right', 'left', 'bottom', 'top'],
  left: ['left', 'right', 'bottom', 'top'],
  top: ['top', 'bottom', 'right', 'left'],
  bottom: ['bottom', 'top', 'right', 'left']
}

/** The card placed against one side of the target, centered on the other axis. */
function boxFor(target: Rect, side: Side, card: Size): Box {
  const centeredX = target.left + target.width / 2 - card.width / 2
  const centeredY = target.top + target.height / 2 - card.height / 2
  if (side === 'top') {
    return { ...card, left: centeredX, top: target.top - TOOLTIP_MARGIN - card.height }
  }
  if (side === 'bottom') {
    return { ...card, left: centeredX, top: target.top + target.height + TOOLTIP_MARGIN }
  }
  if (side === 'left') {
    return { ...card, left: target.left - TOOLTIP_MARGIN - card.width, top: centeredY }
  }
  return { ...card, left: target.left + target.width + TOOLTIP_MARGIN, top: centeredY }
}

/** Does the card clear both window edges on the axis it was placed along? */
function fits(box: Box, side: Side, viewport: Size): boolean {
  if (side === 'left' || side === 'right') {
    return box.left >= TOOLTIP_MARGIN && box.left + box.width <= viewport.width - TOOLTIP_MARGIN
  }
  return box.top >= TOOLTIP_MARGIN && box.top + box.height <= viewport.height - TOOLTIP_MARGIN
}

/**
 * Slide the card until it is inside the window on BOTH axes — the arm the old
 * code was missing for 'left'/'right'. A card larger than the window (only
 * reachable below the app's 1024x640 floor) pins to the top-left margin
 * rather than inverting the range.
 */
function clampBox(box: Box, viewport: Size): Box {
  return {
    ...box,
    left: clamp(
      box.left,
      TOOLTIP_MARGIN,
      Math.max(TOOLTIP_MARGIN, viewport.width - TOOLTIP_MARGIN - box.width)
    ),
    top: clamp(
      box.top,
      TOOLTIP_MARGIN,
      Math.max(TOOLTIP_MARGIN, viewport.height - TOOLTIP_MARGIN - box.height)
    )
  }
}

/**
 * Plain top/left, no `bottom`/`right` anchors and no transform. The clamp
 * above guarantees `left + card.width + TOOLTIP_MARGIN <= viewport.width`, so
 * the absolutely-positioned card always has more room to its right than it
 * wants and CSS shrink-to-fit never squeezes it into a tall sliver — which is
 * what makes the measured width the card's real preferred width, and the
 * measure/position loop settle in one pass.
 */
function toStyle(box: Box): React.CSSProperties {
  return { left: box.left, top: box.top }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
