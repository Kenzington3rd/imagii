import { useNavigate } from 'react-router-dom'
import { useVideoStore, videoDiscardMessage } from '../modules/video-studio/store/videoStore'
import { reportFailure } from './reportFailure'

/**
 * The "Edit in Video Studio" toast action's one implementation: Record's saved take (Round 18 D) and Reframe's
 * saved 9:16 file (T-123 (18)) both hand a finished file to Video Studio through it. It mirrors
 * `VideoStudio.cleanAudioFlow`'s cross-studio bridge: load the path into the target studio's store first, then
 * navigate.
 *
 * T-119: loading REPLACES the video Video Studio holds, with its clips, edits and undo history. Video Studio's own
 * Close and T-112's Clean audio ask first; this asks too, over the same list (`videoDiscardMessage`, lead-in
 * "Replace the video you're editing?"). The count is read when the button is pressed, from the store, not from a
 * render's closure: the toast outlives the render that made it, and an empty studio (nothing to lose) is asked
 * nothing. `failed` is the caller's own sentence for a file that will not open ("Couldn't open the recording in
 * Video Studio."): only the caller knows what the file is.
 */
export function useEditInVideoStudio(failed: string): (outputPath: string) => Promise<void> {
  const navigate = useNavigate()
  const loadVideoSource = useVideoStore((s) => s.loadSource)
  return async function editInVideoStudio(outputPath: string): Promise<void> {
    const message = videoDiscardMessage(useVideoStore.getState().clips.length, 'replace')
    if (message !== null && !confirm(message)) return
    try {
      await loadVideoSource(outputPath)
      navigate('/video')
    } catch (err) {
      reportFailure(err, { failed })
    }
  }
}
