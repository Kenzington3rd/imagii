import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { REFRAME_TARGET, reframePhaseLabel, reframeReadout, type ReframePhase } from '@shared/reframe'
import { clipRecipe } from '@shared/clip'
import { useVideoStore } from './store/videoStore'
import { useReframeRun } from './store/runs'
import { OutputDirLabel, basename } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'
import { useEditInVideoStudio } from '../../lib/editInVideoStudio'
import { useVideoOutputDir } from '../../hooks/useVideoOutputDir'
import { reportFailure } from '../../lib/reportFailure'
import { toastSaved } from '../../lib/savedToast'

type ReframePosition = 'left' | 'center' | 'right'

// This is a FIXED strip, not a tracker (T-85). Round 15 renamed "Smart" to
// "Auto (centered)" because it was only ever a centered crop, but the panel
// still said "Auto-reframe", the tutorial said it would "follow the action",
// and the fourth button duplicated Center. The code decides where the strip
// sits from the side you pick and nothing else, so the copy says that: three
// sides, no 'smart' value left to mislead (main's type and validator dropped
// it too — nothing ever persisted a position, so there is nothing to migrate).
const POSITIONS: Array<{ id: ReframePosition; label: string; hint: string }> = [
  { id: 'left', label: 'Left', hint: 'A 9:16 strip nearer the left edge' },
  { id: 'center', label: 'Center', hint: 'The middle 9:16 strip' },
  { id: 'right', label: 'Right', hint: 'A 9:16 strip nearer the right edge' }
]

export function ReframePanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const [position, setPosition] = useState<ReframePosition>('center')
  // T-135 (1): the run, its progress and its phase are a module store, not this panel's state: leaving the studio does not lose them, and the panel
  // that mounts again draws the run that is there (Reframing…, its bar and its Cancel). `percent` is null until main has a measurement: checking the
  // source has no length to measure (T-108), and the row draws an indeterminate bar rather than "0%".
  const reframeRun = useReframeRun((s) => s.run)
  const running = reframeRun !== null
  const progress: number | null = reframeRun?.percent ?? null
  const phase: ReframePhase = reframeRun?.phase ?? 'starting'
  // T-124 (21): the folder is remembered between visits, like Export's (one key for the four side panels).
  const { outDir, pick: pickDir, resolve: resolveOutDir, remember: rememberOutDir } = useVideoOutputDir()
  // T-126 (19): one start at a time, claimed the instant the function runs - the pattern `ExportPanel.startExport` has (T-125 (18)). The
  // `busy` state is set only after the awaits in the start (the folder chooser), so a double-click ran a second start
  // in that gap: two choosers, two jobs, two files. A `finally` gives the claim back; a second press is dropped in silence (the first
  // one's chooser is on screen). Declared with the other hooks, ahead of any early return.
  const startingRef = useRef(false)
  // T-123 (18): the same toast action Record's saved take has, through the same ask-before-replace bridge. The 9:16 file
  // is a vertical video, so opening it here is also the way into captions for it (transcribe, then burn it in).
  const editInVideoStudio = useEditInVideoStudio("Couldn't open the reframed video in Video Studio.")

  useEffect(() => {
    const off = window.api.video.onReframeProgress((p) => {
      useReframeRun.getState().patch({ percent: p.percent ?? null, phase: p.phase })
    })
    return off
  }, [])

  if (!source) return null
  const clip = clips.find((c) => c.id === selectedClipId)
  if (!clip) return null

  const isHorizontal = source.probe.width > source.probe.height
  if (!isHorizontal) return null

  async function reframe(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (!source || !clip) return
      // M13 fix (round 15): the previous `outDir!` referenced the React state,
      // which on the first run was still `null` AT the point of the IPC call —
      // setOutDir() hadn't been committed yet. The folder is resolved to a local
      // and that is passed down (T-124 (21): the remembered folder, else the chooser).
      const resolvedOutDir = await resolveOutDir()
      if (!resolvedOutDir) return
      const jobId = nanoid(10)
      if (!useReframeRun.getState().begin({ jobId, percent: null, phase: 'starting' })) return
      try {
        const result = await window.api.video.reframe({
          jobId,
          sourcePath: source.filePath,
          // T-124 (17): named for the file the person opened, not for the working copy a converted import is played from.
          sourceName: source.fileName.replace(/\.[^.]+$/, ''),
          // T-125 (22): and the clip's name after it, as Export does, so six highlights are six names and not "name (2)".."name (6)".
          clipName: clip.name,
          outDir: resolvedOutDir,
          position,
          startSec: clip.startSec,
          endSec: clip.endSec,
          targetWidth: REFRAME_TARGET.width,
          targetHeight: REFRAME_TARGET.height,
          // T-124 (16), T-125 (9): the clip as the person built it - its crop, its speed (as it PLAYS: a stored 0 is 1x), its color,
          // its text, Auto Zoom and Hype Shake - the same fields Compile sends (`clipRecipe`), so the 9:16 file is not a subset of it.
          ...clipRecipe(clip)
        })
        rememberOutDir(resolvedOutDir)
        // T-112: the file's own name, so "name (2).mp4" (T-106) is never a surprise.
        toastSaved(`Saved ${basename(result.outputPath)}`, result.outputPath, {
          label: 'Edit in Video Studio',
          onClick: () => {
            void editInVideoStudio(result.outputPath)
          }
        })
      } catch (err) {
        reportFailure(err, { failed: 'Reframe failed.', canceled: 'Reframe canceled.' })
      } finally {
        useReframeRun.getState().end()
      }
    } finally {
      startingRef.current = false
    }
  }

  async function cancel(): Promise<void> {
    const id = useReframeRun.getState().run?.jobId
    if (!id) return
    await window.api.video.cancelReframe(id)
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-reframe">
      <PanelHeader
        icon="phone"
        actions={
          <span className="text-xs text-ink-dim whitespace-nowrap">
            {/* T-126 (14): "1280×720 →" and "1080×1920" on two lines stranded the arrow at the end of the first. */}
            {/* The strip is cut from the clip's crop when it has one (T-125 (9)), so that is the size this reads. */}
            {reframeReadout(source.probe.width, source.probe.height, clip.cropRect)}
          </span>
        }
      >
        Reframe to 9:16
      </PanelHeader>
      <p className="text-xs text-ink-dim">
        Cuts the trimmed range into a vertical 9:16 version for TikTok, Reels, and Shorts,
        with the clip's crop, speed, color, text and effects. It takes a fixed strip —
        it does not track faces or action.
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {POSITIONS.map((p) => (
          <button
            key={p.id}
            title={p.hint}
            // T-112: three buttons that are one choice — the pressed one says so.
            aria-pressed={position === p.id}
            onClick={() => setPosition(p.id)}
            className={`px-2 py-1.5 text-xs rounded border ${
              position === p.id
                ? 'bg-accent text-bg-base border-accent'
                : 'bg-bg-hover border-ink-dim/30 hover:border-accent'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {/* T-126 (13): the chip side gives (`min-w-0`, its name already ends in an ellipsis); the primary's words stay on one line. */}
        {/* T-131 (13): the folder is not changed while a job runs - it would do nothing for the running one - and the chip is the neighbor
            a double-click's second press can land on once the busy primary has shrunk (executed: a chooser opened mid-job on a 120 ms second press). */}
        <button className="btn-ghost min-w-0 px-3 py-1.5 text-xs disabled:opacity-50" onClick={pickDir} disabled={running}>
          <OutputDirLabel outDir={outDir} />
        </button>
        <button
          // T-131 (13): the idle label ("Reframe to 9:16") is the widest it is; the busy one ("Reframing…") used to shrink the button 23 px and
          // give the strip a double-click's second press lands on to the chip beside it, which grew into the room. 8.6 rem is the idle width.
          className="btn-primary px-4 py-1.5 ml-auto whitespace-nowrap min-w-[8.6rem] disabled:opacity-50"
          disabled={running}
          onClick={reframe}
        >
          {running ? 'Reframing…' : 'Reframe to 9:16'}
        </button>
      </div>
      {running ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          {/* T-100: the phase id, upper-cased, was the label ("ANALYZING"). */}
          <span>{reframePhaseLabel(phase)}</span>
          <div
            className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden"
            role="progressbar"
            aria-label={reframePhaseLabel(phase)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress === null ? undefined : Math.round(progress)}
          >
            {progress === null ? (
              <div className="h-full bg-accent progress-indeterminate" />
            ) : (
              <div className="h-full bg-accent" style={{ width: `${Math.round(progress)}%` }} />
            )}
          </div>
          {progress === null ? null : (
            <span className="font-mono w-10 shrink-0 whitespace-nowrap text-right">{Math.round(progress)}%</span>
          )}
          {/* Round 17 B1 */}
          <button
            className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft"
            onClick={cancel}
            title="Cancel reframe"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
