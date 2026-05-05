import { Toaster } from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { useAudioStore } from './state/audioStore'
import { AudioImporter } from './AudioImporter'
import { WaveformView } from './WaveformView'
import { CleanupPanel } from './CleanupPanel'
import { LevelsPanel } from './LevelsPanel'
import { ExportDialog } from './ExportDialog'

export function AudioStudio(): JSX.Element {
  const source = useAudioStore((s) => s.source)
  const clearSource = useAudioStore((s) => s.clearSource)
  const undo = useAudioStore((s) => s.undo)
  const redo = useAudioStore((s) => s.redo)
  const canUndo = useAudioStore((s) => s.canUndo())
  const canRedo = useAudioStore((s) => s.canRedo())

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Audio Studio</h1>
        </div>
        {source ? (
          <div className="flex items-center gap-2 text-sm">
            <button
              className="btn-ghost px-3 py-1.5 disabled:opacity-50"
              disabled={!canUndo}
              onClick={undo}
            >
              ↶ Undo
            </button>
            <button
              className="btn-ghost px-3 py-1.5 disabled:opacity-50"
              disabled={!canRedo}
              onClick={redo}
            >
              ↷ Redo
            </button>
            <span className="ml-3 text-ink-muted truncate max-w-[40ch]">
              {source.fileName}
            </span>
            <button className="btn-ghost px-3 py-1.5 ml-2" onClick={clearSource}>
              Close
            </button>
          </div>
        ) : null}
      </header>

      {source ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="flex flex-col gap-4 min-w-0">
            <WaveformView />
            <ExportDialog />
          </div>
          <div className="flex flex-col gap-4">
            <CleanupPanel />
            <LevelsPanel />
          </div>
        </div>
      ) : (
        <AudioImporter />
      )}

      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: '#16161e',
            color: '#e5e5ee',
            border: '1px solid rgba(149, 149, 165, 0.25)'
          }
        }}
      />
    </div>
  )
}
