import { useState } from 'react'
import toast from 'react-hot-toast'
import type { ChainSpec, CompressorPreset, DenoiseStrength } from '@shared/audio'
import { useAudioStore } from './state/audioStore'

interface Answers {
  voiceQuiet: boolean | null
  backgroundNoise: 'none' | 'mild' | 'loud' | null
  echoy: boolean | null
  primaryUse: 'voice' | 'music' | 'mixed' | null
}

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

export function FixWizard({ open, onClose }: FixWizardProps): JSX.Element | null {
  const patchChain = useAudioStore((s) => s.patchChain)
  const [answers, setAnswers] = useState<Answers>({
    voiceQuiet: null,
    backgroundNoise: null,
    echoy: null,
    primaryUse: null
  })
  const [step, setStep] = useState(0)

  if (!open) return null

  function answer(key: keyof Answers, value: Answers[keyof Answers]): void {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setStep((s) => s + 1)
  }

  function applyResult(): void {
    const denoise: DenoiseStrength =
      answers.backgroundNoise === 'loud'
        ? 'aggressive'
        : answers.backgroundNoise === 'mild'
          ? 'medium'
          : 'off'
    const compressor: CompressorPreset = answers.primaryUse ?? 'voice'
    const patch: Partial<ChainSpec> = {
      denoise,
      hum60: answers.backgroundNoise !== 'none',
      rumbleHighpass: answers.backgroundNoise !== 'none' || answers.primaryUse === 'voice',
      deEss: answers.primaryUse === 'voice' || answers.primaryUse === 'mixed',
      compressor,
      loudnorm: true,
      loudnormTargetLufs: -16
    }
    patchChain(patch)
    toast.success('Cleanup configured. Tweak from the side panels if needed.')
    onClose()
    setStep(0)
    setAnswers({ voiceQuiet: null, backgroundNoise: null, echoy: null, primaryUse: null })
  }

  function reset(): void {
    setStep(0)
    setAnswers({ voiceQuiet: null, backgroundNoise: null, echoy: null, primaryUse: null })
    onClose()
  }

  if (step >= QUESTIONS.length) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
        <div className="bg-bg-elevated border border-accent/40 rounded-xl shadow-2xl w-full max-w-md p-6">
          <h2 className="text-lg font-semibold mb-2">Ready to apply</h2>
          <p className="text-sm text-ink-muted mb-4">
            Based on your answers, I'll set:
          </p>
          <ul className="text-sm flex flex-col gap-1 mb-4">
            <li>
              · Denoise:{' '}
              <span className="font-mono text-accent">
                {answers.backgroundNoise === 'loud'
                  ? 'aggressive'
                  : answers.backgroundNoise === 'mild'
                    ? 'medium'
                    : 'off'}
              </span>
            </li>
            <li>· Highpass + 60 Hz hum reduction: <span className="font-mono text-accent">{answers.backgroundNoise !== 'none' ? 'on' : 'off'}</span></li>
            <li>· De-ess: <span className="font-mono text-accent">{answers.primaryUse === 'voice' || answers.primaryUse === 'mixed' ? 'on' : 'off'}</span></li>
            <li>· Compressor: <span className="font-mono text-accent">{answers.primaryUse}</span></li>
            <li>· Loudnorm to <span className="font-mono text-accent">−16 LUFS</span></li>
          </ul>
          {/* INIT-A (round 15): echoy was collected but silently discarded.
              No ffmpeg filter cleanly removes reverb after the fact, so the
              honest answer is a mic-placement / treatment tip. */}
          {answers.echoy === true ? (
            <p className="text-xs text-amber-300 mb-3">
              Tip: room reverb is hard to remove after the fact. Try moving
              closer to the mic, talking off-axis, or adding soft furnishings
              to the room before the next recording.
            </p>
          ) : null}
          <p className="text-xs text-ink-dim mb-4">
            You can still tweak any individual setting from the side panels after this applies.
          </p>
          <div className="flex justify-between gap-2">
            <button className="btn-ghost px-3 py-2 text-sm" onClick={reset}>
              Start over
            </button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={applyResult}>
              Apply
            </button>
          </div>
        </div>
      </div>
    )
  }

  const q = QUESTIONS[step]
  if (!q) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-bg-elevated border border-accent/40 rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs uppercase tracking-wide text-accent font-semibold">
            Quick fix · {step + 1} of {QUESTIONS.length}
          </span>
          <button
            className="text-ink-dim hover:text-ink-base text-sm"
            onClick={reset}
            title="Close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <h2 className="text-lg font-semibold mb-4">{q.question}</h2>
        <div className="flex flex-col gap-2">
          {q.options.map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => {
                if (q.id === 'noise') answer('backgroundNoise', opt.value as Answers['backgroundNoise'])
                else if (q.id === 'echoy') answer('echoy', opt.value as Answers['echoy'])
                else if (q.id === 'use') answer('primaryUse', opt.value as Answers['primaryUse'])
              }}
              className="w-full text-left px-4 py-3 rounded border border-ink-dim/30 hover:border-accent hover:bg-bg-hover transition-colors text-sm"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
