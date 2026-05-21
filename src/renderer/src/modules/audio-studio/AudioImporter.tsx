import { useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useAudioStore } from './state/audioStore'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
import { useRecentFiles } from '../../hooks/useRecentFiles'
import {
  describeImportError,
  examineDroppedFile,
  pathLooksLikeCloudSync
} from '@shared/importDiagnostics'
import { assertDefined } from '@shared/assert'

const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']

function isVideoExt(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXTS.some((ext) => lower.endsWith(ext))
}

export function AudioImporter(): JSX.Element {
  const loadSource = useAudioStore((s) => s.loadSource)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const { recent, push, clear } = useRecentFiles('audio')

  async function loadFile(filePath: string): Promise<void> {
    setBusy(true)
    try {
      console.info('[audio-import] loading', filePath)
      if (isVideoExt(filePath)) {
        toast.loading('Extracting audio…', { id: 'extract' })
        const wavPath = await window.api.audio.extractFromVideo(filePath)
        toast.dismiss('extract')
        await loadSource(wavPath, filePath)
      } else {
        await loadSource(filePath)
      }
      await push(filePath)
      toast.success('Loaded')
    } catch (err) {
      console.error('[audio-import] failed', { filePath, err })
      toast.dismiss('extract')
      toast.error(describeImportError(err, filePath), { duration: 8000 })
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
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
    const filePath = await window.api.audio.pickFile()
    if (!filePath) return
    if (pathLooksLikeCloudSync(filePath)) {
      toast(
        'Cloud-sync path. If import fails, right-click in Explorer → "Always keep on this device".',
        { icon: <Icon name="warning" size={18} />, duration: 6000 }
      )
    }
    await loadFile(filePath)
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
        MP3, WAV, FLAC, AAC, M4A, OGG, OPUS — or any video to extract its audio.
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
