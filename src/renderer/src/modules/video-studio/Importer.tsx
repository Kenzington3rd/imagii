import { useEffect, useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'
import { useImportRun } from './store/runs'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
import { basename } from '../../components/OutputDirLabel'
import { keptPartQuestion, replacedSince } from '../project/ProjectIO'
import { useRecentFiles } from '../../hooks/useRecentFiles'
import { claimFirst } from '../../lib/claimFirst'
import { dropSwapPress, focusAfterSwap, recordSwapPress, type SwapToken } from '../../lib/swapFocus'
import { describeFailedOpen, examineDroppedFile } from '@shared/importDiagnostics'
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
  const { recent, push, remove, clear } = useRecentFiles('video')
  // T-131 (5): and one chooser at a time. `busy` is only set once a file was PICKED, so a double-click on "Choose file…" opened two
  // choosers (the first's answer loads the file, the second's replaced it or was refused). Claimed before the dialog, given back after.
  const pickingRef = useRef(false)
  // T-192 (3): the importer is the new content when Close brings it back (focus goes to Choose file… when Close held it), and the row is what a pick's press records
  // from: Choose file… or the Recent toggle (a Recent entry hands the focus to the toggle before its pick runs, T-140 (9)). `lib/swapFocus.ts`.
  const rowRef = useRef<HTMLDivElement | null>(null)
  const chooseRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    focusAfterSwap('video-choose', chooseRef.current)
  }, [])
  /**
   * A press that may open a video: the pick's focus is recorded while this row still has it, and its token is dropped by every way the pick ends without one.
   * T-193 (1): only a press that PROCEEDS records (a Recent entry pressed while an import runs is turned away first), and a press drops only its own token, so a
   * refused press never clears the record of the import that is still running.
   */
  function recordPick(): SwapToken | null {
    const active = document.activeElement
    return recordSwapPress('video-play', active !== null && rowRef.current !== null && rowRef.current.contains(active))
  }

  /** Refuses a second import while one runs — it used to start a PARALLEL conversion
   *  (two ffmpeg transcodes fighting for the CPU, then whichever finished last won). */
  function refuseIfBusy(): boolean {
    const running = useImportRun.getState().run
    if (running === null) return false
    // T-193 (1): drops nothing - the press that is refused holds no record of its own here, and the target's record belongs to the import that is running.
    toast(
      running.converting
        ? 'Still converting the last video. Wait for it to finish.'
        : 'Still loading the last video. Wait for it to finish.',
      { id: 'importer-busy', icon: <Icon name="warning" size={18} /> }
    )
    return true
  }

  /** `advise`: what the drop has to say about the file ("may not be a supported video"). Said after the kept question (a Cancel says nothing about a file that was not tried) and before the run is claimed. */
  async function handleFile(filePath: string, advise?: () => void, token: SwapToken | null = null): Promise<void> {
    if (!filePath) return
    // A Choose file… whose chooser was open when another import began lands here refused: it drops its own record (a drop has none: `token` is null).
    if (refuseIfBusy()) {
      dropSwapPress('video-play', token)
      return
    }
    // T-175 (3): a part kept for a video that could not be opened (clips waiting for an unplugged drive) is let go when a DIFFERENT video opens here. Asked before the
    // run is claimed or anything is said, over the file this opens (`videoKey` of the loaded video: the picked path, converted or not); Cancel opens nothing.
    const keptQuestion = keptPartQuestion('video', filePath, basename(filePath))
    if (keptQuestion !== null && !confirm(keptQuestion)) {
      dropSwapPress('video-play', token)
      return
    }
    advise?.()
    if (!useImportRun.getState().begin({ filePath, converting: false })) {
      dropSwapPress('video-play', token)
      return
    }
    // T-136 (2): what the video store held when this import began. The importer is on screen only while no video is open, but the conversion takes
    // minutes and nothing locks the app: a video that arrives meanwhile (a project opened from Home, "Edit in Video Studio") is the one being edited.
    const heldBefore = useVideoStore.getState().source
    // T-192 (3): set once the video is open: the Player mounts with it and takes the pick's record. Any other end drops it (the `finally`).
    let kept = false
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
      kept = true
      await push(filePath)
      toast.success('Video loaded')
    } catch (err) {
      toast.dismiss('convert')
      // M8 fix (round 15): default 4 s toast wasn't enough to read on a
      // codec-not-supported error. Mirror AudioImporter — 8 s + the shared
      // describeImportError which surfaces actionable hints (cloud-sync,
      // permission, unknown codec).
      // T-150: a Recent entry whose file is gone would fail the same way on every pick. Dropped from its list, and the toast says so.
      // T-175 (2): but only when its folder is there - on a drive that is not connected the entry stays and the toast says why.
      const sentence = await describeFailedOpen(err, filePath, 'video', { folderPresent: (p) => window.api.settings.folderOfFilePresent(p), remove })
      toast.error(sentence, { duration: 8000 })
    } finally {
      if (!kept) dropSwapPress('video-play', token)
      useImportRun.getState().end()
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) {
      // T-177 (2): a link, a browser thumbnail or selected text carries no file, and the card un-highlighted and said nothing. The audio importer's sentence, from the
      // same shared hint, at the default duration it uses. Ahead of the busy refusal, as there: that refusal is about a file being tried.
      toast.error(examineDroppedFile(undefined).hint ?? 'No file dropped.')
      return
    }
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
    const advise = isVideoFilename(file.name)
      ? undefined
      : (): void => {
          toast(`${file.name} may not be a supported video — trying anyway`, {
            icon: <Icon name="warning" size={18} />
          })
        }
    void handleFile(filePath, advise)
  }

  function pickRecent(path: string): void {
    // T-193 (1): turned away BEFORE it records, so the refusal cannot touch the running import's record.
    if (refuseIfBusy()) return
    void handleFile(path, undefined, recordPick())
  }

  async function onPickFile(): Promise<void> {
    await claimFirst(pickingRef, async () => {
      // Recorded once the press holds the claim (a double-click's second press records nothing) and ahead of the chooser's first await, so the focus read is the press's.
      const token = recordPick()
      const filePath = await window.api.video.pickFile()
      if (filePath) await handleFile(filePath, undefined, token)
      else dropSwapPress('video-play', token)
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
      <div className="flex items-center gap-2" ref={rowRef}>
        <button ref={chooseRef} className="btn-primary disabled:opacity-50" onClick={onPickFile} disabled={busy}>
          Choose file…
        </button>
        <RecentFilesMenu recent={recent} onPick={pickRecent} onClear={() => void clear()} />
      </div>
    </div>
  )
}
