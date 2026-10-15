import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import toast from 'react-hot-toast'
import { useAudioStore } from './state/audioStore'
import { Modal } from '../../components/Modal'
import { ACTION_TOAST_MS } from '../../lib/savedToast'
import { EMPTY_ANSWERS, fixPatch, fixSummary, type FixAnswers } from './fixWizard'

const QUESTIONS = [
  {
    id: 'noise',
    question: 'Is there background noise (HVAC, fan, traffic)?',
    options: [
      { value: 'none', label: 'None to speak of' },
      { value: 'mild', label: 'A little' },
      { value: 'loud', label: 'Yes, pretty loud' }
    ]
  },
  {
    id: 'echoy',
    question: 'Does the room sound echoy or hollow?',
    options: [
      { value: false, label: 'Sounds dry' },
      { value: true, label: 'Yeah, kind of echoy' }
    ]
  },
  {
    id: 'use',
    question: 'What is this clip mostly?',
    options: [
      { value: 'voice', label: 'Talking / voice' },
      { value: 'music', label: 'Music' },
      { value: 'mixed', label: 'Both, mixed' }
    ]
  }
]

interface FixWizardProps {
  open: boolean
  onClose: () => void
}

/**
 * T-120: a HELD Enter must not walk the whole wizard. Enter on a focused button clicks it on keydown, and
 * the key auto-repeats while it is held; the step swap above puts focus on the next question's first option
 * inside the same event (React flushes a discrete event's effects at its end), so each repeat landed on the
 * next step's button and the held key answered all three questions and pressed Apply. A repeat is not a new
 * decision: its default action (the click) is canceled. A fresh press is untouched.
 */
function ignoreHeldEnter(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === 'Enter' && e.repeat) e.preventDefault()
}

export function FixWizard({ open, onClose }: FixWizardProps): JSX.Element | null {
  const patchChain = useAudioStore((s) => s.patchChain)
  // T-112: the notch the Cleanup panel is on; the wizard keeps it and the summary names it.
  const mains = useAudioStore((s) => (s.chain.humHz === 50 ? 50 : 60))
  const [answers, setAnswers] = useState<FixAnswers>(EMPTY_ANSWERS)
  const [step, setStep] = useState(0)

  // T-119: every answer replaces the buttons the person just pressed (a different list of options, or the
  // summary), so the focused element is unmounted and keyboard focus fell to the page behind the dialog;
  // the focus trap only places focus when the dialog OPENS. Put it on the new step's first option, or on
  // Apply for the summary - the Tutorial coachmark's pattern for the same problem (its Next button). Declared
  // before the early return (hooks), and after the Modal child's own mount focus in effect order, so it also
  // decides where the first question opens: on its first answer, not on Close.
  const focusRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (open) focusRef.current?.focus()
  }, [open, step])

  if (!open) return null

  function answer(key: keyof FixAnswers, value: FixAnswers[keyof FixAnswers]): void {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setStep((s) => s + 1)
  }

  // T-90: "Start over" goes back to the first question and keeps the dialog
  // open — it used to close it, which is what Close is for. Closing (Close,
  // Esc, the scrim) and finishing both leave the wizard fresh for next time.
  function restart(): void {
    setStep(0)
    setAnswers(EMPTY_ANSWERS)
  }

  function close(): void {
    restart()
    onClose()
  }

  // INIT-G (round 16): migrated to <Modal> for Escape + focus trap + focus
  // restore. Two states share the wizard chrome — final summary
  // vs. step question. Both render inside Modal; Modal close maps to
  // `close()` so the wizard resets state on dismissal.
  if (step >= QUESTIONS.length) {
    // T-90: built once. The list below is rendered FROM this object and Apply
    // patches this same object, so the two cannot disagree (see fixWizard.ts).
    const patch = fixPatch(answers, mains)
    return (
      <Modal
        open={open}
        onClose={close}
        title="Ready to apply"
        className="w-full max-w-md p-6 ring-1 ring-accent/40"
      >
        <div onKeyDown={ignoreHeldEnter}>
        <h2 className="text-lg font-semibold mb-2">Ready to apply</h2>
          <p className="text-sm text-ink-muted mb-4">
            Based on your answers, imagii will set:
          </p>
          <ul className="text-sm flex flex-col gap-1 mb-4">
            {fixSummary(patch).map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
          {/* INIT-A (round 15): echoy was collected but silently discarded.
              No ffmpeg filter cleanly removes reverb after the fact, so the
              honest answer is a mic-placement / treatment tip. */}
          {answers.echoy === true ? (
            <p className="text-xs text-warn mb-3">
              Tip: room reverb is hard to remove after the fact. Try moving
              closer to the mic, talking off-axis, or adding soft furnishings
              to the room before the next recording.
            </p>
          ) : null}
          <p className="text-xs text-ink-dim mb-4">
            You can still tweak any individual setting from the side panels after this applies.
          </p>
        <div className="flex justify-between gap-2">
          <button className="btn-ghost px-3 py-2 text-sm" onClick={restart}>
            Start over
          </button>
          <button
            ref={focusRef}
            className="btn-primary px-4 py-2 text-sm"
            onClick={() => {
              patchChain(patch)
              // T-125 (19): this sentence is the only place that says the cleanup waits for the export, and a success toast
              // lasts 2 s: a person reading the wizard's last screen looks up after it has gone. Held as long as an action toast.
              toast.success(
                'Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.',
                { duration: ACTION_TOAST_MS }
              )
              close()
            }}
          >
            Apply
          </button>
        </div>
        </div>
      </Modal>
    )
  }

  const q = QUESTIONS[step]
  if (!q) return null
  return (
    <Modal
      open={open}
      onClose={close}
      title={q.question}
      className="w-full max-w-md p-6 ring-1 ring-accent/40"
    >
      <div onKeyDown={ignoreHeldEnter}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wide text-accent font-semibold">
          Quick fix · {step + 1} of {QUESTIONS.length}
        </span>
        <button
          className="text-ink-dim hover:text-ink-base text-sm"
          onClick={close}
          title="Close"
          aria-label="Close"
        >
          Close
        </button>
      </div>
      <h2 className="text-lg font-semibold mb-4">{q.question}</h2>
      <div className="flex flex-col gap-2">
        {q.options.map((opt, i) => (
          <button
            key={String(opt.value)}
            ref={i === 0 ? focusRef : undefined}
            onClick={() => {
              if (q.id === 'noise') answer('backgroundNoise', opt.value as FixAnswers['backgroundNoise'])
              else if (q.id === 'echoy') answer('echoy', opt.value as FixAnswers['echoy'])
              else if (q.id === 'use') answer('primaryUse', opt.value as FixAnswers['primaryUse'])
            }}
            className="w-full text-left px-4 py-3 rounded border border-ink-dim/30 hover:border-accent hover:bg-bg-hover transition-colors text-sm"
          >
            {opt.label}
          </button>
        ))}
      </div>
      </div>
    </Modal>
  )
}
