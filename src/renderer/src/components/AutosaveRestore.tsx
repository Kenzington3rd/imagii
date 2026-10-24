import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import type { ImagiiProject } from '@shared/workspace'
import { audioSettled, describeApplyOutcome, sessionHoldsWork } from '../modules/project/ProjectIO'
import { applyProjectHeld } from '../hooks/useAutosave'
import { countOf } from '@shared/plural'
import { ERROR_TOAST_MS } from '@shared/userFacingError'
import { reportFailure } from '../lib/reportFailure'
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
  return `${countOf(Math.floor(ms / 86400000), 'day')} ago`
}

export function AutosaveRestore(): JSX.Element | null {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // T-124 (5): the banner is for a session that holds nothing - a launch, or the page a crash reloads to. This component
  // mounts on every visit to Home, mid-session included, and `dismissed` is only this mount's state, so a file that was
  // fresh and valid offered itself again on each visit, and Restore applied it over the live session with no question
  // (the undo histories went with it). Asked once per mount, ahead of both banners; a damaged file is announced at the
  // next launch instead, when nothing is open.
  const [holdsWork] = useState(sessionHoldsWork)
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
        // T-84: the validator's reason ("invalid JSON: Unexpected end of JSON
        // input") is for whoever debugs this, not for the banner.
        console.error('[imagii] the autosave on disk failed validation:', result.reason)
        setSnapshot({ ...result, project: undefined })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (dismissed || holdsWork || !snapshot || !snapshot.info) {
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
    try {
      // T-113: autosave is held for the apply alone (see `applyProjectHeld`).
      const outcome = await applyProjectHeld(snapshot.project)
      // T-84: same rule as Open project — what could be restored is, and the
      // one message names the file that could not.
      const note = describeApplyOutcome(outcome, 'autosave')
      if (note) {
        toast(note, { icon: <Icon name="warning" size={18} />, duration: ERROR_TOAST_MS })
      } else {
        // T-132 (11): a restored sound is drawn AFTER it opens and can still be refused; the green line waits for its waveform, and the
        // navigation below does not wait for the line.
        void audioSettled(outcome).then((settled) => {
          if (settled) toast.success('Restored from autosave')
        })
      }
      setDismissed(true)
      // T-47: and back to the studio they were in, with the selections and
      // the playhead applyProject just put back. Only on the user's own
      // click — continuity is what Restore means, never something that
      // happens to a session that said Later.
      const route = snapshot.project.place?.route
      if (route) navigate(route)
    } catch (err) {
      reportFailure(err, { failed: "Couldn't restore the autosave." })
    } finally {
      setBusy(false)
    }
  }

  // "Clear" on both buttons and in the toast (T-92): it empties the one
  // autosave file, the same call whether the file is good or damaged. The
  // healthy banner used to call it Discard and the damaged one Clear.
  async function clearAutosave(): Promise<void> {
    setBusy(true)
    try {
      await window.api.autosave.clear()
      toast('Autosave cleared', { icon: <Icon name="trash" size={18} /> })
      setDismissed(true)
    } catch (err) {
      // T-57: a clear that failed leaves the file exactly where it was, so
      // the banner stays too — with its button, because trying again is the
      // only thing to do and hiding the offer would strand the file with no
      // way to reach it. Nothing here dismisses.
      // T-117: through the one helper (8 s, T-115). The sentence used to splice main's string in as
      // written ("Couldn't clear the autosave: <reason>."); the plain cause now follows it where the
      // shape is known, and a raw one is left to the console. The only cause that can be named is a
      // locked file: main appends the errno of the unlink that failed (T-118, "could not delete
      // autosave.json (EBUSY)") and userFacingError maps EBUSY, EPERM and EACCES. unlink has no
      // full-disk shape, and a message without a code stays the bare sentence. The banner and its
      // Clear button are still there, so the sentence says only what is true.
      reportFailure(err, { failed: "Couldn't clear the autosave. It's still on disk." })
    } finally {
      setBusy(false)
    }
  }

  const ageText =
    snapshot.info.ageMs !== undefined ? formatAge(snapshot.info.ageMs) : 'unknown'
  // "from just now" is not English; "from a moment ago" is. Only the damaged
  // banner reads the age as the end of "an autosave from …" (T-84).
  const damagedWhen =
    snapshot.info.ageMs === undefined
      ? 'earlier'
      : snapshot.info.ageMs < 60 * 1000
        ? 'a moment ago'
        : ageText

  if (!snapshot.ok) {
    return (
      <div className="card p-3 mb-4 border-danger-strong/40 bg-danger-strong/5 text-sm flex items-center gap-3">
        <span className="text-danger flex-shrink-0">
          <Icon name="warning" size={18} />
        </span>
        <span className="flex-1">
          imagii found an autosave from {damagedWhen}, but it's damaged and can't be restored.
          Clear it to get rid of it.
        </span>
        <button
          className="btn-ghost px-3 py-1 text-xs disabled:opacity-50"
          onClick={() => void clearAutosave()}
          disabled={busy}
          title="Clear the autosave"
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
        className="btn-primary px-3 py-1 text-xs disabled:opacity-50"
        onClick={() => void restore()}
        disabled={busy}
      >
        {busy ? 'Restoring…' : 'Restore'}
      </button>
      <button
        className="btn-ghost px-3 py-1 text-xs disabled:opacity-50"
        onClick={() => void clearAutosave()}
        disabled={busy}
        title="Clear the autosave"
      >
        Clear
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
