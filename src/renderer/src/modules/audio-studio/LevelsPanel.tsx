import type { CompressorPreset } from '@shared/audio'
import { useAudioStore } from './state/audioStore'
import { PanelHeader } from '../../components/PanelHeader'

const COMPRESSOR_OPTIONS: Array<{ value: CompressorPreset; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'voice', label: 'Voice' },
  { value: 'music', label: 'Music' },
  { value: 'mixed', label: 'Mixed' }
]

// INIT-H (round 16): platform LUFS targets per the most-commonly-cited
// docs (Apple Podcasts / AES, YouTube, TikTok, EBU R128). 'custom' is the
// escape hatch — when the user types a value into the LUFS input the
// picker is implicitly switched to 'custom'.
const LUFS_PRESETS: Array<{ value: string; label: string; target: number }> = [
  { value: 'podcast', label: 'Podcast (−16 LUFS)', target: -16 },
  { value: 'youtube', label: 'YouTube / Spotify (−14 LUFS)', target: -14 },
  { value: 'tiktok', label: 'TikTok / Reels (−14 LUFS)', target: -14 },
  { value: 'broadcast', label: 'Broadcast EBU R128 (−23 LUFS)', target: -23 }
]

/**
 * Map a numeric LUFS target back to a preset id. When the user types a
 * value that doesn't match any preset, the picker reads 'custom'. Note
 * that −14 maps to YouTube (the first matching preset); the distinction
 * between YouTube/Spotify and TikTok/Reels is a documentation aid only,
 * since both target the same loudness.
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
            aria-label="Loudness target in LUFS"
          />{' '}
          LUFS
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
            Two-pass loudnorm — measures first, then renders. Adds ~30% to processing time.
            True-peak ceiling is fixed at −1.5 dBTP this round; only the LUFS target is exposed.
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
