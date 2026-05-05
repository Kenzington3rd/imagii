import type { DenoiseStrength } from '@shared/audio'
import { useAudioStore } from './state/audioStore'

const DENOISE_OPTIONS: Array<{ value: DenoiseStrength; label: string; description: string }> = [
  { value: 'off', label: 'Off', description: 'No noise reduction' },
  { value: 'light', label: 'Light', description: 'Subtle hum/hiss' },
  { value: 'medium', label: 'Medium', description: 'Room tone, mild background' },
  { value: 'aggressive', label: 'Aggressive', description: 'Loud HVAC / fan noise' }
]

export function CleanupPanel(): JSX.Element {
  const chain = useAudioStore((s) => s.chain)
  const patchChain = useAudioStore((s) => s.patchChain)

  return (
    <div className="card p-4 flex flex-col gap-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        Cleanup
      </h3>

      <div>
        <div className="text-xs text-ink-muted mb-1.5">Denoise strength</div>
        <div className="grid grid-cols-4 gap-1.5 text-xs">
          {DENOISE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              title={opt.description}
              className={`px-2 py-1.5 rounded border ${
                chain.denoise === opt.value
                  ? 'bg-accent text-bg-base border-accent'
                  : 'bg-bg-hover border-ink-dim/30 hover:border-accent'
              }`}
              onClick={() => patchChain({ denoise: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={chain.rumbleHighpass}
            onChange={(e) => patchChain({ rumbleHighpass: e.target.checked })}
          />
          <span>Remove low rumble (highpass 80 Hz)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={chain.hum60}
            onChange={(e) => patchChain({ hum60: e.target.checked })}
          />
          <span>Reduce 60 Hz hum / power-line buzz</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={chain.deEss}
            onChange={(e) => patchChain({ deEss: e.target.checked })}
          />
          <span>De-ess sibilance (~6.5 kHz)</span>
        </label>
      </div>
    </div>
  )
}
