import { useState } from 'react'
import toast, { Toaster } from 'react-hot-toast'
import { Link, useNavigate } from 'react-router-dom'
import { useVideoStore } from './store/videoStore'
import { useAudioStore } from '../audio-studio/state/audioStore'
import { Importer } from './Importer'
import { Player } from './Player'
import { Timeline } from './Timeline'
import { ClipList } from './ClipList'
import { ExportPanel } from './ExportPanel'
import { TextOverlayEditor } from './TextOverlayEditor'
import { ReframePanel } from './ReframePanel'
import { HighlightPanel } from './HighlightPanel'
import { CaptionsPanel } from './CaptionsPanel'
import { GifPanel } from './GifPanel'
import { OutputPreview } from './OutputPreview'
import { ColorGradePanel } from './ColorGradePanel'
import { PostChecklist } from './PostChecklist'
import { CompilationPanel } from './CompilationPanel'
import { PipPanel } from './PipPanel'
import { ChatHighlightPanel } from './ChatHighlightPanel'
import { Tutorial } from '../../components/Tutorial'
import { TutorialButton } from '../../components/TutorialButton'
import { useTutorial } from '../../hooks/useTutorial'
import { videoTutorial } from '../../tutorials/videoTutorial'

export function VideoStudio(): JSX.Element {
  const source = useVideoStore((s) => s.source)
  const clearSource = useVideoStore((s) => s.clearSource)
  const loadAudioSource = useAudioStore((s) => s.loadSource)
  const navigate = useNavigate()
  const [extractingAudio, setExtractingAudio] = useState(false)
  const tutorial = useTutorial(videoTutorial)

  async function cleanAudioFlow(): Promise<void> {
    if (!source) return
    setExtractingAudio(true)
    toast.loading('Extracting audio…', { id: 'extract-audio' })
    try {
      const wavPath = await window.api.audio.extractFromVideo(source.filePath)
      await loadAudioSource(wavPath, source.filePath)
      toast.dismiss('extract-audio')
      toast.success('Opening Audio Studio')
      navigate('/audio')
    } catch (err) {
      toast.dismiss('extract-audio')
      toast.error(err instanceof Error ? err.message : 'Failed to extract audio')
    } finally {
      setExtractingAudio(false)
    }
  }

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Video Studio</h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          {source ? (
            <>
              <button
                className="btn-ghost px-3 py-1.5 disabled:opacity-50"
                onClick={cleanAudioFlow}
                disabled={extractingAudio}
                title="Extract this video's audio and open it in Audio Studio"
              >
                🎚 Clean audio
              </button>
              <span className="truncate max-w-[40ch]">{source.fileName}</span>
              <button className="btn-ghost px-3 py-1.5" onClick={clearSource}>
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
            <div data-tutorial="video-player"><Player /></div>
            <div data-tutorial="video-timeline"><Timeline /></div>
            <ExportPanel />
          </div>
          <div className="flex flex-col gap-4">
            <ClipList />
            <PreviewWrapper />
            <ColorGradePanel />
            <HighlightPanel />
            <ChatHighlightPanel />
            <ReframePanel />
            <GifPanel />
            <CompilationPanel />
            <PipPanel />
            <CaptionsPanel />
            <TextOverlayEditor />
            <PostChecklist />
          </div>
        </div>
      ) : (
        <div data-tutorial="video-import"><Importer /></div>
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
      {tutorial.active ? (
        <Tutorial def={videoTutorial} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}

function PreviewWrapper(): JSX.Element {
  // Picks up the video element from the global window pointer set by Player.
  // Re-renders periodically by listening to the same events.
  const w = window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }
  return <OutputPreview videoElement={w.__imagiiVideoEl ?? null} />
}
