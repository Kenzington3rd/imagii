import { useState } from 'react'
import {
  LOUDNESS_TARGET_LUFS,
  commitLoudnessTarget,
  isLoudnessTarget,
  type CompressorPreset
} from '@shared/audio'
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
  // T-124 (24): short enough for the picker at the narrowest column (a select clips its text: 210 px of label in a select that
  // shows 176). Spotify is named by the line under the picker ("-14 matches YouTube, Spotify, TikTok and Reels").
  { value: 'streaming', label: 'YouTube, TikTok, Reels (\u221214)', target: -14 },
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

/**
 * The loudness target's number box (T-112). loudnorm takes -70 to -5, and a number input's
 * `min`/`max` only mark a typed value invalid — the browser still hands it over — so a
 * typed -3 reached the chain and was refused only at Export, in a sentence. The box keeps
 * what is typed to itself until it is a target `loudnorm` takes (then it goes straight to
 * the chain, as it always did, so the platform picker follows as you type), and when typing
 * ends (leaving the box, or Enter) an outside number becomes the nearest edge and a
 * non-number is dropped. The way to -23 passes through -2, so a keystroke is never refused.
 */
function LoudnessTargetInput(props: {
  value: number
  disabled: boolean
  onCommit: (target: number) => void
}): JSX.Element {
  const { value, disabled, onCommit } = props
  const [draft, setDraft] = useState<string | null>(null)

  function finish(): void {
    if (draft === null) return
    const target = commitLoudnessTarget(draft, value)
    if (target !== value) onCommit(target)
    setDraft(null)
  }

  return (
    <input
      type="number"
      min={LOUDNESS_TARGET_LUFS.min}
      max={LOUDNESS_TARGET_LUFS.max}
      value={draft ?? value}
      onChange={(e) => {
        const typed = e.target.value
        if (typed.trim() !== '' && isLoudnessTarget(Number(typed))) {
          setDraft(null)
          onCommit(Number(typed))
        } else {
          setDraft(typed)
        }
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish()
      }}
      onClick={(e) => e.stopPropagation()}
      className="bg-bg-base rounded px-1 py-0.5 w-16 text-center font-mono disabled:opacity-50"
      disabled={disabled}
      aria-label="Loudness target (LUFS)"
    />
  )
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
              aria-pressed={chain.compressor === opt.value}
              onClick={() => patchChain({ compressor: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* T-114: the range hint is beside the checkbox's label, not in it. Inside, it was part of the
          checkbox's accessible name ("Even volume ... LUFS) · -70 to -5"). It reads in parentheses
          like the unit does, with the true minus the paragraph below uses. T-113: the box refuses
          nothing as you type (-23 passes through -2), so the range it settles to is said where the
          number is. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={chain.loudnorm}
            onChange={(e) => patchChain({ loudnorm: e.target.checked })}
          />
          <span>
            Even volume (target{' '}
            <LoudnessTargetInput
              value={chain.loudnormTargetLufs}
              disabled={!chain.loudnorm}
              onCommit={(target) => patchChain({ loudnormTargetLufs: target })}
            />{' '}
            LUFS)
          </span>
        </label>
        <span className="text-xs text-ink-dim">(−{Math.abs(LOUDNESS_TARGET_LUFS.min)} to −{Math.abs(LOUDNESS_TARGET_LUFS.max)})</span>
      </div>
      {chain.loudnorm ? (
        <>
          {/* INIT-H (round 16): platform preset picker — the plumbing already
              flows loudnormTargetLufs end-to-end, this just gives the user a
              one-click way to land on the right value per delivery target. */}
          <label className="flex items-center gap-2 text-xs -mt-2">
            <span className="text-ink-muted">Platform</span>
            {/* T-123 (27): `min-w-0`, or a flex-1 select is as wide as its longest option and pokes past the card. */}
            <select
              className="bg-bg-base rounded px-2 py-1 flex-1 min-w-0"
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
        {/* T-123 (10): the ceiling an export answers for. The panel previews the source as it is, so nothing here
            warned that +12 dB on a loud file was clipping; since the export now ends in a -1 dBFS limiter (and Even
            volume's own true-peak limit is -1.5 dB), a boost cannot clip, and the person is told so.
            T-124 (26): of a chain with something in it. A bare pass-through (nothing boosted, nothing switched on) keeps no
            limiter on purpose - it is the file that went in - so the sentence is conditional and says what stays as it was.
            T-125 (15): a CUT is something in the chain too (it makes the chain non-empty, so the limiter runs: a -0.3 dBFS file
            cut and nothing else exports at -1.2 dBFS), so the old second half, which said an export with nothing switched
            on keeps the levels, was false for it. */}
        <p className="text-xs text-ink-dim mt-1">
          When you boost, switch something on or cut a part out, peaks above −1 dBFS are limited in the export, so a boost cannot clip.
          Otherwise the export keeps your levels as they are.
        </p>
      </div>
    </div>
  )
}
