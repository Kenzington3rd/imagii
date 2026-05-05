import { useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { useAudioStore } from './state/audioStore'
import { AudioImporter } from './AudioImporter'
import { WaveformView } from './WaveformView'
import { CleanupPanel } from './CleanupPanel'
import { LevelsPanel } from './LevelsPanel'
import { ExportDialog } from './ExportDialog'
import { FixWizard } from './FixWizard'
import { SecondaryTrackPanel } from './SecondaryTrackPanel'
import { Tutorial } from '../../components/Tutorial'
import { TutorialButton } from '../../components/TutorialButton'
import { useTutorial } from '../../hooks/useTutorial'
import { audioTutorial } from '../../tutorials/audioTutorial'

export function AudioStudio(): JSX.Element {
  const source = useAudioStore((s) => s.source)
  const clearSource = useAudioStore((s) => s.clearSource)
  const undo = useAudioStore((s) => s.undo)
  const redo = useAudioStore((s) => s.redo)
  const canUndo = useAudioStore((s) => s.canUndo())
  const canRedo = useAudioStore((s) => s.canRedo())
  const tutorial = useTutorial(audioTutorial)
  const [showFixWizard, setShowFixWizard] = useState(false)

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Audio Studio</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {source ? (
            <>
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
            </>
          ) : null}
          <TutorialButton onClick={tutorial.start} />
        </div>
      </header>

      {source ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="flex flex-col gap-4 min-w-0">
            <div data-tutorial="audio-waveform">
              <WaveformView />
            </div>
            <div className="card p-3 flex items-center gap-2 text-sm" data-tutorial="audio-fixwizard">
              <span className="text-ink-muted">Not sure what to enable?</span>
              <button className="btn-primary px-3 py-1.5 text-sm ml-auto" onClick={() => setShowFixWizard(true)}>
                ✨ Help me fix this
              </button>
            </div>
            <div data-tutorial="audio-export">
              <ExportDialog />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div data-tutorial="audio-cleanup">
              <CleanupPanel />
            </div>
            <div data-tutorial="audio-levels">
              <LevelsPanel />
            </div>
            <SecondaryTrackPanel />
          </div>
        </div>
      ) : (
        <div data-tutorial="audio-importer">
          <AudioImporter />
        </div>
      )}
      <FixWizard open={showFixWizard} onClose={() => setShowFixWizard(false)} />

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
      {tutorial.active ? (
        <Tutorial def={audioTutorial} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}
