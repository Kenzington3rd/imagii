import { useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useAudioStore } from './state/audioStore'

const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']

function isVideoExt(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXTS.some((ext) => lower.endsWith(ext))
}

export function AudioImporter(): JSX.Element {
  const loadSource = useAudioStore((s) => s.loadSource)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function loadFile(filePath: string): Promise<void> {
    setBusy(true)
    try {
      if (isVideoExt(filePath)) {
        toast.loading('Extracting audio…', { id: 'extract' })
        const wavPath = await window.api.audio.extractFromVideo(filePath)
        toast.dismiss('extract')
        await loadSource(wavPath, filePath)
      } else {
        await loadSource(filePath)
      }
      toast.success('Loaded')
    } catch (err) {
      toast.dismiss('extract')
      const msg = err instanceof Error ? err.message : 'Failed to load audio'
      toast.error(msg)
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
      toast.error('Could not read path. Try the picker.')
      return
    }
    void loadFile(filePath)
  }

  async function onPickFile(): Promise<void> {
    const filePath = await window.api.audio.pickFile()
    if (filePath) await loadFile(filePath)
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
      <div className="text-5xl mb-4">🎚</div>
      <h2 className="text-2xl font-semibold mb-2">Drop audio or video here</h2>
      <p className="text-ink-muted text-sm mb-6">
        MP3, WAV, FLAC, AAC, M4A, OGG, OPUS — or any video to extract its audio.
      </p>
      <button className="btn-primary" onClick={onPickFile} disabled={busy}>
        {busy ? 'Loading…' : 'Choose file…'}
      </button>
    </div>
  )
}
