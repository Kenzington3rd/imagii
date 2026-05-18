import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { ImagiiProject } from '@shared/workspace'
import { applyProject } from '../modules/project/ProjectIO'
import { suppressAutosave } from '../hooks/useAutosave'
import { Icon } from './Icon'

interface AutosaveSnapshot {
  ok: boolean
  reason?: string
  project?: ImagiiProject
  info?: {
    exists: boolean
    filePath: string
    savedAt?: number
    ageMs?: number
    sizeBytes?: number
  }
}

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function formatAge(ms: number): string {
  if (ms < 60 * 1000) return 'just now'
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)} min ago`
  if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3600000)} hr ago`
  return `${Math.floor(ms / 86400000)} day(s) ago`
}

export function AutosaveRestore(): JSX.Element | null {
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.autosave.read().then((result) => {
      if (cancelled) return
      // Only offer restore if the autosave is fresh AND validates
      if (
        result.ok &&
        result.project &&
        result.info?.ageMs !== undefined &&
        result.info.ageMs < STALE_THRESHOLD_MS
      ) {
        setSnapshot(result)
      } else if (
        !result.ok &&
        result.info?.exists &&
        result.info?.ageMs !== undefined &&
        result.info.ageMs < STALE_THRESHOLD_MS
      ) {
        // Show a corruption notice (rare)
        setSnapshot({ ...result, project: undefined })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (dismissed || !snapshot || !snapshot.info) return null

  async function restore(): Promise<void> {
    if (!snapshot?.project) return
    setBusy(true)
    const release = suppressAutosave()
    let restored = false
    try {
      await applyProject(snapshot.project)
      restored = true
      toast.success('Restored from autosave')
      setDismissed(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      // Bug-fix (Phase 2.14): on success, hold suppression for 1.5s so the
      // stores' applyProject side-effects flush before autosave re-engages.
      // On failure, release immediately — a thrown applyProject leaves
      // partially-applied state and there's no benefit to making the user
      // wait an extra 1.5s before they can autosave again.
      if (restored) setTimeout(release, 1500)
      else release()
      setBusy(false)
    }
  }

  async function discard(): Promise<void> {
    setBusy(true)
    try {
      await window.api.autosave.clear()
      toast('Autosave discarded.', { icon: <Icon name="trash" size={18} /> })
      setDismissed(true)
    } finally {
      setBusy(false)
    }
  }

  const ageText =
    snapshot.info.ageMs !== undefined ? formatAge(snapshot.info.ageMs) : 'unknown'

  if (!snapshot.ok) {
    return (
      <div className="card p-3 mb-4 border-rose-400/40 bg-rose-400/5 text-sm flex items-center gap-3">
        <span className="text-rose-300 flex-shrink-0">
          <Icon name="warning" size={18} />
        </span>
        <span className="flex-1">
          An autosave was found ({ageText}) but failed validation: {snapshot.reason}. It will
          not be loaded. You can clear it.
        </span>
        <button className="btn-ghost px-3 py-1 text-xs" onClick={() => void discard()}>
          Clear
        </button>
        <button
          className="btn-ghost px-3 py-1 text-xs"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="card p-3 mb-4 border-accent/40 bg-accent/5 text-sm flex items-center gap-3">
      <span className="text-accent flex-shrink-0">
        <Icon name="save" size={18} />
      </span>
      <span className="flex-1">
        imagii autosaved your work {ageText}. Want to pick up where you left off?
      </span>
      <button
        className="btn-primary px-3 py-1 text-xs"
        onClick={() => void restore()}
        disabled={busy}
      >
        {busy ? 'Restoring…' : 'Restore'}
      </button>
      <button
        className="btn-ghost px-3 py-1 text-xs"
        onClick={() => void discard()}
        disabled={busy}
      >
        Discard
      </button>
      <button
        className="btn-ghost px-3 py-1 text-xs"
        onClick={() => setDismissed(true)}
      >
        Later
      </button>
    </div>
  )
}
