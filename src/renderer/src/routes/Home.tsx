import toast from 'react-hot-toast'
import { NavCard } from '../components/NavCard'
import { Icon } from '../components/Icon'
import { audioSettled, captureProject, describeApplyOutcome } from '../modules/project/ProjectIO'
import { AutosaveRestore } from '../components/AutosaveRestore'
import { useAutosaveOffer } from '../components/restoreRun'
import { applyProjectHeld } from '../hooks/useAutosave'
import { useGlobalUndo } from '../hooks/useGlobalUndo'
import { claimFirst } from '../lib/claimFirst'
import { reportFailure } from '../lib/reportFailure'
import { ERROR_TOAST_MS } from '@shared/userFacingError'

/** The one line for a project file imagii could not read (T-84). The validator's
 *  own reason ("videoStudio.clips not array") goes to the console. */
const PROJECT_OPEN_FAILED =
  "Couldn't open that project. The file may be damaged, or it was saved by a newer version of imagii."

/**
 * T-131 (5): Open project and Save project share ONE claim, and it covers the native dialog and nothing after it. Both go straight to a
 * dialog, and a double-click on either opened two (executed: two choosers). The apply that follows an open is not under it: opening
 * another project meanwhile is supported (T-112's `replacedSince`), and a claim held for a long conversion would drop that press.
 */
const projectDialog = { current: false }

async function handleSave(): Promise<void> {
  try {
    // `undefined` is the second press of a double-click (the first one's dialog is on screen); `null` is a canceled dialog.
    const saved = await claimFirst(projectDialog, () => window.api.project.save(captureProject()))
    if (saved) toast.success('Project saved')
  } catch (err) {
    reportFailure(err, { failed: "Couldn't save the project." })
  }
}

async function handleLoad(): Promise<void> {
  try {
    const result = await claimFirst(projectDialog, () => window.api.project.load())
    if (!result) return // a second press while the dialog was open, or the user canceled it
    if (!result.ok) {
      reportFailure(result.reason, { failed: PROJECT_OPEN_FAILED })
      return
    }
    // T-84: a project whose video was moved still opens everything else, and
    // the ONE message says which file is gone (instead of "Project loaded"
    // over a half-empty studio, or a probe error over a half-restored one).
    // T-113: autosave is held for the apply and for nothing else — not the file dialog before
    // it, not 1.5 s after it (a quit then saved none of what was done during a long conversion).
    const outcome = await applyProjectHeld(result.project)
    // T-139 (5): the project is in the stores. The autosave banner on this page offers a session that is not the person's any more: it goes (Restore would apply
    // the snapshot over what was just opened).
    useAutosaveOffer.getState().withdraw()
    // T-112: also the files that would not open for another reason, and a source
    // skipped because the person opened a different one while it loaded.
    const note = describeApplyOutcome(outcome, 'project')
    if (note) {
      toast(note, { icon: <Icon name="warning" size={18} />, duration: ERROR_TOAST_MS })
    } else if (await audioSettled(outcome)) {
      // T-132 (11): a sound the project opened is drawn AFTER it opens and can still be refused; the green line waits for its waveform.
      toast.success('Project loaded')
    }
  } catch (err) {
    // Not a validation failure — something threw while opening (the dialog
    // bridge, a store). The "damaged or newer" line above would be a guess.
    reportFailure(err, { failed: "Couldn't open that project." })
  }
}

export function Home(): JSX.Element {
  const undo = useGlobalUndo()
  return (
    <div className="h-full overflow-auto px-10 py-12">
      <header className="mb-10 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">imagii</h1>
          <p className="text-ink-muted mt-2">
            Hi Mike — pick a studio to get started.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
            onClick={undo.undo}
            disabled={!undo.canUndo}
            title={`Undo last action (${undo.lastLabel})`}
          >
            <Icon name="undo" size={15} /> Undo
          </button>
          <button
            className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
            onClick={undo.redo}
            disabled={!undo.canRedo}
            title="Redo"
          >
            <Icon name="redo" size={15} /> Redo
          </button>
          <span className="text-xs text-ink-dim mx-2">
            last: {undo.lastLabel}
          </span>
          <button
            className="btn-ghost px-3 py-1.5 inline-flex items-center gap-1.5"
            onClick={handleLoad}
          >
            <Icon name="folder-open" size={15} /> Open project
          </button>
          <button
            className="btn-ghost px-3 py-1.5 inline-flex items-center gap-1.5"
            onClick={handleSave}
          >
            <Icon name="save" size={15} /> Save project
          </button>
        </div>
      </header>

      <AutosaveRestore />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        <NavCard
          to="/record"
          title="Record"
          description="Record your screen or a window, with your webcam and mic, to one video file. Game and desktop sound are not captured."
          icon={<Icon name="record" size={26} />}
          accent="rgba(244, 63, 94, 0.18)"
        />
        <NavCard
          to="/video"
          title="Video Studio"
          description="Trim and clip video, then export for TikTok, Reels, YouTube, X, or Facebook."
          icon={<Icon name="video" size={26} />}
          accent="rgba(255, 49, 49, 0.18)"
        />
        <NavCard
          to="/audio"
          title="Audio Studio"
          description="Clean noise, level volume, and polish audio to podcast quality."
          icon={<Icon name="audio" size={26} />}
          accent="rgba(168, 162, 158, 0.18)"
        />
        <NavCard
          to="/image"
          title="Stream Graphics"
          description="Templates for thumbnails, Twitch overlays, banners, and emotes — start from a preset or import your own image."
          icon={<Icon name="image" size={26} />}
          accent="rgba(220, 38, 38, 0.18)"
        />
        <NavCard
          to="/references"
          title="References"
          description="Search inspiration, save mood boards, and drop them onto the canvas as reference layers."
          icon={<Icon name="sparkle" size={26} />}
          accent="rgba(168, 162, 158, 0.18)"
        />
      </div>

      <footer className="mt-12 text-xs text-ink-dim">
        imagii runs locally on your computer, except Reference Search and the one-time
        caption model download, which go online. No accounts. No subscriptions.
      </footer>
    </div>
  )
}
