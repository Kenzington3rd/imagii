import { useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
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
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const { recent, push, clear } = useRecentFiles('video')
  // T-112: one import at a time. `busy` is state, and a second drop or Recent pick in
  // the same breath reads it before the first one's render; the ref is set the instant
  // the import starts. `convertingRef` only chooses the words of the refusal.
  const busyRef = useRef(false)
  const convertingRef = useRef(false)
  // T-131 (5): and one chooser at a time. `busy` is only set once a file was PICKED, so a double-click on "Choose file…" opened two
  // choosers (the first's answer loads the file, the second's replaced it or was refused). Claimed before the dialog, given back after.
  const pickingRef = useRef(false)

  /** Refuses a second import while one runs — it used to start a PARALLEL conversion
   *  (two ffmpeg transcodes fighting for the CPU, then whichever finished last won). */
  function refuseIfBusy(): boolean {
    if (!busyRef.current) return false
    toast(
      convertingRef.current
        ? 'Still converting the last video. Wait for it to finish.'
        : 'Still loading the last video. Wait for it to finish.',
      { id: 'importer-busy', icon: <Icon name="warning" size={18} /> }
    )
    return true
  }

  async function handleFile(filePath: string): Promise<void> {
    if (!filePath) return
    if (refuseIfBusy()) return
    busyRef.current = true
    setBusy(true)
    try {
      let sourcePath = filePath
      // Round 20: stream-dump containers (flv/ts/wmv/mpg/3gp) can't play
      // in Chromium's <video> element — transcode to an mp4 working copy
      // first. Proven per-container in the Layer 5 suite.
      const needsConversion = videoNeedsConversion(filePath)
      if (needsConversion) {
        convertingRef.current = true
        toast.loading('Converting for editing\u2026', { id: 'convert' })
        sourcePath = await window.api.video.convertForImport(filePath)
        toast.dismiss('convert')
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
      busyRef.current = false
      convertingRef.current = false
      setBusy(false)
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
