import toast from 'react-hot-toast'
import { NavCard } from '../components/NavCard'
import { Icon } from '../components/Icon'
import { applyProject, captureProject } from '../modules/project/ProjectIO'
import { AutosaveRestore } from '../components/AutosaveRestore'
import { suppressAutosave } from '../hooks/useAutosave'
import { useGlobalUndo } from '../hooks/useGlobalUndo'

async function handleSave(): Promise<void> {
  try {
    const project = captureProject()
    const saved = await window.api.project.save(project)
    if (saved) toast.success('Project saved')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Save failed')
  }
}

async function handleLoad(): Promise<void> {
  const release = suppressAutosave()
  let opened = false
  try {
    const result = await window.api.project.load()
    if (!result) return // user canceled the dialog
    if (!result.ok) {
      toast.error(`Couldn't load project: ${result.reason}`)
      return
    }
    opened = true
    await applyProject(result.project)
    toast.success('Project loaded')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Load failed')
  } finally {
    // On a successful load, hold suppression while stores settle. On any
    // failure path (cancel, validation rejection, throw), release immediately
    // so the user can keep autosaving without a 1.5s stall.
    if (opened) setTimeout(release, 1500)
    else release()
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
          description="Capture screen + webcam + mic to a single video — your one-stop alternative to OBS."
          icon={<Icon name="record" size={26} />}
          accent="rgba(244, 63, 94, 0.18)"
        />
        <NavCard
          to="/video"
          title="Video Studio"
          description="Trim and clip video, then export for TikTok, Reels, YouTube, X, or Facebook."
          icon={<Icon name="video" size={26} />}
          accent="rgba(244, 114, 182, 0.18)"
        />
        <NavCard
          to="/audio"
          title="Audio Studio"
          description="Clean noise, level volume, and polish audio to podcast quality."
          icon={<Icon name="audio" size={26} />}
          accent="rgba(96, 165, 250, 0.18)"
        />
        <NavCard
          to="/image"
          title="Stream Graphics"
          description="Templates for thumbnails, Twitch overlays, banners, and emotes — start from a preset or import your own image."
          icon={<Icon name="image" size={26} />}
          accent="rgba(52, 211, 153, 0.18)"
        />
        <NavCard
          to="/references"
          title="References"
          description="Search inspiration, save mood boards, and drop them onto the canvas as reference layers."
          icon={<Icon name="sparkle" size={26} />}
          accent="rgba(251, 191, 36, 0.18)"
        />
      </div>

      <footer className="mt-12 text-xs text-ink-dim">
        imagii runs locally on your computer. No accounts. No subscriptions.
      </footer>
    </div>
  )
}
