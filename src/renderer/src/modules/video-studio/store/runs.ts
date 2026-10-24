import { create } from 'zustand'
import type { CaptionsProgress } from '@shared/captions'
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

/** The GIF export: its job id is what its Cancel is aimed at. */
export const useGifRun = createRunStore<{ jobId: string }>()
/** The compilation join. */
export const useCompileRun = createRunStore<{ jobId: string }>()
/** The picture-in-picture composite. */
export const usePipRun = createRunStore<{ jobId: string }>()
/** The vertical reframe: its progress is a measurement or absent (`percent` null until main has one). */
export const useReframeRun = createRunStore<{ jobId: string; percent: number | null; phase: ReframePhase }>()
/** The highlight scan ("Scan VOD"): one at a time, however many times the panel is mounted. Cancel needs no id (main keeps a single slot). */
export const useScanRun = createRunStore<{ percent: number }>()
/** "Clean audio": the video whose sound is being extracted. */
export const useCleanAudioRun = createRunStore<{ videoPath: string }>()
/**
 * The Clip Kit: it belongs to ONE clip's row (`clipId`), its `phase` is the label that row's button shows, and `canceled` is the latch every step of
 * the kit asks (Cancel between two of its calls would otherwise find nothing to stop, T-98). Every other row's button is off while it runs.
 */
export const useKitRun = createRunStore<{ clipId: string; phase: string; canceled: boolean }>()
/** A transcription or a caption burn-in: which one is running. */
export const useCaptionsRun = createRunStore<{ job: 'transcribe' | 'burn-in' }>()
/**
 * The progress line main last sent for that job. It is NOT a field of the run: the row draws what main reports (the T-89 case sends the events
 * itself, with no engine behind them), and the job's closure clears it when the job ends so a finished job leaves no "Done 100%" behind.
 */
export const useCaptionsProgress = create<{ progress: CaptionsProgress | null }>(() => ({ progress: null }))
