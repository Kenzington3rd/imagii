import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { ExportJobSpec } from '@shared/clip'
import { countOf } from '@shared/plural'
import { persistSetting } from '../../../lib/persistSetting'
import { reportFailure } from '../../../lib/reportFailure'

/**
 * The Export queue (T-135 (1)): its rows, whether a batch is running, and the batch itself.
 *
 * The rows and the running flag were the Export panel's `useState`, and the progress / completion listeners were its effect's. Leaving Video
 * Studio mid-batch unmounted all three: the panel came back idle with Export enabled and no Cancel, the rows were gone, and a retry hit main's
 * "An export is already running" (USER_GUIDE promises a Cancel while a render runs, and a batch is one). Main keeps working through a route
 * change, so the queue's state lives here, where a route change cannot reach it, and the batch's own listeners last exactly as long as the
 * batch. The panel only draws this store and calls `runExportBatch`.
 */

export interface JobStatus {
  jobId: string
  clipName: string
  /** What the queue row shows — a platform's label or the user's own
   *  preset name. Carried rather than looked up, because a custom preset
   *  deleted mid-batch would otherwise leave the row with nothing to
   *  render (T-50). */
  presetLabel: string
  percent: number
  /** The file the job wrote — the path main chose, `name (2).mp4` when the name
   *  was taken (T-106). The row shows its basename (T-112). */
  outputPath?: string
  /** Why the row did not finish — the sentence the toast showed. Set on a
   *  failure AND a cancel; `canceled` says which, and decides the word on the
   *  row ("Failed" / "Canceled"). The row outlives the toast (T-84). */
  error?: string
  canceled?: boolean
  /** T-112: the batch stopped at an earlier job's failure, so this one was never
   *  started. Not a failure of its own and not the user's cancel: "Not run", in
   *  neutral ink, with no reason of its own. */
  notRun?: boolean
}

/**
 * How a finished-or-stopped batch leaves its rows (T-112).
 *
 * The queue is sequential and a failure ends it, so the row that FAILED is the
 * first one that had not finished — every row before it completed and every row
 * after it never started. That row reads Failed (red) with the reason as text; the
 * rest read Not run. A cancel is the user's own act on the whole batch and keeps
 * its T-84/T-100 reading: every unfinished row is Canceled, in neutral ink.
 *
 * // simplification: a batch main REFUSES before any job starts (a second batch
 * // at once, a damaged recipe) marks row 1 Failed with that sentence, because
 * // main sends no "job started" event to tell a refusal from a first job that
 * // failed in its probe. Upgrade path: a `video:jobStarted` event, then the
 * // running row is the one that started.
 */
export function settleJobs(
  jobs: ReadonlyArray<JobStatus>,
  end: { cancelled: boolean; message: string }
): JobStatus[] {
  let failedOne = false
  return jobs.map((job) => {
    if (job.percent >= 100) return job
    if (end.cancelled) return { ...job, error: end.message, canceled: true }
    if (!failedOne) {
      failedOne = true
      return { ...job, error: end.message }
    }
    return { ...job, notRun: true }
  })
}

interface ExportQueueState {
  /** The last batch's rows. They stay after the batch ends (they carry "Show in folder", "Failed", "Canceled") until the next batch replaces them. */
  jobs: JobStatus[]
  running: boolean
  /** The video the batch was made from: the panel shows these rows for that video (or while the batch runs), not under another one. */
  sourcePath: string | null
  /** Claim the queue with the batch's rows. False, and nothing changes, if a batch is already running. */
  begin: (statuses: JobStatus[], sourcePath: string) => boolean
  progress: (jobId: string, percent: number) => void
  complete: (jobId: string, outputPath: string) => void
  settle: (end: { cancelled: boolean; message: string }) => void
  finish: () => void
}

export const useExportQueue = create<ExportQueueState>((set, get) => ({
  jobs: [],
  running: false,
  sourcePath: null,
  begin: (statuses, sourcePath) => {
    if (get().running) return false
    set({ jobs: statuses, running: true, sourcePath })
    return true
  },
  progress: (jobId, percent) =>
    set({ jobs: get().jobs.map((j) => (j.jobId === jobId ? { ...j, percent } : j)) }),
  complete: (jobId, outputPath) =>
    set({ jobs: get().jobs.map((j) => (j.jobId === jobId ? { ...j, outputPath, percent: 100 } : j)) }),
  settle: (end) => set({ jobs: settleJobs(get().jobs, end) }),
  finish: () => set({ running: false })
}))

/**
 * Run a batch of export jobs against the queue, and report how it ended. Nothing here is a component: the panel that started it can be gone
 * (the person went to Home) and the rows still advance, the toast still says how it went, and the queue is free again when it ends.
 */
export async function runExportBatch(opts: {
  queue: ExportJobSpec[]
  statuses: JobStatus[]
  dir: string
  sourcePath: string
}): Promise<void> {
  const { queue, statuses, dir, sourcePath } = opts
  const store = useExportQueue.getState()
  if (!store.begin(statuses, sourcePath)) return
  const offProgress = window.api.video.onProgress((p) => useExportQueue.getState().progress(p.jobId, p.percent))
  const offDone = window.api.video.onJobComplete(({ jobId, outputPath }) => useExportQueue.getState().complete(jobId, outputPath))
  try {
    const results = await window.api.video.exportBatch(queue)
    // The batch's own answer is the record of what it wrote. A job-complete event can land after the call has resolved - and by then this batch's
    // listeners are gone - so the rows take their files from here too (the panel's old always-on listener caught the late event; this one lasts one batch).
    for (const r of results) useExportQueue.getState().complete(r.jobId, r.outputPath)
    toast.success(`Exported ${countOf(queue.length, 'file')}`)
    // INIT-E (round 15): persist the choice on success so the next batch
    // defaults to the same folder.
    void persistSetting('export.lastOutputDir', dir)
  } catch (err) {
    // T-84: one verdict for the toast AND the rows. A cancel is neutral and
    // says what survived; a failure is plain words. Either way the rows that
    // did not finish keep saying so after the toast fades.
    const { cancelled, message } = reportFailure(err, {
      failed: 'Export failed.',
      canceled: 'Export canceled. Files already finished are in your folder.'
    })
    useExportQueue.getState().settle({ cancelled, message })
  } finally {
    offProgress()
    offDone()
    useExportQueue.getState().finish()
  }
}
