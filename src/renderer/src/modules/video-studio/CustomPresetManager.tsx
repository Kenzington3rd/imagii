import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { CustomPreset } from '@shared/customPresets'
import { formatBitrate, normalizeBitrate } from '@shared/customPresets'
import type { PlatformId } from '@shared/clip'
import { ALL_PLATFORM_IDS, PLATFORM_INFO, customPresetStartFor } from './presets'
import { PanelHeader } from '../../components/PanelHeader'
import { Modal } from '../../components/Modal'
import { DraftField } from '../../components/DraftField'
import { claimFirst } from '../../lib/claimFirst'
import { reportFailure } from '../../lib/reportFailure'
import { isRepeatPress } from '../../lib/repeatPress'
import { clampTyped, isTypedInRange } from '@shared/draftNumber'

interface CustomPresetManagerProps {
  open: boolean
  onClose: () => void
  /** The saved presets, owned by ExportPanel — the same list the export
   *  grid draws from, so the modal and the grid can never disagree (T-50). */
  presets: ReadonlyArray<CustomPreset>
  /** Re-read the list from disk. Awaited after every save and delete so the
   *  grid updates (and a deleted preset is unqueued) before the modal
   *  repaints. */
  onChanged: () => Promise<void>
}

const DEFAULT_BASE: PlatformId = 'youtube'

// What a preset's boxes take. Width and height stop at 16384, the most the save accepts (`video:saveCustomPreset`),
// so a typed 70000 is that and not a refusal nobody can read. Their FLOOR is deliberately not enforced here: a
// width under 64 is refused at Save, in a sentence ("Width / height must be at least 64"), and that refusal is
// kept (T-123 (4)). The frame rate is the 1 to 120 its attributes say.
const SIZE_MIN = 64
const SIZE_MAX = 16384
const FPS_MIN = 1
const FPS_MAX = 120
// T-134 (5): the name box takes no more than this. The name is drawn in the Export panel's preset labels and the queue rows too (each cuts it
// with an ellipsis), so a name nobody can read whole in any of them is a name nobody needs; the row below cuts a longer one that is already on disk.
const PRESET_NAME_MAX = 60

export function CustomPresetManager({
  open,
  onClose,
  presets,
  onChanged
}: CustomPresetManagerProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [fps, setFps] = useState(30)
  const [videoBitrate, setVideoBitrate] = useState('8M')
  const [audioBitrate, setAudioBitrate] = useState('192k')
  const [base, setBase] = useState<PlatformId>(DEFAULT_BASE)
  // T-139 (9): one save at a time. `savingRef` is the claim, raised before the first await; `saving` is what the button draws while the write is out.
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)

  // Re-read on open, so a preset folder edited outside the app still shows
  // up. Keyed on `open` alone deliberately: `onChanged` is a stable
  // useCallback in the parent and listing on every render would re-read disk
  // on each keystroke in the form below.
  useEffect(() => {
    if (open) void onChanged()
  }, [open, onChanged])

  if (!open) return null

  function loadFromBase(p: PlatformId): void {
    // T-132 (7): the platform's whole encode, not its size alone - a preset based on YouTube 1080p60 starts at 60 fps and 12M.
    const start = customPresetStartFor(p)
    setWidth(start.width)
    setHeight(start.height)
    setFps(start.fps)
    setVideoBitrate(start.videoBitrate)
    setAudioBitrate(start.audioBitrate)
    setBase(p)
  }

  async function save(): Promise<void> {
    await claimFirst(savingRef, async () => {
      setSaving(true)
      try {
        await saveOnce()
      } finally {
        setSaving(false)
      }
    })
  }

  async function saveOnce(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Give it a name')
      return
    }
    if (width < 64 || height < 64) {
      toast.error('Width / height must be at least 64')
      return
    }
    // T-50: these two strings become the encoder's `-b:v` / `-b:a`, so a
    // preset with a bitrate ffmpeg can't read is a preset that can't export.
    // Refuse it here rather than let the user find out at export time.
    // T-92: and a bare "192" is not refused but READ — as kilobits, the way the
    // field's example teaches — because ffmpeg would read it as bits per second.
    // What was understood is written back into the field, so the unit the form
    // assumed is on screen.
    const video = normalizeBitrate(videoBitrate, 'video')
    if (!video.ok) {
      toast.error(video.problem)
      return
    }
    const audio = normalizeBitrate(audioBitrate, 'audio')
    if (!audio.ok) {
      toast.error(audio.problem)
      return
    }
    setVideoBitrate(video.value)
    setAudioBitrate(audio.value)
    // T-135 (8): a refused write (a full disk, a folder that cannot be made) was an unhandled rejection and the form looked as if it had saved; the
    // audio Cleanup presets have had this catch since T-90. The name stays in the box for the retry.
    try {
      await window.api.video.saveCustomPreset({
        name: trimmed,
        width,
        height,
        fps,
        videoBitrate: video.value,
        audioBitrate: audio.value,
        basePlatformId: base
      })
    } catch (err) {
      reportFailure(err, { failed: "Couldn't save that preset." })
      return
    }
    setName('')
    await onChanged()
    toast.success(`Saved "${trimmed}"`)
  }

  async function remove(p: CustomPreset): Promise<void> {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    try {
      await window.api.video.deleteCustomPreset(p.id)
    } catch (err) {
      reportFailure(err, { failed: "Couldn't delete that preset." })
      return
    }
    // The parent's refresh also prunes the deleted id off every clip, so the
    // checkbox and its queued job disappear together (T-50).
    await onChanged()
  }

  // INIT-G (round 16): migrated to <Modal> for Escape + focus trap + focus
  // restore. The form-input dialog was the worst offender — re-opening it
  // used to drop focus back to the page root, losing the user's place.
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Custom export presets"
      className="w-full max-w-2xl max-h-[80vh] flex flex-col"
    >
      <div className="flex items-center justify-between p-4 border-b border-ink-dim/30">
        <h2 className="text-lg font-semibold">Custom export presets</h2>
        <button
          className="text-ink-dim hover:text-ink-base"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          Close
        </button>
      </div>

        <div className="p-4 flex flex-col gap-4 overflow-y-auto">
          <section>
            <PanelHeader icon="gear" className="mb-2">
              Save a new preset
            </PanelHeader>
            <p className="text-xs text-ink-dim mb-3">
              Create a custom resolution / bitrate combo on top of an existing platform preset.
              Useful for non-standard targets (Discord 1080p, vertical YouTube shorts at custom
              size, etc.).
            </p>
            <div className="flex flex-col gap-2 text-sm">
              <input
                type="text"
                placeholder="Preset name (e.g. Discord 1080p)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-bg-base rounded px-2 py-1.5"
                maxLength={PRESET_NAME_MAX}
                // M11 fix (round 15): the visible label "Preset name (e.g. …)"
                // is the placeholder, which AT does not treat as a label.
                aria-label="Custom preset name"
              />
              <label className="flex items-center gap-2 text-xs">
                <span className="text-ink-muted w-24">Base on</span>
                <select
                  value={base}
                  onChange={(e) => loadFromBase(e.target.value as PlatformId)}
                  className="bg-bg-base rounded px-2 py-1 flex-1"
                >
                  {ALL_PLATFORM_IDS.map((id) => (
                    <option key={id} value={id}>
                      {PLATFORM_INFO[id].label} ({PLATFORM_INFO[id].width}×
                      {PLATFORM_INFO[id].height})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Width (px)</span>
                  {/* T-123 (4): kept until typing ends; `Number(typed) || 64` appended "1280" to an emptied box as 641280. */}
                  <DraftField
                    type="number"
                    min={SIZE_MIN}
                    value={String(width)}
                    live={(typed) => isTypedInRange(typed, SIZE_MIN, SIZE_MAX)}
                    commit={(typed) => {
                      const n = clampTyped(typed, 1, SIZE_MAX)
                      if (n !== null) setWidth(n)
                      return null
                    }}
                    className="bg-bg-base rounded px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Height (px)</span>
                  <DraftField
                    type="number"
                    min={SIZE_MIN}
                    value={String(height)}
                    live={(typed) => isTypedInRange(typed, SIZE_MIN, SIZE_MAX)}
                    commit={(typed) => {
                      const n = clampTyped(typed, 1, SIZE_MAX)
                      if (n !== null) setHeight(n)
                      return null
                    }}
                    className="bg-bg-base rounded px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Frame rate (fps)</span>
                  <DraftField
                    type="number"
                    min={FPS_MIN}
                    max={FPS_MAX}
                    value={String(fps)}
                    live={(typed) => isTypedInRange(typed, FPS_MIN, FPS_MAX)}
                    commit={(typed) => {
                      const n = clampTyped(typed, FPS_MIN, FPS_MAX)
                      if (n !== null) setFps(n)
                      return null
                    }}
                    className="bg-bg-base rounded px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Video bitrate (e.g. 8M)</span>
                  <input
                    type="text"
                    value={videoBitrate}
                    onChange={(e) => setVideoBitrate(e.target.value)}
                    className="bg-bg-base rounded px-2 py-1 font-mono"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Audio bitrate (e.g. 192k)</span>
                  <input
                    type="text"
                    value={audioBitrate}
                    onChange={(e) => setAudioBitrate(e.target.value)}
                    className="bg-bg-base rounded px-2 py-1 font-mono"
                  />
                </label>
                <p className="self-end text-ink-dim">
                  M is megabits per second, k is kilobits per second. A bare number counts as
                  kilobits.
                </p>
              </div>
              {/* T-139 (9): the second press of a double-click is not a second preset, nor a "Give it a name" after the first cleared the box. */}
              <button
                className="btn-primary px-4 py-1.5 text-sm self-start disabled:opacity-50"
                onClick={(e) => {
                  if (isRepeatPress(e)) return
                  void save()
                }}
                disabled={saving}
              >
                + Save preset
              </button>
            </div>
          </section>

          <section>
            <PanelHeader icon="gear" className="mb-2">
              Saved presets ({presets.length})
            </PanelHeader>
            {presets.length === 0 ? (
              <p className="text-xs text-ink-dim">No custom presets yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {presets.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2 bg-bg-hover rounded text-sm"
                  >
                    {/* T-134 (5): the name gives way (an ellipsis, the whole of it as the tooltip); the numbers and Delete never move. An 80-character
                        unbroken name used to push Delete past the card's edge. */}
                    <span className="font-medium min-w-0 truncate" title={p.name}>
                      {p.name}
                    </span>
                    <span className="text-xs text-ink-dim font-mono shrink-0">
                      {p.width}×{p.height} · {p.fps} fps · {formatBitrate(p.videoBitrate)} ·{' '}
                      {PLATFORM_INFO[p.basePlatformId].label}
                    </span>
                    <button
                      className="ml-auto shrink-0 text-ink-dim hover:text-danger text-xs"
                      onClick={() => remove(p)}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

      <div className="p-3 border-t border-ink-dim/30 text-xs text-ink-dim">
        Saved presets join the platform presets in the Export panel — check one to export a clip at its own size and bitrate.
      </div>
    </Modal>
  )
}
