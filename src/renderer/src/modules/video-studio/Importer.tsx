import { useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'
import { useImportRun } from './store/runs'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
import { basename } from '../../components/OutputDirLabel'
import { replacedSince } from '../project/ProjectIO'
import { useRecentFiles } from '../../hooks/useRecentFiles'
import { claimFirst } from '../../lib/claimFirst'
import { describeImportError } from '@shared/importDiagnostics'
import {
  VIDEO_EXTENSIONS,
  isVideoFilename,
  videoNeedsConversion,
  formatHint
} from '@shared/mediaFormats'

// Round 20: lists + hint come from shared/mediaFormats — see that module
// for the native-vs-convert tiering rationale.

export function Importer(): JSX.Element {
  const loadSource = useVideoStore((s) => s.loadSource)
  // T-136 (2): the import - the load, and for flv / ts / wmv / mpg the transcode - is a module store, not this component's state. T-112's
  // `busyRef` / `busy` died with the route: a trip to Home re-armed the importer over a conversion main was still running, a second drop ran a SECOND
  // libx264 convert, and the second one's landing replaced the video being edited (executed: 2 edited clips reset to 1, with no confirm - loading is
  // not undoable). The claim is `begin()`, taken the instant the import starts (a second drop or Recent pick in the same breath reads the store, not a
  // render); `converting` only chooses the words of the refusal. Main refuses a second convert too (`video:convertForImport`), whoever asks.
  const busy = useImportRun((s) => s.run !== null)
  const [dragOver, setDragOver] = useState(false)
  const { recent, push, clear } = useRecentFiles('video')
  // T-131 (5): and one chooser at a time. `busy` is only set once a file was PICKED, so a double-click on "Choose file…" opened two
  // choosers (the first's answer loads the file, the second's replaced it or was refused). Claimed before the dialog, given back after.
  const pickingRef = useRef(false)

  /** Refuses a second import while one runs — it used to start a PARALLEL conversion
   *  (two ffmpeg transcodes fighting for the CPU, then whichever finished last won). */
  function refuseIfBusy(): boolean {
    const running = useImportRun.getState().run
    if (running === null) return false
    toast(
      running.converting
        ? 'Still converting the last video. Wait for it to finish.'
        : 'Still loading the last video. Wait for it to finish.',
      { id: 'importer-busy', icon: <Icon name="warning" size={18} /> }
    )
    return true
  }

  async function handleFile(filePath: string): Promise<void> {
    if (!filePath) return
    if (refuseIfBusy()) return
    if (!useImportRun.getState().begin({ filePath, converting: false })) return
    // T-136 (2): what the video store held when this import began. The importer is on screen only while no video is open, but the conversion takes
    // minutes and nothing locks the app: a video that arrives meanwhile (a project opened from Home, "Edit in Video Studio") is the one being edited.
    const heldBefore = useVideoStore.getState().source
    try {
      let sourcePath = filePath
      // Round 20: stream-dump containers (flv/ts/wmv/mpg/3gp) can't play
      // in Chromium's <video> element — transcode to an mp4 working copy
      // first. Proven per-container in the Layer 5 suite.
      const needsConversion = videoNeedsConversion(filePath)
      if (needsConversion) {
        useImportRun.getState().patch({ converting: true })
        toast.loading('Converting for editing\u2026', { id: 'convert' })
        sourcePath = await window.api.video.convertForImport(filePath)
        toast.dismiss('convert')
        // The same rule as a project open (`replacedSince`, T-112): a video that is open now and was not when this began is the person's, and the
        // converted copy is not loaded over it (loading resets the clips and the undo history, and cannot be undone).
        if (replacedSince(heldBefore, useVideoStore.getState().source)) {
          toast(`Skipped ${basename(filePath)} because you opened another video while it was converting`, {
            icon: <Icon name="warning" size={18} />,
            duration: 8000
          })
          return
        }
      }
      // T-107: the store keeps the ORIGINAL beside the working copy, so a saved
      // project can point at the file the person owns and convert again on open.
      await loadSource(sourcePath, needsConversion ? filePath : undefined)
      await push(filePath)
      toast.success('Video loaded')
    } catch (err) {
      toast.dismiss('convert')
      // M8 fix (round 15): default 4 s toast wasn't enough to read on a
      // codec-not-supported error. Mirror AudioImporter — 8 s + the shared
      // describeImportError which surfaces actionable hints (cloud-sync,
      // permission, unknown codec).
      toast.error(describeImportError(err, filePath), { duration: 8000 })
    } finally {
      useImportRun.getState().end()
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    // Before anything else is said about the file: "trying anyway" followed by a
    // refusal would be two sentences that disagree.
    if (refuseIfBusy()) return
    const filePath = (file as File & { path?: string }).path
    if (!filePath) {
      // M8 fix (round 15): longer duration to match the rest of the error path.
      toast.error('Could not read file path — try the file picker instead.', {
        duration: 8000
      })
      return
    }
    if (!isVideoFilename(file.name)) {
      toast(`${file.name} may not be a supported video — trying anyway`, {
        icon: <Icon name="warning" size={18} />
      })
    }
    void handleFile(filePath)
  }

  async function onPickFile(): Promise<void> {
    await claimFirst(pickingRef, async () => {
      const filePath = await window.api.video.pickFile()
      if (filePath) await handleFile(filePath)
    })
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`card flex flex-col items-center justify-center text-center px-10 py-16 transition-colors ${
        dragOver ? 'border-accent bg-bg-hover' : ''
      }`}
    >
      <div className="mb-4 text-accent">
        <Icon name="video" size={48} />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Drop a video here</h2>
      <p className="text-ink-muted text-sm mb-6">
        {formatHint(VIDEO_EXTENSIONS)}. {busy ? 'Loading…' : 'Or use the file picker.'}
      </p>
      <div className="flex items-center gap-2">
        <button className="btn-primary disabled:opacity-50" onClick={onPickFile} disabled={busy}>
          Choose file…
        </button>
        <RecentFilesMenu recent={recent} onPick={(p) => void handleFile(p)} onClear={() => void clear()} />
      </div>
    </div>
  )
}
