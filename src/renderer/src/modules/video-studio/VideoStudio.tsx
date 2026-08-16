import { useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
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
import { useUndoRedoHotkeys } from '../../hooks/useUndoRedoHotkeys'
import { videoTutorial } from '../../tutorials/videoTutorial'

export function VideoStudio(): JSX.Element {
  const source = useVideoStore((s) => s.source)
  const clipCount = useVideoStore((s) => s.clips.length)
  const clearSource = useVideoStore((s) => s.clearSource)
  const undo = useVideoStore((s) => s.undo)
  const redo = useVideoStore((s) => s.redo)
  const canUndo = useVideoStore((s) => s.canUndo())
  const canRedo = useVideoStore((s) => s.canRedo())
  const loadAudioSource = useAudioStore((s) => s.loadSource)
  const navigate = useNavigate()
  const [extractingAudio, setExtractingAudio] = useState(false)
  // T-38: the Player publishes its <video> here as it attaches, so the output
  // preview has the element on the very next render. It used to be read off a
  // global during the render that MOUNTS the Player — always null, and the
  // studio re-renders only on source / clip-count / undo-availability, never
  // on playback, so the preview stayed a blank 300x150 canvas until the first
  // undoable edit.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const tutorial = useTutorial(videoTutorial)

  // T-15: videoStore has had full history since round 18, but the studio
  // exposed no way to reach it — trims, clip removal, and color grades were
  // un-undoable in place. Same binding as Audio Studio and Image Canvas.
  useUndoRedoHotkeys(undo, redo)

  function handleClose(): void {
    // UX round 18: clearSource() silently wiped every clip and its edits.
    // Confirm first whenever there is anything to lose (source load always
    // creates at least one clip, and clearSource also drops undo history,
    // so this is unrecoverable).
    if (clipCount > 0) {
      const ok = confirm(
        `Close this video? ${clipCount} clip(s) and their edits will be discarded.`
      )
      if (!ok) return
    }
    clearSource()
  }

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
          <HomeLink />
          <h1 className="text-2xl font-semibold mt-1">Video Studio</h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          {source ? (
            <>
              <button
                className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
                disabled={!canUndo}
                onClick={undo}
                title="Undo (Ctrl+Z)"
              >
                <Icon name="undo" size={15} /> Undo
              </button>
              <button
                className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
                disabled={!canRedo}
                onClick={redo}
                title="Redo (Ctrl+Y)"
              >
                <Icon name="redo" size={15} /> Redo
              </button>
              <button
                className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
                onClick={cleanAudioFlow}
                disabled={extractingAudio}
                title="Extract this video's audio and open it in Audio Studio"
              >
                <Icon name="audio" size={15} /> Clean audio
              </button>
              <span className="truncate max-w-[40ch]">{source.fileName}</span>
              <button className="btn-ghost px-3 py-1.5" onClick={handleClose}>
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
            <div data-tutorial="video-player"><Player onVideoElement={setVideoEl} /></div>
            <div data-tutorial="video-timeline"><Timeline /></div>
            <ExportPanel />
          </div>
          <div className="flex flex-col gap-4">
            <ClipList />
            <OutputPreview videoElement={videoEl} />
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

      {tutorial.active ? (
        <Tutorial def={videoTutorial} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}
