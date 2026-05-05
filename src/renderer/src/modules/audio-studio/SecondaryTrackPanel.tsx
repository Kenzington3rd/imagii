import toast from 'react-hot-toast'
import type { SecondaryTrackRole } from '@shared/audio'
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
    const opt = ROLE_OPTIONS.find((o) => o.value === role)!
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
              checked={secondary.duckUnderPrimary}
              onChange={(e) => update({ duckUnderPrimary: e.target.checked })}
            />
            <span>Duck under primary (sidechain compress)</span>
          </label>
          <p className="text-xs text-ink-dim">
            Sidechain compresses this track when the primary track has signal — your voice
            cuts through automatically. Common for music beds.
          </p>
        </div>
      )}
    </div>
  )
}
