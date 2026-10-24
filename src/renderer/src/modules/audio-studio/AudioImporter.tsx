import { useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useAudioStore, waveformArrived, type AudioSource } from './state/audioStore'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
import { useRecentFiles } from '../../hooks/useRecentFiles'
import { claimFirst } from '../../lib/claimFirst'
import {
  describeImportError,
  examineDroppedFile,
  pathLooksLikeCloudSync
} from '@shared/importDiagnostics'
import { assertDefined } from '@shared/assert'
import { audioNeedsExtraction, formatHint, AUDIO_EXTENSIONS } from '@shared/mediaFormats'

// Round 20: classification comes from shared/mediaFormats; extraction now
// also covers audio formats WebAudio can't decode (aiff/wma).

export function AudioImporter(): JSX.Element {
  const loadSource = useAudioStore((s) => s.loadSource)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const { recent, push, clear } = useRecentFiles('audio')
  // T-119: one import at a time, the video Importer's rule (T-112). `busy` is state, and a second drop or
  // Recent pick in the same breath reads it before the first one's render; the ref is set the instant the
  // import starts. `extractingRef` only chooses the words of the refusal. A slow extraction of a video's
  // sound used to land after a second file had loaded (and been tuned) and replace it.
  const busyRef = useRef(false)
  const extractingRef = useRef(false)
  // T-131 (5): and one chooser at a time (the Importer's `pickingRef`): `busy` is set only once a file was picked.
  const pickingRef = useRef(false)

  /** Refuses a second import while one runs. */
  function refuseIfBusy(): boolean {
    if (!busyRef.current) return false
    toast(
      extractingRef.current
        ? 'Still extracting audio from the last file. Wait for it to finish.'
        : 'Still loading the last file. Wait for it to finish.',
      { id: 'audio-importer-busy', icon: <Icon name="warning" size={18} /> }
    )
    return true
  }

  async function loadFile(filePath: string): Promise<void> {
    if (refuseIfBusy()) return
    busyRef.current = true
    setBusy(true)
    try {
      console.info('[audio-import] loading', filePath)
      let opened: AudioSource
      if (audioNeedsExtraction(filePath)) {
        extractingRef.current = true
        toast.loading('Extracting audio…', { id: 'extract' })
        const { wavPath, hasVideo } = await window.api.audio.extractFromVideo(filePath)
        toast.dismiss('extract')
        opened = await loadSource(wavPath, filePath, undefined, hasVideo)
      } else {
        opened = await loadSource(filePath)
      }
      // T-132 (11): the file is OPEN, but its waveform is read after that (T-129) and main can still refuse it (an unknown WAV format,
      // a damaged stream): the studio then lets go of it and says why. "Loaded" and a Recent entry are for a file that stayed.
      if (!(await waveformArrived(opened))) return
      await push(filePath)
      toast.success('Loaded')
    } catch (err) {
      console.error('[audio-import] failed', { filePath, err })
      toast.dismiss('extract')
      toast.error(describeImportError(err, filePath, 'audio'), { duration: 8000 })
    } finally {
      busyRef.current = false
      extractingRef.current = false
      setBusy(false)
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
    if (diag.reason === 'cloud-placeholder') {
      toast(diag.hint ?? 'Cloud-sync path detected.', { icon: <Icon name="warning" size={18} />, duration: 6000 })
    }
    void loadFile(filePath)
  }

  async function onPickFile(): Promise<void> {
    await claimFirst(pickingRef, async () => {
      const filePath = await window.api.audio.pickFile()
      if (!filePath) return
      // The picker can be open while a drop starts a load (the button is only disabled once busy): refuse
      // before the cloud-sync warning, for the reason the drop does.
      if (refuseIfBusy()) return
      if (pathLooksLikeCloudSync(filePath)) {
        toast(
          'Cloud-sync path. If import fails, right-click in Explorer → "Always keep on this device".',
          { icon: <Icon name="warning" size={18} />, duration: 6000 }
        )
      }
      await loadFile(filePath)
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
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={onPickFile} disabled={busy}>
          {busy ? 'Loading…' : 'Choose file…'}
        </button>
        <RecentFilesMenu recent={recent} onPick={(p) => void loadFile(p)} onClear={() => void clear()} />
      </div>
      <p className="text-xs text-ink-dim mt-4 max-w-md">
        Files in OneDrive / Google Drive that show as cloud-only need to be marked "Always keep
        on this device" first. Files dragged from browser tabs use the picker instead.
      </p>
    </div>
  )
}
