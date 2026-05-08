import { useVideoStore } from './store/videoStore'
import { HookIndicator } from './HookIndicator'

function formatShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ClipList(): JSX.Element {
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const selectClip = useVideoStore((s) => s.selectClip)
  const addClip = useVideoStore((s) => s.addClip)
  const removeClip = useVideoStore((s) => s.removeClip)
  const renameClip = useVideoStore((s) => s.renameClip)
  const setClipSpeed = useVideoStore((s) => s.setClipSpeed)
  const source = useVideoStore((s) => s.source)
  const selected = clips.find((c) => c.id === selectedClipId)
  const selectedSpeed = selected?.speedMultiplier ?? 1

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Clips ({clips.length})
        </h3>
        <button className="btn-ghost px-3 py-1 text-xs" onClick={addClip}>
          + Add clip
        </button>
      </div>
      {selected ? (
        <div className="flex flex-col gap-1.5 px-1 py-1.5 bg-bg-hover rounded">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted">Speed</span>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={selectedSpeed}
              onChange={(e) => setClipSpeed(selected.id, Number(e.target.value))}
              className="flex-1"
            />
            <span className="font-mono w-10 text-right">{selectedSpeed.toFixed(2)}×</span>
            <button
              className="text-ink-dim hover:text-ink-base"
              onClick={() => setClipSpeed(selected.id, 1)}
              title="Reset to 1×"
            >
              ↺
            </button>
          </div>
          {/* Phase 4C: hook indicator. Lazy-fetches first-3-seconds energy
              for the selected clip. Hover for the explanation. */}
          {source ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-ink-muted">First 3s:</span>
              <HookIndicator sourcePath={source.filePath} startSec={selected.startSec} />
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {clips.map((clip) => {
          const isSelected = clip.id === selectedClipId
          return (
            <li
              key={clip.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                isSelected
                  ? 'border-accent bg-bg-hover'
                  : 'border-ink-dim/30 hover:bg-bg-hover'
              }`}
            >
              <button
                onClick={() => selectClip(clip.id)}
                className="flex-1 text-left flex items-center gap-3"
              >
                <input
                  type="text"
                  value={clip.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => renameClip(clip.id, e.target.value)}
                  className="bg-transparent flex-1 outline-none focus:bg-bg-base px-1 rounded text-sm"
                />
                <span className="text-xs text-ink-muted font-mono">
                  {formatShort(clip.startSec)} → {formatShort(clip.endSec)}
                </span>
              </button>
              {clips.length > 1 ? (
                <button
                  onClick={() => removeClip(clip.id)}
                  className="text-xs text-ink-dim hover:text-rose-300 px-2"
                  title="Remove clip"
                >
                  ✕
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
