import { useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { clipRecipe } from '@shared/clip'
import { compileFps } from '@shared/compileFps'
import { countOf } from '@shared/plural'
import { formatFps } from '@shared/units'
import { useVideoStore } from './store/videoStore'
import { useCompileRun } from './store/runs'
import { COMPILE_SIZE, COMPILE_TARGET } from './presets'
import { SuccessIndicator } from './SuccessIndicator'
import { OutputDirLabel, basename } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'
import { RunningCancel } from '../../components/RunningCancel'
import { reportFailure } from '../../lib/reportFailure'
import { toastSaved } from '../../lib/savedToast'
import { useVideoOutputDir } from '../../hooks/useVideoOutputDir'

export function CompilationPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const [fadeMs, setFadeMs] = useState(300)
  // T-124 (21): the folder is remembered between visits, like Export's (one key for the four side panels).
  const { outDir, pick: pickDir, resolve: resolveOutDir, remember: rememberOutDir } = useVideoOutputDir()
  // T-135 (1): the run is a module store, not this panel's state: leaving the studio does not lose it (see GifPanel).
  const busy = useCompileRun((s) => s.run !== null)
  // T-126 (19): one start at a time, claimed the instant the function runs - the pattern `ExportPanel.startExport` has (T-125 (18)). The
  // `busy` state is set only after the awaits in the start (the folder chooser), so a double-click ran a second start
  // in that gap: two choosers, two jobs, two files. A `finally` gives the claim back; a second press is dropped in silence (the first
  // one's chooser is on screen). Declared with the other hooks, ahead of any early return.
  const startingRef = useRef(false)

  if (!source) return null
  // T-92: the card used to appear only at the second clip, so a person with one
  // clip never learned that compiling existed. It is always here now; with one
  // clip it says what it is waiting for instead of vanishing.
  const needsSecondClip = clips.length < 2

  async function exportCompilation(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (!source) return
      const dir = await resolveOutDir()
      if (!dir) return
      const jobId = nanoid(10)
      if (!useCompileRun.getState().begin({ jobId })) return
      try {
        const result = await window.api.video.concat({
          jobId,
          sourcePath: source.filePath,
          // T-125 (22): named for the video the person opened, not for the working copy a converted import is played from.
          sourceName: source.fileName.replace(/\.[^.]+$/, ''),
          outDir: dir,
          // T-96 / T-105: each clip is compiled as the clip the user built — its
          // crop, speed, color, effects and text, not just its range.
          segments: clips.map((c) => ({
            startSec: c.startSec,
            endSec: c.endSec,
            name: c.name,
            ...clipRecipe(c)
          })),
          fadeMs,
          width: COMPILE_SIZE.width,
          height: COMPILE_SIZE.height
        })
        // T-112: the file's own name — "x_compilation (2).mp4" when the name was taken
        // (T-106) is never a surprise in the folder.
        toastSaved(`Saved ${basename(result.outputPath)}`, result.outputPath)
        rememberOutDir(dir)
      } catch (err) {
        reportFailure(err, { failed: 'Compilation failed.', canceled: 'Compilation canceled.' })
      } finally {
        useCompileRun.getState().end()
      }
    } finally {
      startingRef.current = false
    }
  }

  async function cancel(): Promise<void> {
    const id = useCompileRun.getState().run?.jobId
    if (!id) return
    await window.api.video.cancelConcat(id)
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="film">Compile clips ({clips.length})</PanelHeader>
      {/* T-112: the frame is the compilation's, not the source's: every clip is cut to 16:9 at
          1920×1080, and the card did not say so until the file was written. T-130 (q): the
          rate is the recording's, up to 60 (`compileFps`, the same call main makes from the
          same probe), so the card names the rate the file will have. */}
      <p className="text-xs text-ink-dim">
        Stitch all clips into one montage MP4 ({COMPILE_SIZE.width}×{COMPILE_SIZE.height},{' '}
        {formatFps(compileFps([source.probe.fps]))}), in clip list order. Each clip keeps its crop,
        speed, color and effects.
      </p>
      {needsSecondClip ? (
        <p className="text-xs text-warn">Add a second clip to compile.</p>
      ) : null}
      {/* T-105: how each clip fits the compilation's 16:9 frame, in the export
          grid's own words (the same verdict, the compilation as the target).
          A crop that is not 16:9 keeps only the middle of its picture, and the
          card used to say nothing until the file was already written. */}
      {/* T-112: a scroller must be reachable by keyboard — this Electron (Chromium 126)
          does not make a scrollable region focusable by itself — and the ring says where
          the focus is. The name column flexes, so two clips with long custom names that
          differ only at the end (and have different verdicts) can be told apart; the full
          name stays in the title. */}
      <ul
        className="flex flex-col gap-1.5 max-h-40 overflow-y-auto rounded outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="How each clip fits the compilation"
        tabIndex={0}
      >
        {clips.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-xs">
            {/* Two shares of the row (2:3), both able to shrink below their content: a bare
                `flex-1` name beside a verdict whose reasons are one long line gets nothing,
                because the verdict's natural width is the whole row. */}
            <span className="min-w-0 flex-[2] truncate text-ink-muted" title={c.name}>
              {c.name}
            </span>
            <div className="min-w-0 flex-[3]">
              <SuccessIndicator
                platform={COMPILE_TARGET}
                clip={c}
                sourceWidth={source.probe.width}
                sourceHeight={source.probe.height}
              />
            </div>
          </li>
        ))}
      </ul>
      {/* T-112: this was "Crossfade". Nothing crossfades: each clip's picture and sound fade
          out to black, the next fades in from black, and the pieces are joined end to end
          without overlapping. Zero is a hard cut. */}
      <label className="flex items-center gap-2 text-xs">
        <span className="text-ink-muted w-28 shrink-0">Fade between clips</span>
        <input
          type="range"
          min={0}
          max={1500}
          step={50}
          value={fadeMs}
          onChange={(e) => setFadeMs(Number(e.target.value))}
          className="flex-1 min-w-0"
          // M11 fix (round 15): name + formatted value for AT.
          aria-label="Fade between clips, in milliseconds"
          aria-valuetext={`${fadeMs} milliseconds`}
        />
        {/* T-126 (11): "300 ms" wrapped at 1632 px and under and the row changed height while the slider was dragged (the class ParamSlider's readout has). */}
        <span className="font-mono w-14 shrink-0 whitespace-nowrap text-right">{fadeMs} ms</span>
      </label>
      <p className="text-xs text-ink-dim -mt-1.5">
        Each clip fades out to black and the next fades in from black; clips never overlap. 0 ms is a
        hard cut.
      </p>
      <div className="flex items-center gap-2">
        {/* T-126 (13): the chip side gives (`min-w-0`, its name already ends in an ellipsis); the primary's words stay on one line. */}
        {/* T-131 (13): the folder is not changed while a job runs - it would do nothing for the running one - and the chip is the neighbor
            a double-click's second press can land on once the busy primary has shrunk (executed: a chooser opened mid-job on a 120 ms second press). */}
        <button className="btn-ghost min-w-0 px-3 py-1.5 text-xs disabled:opacity-50" onClick={pickDir} disabled={busy}>
          <OutputDirLabel outDir={outDir} />
        </button>
        <button
          // T-131 (13): as Reframe's: "Stitching…" shrank the button 26 px and the chip took its strip. 7.1 rem is "Compile 2 clips".
          className="btn-primary px-3 py-1.5 text-xs ml-auto whitespace-nowrap min-w-[7.1rem] disabled:opacity-50"
          disabled={busy || needsSecondClip}
          onClick={exportCompilation}
        >
          {busy ? 'Stitching…' : `Compile ${countOf(clips.length, 'clip')}`}
        </button>
      </div>
      {/* T-126 (20): Cancel has a row of its own. Beside the primary it took the place the primary's right edge had a moment ago - the
          busy label is shorter, so the second click of a double-click landed on Cancel and cancelled the job it had just started
          (measured: the idle button spans 1093-1205, Cancel 1147-1205). Where the second press lands now is the disabled primary. */}
      {/* Round 17 B4 */}
      {busy ? (
        <div className="flex justify-end">
          <RunningCancel title="Cancel compilation" onClick={cancel} />
        </div>
      ) : null}
    </div>
  )
}
