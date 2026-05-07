import toast from 'react-hot-toast'
import type { DuckingParams, SecondaryTrackRole } from '@shared/audio'
import { DEFAULT_DUCK_PARAMS } from '@shared/audio'
import { useAudioStore } from './state/audioStore'

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

  async function pickAndAdd(role: SecondaryTrackRole): Promise<void> {
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
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        Add a second track
      </h3>
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
          <div className="flex items-center justify-between">
            <span className="font-medium truncate">
              {ROLE_OPTIONS.find((o) => o.value === secondary.role)?.label}: {secondary.fileName}
            </span>
            <button
              className="text-ink-dim hover:text-rose-300 text-xs px-2"
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
              className="flex-1"
            />
            <span className="text-xs font-mono w-12 text-right">
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
            <span>Match loudness with primary (auto-balance via loudnorm)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={secondary.duckUnderPrimary}
              onChange={(e) => update({ duckUnderPrimary: e.target.checked })}
            />
            <span>Duck under primary (sidechain compress)</span>
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
                hint="Primary level above which secondary starts compressing."
              />
              <DuckSlider
                label="Ratio"
                unit=":1"
                min={1}
                max={20}
                step={0.5}
                value={secondary.duckParams?.ratio ?? DEFAULT_DUCK_PARAMS.ratio}
                onChange={(ratio) => updateDuck({ ratio })}
                hint="How aggressively to compress (8:1 is strong)."
              />
              <DuckSlider
                label="Attack"
                unit="ms"
                min={1}
                max={200}
                step={1}
                value={secondary.duckParams?.attackMs ?? DEFAULT_DUCK_PARAMS.attackMs}
                onChange={(attackMs) => updateDuck({ attackMs })}
                hint="How fast ducking kicks in once primary is detected."
              />
              <DuckSlider
                label="Release"
                unit="ms"
                min={50}
                max={2000}
                step={10}
                value={secondary.duckParams?.releaseMs ?? DEFAULT_DUCK_PARAMS.releaseMs}
                onChange={(releaseMs) => updateDuck({ releaseMs })}
                hint="How fast secondary returns once primary stops."
              />
            </div>
          ) : null}
          <p className="text-xs text-ink-dim">
            Sidechain compresses this track when the primary track has signal — your voice
            cuts through automatically. Common for music beds.
          </p>
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
      <div className="flex items-center justify-between">
        <span className="text-ink-muted">{label}</span>
        <span className="font-mono text-ink-base">
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
