import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { ChainPreset } from '@shared/workspace'
import { useAudioStore } from './state/audioStore'
import { PanelHeader } from '../../components/PanelHeader'

export function PresetPanel(): JSX.Element {
  const chain = useAudioStore((s) => s.chain)
  const patchChain = useAudioStore((s) => s.patchChain)
  const [presets, setPresets] = useState<ChainPreset[]>([])
  const [name, setName] = useState('')

  async function refresh(): Promise<void> {
    const list = await window.api.audio.listPresets()
    setPresets(list)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function save(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name your preset first')
      return
    }
    await window.api.audio.savePreset(trimmed, chain)
    setName('')
    await refresh()
    toast.success(`Saved "${trimmed}"`)
  }

  async function apply(p: ChainPreset): Promise<void> {
    patchChain(p.chain)
    toast.success(`Applied "${p.name}"`)
  }

  async function remove(p: ChainPreset): Promise<void> {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    await window.api.audio.deletePreset(p.id)
    await refresh()
  }

  return (
    <div className="card p-3 flex flex-col gap-2 text-sm">
      <PanelHeader icon="gear">Cleanup presets</PanelHeader>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="My mic preset"
          className="flex-1 bg-bg-base rounded px-2 py-1 text-xs"
        />
        <button className="btn-primary px-3 py-1 text-xs" onClick={save}>
          Save current
        </button>
      </div>
      {presets.length === 0 ? (
        <p className="text-xs text-ink-dim">
          Get the chain dialed in, name it, and save. One click to re-apply next session.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {presets.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 px-2 py-1.5 bg-bg-hover rounded text-xs"
            >
              <span className="flex-1 truncate font-medium">{p.name}</span>
              <button
                className="text-accent hover:underline"
                onClick={() => apply(p)}
              >
                Apply
              </button>
              <button
                className="text-ink-dim hover:text-rose-300"
                onClick={() => remove(p)}
                title="Remove preset"
                aria-label="Remove preset"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
