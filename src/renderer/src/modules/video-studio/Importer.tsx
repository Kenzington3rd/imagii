import { useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
import { useRecentFiles } from '../../hooks/useRecentFiles'
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

  async function handleFile(filePath: string): Promise<void> {
    if (!filePath) return
    setBusy(true)
    try {
      let sourcePath = filePath
      // Round 20: stream-dump containers (flv/ts/wmv/mpg/3gp) can't play
      // in Chromium's <video> element — transcode to an mp4 working copy
      // first. Proven per-container in the Layer 5 suite.
      if (videoNeedsConversion(filePath)) {
        toast.loading('Converting for editing\u2026', { id: 'convert' })
        sourcePath = await window.api.video.convertForImport(filePath)
        toast.dismiss('convert')
      }
      await loadSource(sourcePath)
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
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const filePath = (file as File & { path?: string }).path
    if (!filePath) {
      // M8 fix (round 15): longer duration to match the rest of the error path.
      toast.error('Could not read file path — try the file picker instead.', {
        duration: 8000
      })
      return
    }
    if (!isVideoFilename(file.name)) {
      toast(`${file.name} may not be a supported video — trying anyway.`, {
        icon: <Icon name="warning" size={18} />
      })
    }
    void handleFile(filePath)
  }

  async function onPickFile(): Promise<void> {
    const filePath = await window.api.video.pickFile()
    if (filePath) await handleFile(filePath)
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
        <button className="btn-primary" onClick={onPickFile} disabled={busy}>
          Choose file…
        </button>
        <RecentFilesMenu recent={recent} onPick={(p) => void handleFile(p)} onClear={() => void clear()} />
      </div>
    </div>
  )
}
