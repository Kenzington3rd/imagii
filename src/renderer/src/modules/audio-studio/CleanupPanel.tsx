import type { DenoiseParams, DenoiseStrength } from '@shared/audio'
import { DEFAULT_DENOISE_PARAMS } from '@shared/audio'
import { useAudioStore } from './state/audioStore'
import { PanelHeader } from '../../components/PanelHeader'

const DENOISE_OPTIONS: Array<{ value: DenoiseStrength; label: string; description: string }> = [
  { value: 'off', label: 'Off', description: 'No noise reduction' },
  { value: 'light', label: 'Light', description: 'Subtle hum/hiss' },
  { value: 'medium', label: 'Medium', description: 'Room tone, mild background' },
  { value: 'aggressive', label: 'Aggressive', description: 'Loud HVAC / fan noise' },
  {
    value: 'parametric',
    label: 'Custom',
    description: 'Tune noise floor / reduction / sensitivity by hand'
  }
]

export function CleanupPanel(): JSX.Element {
  const chain = useAudioStore((s) => s.chain)
  const patchChain = useAudioStore((s) => s.patchChain)

  const params = chain.denoiseParams ?? DEFAULT_DENOISE_PARAMS

  function updateParam(patch: Partial<DenoiseParams>): void {
    patchChain({ denoiseParams: { ...params, ...patch } })
  }

  return (
    <div className="card p-4 flex flex-col gap-4">
      <PanelHeader icon="sparkle">Cleanup</PanelHeader>

      <div>
        <div className="text-xs text-ink-muted mb-1.5">Denoise strength</div>
        <div className="grid grid-cols-5 gap-1.5 text-xs">
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

      {/* Phase 3.3: parametric controls only when "Custom" is selected. */}
      {chain.denoise === 'parametric' ? (
        <div className="flex flex-col gap-2 text-xs border-l-2 border-accent/30 pl-3 ml-1">
          <ParamSlider
            label="Noise floor"
            unit="dB"
            min={-80}
            max={-10}
            step={1}
            value={params.noiseFloorDb}
            onChange={(noiseFloorDb) => updateParam({ noiseFloorDb })}
            hint="Set the level below which signal is treated as noise. -25 ≈ medium preset."
          />
          <ParamSlider
            label="Reduction"
            unit="dB"
            min={0}
            max={50}
            step={1}
            value={params.reductionDb}
            onChange={(reductionDb) => updateParam({ reductionDb })}
            hint="How much noise to actually remove. Higher = harsher but quieter result."
          />
          <ParamSlider
            label="Sensitivity"
            unit=""
            min={-2}
            max={2}
            step={0.1}
            value={params.sensitivity}
            onChange={(sensitivity) => updateParam({ sensitivity })}
            hint="How aggressively the detector triggers on quiet noise. 0 = neutral."
          />
        </div>
      ) : null}

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

interface ParamSliderProps {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (next: number) => void
  hint: string
}

function ParamSlider(props: ParamSliderProps): JSX.Element {
  const { label, unit, min, max, step, value, onChange, hint } = props
  return (
    <label className="flex items-center gap-2" title={hint}>
      <span className="text-ink-muted w-24">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="font-mono w-14 text-right">
        {value.toFixed(step < 1 ? 1 : 0)}
        {unit ? ` ${unit}` : ''}
      </span>
    </label>
  )
}
