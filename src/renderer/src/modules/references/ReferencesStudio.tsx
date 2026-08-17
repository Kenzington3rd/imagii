import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { useReferencesStore } from './state/referencesStore'
import { ReferencePanel } from './ReferencePanel'
import { MoodBoardPanel } from './MoodBoardPanel'
import { AssetLibraryPanel } from './AssetLibraryPanel'
import { Tutorial } from '../../components/Tutorial'
import { TutorialButton } from '../../components/TutorialButton'
import { useTutorial } from '../../hooks/useTutorial'
import { useUndoRedoHotkeys } from '../../hooks/useUndoRedoHotkeys'
import { aiTutorial } from '../../tutorials/aiTutorial'

type TabId = 'reference' | 'moodboards' | 'assets'

export function ReferencesStudio(): JSX.Element {
  const tab = useReferencesStore((s) => s.tab)
  const setTab = useReferencesStore((s) => s.setTab)
  const undo = useReferencesStore((s) => s.undo)
  const redo = useReferencesStore((s) => s.redo)
  const canUndo = useReferencesStore((s) => s.canUndo())
  const canRedo = useReferencesStore((s) => s.canRedo())
  const tutorial = useTutorial(aiTutorial)

  // T-58: the same binding the other three studios share (T-15), so a board
  // deleted by accident comes back the way every other destructive action in
  // the app does.
  useUndoRedoHotkeys(undo, redo)

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <HomeLink />
          <h1 className="text-2xl font-semibold mt-1">References</h1>
          <p className="text-xs text-ink-muted mt-1">
            Search inspiration, save mood boards, or drop a built-in asset
            straight into Stream Graphics.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
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
          <TutorialButton onClick={tutorial.start} />
        </div>
      </header>

      <div data-tutorial="ai-tabs" className="flex border-b border-ink-dim/30 flex-wrap">
        <TabButton id="reference" label="Reference Search" current={tab} onClick={setTab} />
        <TabButton id="moodboards" label="Mood Boards" current={tab} onClick={setTab} />
        <TabButton id="assets" label="Asset Library" current={tab} onClick={setTab} />
      </div>

      <div className="min-h-0">
        {tab === 'reference' ? (
          <ReferencePanel />
        ) : tab === 'moodboards' ? (
          <MoodBoardPanel />
        ) : (
          <AssetLibraryPanel />
        )}
      </div>

      {tutorial.active ? <Tutorial def={aiTutorial} onClose={tutorial.stop} /> : null}
    </div>
  )
}

function TabButton({
  id,
  label,
  current,
  onClick
}: {
  id: TabId
  label: string
  current: string
  onClick: (id: TabId) => void
}): JSX.Element {
  const active = id === current
  return (
    <button
      onClick={() => onClick(id)}
      className={`px-4 py-2 text-sm border-b-2 transition-colors ${
        active
          ? 'border-accent text-ink-base font-medium'
          : 'border-transparent text-ink-muted hover:text-ink-base'
      }`}
    >
      {label}
    </button>
  )
}
