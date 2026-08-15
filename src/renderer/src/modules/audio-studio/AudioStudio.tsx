import { useState } from 'react'
import type { ChainSpec } from '@shared/audio'
import { DEFAULT_CHAIN_SPEC } from '@shared/audio'
import { AppToaster } from '../../components/AppToaster'
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { useAudioStore } from './state/audioStore'
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

/**
 * T-19: what a Close would throw away. Everything here is unrecoverable —
 * clearSource() resets the chain AND drops the undo history with it.
 */
export function audioCloseMessage(chain: ChainSpec): string | null {
  const cuts = chain.cutRegions.length
  const hasSecondary = chain.secondaryTrack !== null
  const chainEdited = chainDiffersFromDefault(chain)
  if (!cuts && !hasSecondary && !chainEdited) return null
  const parts: string[] = []
  if (chainEdited) parts.push('your cleanup settings')
  if (cuts > 0) parts.push(`${cuts} cut region(s)`)
  if (hasSecondary) parts.push('the second track')
  // Mirrors VideoStudio.tsx's confirm copy: name what is lost, then say it
  // is discarded.
  return `Close this audio? ${parts.join(', ')} will be discarded.`
}

/** Field-by-field so a re-ordered object literal can't read as "edited". */
function chainDiffersFromDefault(chain: ChainSpec): boolean {
  const keys = Object.keys(DEFAULT_CHAIN_SPEC) as Array<keyof ChainSpec>
  return keys.some((key) => {
    if (key === 'cutRegions' || key === 'secondaryTrack') return false
    return JSON.stringify(chain[key]) !== JSON.stringify(DEFAULT_CHAIN_SPEC[key])
  })
}

/**
 * T-19: Video Studio has confirmed its Close since round 18; Audio Studio
 * silently discarded chain edits, cut regions, and a loaded second track.
 * Split out from the component so the accept AND decline branches are unit
 * testable in the node-env layer.
 */
export function confirmAudioClose(chain: ChainSpec, ask: (message: string) => boolean): boolean {
  const message = audioCloseMessage(chain)
  if (message === null) return true
  return ask(message)
}

export function AudioStudio(): JSX.Element {
  const source = useAudioStore((s) => s.source)
  const chain = useAudioStore((s) => s.chain)
  const clearSource = useAudioStore((s) => s.clearSource)
  const undo = useAudioStore((s) => s.undo)
  const redo = useAudioStore((s) => s.redo)
  const canUndo = useAudioStore((s) => s.canUndo())
  const canRedo = useAudioStore((s) => s.canRedo())
  const tutorial = useTutorial(audioTutorial)
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
              <span className="ml-3 text-ink-muted truncate max-w-[40ch]">
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
                nothing rendered. The panel root already carries
                `audio-music` for the ducking step, so the host wrapper
                carries the multi-track one — same convention as the
                siblings above. */}
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

      <AppToaster />
      {tutorial.active ? (
        <Tutorial def={audioTutorial} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}
