import { useEffect, useLayoutEffect, useState } from 'react'
import type { TutorialDef, TutorialStep } from '../tutorials/types'

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

export function Tutorial({ def, onClose }: TutorialProps): JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)
  const step: TutorialStep = def.steps[stepIndex]

  const [targetRect, setTargetRect] = useState<Rect | null>(null)

  useLayoutEffect(() => {
    if (!step?.targetSelector) {
      setTargetRect(null)
      return
    }
    const update = (): void => {
      const el = document.querySelector(step.targetSelector!)
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
      if (e.key === 'Escape') onClose(false)
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
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

  const tooltipStyle = computeTooltipPosition(targetRect, step?.placement)
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
          fill="rgba(8, 8, 12, 0.78)"
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
            stroke="#a78bfa"
            strokeWidth={2}
          />
        ) : null}
      </svg>

      <div
        className="absolute pointer-events-auto bg-bg-elevated border border-accent/60 rounded-xl shadow-2xl p-5 max-w-md"
        style={tooltipStyle}
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
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={prev}>
              ← Back
            </button>
          ) : null}
          <div className="flex-1" />
          <button className="btn-primary px-4 py-1.5 text-sm" onClick={next}>
            {stepIndex === def.steps.length - 1 ? 'Done ✓' : 'Next →'}
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
