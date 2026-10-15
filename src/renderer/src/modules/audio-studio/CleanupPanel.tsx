import type { DenoiseParams, DenoiseStrength, MainsHz } from '@shared/audio'
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
    description: 'Tune noise floor / reduction by hand'
  }
]

// T-90: the grid the hum comes from. 60 Hz is the US/Canada mains, 50 Hz most
// of the rest of the world; a notch at the wrong one removes nothing, so the
// choice is on screen the moment hum removal is on.
const MAINS_OPTIONS: Array<{ value: MainsHz; label: string }> = [
  { value: 60, label: '60 Hz — US, Canada' },
  { value: 50, label: '50 Hz — most other regions' }
]

export function CleanupPanel(): JSX.Element {
  const chain = useAudioStore((s) => s.chain)
  const patchChain = useAudioStore((s) => s.patchChain)

  const params = chain.denoiseParams ?? DEFAULT_DENOISE_PARAMS
  // A chain saved before 50 Hz existed has no humHz and was always 60.
  const mains: MainsHz = chain.humHz === 50 ? 50 : 60

  function updateParam(patch: Partial<DenoiseParams>): void {
    patchChain({ denoiseParams: { ...params, ...patch } })
  }

  return (
    <div className="card p-4 flex flex-col gap-4">
      <PanelHeader icon="sparkle">Cleanup</PanelHeader>

      <div>
        <div className="text-xs text-ink-muted mb-1.5">Quieter background (strength)</div>
        {/* T-123 (25): five equal columns made each button as wide as the card's fifth, and "Aggressive" (71 px of text)
            was cut to "Aggress" in a 46 px one. The buttons take the width their label needs and share each row out, so
            they wrap at a narrow card instead of clipping, and every label is drawn whole at any window width. */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          {DENOISE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              title={opt.description}
              className={`flex-1 whitespace-nowrap px-2 py-1.5 rounded border ${
                chain.denoise === opt.value
                  ? 'bg-accent text-bg-base border-accent'
                  : 'bg-bg-hover border-ink-dim/30 hover:border-accent'
              }`}
              aria-pressed={chain.denoise === opt.value}
              onClick={() => patchChain({ denoise: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Phase 3.3: parametric controls only when "Custom" is selected.
          Round 18: ranges now match afftdn's REAL accepted values (nf is
          -80..-20, nr floors at 1) — the old -10 ceiling let a third of
          the noise-floor slider produce values ffmpeg rejects. The
          "Sensitivity" slider is gone: it mapped to an `ns` option afftdn
          has never had, which made every Custom export fail. */}
      {chain.denoise === 'parametric' ? (
        <div className="flex flex-col gap-2 text-xs border-l-2 border-accent/30 pl-3 ml-1">
          <ParamSlider
            label="Noise floor"
            unit="dB"
            min={-80}
            max={-20}
            step={1}
            value={Math.min(-20, params.noiseFloorDb)}
            onChange={(noiseFloorDb) => updateParam({ noiseFloorDb })}
            hint="Set the level below which signal is treated as noise. -35 is the Light preset's setting."
          />
          <ParamSlider
            label="Reduction"
            unit="dB"
            min={1}
            max={50}
            step={1}
            value={Math.max(1, params.reductionDb)}
            onChange={(reductionDb) => updateParam({ reductionDb })}
            hint="How much noise to actually remove. Higher = harsher but quieter result."
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
          <span>Remove low rumble (below 80 Hz)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={chain.hum60}
            onChange={(e) => patchChain({ hum60: e.target.checked })}
          />
          <span>Hum removal ({mains} Hz mains)</span>
        </label>
        {chain.hum60 ? (
          <label className="flex flex-col gap-1 text-xs -mt-1 ml-6">
            <span className="text-ink-muted">Power-line frequency</span>
            {/* T-123 (27): `min-w-0`, or a select is as wide as its longest option and pokes past the card. T-124 (24): but a
                select that is shrunk CLIPS its text ("60 Hz — US," of "60 Hz — US, Canada"), and its `scrollWidth` says nothing
                is cut, so the check that looked was green. The label is on its own line and the select has the card's width
                under it; both options fit it at the narrowest column (`expectSelectsWhole` measures the selected text). */}
            <select
              className="bg-bg-base rounded px-2 py-1 w-full min-w-0"
              value={mains}
              onChange={(e) => patchChain({ humHz: Number(e.target.value) === 50 ? 50 : 60 })}
              aria-label="Power-line frequency"
            >
              {MAINS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={chain.deEss}
            onChange={(e) => patchChain({ deEss: e.target.checked })}
          />
          <span>Softer harsh 's' sounds</span>
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
  const readout = `${value.toFixed(step < 1 ? 1 : 0)}${unit ? ` ${unit}` : ''}`
  // T-124 (25): the name and the readout share a line and the slider has the row's width under them. The readout was a `w-14`
  // box beside the slider in a row with no room for it: squeezed to 38 px, "-25 dB" wrapped onto two lines, and the row grew
  // and shrank with the value while the slider was being dragged (a one-digit readout fits where a two-digit one wraps). A
  // readout never shrinks and never wraps, so the row is the same height at both ends of the slider.
  return (
    <label className="flex flex-col gap-1" title={hint}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-ink-muted">{label}</span>
        <span className="font-mono shrink-0 whitespace-nowrap text-right">{readout}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label={label}
        aria-valuetext={readout}
      />
    </label>
  )
}
