import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { CustomPreset } from '@shared/customPresets'
import { isValidBitrate } from '@shared/customPresets'
import type { PlatformId } from '@shared/clip'
import { ALL_PLATFORM_IDS, PLATFORM_INFO } from './presets'
import { PanelHeader } from '../../components/PanelHeader'
import { Modal } from '../../components/Modal'

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

  // Re-read on open, so a preset folder edited outside the app still shows
  // up. Keyed on `open` alone deliberately: `onChanged` is a stable
  // useCallback in the parent and listing on every render would re-read disk
  // on each keystroke in the form below.
  useEffect(() => {
    if (open) void onChanged()
  }, [open, onChanged])

  if (!open) return null

  function loadFromBase(p: PlatformId): void {
    const info = PLATFORM_INFO[p]
    setWidth(info.width)
    setHeight(info.height)
    setBase(p)
  }

  async function save(): Promise<void> {
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
    if (!isValidBitrate(videoBitrate) || !isValidBitrate(audioBitrate)) {
      toast.error('Bitrates look like 8M or 192k')
      return
    }
    await window.api.video.saveCustomPreset({
      name: trimmed,
      width,
      height,
      fps,
      videoBitrate,
      audioBitrate,
      basePlatformId: base
    })
    setName('')
    await onChanged()
    toast.success(`Saved "${trimmed}"`)
  }

  async function remove(p: CustomPreset): Promise<void> {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    await window.api.video.deleteCustomPreset(p.id)
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
                <label className="flex items-center gap-1.5">
                  <span className="text-ink-muted w-16">Width</span>
                  <input
                    type="number"
                    min={64}
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value) || 64)}
                    className="bg-bg-base rounded px-2 py-1 flex-1"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-ink-muted w-16">Height</span>
                  <input
                    type="number"
                    min={64}
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value) || 64)}
                    className="bg-bg-base rounded px-2 py-1 flex-1"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-ink-muted w-16">FPS</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value) || 30)}
                    className="bg-bg-base rounded px-2 py-1 flex-1"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-ink-muted w-16">V bitrate</span>
                  <input
                    type="text"
                    value={videoBitrate}
                    onChange={(e) => setVideoBitrate(e.target.value)}
                    className="bg-bg-base rounded px-2 py-1 flex-1 font-mono"
                  />
                </label>
                <label className="flex items-center gap-1.5 col-span-2">
                  <span className="text-ink-muted w-16">A bitrate</span>
                  <input
                    type="text"
                    value={audioBitrate}
                    onChange={(e) => setAudioBitrate(e.target.value)}
                    className="bg-bg-base rounded px-2 py-1 flex-1 font-mono"
                  />
                </label>
              </div>
              <button className="btn-primary px-4 py-1.5 text-sm self-start" onClick={save}>
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
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-ink-dim font-mono">
                      {p.width}×{p.height} · {p.fps}fps · {p.videoBitrate} ·{' '}
                      {PLATFORM_INFO[p.basePlatformId].label}
                    </span>
                    <button
                      className="ml-auto text-ink-dim hover:text-danger text-xs"
                      onClick={() => remove(p)}
                    >
                      ✕ delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

      <div className="p-3 border-t border-ink-dim/30 flex justify-between items-center text-xs text-ink-dim">
        <span>Saved presets join the platform presets in the Export panel — tick one to export a clip at its own size and bitrate.</span>
        <button className="text-accent hover:underline" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  )
}
