import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { useAiStore } from './state/aiStore'
import { SetupCard } from './SetupCard'
import { GeneratePanel } from './GeneratePanel'
import { OutpaintPanel } from './OutpaintPanel'
import { InpaintPanel } from './InpaintPanel'
import { ReferencePanel } from './ReferencePanel'
import { MoodBoardPanel } from './MoodBoardPanel'
import { Tutorial } from '../../components/Tutorial'
import { TutorialButton } from '../../components/TutorialButton'
import { useTutorial } from '../../hooks/useTutorial'
import { aiTutorial } from '../../tutorials/aiTutorial'

export function AiStudio(): JSX.Element {
  const tab = useAiStore((s) => s.tab)
  const setTab = useAiStore((s) => s.setTab)
  const refreshStatus = useAiStore((s) => s.refreshStatus)
  const tutorial = useTutorial(aiTutorial)

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">AI Art</h1>
        </div>
        <TutorialButton onClick={tutorial.start} />
      </header>

      <div data-tutorial="ai-setup">
        <SetupCard />
      </div>

      <div data-tutorial="ai-tabs" className="flex border-b border-ink-dim/30 flex-wrap">
        <TabButton id="generate" label="Generate" current={tab} onClick={setTab} />
        <TabButton id="outpaint" label="Expand (Outpaint)" current={tab} onClick={setTab} />
        <TabButton id="inpaint" label="Inpaint (Brush)" current={tab} onClick={setTab} />
        <TabButton id="reference" label="Reference Search" current={tab} onClick={setTab} />
        <TabButton id="moodboards" label="Mood Boards" current={tab} onClick={setTab} />
      </div>

      <div className="min-h-0">
        {tab === 'generate' ? (
          <GeneratePanel />
        ) : tab === 'outpaint' ? (
          <OutpaintPanel />
        ) : tab === 'inpaint' ? (
          <InpaintPanel />
        ) : tab === 'reference' ? (
          <ReferencePanel />
        ) : (
          <MoodBoardPanel />
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
  id: 'generate' | 'outpaint' | 'inpaint' | 'reference' | 'moodboards'
  label: string
  current: string
  onClick: (id: 'generate' | 'outpaint' | 'inpaint' | 'reference' | 'moodboards') => void
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
