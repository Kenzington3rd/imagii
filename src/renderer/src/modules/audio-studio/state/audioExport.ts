import { create } from 'zustand'
import type { AudioJobProgress } from '@shared/audio'

/**
 * The audio export's row and whether it is running (T-135 (1)).
 *
 * They were the export dialog's `useState`, and its progress listener its effect's: leaving Audio Studio mid-export lost the row, the bar and
 * the Cancel (the dialog came back with Export enabled while main kept rendering) and every event that arrived while it was away. The row is a
 * module store; the dialog registers the progress listener for the length of its own export (the closure that runs it holds no component state).
 * The row outlives the export (it carries "Failed", "Canceled" and "Show in folder") until the next export replaces it.
 */
export interface AudioExportJob {
  jobId: string
  pass: 'measure' | 'render' | 'mux'
  /** The passes this export will make, so the row can say "Step 2 of 2" (T-100). */
  plan: Array<'measure' | 'render' | 'mux'>
  percent: number
  outputPath?: string
  /** Why the export did not finish — the sentence the toast showed. Set on a
   *  failure AND a cancel; `canceled` says which and picks the word on the row,
   *  as the video queue's rows do (T-84, T-100). */
  error?: string
  canceled?: boolean
}

interface AudioExportState {
  job: AudioExportJob | null
  running: boolean
  /** The file the export was made from: the row is drawn for that file (or while it runs), not under another one. */
  sourcePath: string | null
  /** Claim the export with its first row. False, and nothing changes, if one is already running. */
  begin: (job: AudioExportJob, sourcePath: string) => boolean
  progress: (p: AudioJobProgress) => void
  done: (outputPath: string) => void
  fail: (end: { error: string; canceled: boolean }) => void
  finish: () => void
}

export const useAudioExport = create<AudioExportState>((set, get) => ({
  job: null,
  running: false,
  sourcePath: null,
  begin: (job, sourcePath) => {
    if (get().running) return false
    set({ job, running: true, sourcePath })
    return true
  },
  progress: (p) => {
    const job = get().job
    if (get().running && job && job.jobId === p.jobId) set({ job: { ...job, ...p } })
  },
  done: (outputPath) => {
    const job = get().job
    if (get().running && job) set({ job: { ...job, percent: 100, outputPath } })
  },
  fail: ({ error, canceled }) => {
    const job = get().job
    if (get().running && job) set({ job: { ...job, error, canceled } })
  },
  finish: () => set({ running: false })
}))
