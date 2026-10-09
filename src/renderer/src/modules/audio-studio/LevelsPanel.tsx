import type { CompressorPreset } from '@shared/audio'
import { useAudioStore } from './state/audioStore'
import { PanelHeader } from '../../components/PanelHeader'

const COMPRESSOR_OPTIONS: Array<{ value: CompressorPreset; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'voice', label: 'Voice' },
  { value: 'music', label: 'Music' },
  { value: 'mixed', label: 'Mixed' }
]

// INIT-H (round 16): platform loudness targets per the most-commonly-cited
// docs (Apple Podcasts / AES, YouTube, TikTok, EBU R128). 'custom' is the
// escape hatch — when the user types a value into the loudness input the
// picker is implicitly switched to 'custom'.
//
// T-90: ONE entry per distinct number. The picker used to list YouTube/Spotify
// and TikTok/Reels as two rows with the same −14: choosing the second wrote −14,
// the picker looked the number up, found the FIRST row and snapped back to it,
// so the second row could never stay selected. Two rows that mean the same
// number are one row. The labels carry the number without the unit (the unit
// is on the input beside it), and none of them says EBU or R128.
export const LUFS_PRESETS: Array<{ value: string; label: string; target: number }> = [
  { value: 'podcast', label: 'Talking and podcasts (\u221216)', target: -16 },
  { value: 'streaming', label: 'YouTube, Spotify, TikTok, Reels (\u221214)', target: -14 },
  { value: 'broadcast', label: 'Broadcast TV and radio (\u221223)', target: -23 }
]

/**
 * Map a numeric loudness target back to a preset id. When the user types a
 * value that doesn't match any preset, the picker reads 'custom'. Every preset
 * has its own number, so this is a true inverse of choosing one: picking a row
 * and looking its number up again lands on the same row.
 */
export function lufsTargetToPresetId(target: number): string {
  const match = LUFS_PRESETS.find((p) => p.target === target)
  return match ? match.value : 'custom'
}

export function LevelsPanel(): JSX.Element {
  const chain = useAudioStore((s) => s.chain)
  const patchChain = useAudioStore((s) => s.patchChain)

  return (
    <div className="card p-4 flex flex-col gap-4">
      <PanelHeader icon="sliders">Levels</PanelHeader>

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
          Even volume (target{' '}
          <input
            type="number"
            value={chain.loudnormTargetLufs}
            onChange={(e) =>
              patchChain({ loudnormTargetLufs: Number(e.target.value) || -16 })
            }
            onClick={(e) => e.stopPropagation()}
            className="bg-bg-base rounded px-1 py-0.5 w-16 text-center font-mono disabled:opacity-50"
            disabled={!chain.loudnorm}
            aria-label="Loudness target (LUFS)"
          />{' '}
          LUFS)
        </span>
      </label>
      {chain.loudnorm ? (
        <>
          {/* INIT-H (round 16): platform preset picker — the plumbing already
              flows loudnormTargetLufs end-to-end, this just gives the user a
              one-click way to land on the right value per delivery target. */}
          <label className="flex items-center gap-2 text-xs -mt-2">
            <span className="text-ink-muted">Platform</span>
            <select
              className="bg-bg-base rounded px-2 py-1 flex-1"
              value={lufsTargetToPresetId(chain.loudnormTargetLufs)}
              onChange={(e) => {
                const choice = e.target.value
                const match = LUFS_PRESETS.find((p) => p.value === choice)
                if (match) patchChain({ loudnormTargetLufs: match.target })
                // 'custom' picked → leave the current value alone; the
                // numeric input above is the source of truth.
              }}
              aria-label="Loudness platform preset"
            >
              {LUFS_PRESETS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <p className="text-xs text-ink-dim -mt-2">
            Loudness target — how loud the finished audio is. −16 suits talking and podcasts;
            −14 matches YouTube, Spotify, TikTok and Reels. imagii measures the whole file
            first, so exports take a little longer.
          </p>
        </>
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
          // M11 fix (round 15)
          aria-label="Manual gain in decibels"
          aria-valuetext={`${chain.gainDb >= 0 ? '+' : ''}${chain.gainDb.toFixed(1)} decibels`}
        />
      </div>
    </div>
  )
}
