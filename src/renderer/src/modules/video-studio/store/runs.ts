import { create } from 'zustand'
import type { CaptionsInstallStatus, CaptionsProgress, ModelInstallProgress } from '@shared/captions'
import type { ReframePhase } from '@shared/reframe'
import { createRunStore } from '../../../lib/runStore'

/**
 * The long jobs of Video Studio's panels, one run slot each (T-135 (1)).
 *
 * A panel's busy flag and its job handle were `useState` / `useRef`; leaving the studio unmounted them, and the panel came back idle over a
 * job main was still running, with its primary enabled and no Cancel (USER_GUIDE: "Reframe, GIF, Compile, PiP, highlight scan,
 * transcription, and caption burn-in all show a Cancel button while they're running"). Each is a `createRunStore` here instead: the job's own
 * closure writes to it after its panel is gone, and a panel that mounts again draws the run that is there. The Export queue (rows that outlive
 * the run) is `exportQueue.ts`; the audio export's is `audio-studio/state/audioExport.ts`.
 */

/**
 * Every run below that is a job of a VIDEO carries `name`, the words its row says it is for (T-144): the clip or the file. The panels draw their own
 * row from the open video; `VideoJobsRunning` draws it when the video is closed, and a closed video has nobody to ask.
 */
/** The GIF export: its job id is what its Cancel is aimed at. */
export const useGifRun = createRunStore<{ jobId: string; name: string; videoPath: string; fileName: string }>()
/** The compilation join. */
export const useCompileRun = createRunStore<{ jobId: string; name: string }>()
/** The picture-in-picture composite. */
export const usePipRun = createRunStore<{ jobId: string; name: string }>()
/**
 * The vertical reframe: its progress is a measurement or absent (`percent` null until main has one). `videoPath` and `fileName` are the video it was started on
 * (T-170 (2)): the panel names them when another video is open, as Export's queue does (T-168 (4)).
 */
export const useReframeRun = createRunStore<{
  jobId: string
  name: string
  videoPath: string
  fileName: string
  percent: number | null
  phase: ReframePhase
}>()
/** The highlight scan ("Scan VOD"): one at a time, however many times the panel is mounted. Cancel needs no id (main keeps a single slot). */
export const useScanRun = createRunStore<{ name: string; percent: number }>()
/** "Clean audio": the video whose sound is being extracted. */
export const useCleanAudioRun = createRunStore<{ videoPath: string }>()
/**
 * The Clip Kit: it was started on ONE clip (`clipId`, and its `clipName`, so the kit can be named after the clip is renamed, removed or the video
 * closed), its `phase` is the label the kit button shows, and `canceled` is the latch every step of the kit asks (Cancel between two of its calls
 * would otherwise find nothing to stop, T-98). Whichever clip is selected, the kit button shows the RUNNING kit, with its Cancel, and starts nothing
 * (T-136 (1): the list draws one kit button, for the selected clip, so a kit that showed itself only on its own clip's button lost its Cancel when
 * another clip was selected, and for good when its clip was removed or the video closed).
 */
export const useKitRun = createRunStore<{ clipId: string; clipName: string; videoPath: string; fileName: string; phase: string; canceled: boolean }>()
/** A transcription or a caption burn-in: which one is running, and (T-170 (2)) the video it was started on - `name` is that video's file name. */
export const useCaptionsRun = createRunStore<{ job: 'transcribe' | 'burn-in'; name: string; videoPath: string }>()
/**
 * The progress line main last sent for that job. It is NOT a field of the run: the row draws what main reports (the T-89 case sends the events
 * itself, with no engine behind them), and the job's closure clears it when the job ends so a finished job leaves no "Done 100%" behind.
 */
export const useCaptionsProgress = create<{ progress: CaptionsProgress | null }>(() => ({ progress: null }))

/**
 * The importer's file (T-136 (2)): the video whose load (and, for flv / ts / wmv / mpg, whose transcode) is under way. It was the Importer's
 * `useState` / `useRef`, so a trip to Home re-armed it over a conversion main was still running; a second drop then ran a SECOND libx264 convert and
 * its landing replaced the video being edited. `converting` chooses the words of the refusal ("Still converting..." / "Still loading...").
 */
export const useImportRun = createRunStore<{ filePath: string; converting: boolean }>()
/**
 * The Player's "Make a preview copy" (T-136 (2)): the video whose copy is being converted. The same state-in-the-panel bug as the importer's: the
 * button came back enabled over a running convert, and the finished copy's playhead was restored from the unmounted Player's refs (the video restarted
 * at 0:00; the position now travels with the copy in the video store, `previewResumeAt`).
 */
export const usePreviewCopyRun = createRunStore<{ sourcePath: string }>()
/** The caption model's download (T-136 (4)): the progress line main last sent. The bar and its Cancel were the panel's `useState`. */
export const useModelInstallRun = createRunStore<{ progress: ModelInstallProgress }>()
/**
 * What `captions:status` last answered (T-136 (4)): is the engine there, is the model. It was the panel's `useState`, so a download that finished
 * while the person was in another studio refreshed it on the unmounted panel, and the panel that came back asked for the status while the download was
 * still going - "Transcribe" then reopened the setup for a model that was installed.
 */
export const useCaptionsStatus = create<{ status: CaptionsInstallStatus | null }>(() => ({ status: null }))

/**
 * The Cancel of each long job (T-144). The panel's button and `VideoJobsRunning`'s card (the closed video's) call THESE, so there is one cancel path per
 * job: a job's Cancel cannot mean one thing beside its panel and another on the card. The id a Cancel is aimed at is read off the run at the moment it is
 * pressed, and a job that is not running is a no-op.
 */
export async function cancelReframe(): Promise<void> {
  const id = useReframeRun.getState().run?.jobId
  if (!id) return
  await window.api.video.cancelReframe(id)
}
export async function cancelGif(): Promise<void> {
  const id = useGifRun.getState().run?.jobId
  if (!id) return
  await window.api.video.cancelGif(id)
}
export async function cancelCompile(): Promise<void> {
  const id = useCompileRun.getState().run?.jobId
  if (!id) return
  await window.api.video.cancelConcat(id)
}
export async function cancelPip(): Promise<void> {
  const id = usePipRun.getState().run?.jobId
  if (!id) return
  await window.api.video.cancelPip(id)
}
/** Round 17 B3: single-slot cancel, no jobId needed. */
export function cancelScan(): void {
  void window.api.video.cancelHighlight()
}
/** The transcription and the burn-in are two jobs of one panel, each with its own cancel in main. */
export function cancelCaptionsJob(job: 'transcribe' | 'burn-in'): void {
  void (job === 'burn-in' ? window.api.captions.cancelBurnIn() : window.api.captions.cancelTranscribe())
}
export function cancelModelInstall(): void {
  void window.api.captions.cancelInstall()
}
