import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import type { ImagiiProject } from '@shared/workspace'
import { applyProject } from '../modules/project/ProjectIO'
import { suppressAutosave } from '../hooks/useAutosave'
import { ipcErrorMessage } from '@shared/ipcError'
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
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  // Round 17 B7: lightweight metadata (size + age) shown via `autosave.info`
  // without loading the whole project. Lets the home page show "Last
  // autosave: 5 min ago" even after the user dismissed the restore prompt.
  const [info, setInfo] = useState<{ ageMs?: number; exists: boolean } | null>(
    null
  )

  useEffect(() => {
    let cancelled = false
    // Cheap metadata probe runs in parallel with the full read so the
    // dismissed-state status line has data even if the user never opens
    // the restore prompt.
    void window.api.autosave.info().then((meta) => {
      if (!cancelled) setInfo(meta)
    })
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
      } else if (!result.ok && result.info?.exists) {
        // T-33: a corruption notice, gated on nothing but the file being
        // there. The age used to be required here and main never sent one
        // for a file that failed validation, so this branch — and the Clear
        // button that is the only in-app way to delete the bad file — could
        // never render. Staleness is not a gate either: a corrupt autosave
        // is never restorable, so hiding an old one just leaves it on disk
        // with no way for the user to hear about it or clear it.
        setSnapshot({ ...result, project: undefined })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (dismissed || !snapshot || !snapshot.info) {
    // Round 17 B7: even when there's no restore prompt to show, surface a
    // single-line "Last autosave: 5 min ago" so the user knows imagii is
    // backing them up. Driven by the cheap autosave.info() call.
    if (info && info.exists && info.ageMs !== undefined) {
      return (
        <div className="text-xs text-ink-dim mb-3">
          Last autosave: {formatAge(info.ageMs)}
        </div>
      )
    }
    return null
  }

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
      // T-47: and back to the studio they were in, with the selections and
      // the playhead applyProject just put back. Only on the user's own
      // click — continuity is what Restore means, never something that
      // happens to a session that said Later.
      const route = snapshot.project.place?.route
      if (route) navigate(route)
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
    } catch (err) {
      // T-57: a clear that failed leaves the file exactly where it was, so
      // the banner stays too — with its button, because trying again is the
      // only thing to do and hiding the offer would strand the file with no
      // way to reach it. Nothing here dismisses.
      toast.error(
        `Couldn't clear the autosave: ${ipcErrorMessage(err, 'unknown reason')}. ` +
          "It's still on disk — close anything using it and try again."
      )
    } finally {
      setBusy(false)
    }
  }

  const ageText =
    snapshot.info.ageMs !== undefined ? formatAge(snapshot.info.ageMs) : 'unknown'

  if (!snapshot.ok) {
    return (
      <div className="card p-3 mb-4 border-danger-strong/40 bg-danger-strong/5 text-sm flex items-center gap-3">
        <span className="text-danger flex-shrink-0">
          <Icon name="warning" size={18} />
        </span>
        <span className="flex-1">
          An autosave was found ({ageText}) but failed validation: {snapshot.reason}. It will
          not be loaded. You can clear it.
        </span>
        <button
          className="btn-ghost px-3 py-1 text-xs"
          onClick={() => void discard()}
          disabled={busy}
        >
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
