import { useMemo } from 'react'
import { useVideoStore } from './store/videoStore'

const FONT_OPTIONS = ['Arial', 'Impact', 'Verdana', 'Georgia', 'Courier New', 'Comic Sans MS']

export function TextOverlayEditor(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const addTextOverlay = useVideoStore((s) => s.addTextOverlay)
  const updateTextOverlay = useVideoStore((s) => s.updateTextOverlay)
  const removeTextOverlay = useVideoStore((s) => s.removeTextOverlay)

  const clip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  )

  if (!source || !clip) return null

  function addOverlay(): void {
    if (!clip) return
    addTextOverlay(clip.id, {
      text: 'Your text here',
      font: 'Arial',
      sizePx: 48,
      colorHex: 'white',
      x: 0.1,
      y: 0.85,
      startSec: clip.startSec,
      endSec: clip.endSec
    })
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Text overlays ({clip.textOverlays.length})
        </h3>
        <button className="btn-ghost px-3 py-1 text-xs" onClick={addOverlay}>
          + Add text
        </button>
      </div>

      {clip.textOverlays.length === 0 ? (
        <p className="text-xs text-ink-dim">
          Add a text overlay to draw a caption on the exported video.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {clip.textOverlays.map((overlay) => (
          <li
            key={overlay.id}
            className="border border-ink-dim/30 rounded-md p-3 flex flex-col gap-2"
          >
            <input
              type="text"
              value={overlay.text}
              onChange={(e) =>
                updateTextOverlay(clip.id, overlay.id, { text: e.target.value })
              }
              className="bg-bg-base rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
              placeholder="Caption"
            />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-ink-muted w-12">Font</span>
                <select
                  value={overlay.font}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, { font: e.target.value })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 flex-1"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-ink-muted w-12">Size</span>
                <input
                  type="number"
                  min={8}
                  max={400}
                  value={overlay.sizePx}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, {
                      sizePx: Math.max(8, Number(e.target.value) || 8)
                    })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 flex-1"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-ink-muted w-12">Color</span>
                <input
                  type="text"
                  value={overlay.colorHex}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, { colorHex: e.target.value })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 flex-1 font-mono"
                  placeholder="white or #ffcc00"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-ink-muted w-12">x / y</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={overlay.x}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, {
                      x: Math.min(1, Math.max(0, Number(e.target.value) || 0))
                    })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 w-16"
                />
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={overlay.y}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, {
                      y: Math.min(1, Math.max(0, Number(e.target.value) || 0))
                    })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 w-16"
                />
              </label>
              <label className="flex items-center gap-1.5 col-span-2">
                <span className="text-ink-muted w-12">Time</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={overlay.startSec.toFixed(2)}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, {
                      startSec: Math.max(0, Number(e.target.value) || 0)
                    })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 w-20"
                />
                <span className="text-ink-dim">→</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={overlay.endSec.toFixed(2)}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, {
                      endSec: Math.max(overlay.startSec, Number(e.target.value) || 0)
                    })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 w-20"
                />
                <span className="text-ink-dim">sec</span>
                <button
                  onClick={() => removeTextOverlay(clip.id, overlay.id)}
                  className="ml-auto text-ink-dim hover:text-rose-300 px-2"
                  title="Remove"
                >
                  ✕
                </button>
              </label>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
