import { useRef } from 'react'
import toast from 'react-hot-toast'
import type { DuckingParams, SecondaryTrackRole } from '@shared/audio'
import { DEFAULT_DUCK_PARAMS } from '@shared/audio'
import { readoutText } from '@shared/units'
import { useAudioStore } from './state/audioStore'
import { PanelHeader } from '../../components/PanelHeader'
import { claimFirst } from '../../lib/claimFirst'

const ROLE_OPTIONS: Array<{
  value: SecondaryTrackRole
  label: string
  defaultGain: number
  defaultDuck: boolean
  hint: string
}> = [
  {
    value: 'music',
    label: 'Background music',
    defaultGain: -10,
    defaultDuck: true,
    hint: 'Plays under your voice; ducks when you speak.'
  },
  {
    value: 'mic2',
    label: 'Second mic',
    defaultGain: 0,
    defaultDuck: false,
    hint: 'Mix two voice tracks (e.g. co-host).'
  },
  {
    value: 'gameaudio',
    label: 'Game audio',
    defaultGain: -3,
    defaultDuck: true,
    hint: 'Game audio stays present but ducks under voice.'
  }
]

function fileNameFromPath(p: string): string {
  const c = p.replace(/\\/g, '/')
  return c.substring(c.lastIndexOf('/') + 1)
}

export function SecondaryTrackPanel(): JSX.Element {
  const secondary = useAudioStore((s) => s.chain.secondaryTrack)
  const setSecondaryTrack = useAudioStore((s) => s.setSecondaryTrack)

  // T-131 (5): one chooser at a time across the three role buttons. A double-click on one opened two, and the second answer silently
  // REPLACED the track the first had just added (with the second role's gain and duck defaults, if it landed on another button).
  const pickingRef = useRef(false)

  async function pickAndAdd(role: SecondaryTrackRole): Promise<void> {
    await claimFirst(pickingRef, async () => {
      const filePath = await window.api.audio.pickFile()
      if (!filePath) return
      const opt = ROLE_OPTIONS.find((o) => o.value === role)
      if (!opt) return
      setSecondaryTrack({
        filePath,
        fileName: fileNameFromPath(filePath),
        role,
        gainDb: opt.defaultGain,
        duckUnderPrimary: opt.defaultDuck
      })
      toast.success(`${opt.label} added`)
    })
  }

  function update(patch: Partial<NonNullable<typeof secondary>>): void {
    if (!secondary) return
    setSecondaryTrack({ ...secondary, ...patch })
  }

  function updateDuck(patch: Partial<DuckingParams>): void {
    if (!secondary) return
    const current = secondary.duckParams ?? DEFAULT_DUCK_PARAMS
    setSecondaryTrack({ ...secondary, duckParams: { ...current, ...patch } })
  }

  return (
    <div className="card p-4 flex flex-col gap-3" data-tutorial="audio-music">
      <PanelHeader icon="audio">Add a second track</PanelHeader>
      {!secondary ? (
        <>
          <p className="text-xs text-ink-muted">
            Layer in background music, a co-host's mic, or game audio. Music can duck under
            your voice automatically.
          </p>
          <div className="grid grid-cols-1 gap-2 text-sm">
            {ROLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => pickAndAdd(opt.value)}
                className="text-left px-3 py-2 rounded border border-ink-dim/30 hover:border-accent hover:bg-bg-hover transition-colors"
              >
                <div className="font-medium">+ {opt.label}</div>
                <div className="text-xs text-ink-muted mt-0.5">{opt.hint}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {/* T-126 (12): the name is what gives (it truncates); the button keeps its words on one line instead of being squeezed to two. */}
          <div className="flex items-center justify-between gap-2">
            {/* T-127 (15): a name that is cut with an ellipsis carries its whole self as its tooltip (the folder chip's rule). */}
            <span className="font-medium truncate" title={`${ROLE_OPTIONS.find((o) => o.value === secondary.role)?.label}: ${secondary.fileName}`}>
              {ROLE_OPTIONS.find((o) => o.value === secondary.role)?.label}: {secondary.fileName}
            </span>
            <button
              className="shrink-0 whitespace-nowrap text-ink-dim hover:text-danger text-xs px-2"
              onClick={() => setSecondaryTrack(null)}
            >
              ✕ Remove
            </button>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs text-ink-muted w-16">Gain</span>
            <input
              type="range"
              min={-24}
              max={12}
              step={0.5}
              value={secondary.gainDb}
              onChange={(e) => update({ gainDb: Number(e.target.value) })}
              className="flex-1 min-w-0"
              // M11 fix (round 15)
              aria-label="Secondary track gain in decibels"
              aria-valuetext={`${secondary.gainDb >= 0 ? '+' : ''}${secondary.gainDb.toFixed(1)} decibels`}
            />
            {/* T-126 (12): "-10.0 dB" is eight characters of mono; w-12 wrapped it to two lines at every window size. It is never squeezed or
                wrapped now, and a monospace face wider than Consolas (58 px of it in a 56 px box on Linux) widens the box instead of cutting the
                text, so the width is a floor (`min-w`), not a fixed size. */}
            <span className="text-xs font-mono min-w-[3.5rem] shrink-0 whitespace-nowrap text-right">
              {secondary.gainDb >= 0 ? '+' : ''}
              {secondary.gainDb.toFixed(1)} dB
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(secondary.matchLoudness)}
              onChange={(e) => update({ matchLoudness: e.target.checked })}
            />
            <span>Match loudness with your voice</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={secondary.duckUnderPrimary}
              onChange={(e) => update({ duckUnderPrimary: e.target.checked })}
            />
            <span>Duck under your voice</span>
          </label>
          {/* Phase 3.2: ducking parameter sliders only when ducking is on. */}
          {secondary.duckUnderPrimary ? (
            <div className="grid grid-cols-2 gap-3 text-xs border-l-2 border-accent/30 pl-3 ml-2">
              <DuckSlider
                label="Threshold"
                unit="dBFS"
                min={-60}
                max={0}
                step={1}
                value={secondary.duckParams?.thresholdDb ?? DEFAULT_DUCK_PARAMS.thresholdDb}
                onChange={(thresholdDb) => updateDuck({ thresholdDb })}
                hint="How loud your voice has to be before this track starts to dip."
              />
              <DuckSlider
                label="Ratio"
                unit=":1"
                min={1}
                max={20}
                step={0.5}
                value={secondary.duckParams?.ratio ?? DEFAULT_DUCK_PARAMS.ratio}
                onChange={(ratio) => updateDuck({ ratio })}
                hint="How far this track dips (8:1 is a strong dip)."
              />
              <DuckSlider
                label="Attack"
                unit="ms"
                min={1}
                max={200}
                step={1}
                value={secondary.duckParams?.attackMs ?? DEFAULT_DUCK_PARAMS.attackMs}
                onChange={(attackMs) => updateDuck({ attackMs })}
                hint="How fast this track dips once you start talking."
              />
              <DuckSlider
                label="Release"
                unit="ms"
                min={50}
                max={2000}
                step={10}
                value={secondary.duckParams?.releaseMs ?? DEFAULT_DUCK_PARAMS.releaseMs}
                onChange={(releaseMs) => updateDuck({ releaseMs })}
                hint="How fast this track comes back up once you stop talking."
              />
            </div>
          ) : null}
          {/* T-122: the sentence is a promise about the export, and only Duck builds a
              sidechaincompress; "Second mic" defaults Duck off and said it dipped anyway. */}
          {secondary.duckUnderPrimary ? (
            <p className="text-xs text-ink-dim">
              This track dips whenever you talk, so your voice cuts through on its own.
              Common for music beds.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

interface DuckSliderProps {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (next: number) => void
  hint: string
}

function DuckSlider(props: DuckSliderProps): JSX.Element {
  const { label, unit, min, max, step, value, onChange, hint } = props
  return (
    <label className="flex flex-col gap-0.5" title={hint}>
      {/* T-126 (12): the label and the readout are 1 px apart at 2560 without a gap; one formatter draws the readout and names the value. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-muted">{label}</span>
        <span className="font-mono text-ink-base whitespace-nowrap">{readoutText(value, unit)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        // M11 fix (round 15)
        aria-label={label}
        aria-valuetext={readoutText(value, unit)}
      />
    </label>
  )
}
