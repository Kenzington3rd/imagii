import { useEffect, useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useAudioStore, waveformArrived, type AudioSource } from './state/audioStore'
import { useAudioImportRun } from './state/audioImport'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
import { basename } from '../../components/OutputDirLabel'
import { keptPartQuestion, replacedSince } from '../project/ProjectIO'
import { useRecentFiles } from '../../hooks/useRecentFiles'
import { claimFirst } from '../../lib/claimFirst'
import { dropSwapPress, focusAfterSwap, recordSwapPress, type SwapToken } from '../../lib/swapFocus'
import { describeFailedOpen, examineDroppedFile, pathLooksLikeCloudSync } from '@shared/importDiagnostics'
import { assertDefined } from '@shared/assert'
import { audioNeedsExtraction, formatHint, AUDIO_EXTENSIONS } from '@shared/mediaFormats'

// Round 20: classification comes from shared/mediaFormats; extraction now
// also covers audio formats WebAudio can't decode (aiff/wma).

export function AudioImporter(): JSX.Element {
  const loadSource = useAudioStore((s) => s.loadSource)
  // T-137 (1): the import - the load, and for a video or an AIFF / WMA the extraction - is a module store, not this component's state. T-119's
  // `busyRef` died with the route: a trip to Home re-armed the importer over an extraction main was still running, a plain WAV dropped on the idle
  // importer opened (main refuses only a second EXTRACTION) and was tuned, and the extraction's landing then replaced it, its chain and its undo
  // history, with no confirm. The claim is `begin()`, taken the instant the import starts (a second drop or Recent pick in the same breath reads the
  // store, not a render); `extracting` only chooses the words of the refusal. A returning importer is the same import: busy, refusing a second.
  const busy = useAudioImportRun((s) => s.run !== null)
  const [dragOver, setDragOver] = useState(false)
  const { recent, push, remove, clear } = useRecentFiles('audio')
  // T-131 (5): and one chooser at a time (the Importer's `pickingRef`): `busy` is set only once a file was picked.
  const pickingRef = useRef(false)
  // T-192 (3): the importer is the new content when Close brings it back (focus goes to Choose file… when Close held it), and the row is what a pick's press records
  // from: Choose file… or the Recent toggle (a Recent entry hands the focus to the toggle before its pick runs, T-140 (9)). `lib/swapFocus.ts`.
  const rowRef = useRef<HTMLDivElement | null>(null)
  const chooseRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    focusAfterSwap('audio-choose', chooseRef.current)
  }, [])
  /**
   * A press that may open a sound: the pick's focus is recorded while this row still has it, and its token is dropped by every way the pick ends without one.
   * T-193 (1): only a press that PROCEEDS records (a Recent entry pressed while an import runs is turned away first), and a press drops only its own token, so a
   * refused press never clears the record of the import that is still running.
   */
  function recordPick(): SwapToken | null {
    const active = document.activeElement
    return recordSwapPress('audio-play', active !== null && rowRef.current !== null && rowRef.current.contains(active))
  }

  /** Refuses a second import while one runs. */
  function refuseIfBusy(): boolean {
    const running = useAudioImportRun.getState().run
    if (running === null) return false
    // T-193 (1): drops nothing - the press that is refused holds no record of its own here, and the target's record belongs to the import that is running.
    toast(
      running.extracting
        ? 'Still extracting audio from the last file. Wait for it to finish.'
        : 'Still loading the last file. Wait for it to finish.',
      { id: 'audio-importer-busy', icon: <Icon name="warning" size={18} /> }
    )
    return true
  }

  /** `advise`: what the drop or the picker has to say about the file (the cloud-sync warning). Said after the kept question (a Cancel says nothing about a file that was not tried) and before the run is claimed. */
  async function loadFile(filePath: string, advise?: () => void, token: SwapToken | null = null): Promise<void> {
    // A Choose file… whose chooser was open when another import began lands here refused: it drops its own record (a drop has none: `token` is null).
    if (refuseIfBusy()) {
      dropSwapPress('audio-play', token)
      return
    }
    // T-175 (3): a chain kept for a sound that could not be opened (an unplugged drive) is let go when a DIFFERENT file opens here. Asked before the run is claimed or
    // anything is said, over the file this opens (`soundKey` of the loaded sound: the picked path, whether it is played as it is or extracted); Cancel opens nothing.
    const keptQuestion = keptPartQuestion('audio', filePath, basename(filePath))
    if (keptQuestion !== null && !confirm(keptQuestion)) {
      dropSwapPress('audio-play', token)
      return
    }
    advise?.()
    const extracting = audioNeedsExtraction(filePath)
    if (!useAudioImportRun.getState().begin({ filePath, extracting })) {
      dropSwapPress('audio-play', token)
      return
    }
    // T-137 (1): what Audio Studio held when this import began. The importer is on screen only while no sound is open, but an extraction takes
    // minutes and nothing locks the app: a sound that arrives meanwhile (a project opened from Home, Clean audio on a video) is the one being edited.
    const heldBefore = useAudioStore.getState().source
    // T-192 (3): set once the sound is open and its waveform has arrived: from there the studio's Play takes the pick's record. Any other end drops it (the `finally`).
    let kept = false
    try {
      console.info('[audio-import] loading', filePath)
      let opened: AudioSource
      if (extracting) {
        toast.loading('Extracting audio…', { id: 'extract' })
        const { wavPath, hasVideo } = await window.api.audio.extractFromVideo(filePath)
        toast.dismiss('extract')
        // The rule of a project open and of Video Studio's Clean audio (`replacedSince`, T-112): a sound that is open now and was not when this began
        // is the person's, and the extracted one is not loaded over it (loading resets the chain and the undo history, and cannot be undone).
        if (replacedSince(heldBefore, useAudioStore.getState().source)) {
          toast(`Skipped the sound of ${basename(filePath)} because you opened another file in Audio Studio while it was extracting`, {
            icon: <Icon name="warning" size={18} />,
            duration: 8000
          })
          return
        }
        opened = await loadSource(wavPath, filePath, undefined, hasVideo)
      } else {
        opened = await loadSource(filePath)
      }
      // T-132 (11): the file is OPEN, but its waveform is read after that (T-129) and main can still refuse it (an unknown WAV format,
      // a damaged stream): the studio then lets go of it and says why. "Loaded" and a Recent entry are for a file that stayed.
      if (!(await waveformArrived(opened))) return
      kept = true
      await push(filePath)
      toast.success('Loaded')
    } catch (err) {
      console.error('[audio-import] failed', { filePath, err })
      toast.dismiss('extract')
      // T-150: a Recent entry whose file is gone would fail the same way on every pick. Dropped from its list, and the toast says so.
      // T-175 (2): but only when its folder is there - on a drive that is not connected the entry stays and the toast says why.
      const sentence = await describeFailedOpen(err, filePath, 'audio', { folderPresent: (p) => window.api.settings.folderOfFilePresent(p), remove })
      toast.error(sentence, { duration: 8000 })
    } finally {
      if (!kept) dropSwapPress('audio-play', token)
      useAudioImportRun.getState().end()
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    // Before anything else is said about the file: a cloud-sync warning followed by a refusal would be
    // two sentences that disagree.
    if (file && refuseIfBusy()) return
    const diag = examineDroppedFile(file)
    console.info('[audio-import] drop', diag)

    if (diag.reason === 'no-file') {
      toast.error(diag.hint ?? 'No file dropped.')
      return
    }
    if (diag.reason === 'no-path') {
      toast.error(diag.hint ?? 'Could not read file path.', { duration: 10000 })
      return
    }
    // M13 fix (round 15): the `no-path` branch above already returns when
    // path is missing, so this is logically safe — but `!` skips runtime
    // verification and tools can't see that. assertDefined keeps the
    // type-narrowing and produces a clear error if the guard ever drifts.
    const filePath = assertDefined(
      (file as File & { path?: string }).path,
      'dropped file path'
    )
    const advise =
      diag.reason === 'cloud-placeholder'
        ? (): void => {
            toast(diag.hint ?? 'Cloud-sync path detected.', { icon: <Icon name="warning" size={18} />, duration: 6000 })
          }
        : undefined
    void loadFile(filePath, advise)
  }

  function pickRecent(path: string): void {
    // T-193 (1): turned away BEFORE it records, so the refusal cannot touch the running import's record.
    if (refuseIfBusy()) return
    void loadFile(path, undefined, recordPick())
  }

  async function onPickFile(): Promise<void> {
    await claimFirst(pickingRef, async () => {
      // Recorded once the press holds the claim (a double-click's second press records nothing) and ahead of the chooser's first await, so the focus read is the press's.
      const token = recordPick()
      const filePath = await window.api.audio.pickFile()
      if (!filePath) {
        dropSwapPress('audio-play', token)
        return
      }
      // The picker can be open while a drop starts a load (the button is only disabled once busy): refuse
      // before the cloud-sync warning, for the reason the drop does. Its own record goes with the refusal.
      if (refuseIfBusy()) {
        dropSwapPress('audio-play', token)
        return
      }
      await loadFile(
        filePath,
        pathLooksLikeCloudSync(filePath)
          ? (): void => {
              toast(
                'Cloud-sync path. If import fails, right-click in Explorer → "Always keep on this device".',
                { icon: <Icon name="warning" size={18} />, duration: 6000 }
              )
            }
          : undefined,
        token
      )
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
        <Icon name="audio" size={48} />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Drop audio or video here</h2>
      <p className="text-ink-muted text-sm mb-6">
        {formatHint(AUDIO_EXTENSIONS)} — or any video to extract its audio.
      </p>
      <div className="flex items-center gap-2" ref={rowRef}>
        <button ref={chooseRef} className="btn-primary disabled:opacity-50" onClick={onPickFile} disabled={busy}>
          {busy ? 'Loading…' : 'Choose file…'}
        </button>
        <RecentFilesMenu recent={recent} onPick={pickRecent} onClear={() => void clear()} />
      </div>
      <p className="text-xs text-ink-dim mt-4 max-w-md">
        Files in OneDrive / Google Drive that show as cloud-only need to be marked "Always keep
        on this device" first. Files dragged from browser tabs use the picker instead.
      </p>
    </div>
  )
}
