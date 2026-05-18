import { useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'
import { RecentFilesMenu } from '../../components/RecentFilesMenu'
import { Icon } from '../../components/Icon'
import { useRecentFiles } from '../../hooks/useRecentFiles'

const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']

function looksLikeVideo(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function Importer(): JSX.Element {
  const loadSource = useVideoStore((s) => s.loadSource)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const { recent, push, clear } = useRecentFiles('video')

  async function handleFile(filePath: string): Promise<void> {
    if (!filePath) return
    setBusy(true)
    try {
      await loadSource(filePath)
      await push(filePath)
      toast.success('Video loaded')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load video'
      toast.error(message)
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
      toast.error('Could not read file path — try the file picker instead.')
      return
    }
    if (!looksLikeVideo(file.name)) {
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
        MP4, MOV, AVI, MKV, WEBM, M4V. {busy ? 'Loading…' : 'Or use the file picker.'}
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
