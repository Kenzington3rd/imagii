import { clipSpeed } from '@shared/clip'
import { hookWindow } from '@shared/highlights'
import { handleGestureEndPointerUp, useVideoStore, videoHasNoSound } from './store/videoStore'
import { ClipKitButton } from './ClipKitButton'
import { HookIndicator } from './HookIndicator'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'
import { formatClock } from '@shared/clockTime'

export function ClipList(): JSX.Element {
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const selectClip = useVideoStore((s) => s.selectClip)
  const addClip = useVideoStore((s) => s.addClip)
  const removeClip = useVideoStore((s) => s.removeClip)
  const renameClip = useVideoStore((s) => s.renameClip)
  const setClipSpeed = useVideoStore((s) => s.setClipSpeed)
  const endGesture = useVideoStore((s) => s.endGesture)
  const source = useVideoStore((s) => s.source)
  const selected = clips.find((c) => c.id === selectedClipId)
  const selectedSpeed = selected ? clipSpeed(selected) : 1
  const hook = selected ? hookWindow(selected) : null

  return (
    // T-40: the speed slider and each rename field coalesce their own stream
    // of events into one undo step, and only a gesture END can tell that
    // stream from the next one. pointerup and focusout bubble, so one pair
    // here closes the window for the slider, its Reset button and every
    // rename input in the list.
    // T-80: every pointerup — including the click that moves the caret inside
    // a rename field mid-edit. `handleGestureEndPointerUp` lets that one
    // through; a text field's gesture ends on blur, which is the other half
    // of this pair.
    <div
      className="card p-4 flex flex-col gap-3"
      onPointerUp={handleGestureEndPointerUp}
      onBlur={endGesture}
    >
      <PanelHeader
        icon="film"
        actions={
          <button className="btn-ghost px-3 py-1 text-xs" onClick={addClip}>
            + Add clip
          </button>
        }
      >
        Clips ({clips.length})
      </PanelHeader>
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
              className="flex-1 min-w-0"
              // M11 fix (round 15)
              aria-label="Clip playback speed"
              aria-valuetext={`${selectedSpeed.toFixed(2)} times normal speed`}
            />
            <span className="font-mono w-10 shrink-0 whitespace-nowrap text-right">{selectedSpeed.toFixed(2)}×</span>
            <button
              className="text-ink-dim hover:text-ink-base flex"
              onClick={() => setClipSpeed(selected.id, 1)}
              title="Reset to 1×"
              aria-label="Reset speed to 1×"
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
          {/* T-124 (19): BRANDING says a control with no live preview says so in one line (the color grade's exemplar). The player
              always plays at normal speed (nothing sets a playback rate); the speed is in the exported file. */}
          <p className="text-xs text-ink-dim">
            Speed is applied when you export. The player here always plays at normal speed.
          </p>
          {/* Phase 4C: hook indicator. Lazy-fetches first-3-seconds energy
              for the selected clip. Hover for the explanation. */}
          {source && hook && !videoHasNoSound(source) ? (
            <div className="flex items-center gap-2 text-xs">
              {/* T-112: three seconds of what the viewer sees, so the window to
                  listen to is 3 x the clip's speed in the source (hookWindow). A clip
                  shorter than that is listened to whole, and the label says so. A clip
                  too short to have a hook (hookWindow is null, T-113) has no row, and neither
                  has a video with no sound (T-114: the badge rates how LOUD the opening is -
                  the three panels that need sound were gated, this one was left behind). */}
              <span className="text-ink-muted">
                First {Math.round(hook.outputSec * 10) / 10} s:
              </span>
              {/* T-114: one badge per clip. Its previous score stays up while a new one is worked
                  out (a start-handle drag), which is right for the SAME clip and wrong for another. */}
              <HookIndicator
                key={`${source.filePath}|${selected.id}`}
                sourcePath={source.filePath}
                startSec={selected.startSec}
                durationSec={hook.sourceSec}
                outputSec={hook.outputSec}
              />
            </div>
          ) : null}
          {/* Phase 4D: one-click clip kit (5 platforms + 3 thumbnails). T-136 (1): ONE button, for the selected clip; a running kit shows on it. */}
          <div className="flex items-center justify-end">
            <ClipKitButton clip={selected} />
          </div>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {clips.map((clip) => {
          const isSelected = clip.id === selectedClipId
          return (
            <li
              key={clip.id}
              // T-112: the selected row says so to a screen reader too, not only by its
              // border. (The select button below carries it as well: that is where
              // keyboard focus lands.)
              aria-current={isSelected ? 'true' : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                isSelected
                  ? 'border-accent bg-bg-hover'
                  : 'border-ink-dim/30 hover:bg-bg-hover'
              }`}
            >
              {/* T-17: the rename input used to sit INSIDE the row-select
                  button, which made the row an ambiguous activation target
                  and needed an onClick stopPropagation to keep typing from
                  selecting. Siblings instead: the input handles its own
                  clicks (no ancestor handler left to stop), and the select
                  button keeps the whole timecode column as its hit area. */}
              <input
                type="text"
                value={clip.name}
                onChange={(e) => renameClip(clip.id, e.target.value)}
                className="bg-transparent flex-1 min-w-0 outline-none focus:bg-bg-base focus:ring-1 focus:ring-accent px-1 rounded text-sm"
                aria-label={`Rename clip ${clip.name}`}
              />
              <button
                onClick={() => selectClip(clip.id)}
                className="text-left flex items-center gap-3 text-xs text-ink-muted font-mono hover:text-ink-base"
                title="Select clip"
                aria-current={isSelected ? 'true' : undefined}
                // T-112 (label in name): the name CONTAINS the timecode the button shows,
                // so someone who speaks the visible text to a voice-control tool reaches it.
                aria-label={`Select clip ${clip.name}, ${formatClock(clip.startSec)} → ${formatClock(clip.endSec)}`}
              >
                {formatClock(clip.startSec)} → {formatClock(clip.endSec)}
              </button>
              {clips.length > 1 ? (
                <button
                  onClick={() => {
                    // UX round 18: destructive — confirm before removing.
                    // (Undo can bring it back, but a confirm still beats a
                    // surprise; same pattern as CustomPresetManager.)
                    if (!confirm(`Remove clip "${clip.name}"?`)) return
                    removeClip(clip.id)
                  }}
                  className="text-xs text-ink-dim hover:text-danger px-2"
                  title="Remove clip"
                  // UX round 18: the ✕ glyph would otherwise win the
                  // accessible-name computation over the title attribute.
                  aria-label="Remove clip"
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
