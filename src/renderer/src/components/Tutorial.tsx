import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
      // Focus lives on the coachmark's buttons; Enter there already fires
      // the button's own click. Let the native activation win so a single
      // keypress doesn't advance twice.
      const onButton =
        e.target instanceof HTMLElement && e.target.tagName === 'BUTTON'
      if (e.key === 'Escape') onClose(false)
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) next()
      else if (e.key === 'ArrowLeft') prev()
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

  const tooltipStyle = computeTooltipPosition(targetRect, step.placement)
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

function computeTooltipPosition(
  target: Rect | null,
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
): React.CSSProperties {
  if (!target || placement === 'center') {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)'
    }
  }

  const margin = 16
  const tooltipMaxWidth = 448
  const tooltipMaxHeight = 320

  if (placement === 'top') {
    return {
      bottom: window.innerHeight - target.top + margin,
      left: clamp(target.left + target.width / 2 - tooltipMaxWidth / 2, margin, window.innerWidth - tooltipMaxWidth - margin)
    }
  }
  if (placement === 'left') {
    return {
      right: window.innerWidth - target.left + margin,
      top: clamp(target.top + target.height / 2 - tooltipMaxHeight / 2, margin, window.innerHeight - tooltipMaxHeight - margin)
    }
  }
  if (placement === 'right') {
    return {
      left: target.left + target.width + margin,
      top: clamp(target.top + target.height / 2 - tooltipMaxHeight / 2, margin, window.innerHeight - tooltipMaxHeight - margin)
    }
  }

  // default 'bottom'
  return {
    top: target.top + target.height + margin,
    left: clamp(target.left + target.width / 2 - tooltipMaxWidth / 2, margin, window.innerWidth - tooltipMaxWidth - margin)
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
