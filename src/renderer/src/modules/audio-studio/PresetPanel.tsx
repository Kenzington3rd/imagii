import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { ChainSpec } from '@shared/audio'
import { cleanupSettings } from '@shared/audioPreset'
import type { ChainPreset } from '@shared/workspace'
import { useAudioStore } from './state/audioStore'
import { PanelHeader } from '../../components/PanelHeader'
import { reportFailure } from '../../lib/reportFailure'

/**
 * What Apply puts on the recording in front of the user (T-90): the preset's
 * cleanup settings, and nothing else. A preset written by an older build also
 * holds that day's cut times and second track — `cleanupSettings` drops both,
 * so applying it cannot re-impose them on a new take.
 */
export function presetPatch(preset: ChainPreset): Partial<ChainSpec> {
  return cleanupSettings(preset.chain)
}

export function PresetPanel(): JSX.Element {
  const chain = useAudioStore((s) => s.chain)
  const patchChain = useAudioStore((s) => s.patchChain)
  const [presets, setPresets] = useState<ChainPreset[]>([])
  const [name, setName] = useState('')

  async function refresh(): Promise<void> {
    // Round 18: swallow-and-report instead of letting a rejection escape the
    // unawaited effect call below as an unhandled promise rejection.
    try {
      const list = await window.api.audio.listPresets()
      setPresets(list)
    } catch {
      toast.error('Could not load saved presets')
    }
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
    // T-90: a failed write (full disk, a locked folder) used to be an
    // unhandled rejection — the button looked fine and nothing was saved.
    try {
      await window.api.audio.savePreset(trimmed, chain)
    } catch (err) {
      reportFailure(err, { failed: "Couldn't save that preset." })
      return
    }
    setName('')
    await refresh()
    toast.success(`Saved "${trimmed}"`)
  }

  async function apply(p: ChainPreset): Promise<void> {
    patchChain(presetPatch(p))
    toast.success(`Applied "${p.name}"`)
  }

  async function remove(p: ChainPreset): Promise<void> {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    try {
      await window.api.audio.deletePreset(p.id)
    } catch (err) {
      reportFailure(err, { failed: "Couldn't delete that preset." })
      return
    }
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
          className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 text-xs"
        />
        <button className="btn-primary px-3 py-1 text-xs" onClick={save}>
          Save current
        </button>
      </div>
      <p className="text-xs text-ink-dim">
        Saves your cleanup settings — noise, levels, and voice treatments — so you can reuse
        them. Cuts and the second track stay with the session.
      </p>
      {presets.length > 0 ? (
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
                className="text-ink-dim hover:text-danger"
                onClick={() => remove(p)}
                title="Delete preset"
                aria-label="Delete preset"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
