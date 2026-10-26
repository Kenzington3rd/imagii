import { useState } from 'react'
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { useAudioStore } from './state/audioStore'
import { confirmAudioClose } from './audioClose'
import { AudioImporter } from './AudioImporter'
import { WaveformView } from './WaveformView'
import { CleanupPanel } from './CleanupPanel'
import { LevelsPanel } from './LevelsPanel'
import { PresetPanel } from './PresetPanel'
import { ExportDialog } from './ExportDialog'
import { FixWizard } from './FixWizard'
import { SecondaryTrackPanel } from './SecondaryTrackPanel'
import { Tutorial } from '../../components/Tutorial'
import { TutorialButton } from '../../components/TutorialButton'
import { useTutorial } from '../../hooks/useTutorial'
import { useUndoRedoHotkeys } from '../../hooks/useUndoRedoHotkeys'
import { audioTutorial } from '../../tutorials/audioTutorial'

// T-112: the close-confirm helpers live in `audioClose.ts` so Video Studio's "Clean
// audio" can ask the same question without importing this component. Re-exported here
// because this is where the Close button, and AudioStudio.test.ts, have always found them.
export { audioCloseMessage, confirmAudioClose } from './audioClose'

export function AudioStudio(): JSX.Element {
  const source = useAudioStore((s) => s.source)
  const chain = useAudioStore((s) => s.chain)
  const clearSource = useAudioStore((s) => s.clearSource)
  const undo = useAudioStore((s) => s.undo)
  const redo = useAudioStore((s) => s.redo)
  const canUndo = useAudioStore((s) => s.canUndo())
  const canRedo = useAudioStore((s) => s.canRedo())
  // T-86: held until there is audio loaded — see VideoStudio.
  const tutorial = useTutorial(audioTutorial, source !== null)
  const [showFixWizard, setShowFixWizard] = useState(false)

  // B11 fix (round 15): HotkeyOverlay documented Ctrl+Z / Ctrl+Y for Audio
  // Studio but no listener was wired. T-15 moved the shared branch into
  // useUndoRedoHotkeys — same behavior, one tested guard for all three
  // studios.
  useUndoRedoHotkeys(undo, redo)

  function handleClose(): void {
    // The button only renders with a source loaded, so "a source is loaded"
    // is already true here.
    if (!confirmAudioClose(chain, (message) => confirm(message))) return
    clearSource()
  }

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <HomeLink />
          <h1 className="text-2xl font-semibold mt-1">Audio Studio</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {source ? (
            <>
              <button
                className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
                disabled={!canUndo}
                onClick={undo}
              >
                <Icon name="undo" size={15} /> Undo
              </button>
              <button
                className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
                disabled={!canRedo}
                onClick={redo}
              >
                <Icon name="redo" size={15} /> Redo
              </button>
              <span className="ml-3 text-ink-muted truncate max-w-[40ch]" title={source.fileName}>
                {source.fileName}
              </span>
              <button className="btn-ghost px-3 py-1.5 ml-2" onClick={handleClose}>
                Close
              </button>
            </>
          ) : null}
          <TutorialButton onClick={tutorial.start} />
        </div>
      </header>

      {source ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_clamp(300px,18%,460px)] gap-5">
          <div className="flex flex-col gap-4 min-w-0">
            <div data-tutorial="audio-waveform">
              <WaveformView />
            </div>
            <div className="card p-3 flex items-center gap-2 text-sm" data-tutorial="audio-fixwizard">
              <span className="text-ink-muted">Not sure what to enable?</span>
              <button
                className="btn-primary px-3 py-1.5 text-sm ml-auto inline-flex items-center gap-1.5"
                onClick={() => setShowFixWizard(true)}
              >
                <Icon name="sparkle" size={15} /> Help me fix this
              </button>
            </div>
            <div data-tutorial="audio-export">
              <ExportDialog />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {/* T-124 (19): none of the panels below changes what the player plays: the waveform is the original sound, and every
                setting is applied when you export (BRANDING: a control with no live preview says so in one line). */}
            <p className="text-xs text-ink-dim">
              Changes here are applied when you export. The player plays your original sound.
            </p>
            <div data-tutorial="audio-cleanup">
              <CleanupPanel />
            </div>
            <div data-tutorial="audio-levels">
              <LevelsPanel />
            </div>
            {/* T-14: the cleanup-preset CRUD shipped in main with no
                reachable UI. It saves and re-applies the chain the two
                panels above build, so it sits directly under them. */}
            <PresetPanel />
            {/* T-16: the tutorial's multi-track step pointed at a selector
                nothing rendered, so the host wrapper carries this one — same
                convention as the siblings above. T-86 merged that step into
                the single "Add a second track" step (it pointed at this very
                panel, and "load both tracks" was false: the panel adds ONE
                second track), which targets the root's `audio-music`; this
                attribute stays because audio.spec.ts addresses the panel by
                it. */}
            <div data-tutorial="audio-multitrack">
              <SecondaryTrackPanel />
            </div>
          </div>
        </div>
      ) : (
        <div data-tutorial="audio-importer">
          <AudioImporter />
        </div>
      )}
      <FixWizard open={showFixWizard} onClose={() => setShowFixWizard(false)} />

      {tutorial.active ? (
        <Tutorial def={tutorial.def} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}
