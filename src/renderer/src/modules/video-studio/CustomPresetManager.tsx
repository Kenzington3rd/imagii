import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { CustomPreset } from '@shared/customPresets'
import type { PlatformId } from '@shared/clip'
import { ALL_PLATFORM_IDS, PLATFORM_INFO } from './presets'

interface CustomPresetManagerProps {
  open: boolean
  onClose: () => void
}

const DEFAULT_BASE: PlatformId = 'youtube'

export function CustomPresetManager({ open, onClose }: CustomPresetManagerProps): JSX.Element | null {
  const [presets, setPresets] = useState<CustomPreset[]>([])
  const [name, setName] = useState('')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [fps, setFps] = useState(30)
  const [videoBitrate, setVideoBitrate] = useState('8M')
  const [audioBitrate, setAudioBitrate] = useState('192k')
  const [base, setBase] = useState<PlatformId>(DEFAULT_BASE)

  async function refresh(): Promise<void> {
    const list = await window.api.video.listCustomPresets()
    setPresets(list)
  }

  useEffect(() => {
    if (open) void refresh()
  }, [open])

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
    await refresh()
    toast.success(`Saved "${trimmed}"`)
  }

  async function remove(p: CustomPreset): Promise<void> {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    await window.api.video.deleteCustomPreset(p.id)
    await refresh()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-ink-dim/30 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-ink-dim/30">
          <h2 className="text-lg font-semibold">Custom export presets</h2>
          <button className="text-ink-dim hover:text-ink-base" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4 overflow-y-auto">
          <section>
            <h3 className="text-xs uppercase tracking-wide text-ink-muted mb-2">
              Save a new preset
            </h3>
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
            <h3 className="text-xs uppercase tracking-wide text-ink-muted mb-2">
              Saved presets ({presets.length})
            </h3>
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
                      className="ml-auto text-ink-dim hover:text-rose-300 text-xs"
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
          <span>Custom presets currently scaffold metadata only — exports use the base platform's encoder settings.</span>
          <button className="text-accent hover:underline" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
