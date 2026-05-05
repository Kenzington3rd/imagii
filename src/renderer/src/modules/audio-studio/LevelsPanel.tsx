import type { CompressorPreset } from '@shared/audio'
import { useAudioStore } from './state/audioStore'

const COMPRESSOR_OPTIONS: Array<{ value: CompressorPreset; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'voice', label: 'Voice' },
  { value: 'music', label: 'Music' },
  { value: 'mixed', label: 'Mixed' }
]

export function LevelsPanel(): JSX.Element {
  const chain = useAudioStore((s) => s.chain)
  const patchChain = useAudioStore((s) => s.patchChain)

  return (
    <div className="card p-4 flex flex-col gap-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        Levels
      </h3>

      <div>
        <div className="text-xs text-ink-muted mb-1.5">Compressor preset</div>
        <div className="grid grid-cols-4 gap-1.5 text-xs">
          {COMPRESSOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`px-2 py-1.5 rounded border ${
                chain.compressor === opt.value
                  ? 'bg-accent text-bg-base border-accent'
                  : 'bg-bg-hover border-ink-dim/30 hover:border-accent'
              }`}
              onClick={() => patchChain({ compressor: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={chain.loudnorm}
          onChange={(e) => patchChain({ loudnorm: e.target.checked })}
        />
        <span>
          Normalize to{' '}
          <input
            type="number"
            value={chain.loudnormTargetLufs}
            onChange={(e) =>
              patchChain({ loudnormTargetLufs: Number(e.target.value) || -16 })
            }
            onClick={(e) => e.stopPropagation()}
            className="bg-bg-base rounded px-1 py-0.5 w-16 text-center font-mono"
            disabled={!chain.loudnorm}
          />{' '}
          LUFS (podcast standard −16)
        </span>
      </label>
      {chain.loudnorm ? (
        <p className="text-xs text-ink-dim -mt-2">
          Two-pass loudnorm — measures first, then renders. Adds ~30% to processing time.
        </p>
      ) : null}

      <div>
        <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>Manual gain</span>
          <span className="font-mono">
            {chain.gainDb >= 0 ? '+' : ''}
            {chain.gainDb.toFixed(1)} dB
          </span>
        </div>
        <input
          type="range"
          min={-12}
          max={12}
          step={0.5}
          value={chain.gainDb}
          onChange={(e) => patchChain({ gainDb: Number(e.target.value) })}
          className="w-full"
        />
      </div>
    </div>
  )
}
