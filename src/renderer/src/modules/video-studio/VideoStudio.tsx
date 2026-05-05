import { Toaster } from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { useVideoStore } from './store/videoStore'
import { Importer } from './Importer'
import { Player } from './Player'
import { Timeline } from './Timeline'
import { ClipList } from './ClipList'
import { ExportPanel } from './ExportPanel'
import { TextOverlayEditor } from './TextOverlayEditor'

export function VideoStudio(): JSX.Element {
  const source = useVideoStore((s) => s.source)
  const clearSource = useVideoStore((s) => s.clearSource)

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Video Studio</h1>
        </div>
        {source ? (
          <div className="flex items-center gap-3 text-sm text-ink-muted">
            <span className="truncate max-w-[40ch]">{source.fileName}</span>
            <button className="btn-ghost px-3 py-1.5" onClick={clearSource}>
              Close
            </button>
          </div>
        ) : null}
      </header>

      {source ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="flex flex-col gap-4 min-w-0">
            <Player />
            <Timeline />
            <ExportPanel />
          </div>
          <div className="flex flex-col gap-4">
            <ClipList />
            <TextOverlayEditor />
          </div>
        </div>
      ) : (
        <Importer />
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
