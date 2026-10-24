import { useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { NO_SOUND_MESSAGE, useVideoStore, videoDiscardMessage, videoHasNoSound } from './store/videoStore'
import { useAudioStore } from '../audio-studio/state/audioStore'
import { confirmAudioClose, confirmReplaceAfterWait } from '../audio-studio/audioClose'
import { currentRoute, replacedSince } from '../project/ProjectIO'
import { toastWithActions } from '../../lib/savedToast'
import { mayLeaveLiveTake } from '../../lib/liveTake'
import { useCleanAudioRun } from './store/runs'
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
  // T-135 (1): the extraction is a module store, not this studio's state - Clean audio's own navigation (and any trip to Home) unmounts the studio,
  // and it came back with the button enabled over an extraction still running, whose second press ran a second concurrent one.
  const extractingAudio = useCleanAudioRun((s) => s.run !== null)
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
    // T-129: no length gate here any more. T-124 (6) refused a video over two hours at this button (the most Audio Studio's
    // waveform could hold when the renderer decoded it); the waveform is drawn from main's peaks now, so a 4 h VOD is cleaned
    // like any other recording.
    // T-112: handing this video's sound to Audio Studio REPLACES what that studio holds,
    // and the chain, the cuts and the undo history go with it. When it holds tuned work
    // the person is asked first, over the same list of what would be lost as Audio Studio's
    // own Close — but nothing is being closed here, so T-113's lead-in says "Replace the audio
    // you're editing?". (Nothing loaded, or nothing changed, asks nothing: `confirmAudioClose`
    // answers yes.)
    const chainAsked = useAudioStore.getState().chain
    if (!confirmAudioClose(chainAsked, (message) => confirm(message), 'replace')) return
    if (!useCleanAudioRun.getState().begin({ videoPath: source.filePath })) return
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
      // T-133 (6): the same file, tuned meanwhile. `replacedSince` sees only a different source; loading resets the chain and the undo history,
      // so work done during the wait would be replaced with no way back. The question is asked again over what is there now (not about work
      // they already agreed to lose before the wait: `chainAsked` is the chain that question was about).
      if (!confirmReplaceAfterWait(chainAsked, useAudioStore.getState().chain, (message) => confirm(message))) {
        toast.dismiss('extract-audio')
        toast("Skipped this video's sound to keep the changes you made in Audio Studio while it was extracting", {
          icon: <Icon name="warning" size={18} />,
          duration: 8000
        })
        return
      }
      // T-107: a converted import's working copy is scratch; the audio studio is
      // told the original too, so a saved project can name the file the person owns.
      await loadAudioSource(wavPath, source.filePath, source.convertedFrom, hasVideo)
      toast.dismiss('extract-audio')
      // T-132 (1): the extraction takes minutes for a long recording, and the person is free to go anywhere meanwhile. `navigate` still
      // works from a studio that unmounted, so this used to take them to /audio wherever they were - from /record that unmounts
      // RecordStudio, whose cleanup stops the tracks and cut a LIVE TAKE short. Only a person still on this studio is taken along; anyone
      // else keeps their screen, the sound is loaded, and a toast offers the way there ("nothing teleports the user", ProjectIO).
      const where = currentRoute()
      if (where === '/video') {
        toast.success('Opening Audio Studio')
        navigate('/audio')
      } else {
        // On Audio Studio itself the sound has simply appeared in front of them: the toast only says whose it is.
        toastWithActions(
          `Extracted the sound from ${source.fileName}`,
          where === '/audio'
            ? []
            : [
                {
                  label: 'Open Audio Studio',
                  // T-133 (1): this toast can be over the REC screen (that is where T-132 (1) leaves a person whose take was running), and
                  // the button navigates away from it: a live take is asked about first, as the Home link asks.
                  onClick: () => {
                    if (mayLeaveLiveTake()) navigate('/audio')
                  }
                }
              ]
        )
      }
    } catch (err) {
      toast.dismiss('extract-audio')
      reportFailure(err, { failed: "Couldn't extract the audio." })
    } finally {
      useCleanAudioRun.getState().end()
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
