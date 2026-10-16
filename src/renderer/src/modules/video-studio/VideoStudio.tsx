import { useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { waveformCeilingRefusal } from '@shared/audio'
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { NO_SOUND_MESSAGE, useVideoStore, videoDiscardMessage, videoHasNoSound } from './store/videoStore'
import { useAudioStore } from '../audio-studio/state/audioStore'
import { confirmAudioClose } from '../audio-studio/audioClose'
import { replacedSince } from '../project/ProjectIO'
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
import { reportFailure } from '../../lib/reportFailure'
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
  // T-86: the first-visit tour waits for a video — an empty studio is only the
  // importer, and a coachmark over it points at trim handles that are not there.
  const tutorial = useTutorial(videoTutorial, source !== null)
  const noSound = videoHasNoSound(source)

  // T-15: videoStore has had full history since round 18, but the studio
  // exposed no way to reach it — trims, clip removal, and color grades were
  // un-undoable in place. Same binding as Audio Studio and Stream Graphics.
  useUndoRedoHotkeys(undo, redo)

  function handleClose(): void {
    // UX round 18: clearSource() silently wiped every clip and its edits.
    // Confirm first whenever there is anything to lose (source load always
    // creates at least one clip, and clearSource also drops undo history,
    // so this is unrecoverable).
    const message = videoDiscardMessage(clipCount)
    if (message !== null && !confirm(message)) return
    clearSource()
  }

  async function cleanAudioFlow(): Promise<void> {
    if (!source) return
    // T-124 (6): the length is already in hand (`source.probe`), so a video Audio Studio will refuse (over 2 hours, the most
    // its waveform can hold) is refused here, before the replace question and before a sound is extracted for it: the
    // extraction of a 4 h VOD was minutes and a ~2.8 GB WAV in %TEMP% for a file the studio was going to turn away. Main
    // asks the same question for the importer's drop and a restored project.
    const tooLong = waveformCeilingRefusal(source.probe.duration, 'video')
    if (tooLong) {
      reportFailure(new Error(tooLong), { failed: "Couldn't extract the audio." })
      return
    }
    // T-112: handing this video's sound to Audio Studio REPLACES what that studio holds,
    // and the chain, the cuts and the undo history go with it. When it holds tuned work
    // the person is asked first, over the same list of what would be lost as Audio Studio's
    // own Close — but nothing is being closed here, so T-113's lead-in says "Replace the audio
    // you're editing?". (Nothing loaded, or nothing changed, asks nothing: `confirmAudioClose`
    // answers yes.)
    if (!confirmAudioClose(useAudioStore.getState().chain, (message) => confirm(message), 'replace')) return
    setExtractingAudio(true)
    toast.loading('Extracting audio…', { id: 'extract-audio' })
    // T-125 (20): what Audio Studio holds NOW, kept to compare with what it holds when the extraction ends. The question above is
    // asked before a wait that can be minutes long, and the person is free to go to Audio Studio and open a file in it meanwhile.
    const heldBefore = useAudioStore.getState().source
    try {
      const { wavPath, hasVideo } = await window.api.audio.extractFromVideo(source.filePath)
      if (replacedSince(heldBefore, useAudioStore.getState().source)) {
        // They opened something else there while this ran (`replacedSince`: ProjectIO's rule for a project open): that work stays,
        // the result is not loaded over it, and nothing pulls them to a studio they are already in or have left.
        toast.dismiss('extract-audio')
        toast("Skipped this video's sound because you opened another file in Audio Studio while it was extracting", {
          icon: <Icon name="warning" size={18} />,
          duration: 8000
        })
        return
      }
      // T-107: a converted import's working copy is scratch; the audio studio is
      // told the original too, so a saved project can name the file the person owns.
      await loadAudioSource(wavPath, source.filePath, source.convertedFrom, hasVideo)
      toast.dismiss('extract-audio')
      toast.success('Opening Audio Studio')
      navigate('/audio')
    } catch (err) {
      toast.dismiss('extract-audio')
      reportFailure(err, { failed: "Couldn't extract the audio." })
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
              {/* T-112: a video with no audio stream has nothing to clean; the button says
                  so instead of extracting an empty track. */}
              {noSound ? <span className="text-xs text-warn">{NO_SOUND_MESSAGE}</span> : null}
              <button
                className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
                onClick={cleanAudioFlow}
                disabled={extractingAudio || noSound}
                title={
                  noSound
                    ? NO_SOUND_MESSAGE
                    : "Extract this video's audio and open it in Audio Studio"
                }
              >
                <Icon name="audio" size={15} /> Clean audio
              </button>
              <span className="truncate max-w-[40ch]" title={source.fileName}>{source.fileName}</span>
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
        <Tutorial def={tutorial.def} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}
