import { useState } from 'react'
import { captionPhaseLabel } from '@shared/captions'
import { reframePanelShows, reframePhaseLabel } from '@shared/reframe'
import { Icon, type IconName } from '../../components/Icon'
import { basename } from '../../components/OutputDirLabel'
import { RunningCancel } from '../../components/RunningCancel'
import { ExportCancelConfirm } from './ExportPanel'
import { requestExportCancel, useExportQueue, type JobStatus } from './store/exportQueue'
import {
  cancelCaptionsJob,
  cancelCompile,
  cancelGif,
  cancelModelInstall,
  cancelPip,
  cancelReframe,
  cancelScan,
  useCaptionsProgress,
  useCaptionsRun,
  useCompileRun,
  useGifRun,
  useKitRun,
  useModelInstallRun,
  usePipRun,
  useReframeRun,
  useScanRun
} from './store/runs'
import { useVideoStore } from './store/videoStore'

/**
 * The long jobs of Video Studio that outlive the video they were started on (T-144).
 *
 * Closing the video unmounts every panel that drew a job's row and its Cancel (each returns null with no source), while the run stores - and main -
 * keep going: a minutes-long export batch, reframe, GIF, compilation, composite, scan or transcription ran on with nothing on screen until it ended.
 * T-136 (1) fixed that for Clip Kit alone (`ClipKitRunning`); this is the same card for the rest, one row per running job. Clean audio's extraction
 * has no Cancel (T-110 (bb)) and is not here; the Clip Kit keeps its own card.
 */

export type VideoJobKind = 'export' | 'reframe' | 'gif' | 'compile' | 'pip' | 'scan' | 'transcribe' | 'burn-in' | 'model'

/** What one row says. Plain data: the card draws it, the Close question names it, and the unit test reads it. */
export interface VideoJobRow {
  kind: VideoJobKind
  icon: IconName
  /** What is running and what it is for ("Reframe - Clip 1"). */
  label: string
  /** How far along it is, only where the run holds a measurement (or a phase the job reported); null otherwise. */
  progress: string | null
  /** The job in a sentence's words ("export"): the Close question says "The export that is running keeps going". */
  noun: string
  /** The Cancel's title names the job it stops, as every panel's does. */
  cancelTitle: string
}

type RunOf<T extends { getState: () => { run: unknown } }> = ReturnType<T['getState']>['run']

/** Every run that can be going, as a plain value: the hook below reads it from the stores, the Close handler reads it at the moment it is asked. */
export interface VideoRunSnapshot {
  exportQueue: { running: boolean; jobs: ReadonlyArray<JobStatus>; sourcePath: string | null; sourceName: string | null }
  reframe: RunOf<typeof useReframeRun>
  gif: RunOf<typeof useGifRun>
  compile: RunOf<typeof useCompileRun>
  pip: RunOf<typeof usePipRun>
  scan: RunOf<typeof useScanRun>
  captions: RunOf<typeof useCaptionsRun>
  captionsProgress: ReturnType<typeof useCaptionsProgress.getState>['progress']
  modelInstall: RunOf<typeof useModelInstallRun>
  kit: RunOf<typeof useKitRun>
}

export function readVideoRunSnapshot(): VideoRunSnapshot {
  const q = useExportQueue.getState()
  return {
    exportQueue: { running: q.running, jobs: q.jobs, sourcePath: q.sourcePath, sourceName: q.sourceName },
    reframe: useReframeRun.getState().run,
    gif: useGifRun.getState().run,
    compile: useCompileRun.getState().run,
    pip: usePipRun.getState().run,
    scan: useScanRun.getState().run,
    captions: useCaptionsRun.getState().run,
    captionsProgress: useCaptionsProgress.getState().progress,
    modelInstall: useModelInstallRun.getState().run,
    kit: useKitRun.getState().run
  }
}

function useVideoRunSnapshot(): VideoRunSnapshot {
  const queue = useExportQueue()
  const reframe = useReframeRun((s) => s.run)
  const gif = useGifRun((s) => s.run)
  const compile = useCompileRun((s) => s.run)
  const pip = usePipRun((s) => s.run)
  const scan = useScanRun((s) => s.run)
  const captions = useCaptionsRun((s) => s.run)
  const captionsProgress = useCaptionsProgress((s) => s.progress)
  const modelInstall = useModelInstallRun((s) => s.run)
  const kit = useKitRun((s) => s.run)
  return {
    exportQueue: { running: queue.running, jobs: queue.jobs, sourcePath: queue.sourcePath, sourceName: queue.sourceName },
    reframe,
    gif,
    compile,
    pip,
    scan,
    captions,
    captionsProgress,
    modelInstall,
    kit
  }
}

/** "Reframe - Clip 1", or the bare job when the run holds no name (a clip whose name was emptied). */
function named(job: string, name: string): string {
  const trimmed = name.trim()
  return trimmed === '' ? job : `${job} — ${trimmed}`
}

const pct = (n: number): string => `${Math.round(n)}%`

/**
 * The rows for the running jobs, in the order the panels stand on the screen. The Clip Kit is not one of them (its own card draws it) and nothing is
 * a row that has no Cancel. Which jobs there are, and nothing else, decides: whether a video is open is the card's business.
 */
export function videoJobRows(snap: VideoRunSnapshot): VideoJobRow[] {
  const rows: VideoJobRow[] = []
  const { exportQueue: q } = snap
  if (q.running) {
    const total = q.jobs.length
    const done = q.jobs.filter((j) => j.percent >= 100).length
    const current = q.jobs.find((j) => j.percent < 100 && !j.error)
    // T-164 (5): the file the person opened, not the working copy a converted import is played from; the path's basename only for a batch with no name.
    const where = q.sourceName || (q.sourcePath ? basename(q.sourcePath) : '')
    rows.push({
      kind: 'export',
      icon: 'download',
      label: `${named('Export', where)}: file ${Math.min(done + 1, Math.max(total, 1))} of ${Math.max(total, 1)}`,
      progress: current ? pct(current.percent) : null,
      noun: 'export',
      cancelTitle: 'Cancel export'
    })
  }
  if (snap.reframe) {
    const { phase, percent } = snap.reframe
    rows.push({
      kind: 'reframe',
      icon: 'phone',
      label: named('Reframe', snap.reframe.name),
      progress: percent === null ? reframePhaseLabel(phase) : `${reframePhaseLabel(phase)} ${pct(percent)}`,
      noun: 'reframe',
      cancelTitle: 'Cancel reframe'
    })
  }
  if (snap.gif) {
    rows.push({ kind: 'gif', icon: 'image', label: named('GIF', snap.gif.name), progress: null, noun: 'GIF export', cancelTitle: 'Cancel GIF export' })
  }
  if (snap.compile) {
    rows.push({ kind: 'compile', icon: 'film', label: named('Compile', snap.compile.name), progress: null, noun: 'compilation', cancelTitle: 'Cancel compilation' })
  }
  if (snap.pip) {
    rows.push({
      kind: 'pip',
      icon: 'image',
      label: named('Picture-in-picture', snap.pip.name),
      progress: null,
      noun: 'picture-in-picture composite',
      cancelTitle: 'Cancel picture-in-picture composite'
    })
  }
  if (snap.scan) {
    rows.push({ kind: 'scan', icon: 'bolt', label: named('Scan VOD', snap.scan.name), progress: pct(snap.scan.percent), noun: 'scan', cancelTitle: 'Cancel scan' })
  }
  if (snap.captions) {
    const burn = snap.captions.job === 'burn-in'
    const p = snap.captionsProgress
    // The phase main last reported, with its figure only where main has one (the burn-in's); a transcription has a phase and no number.
    const progress = p === null ? null : typeof p.percent === 'number' ? `${captionPhaseLabel(p.phase)} ${pct(p.percent)}` : captionPhaseLabel(p.phase)
    rows.push({
      kind: burn ? 'burn-in' : 'transcribe',
      icon: 'microphone',
      label: named(burn ? 'Burning in captions' : 'Transcribing', snap.captions.name),
      progress,
      noun: burn ? 'caption burn-in' : 'transcription',
      cancelTitle: burn ? 'Cancel burn-in' : 'Cancel transcription'
    })
  }
  if (snap.modelInstall) {
    rows.push({
      kind: 'model',
      icon: 'download',
      label: 'Downloading the caption model',
      progress: pct(snap.modelInstall.progress.percent ?? 0),
      noun: 'model download',
      cancelTitle: 'Cancel download'
    })
  }
  return rows
}

/**
 * The sentence the Close question adds while jobs are going (T-144), or null when none is: the video is going away and the jobs are not. The Clip Kit
 * counts here (its card is the other half of what Close leaves on screen) though it is not one of `videoJobRows`.
 */
export function jobsKeepGoingSentence(snap: VideoRunSnapshot): string | null {
  const nouns = videoJobRows(snap).map((r) => r.noun)
  if (snap.kit) nouns.push('Clip Kit')
  if (nouns.length === 0) return null
  if (nouns.length === 1) return `The ${nouns[0]} that is running keeps going; its Cancel stays on screen.`
  return `The ${nouns.length} jobs that are running keep going; their Cancel buttons stay on screen.`
}

/**
 * The closed video's running jobs, one row each with the Cancel the panel's own calls (T-144). Mounted by VideoStudio ahead of the open-or-closed
 * conditional, beside `ClipKitRunning`, and built the way that card is (T-137 (3), T-138 (4)): the wrapper is an ALWAYS-mounted polite live region
 * that is empty - and takes no gap, `-mb-5` giving back the second flex gap - unless no video is open and a job is going, because a region that arrives
 * with its text is not reliably announced. The progress figures are `aria-hidden`: a percent that moves several times a second would be read out each
 * time from a polite region. T-164 (4): with a video open the same card, in the same place (above the player and the panels, ahead of the open-or-closed
 * conditional) and the same live region, draws the Reframe row alone when the open video's Reframe panel is not showing (`reframePanelShows`); its sentence
 * then leaves out "The video is closed" (one is open) and the wrapper keeps its empty rule (`-mb-5`, no gap) whenever there is no row to draw. The Export question (a batch of two or more asks first, as its panel does) is a sibling of the wrapper, not inside it,
 * and goes with the batch.
 */
export function VideoJobsRunning(): JSX.Element {
  const snap = useVideoRunSnapshot()
  const source = useVideoStore((s) => s.source)
  const selectedClip = useVideoStore((s) => s.clips.find((c) => c.id === s.selectedClipId))
  const allRows = videoJobRows(snap)
  // T-164 (4): with a video open the panels draw their own jobs - except a Reframe the open video's panel does not show (a vertical video, no clip
  // selected), which has no row anywhere else: it is drawn here, with its Cancel, and only it. Every other row keeps the no-video-open rule.
  const videoOpen = source !== null
  // T-171 (4): and a Reframe started on ANOTHER video than the open one says whose it is - the clip and the file in its label, and the sentence under the rows
  // says it was started on another video - since its "Clip 1" would be read as the open video's. (One started on the open video, its clip since deselected,
  // keeps the plain label: it is the open video's.)
  const reframeElsewhere = videoOpen && snap.reframe !== null && snap.reframe.videoPath !== source.filePath
  const rows = (!videoOpen ? allRows : reframePanelShows(source, selectedClip) ? [] : allRows.filter((r) => r.kind === 'reframe')).map((r) =>
    r.kind === 'reframe' && reframeElsewhere && snap.reframe
      ? { ...r, label: named('Reframe', `${snap.reframe.name} from ${snap.reframe.fileName}`) }
      : r
  )
  const shown = rows.length > 0
  const [askingExport, setAskingExport] = useState(false)
  // The question is about the batch that is running: it goes with the batch (T-131 (9)), not on to the next one.
  if (askingExport && !rows.some((r) => r.kind === 'export')) setAskingExport(false)
  const cancel = (kind: VideoJobKind): void => {
    switch (kind) {
      case 'export':
        requestExportCancel(() => setAskingExport(true))
        return
      case 'reframe':
        void cancelReframe()
        return
      case 'gif':
        void cancelGif()
        return
      case 'compile':
        void cancelCompile()
        return
      case 'pip':
        void cancelPip()
        return
      case 'scan':
        cancelScan()
        return
      case 'transcribe':
      case 'burn-in':
        cancelCaptionsJob(kind)
        return
      case 'model':
        cancelModelInstall()
        return
    }
  }
  return (
    <>
      <div aria-live="polite" className={shown ? undefined : '-mb-5'}>
        {shown ? (
          <div className="card p-3 flex flex-col gap-2 text-sm">
            {rows.map((row) => (
              <div key={row.kind} className="flex items-center gap-2">
                <Icon name={row.icon} size={14} />
                <span className="min-w-0 flex-1 truncate" title={row.label}>
                  {row.label}
                </span>
                {row.progress ? (
                  <span className="text-xs text-ink-muted font-mono whitespace-nowrap" aria-hidden="true">
                    {row.progress}
                  </span>
                ) : null}
                <RunningCancel title={row.cancelTitle} onClick={() => cancel(row.kind)} />
              </div>
            ))}
            <p className="text-xs text-ink-muted">
              {videoOpen
                ? reframeElsewhere
                  ? 'Started on another video; the reframe keeps going until it finishes or you cancel it.'
                  : 'The reframe keeps going until it finishes or you cancel it.'
                : rows.length === 1
                  ? 'The video is closed; the job keeps going until it finishes or you cancel it.'
                  : 'The video is closed; these jobs keep going until they finish or you cancel them.'}
            </p>
          </div>
        ) : null}
      </div>
      <ExportCancelConfirm open={askingExport} onClose={() => setAskingExport(false)} />
    </>
  )
}
