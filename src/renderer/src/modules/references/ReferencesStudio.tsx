import { Toaster } from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { useReferencesStore } from './state/referencesStore'
import { ReferencePanel } from './ReferencePanel'
import { MoodBoardPanel } from './MoodBoardPanel'
import { AssetLibraryPanel } from './AssetLibraryPanel'
import { Tutorial } from '../../components/Tutorial'
import { TutorialButton } from '../../components/TutorialButton'
import { useTutorial } from '../../hooks/useTutorial'
import { aiTutorial } from '../../tutorials/aiTutorial'

type TabId = 'reference' | 'moodboards' | 'assets'

export function ReferencesStudio(): JSX.Element {
  const tab = useReferencesStore((s) => s.tab)
  const setTab = useReferencesStore((s) => s.setTab)
  const tutorial = useTutorial(aiTutorial)

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">References</h1>
          <p className="text-xs text-ink-muted mt-1">
            Search inspiration, save mood boards, or drop a built-in asset
            straight into Stream Graphics.
          </p>
        </div>
        <TutorialButton onClick={tutorial.start} />
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
