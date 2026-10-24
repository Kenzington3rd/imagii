import { useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useVideoStore } from './store/videoStore'
import { useGifRun } from './store/runs'
import { outputDurationSec } from './presets'
import { OutputDirLabel, basename } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'
import { reportFailure } from '../../lib/reportFailure'
import { toastSaved } from '../../lib/savedToast'
import { useVideoOutputDir } from '../../hooks/useVideoOutputDir'

export function GifPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const [width, setWidth] = useState(480)
  const [fps, setFps] = useState(15)
  const [speed, setSpeed] = useState(1)
  // T-135 (1): the run is a module store, not this panel's state - the person can leave the studio while it works, and the panel that mounts again
  // draws it (Exporting…, and the Cancel).
  const busy = useGifRun((s) => s.run !== null)
  // T-124 (21): the folder is remembered between visits, like Export's (one key for the four side panels).
  const { outDir, pick: pickDir, resolve: resolveOutDir, remember: rememberOutDir } = useVideoOutputDir()
  // T-126 (19): one start at a time, claimed the instant the function runs - the pattern `ExportPanel.startExport` has (T-125 (18)). The
  // `busy` state is set only after the awaits in the start (the folder chooser), so a double-click ran a second start
  // in that gap: two choosers, two jobs, two files. A `finally` gives the claim back; a second press is dropped in silence (the first
  // one's chooser is on screen). Declared with the other hooks, ahead of any early return.
  const startingRef = useRef(false)

  if (!source) return null
  const clip = clips.find((c) => c.id === selectedClipId)
  if (!clip) return null

  // T-105: the warning is about the GIF that will be WRITTEN, so it reads its
  // length at the speed the panel's own select says (the T-97 shape). A 20 s
  // range at 3x is a 7 s GIF and a 6 s range at 0.5x is a 12 s one.
  const tooLong =
    outputDurationSec({ startSec: clip.startSec, endSec: clip.endSec, speedMultiplier: speed }) > 10

  async function exportGif(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (!source || !clip) return
      const dir = await resolveOutDir()
      if (!dir) return
      const jobId = nanoid(10)
      if (!useGifRun.getState().begin({ jobId })) return
      try {
        const result = await window.api.video.exportGif({
          jobId,
          sourcePath: source.filePath,
          // T-124 (17): named for the file the person opened, not for the working copy a converted import is played from.
          sourceName: source.fileName.replace(/\.[^.]+$/, ''),
          // T-125 (22): and the clip's name after it, as Export does, so six highlights are six names and not "name (2)".."name (6)".
          clipName: clip.name,
          outDir: dir,
          startSec: clip.startSec,
          endSec: clip.endSec,
          width,
          fps,
          speed,
          // T-96: the GIF is made from the crop the user drew for this clip.
          cropRect: clip.cropRect
        })
        // T-112: the file's own name, so "name (2).gif" (T-106) is never a surprise.
        toastSaved(`Saved ${basename(result.outputPath)}`, result.outputPath)
        rememberOutDir(dir)
      } catch (err) {
        reportFailure(err, { failed: 'GIF export failed.', canceled: 'GIF canceled.' })
      } finally {
        useGifRun.getState().end()
      }
    } finally {
      startingRef.current = false
    }
  }

  async function cancel(): Promise<void> {
    const id = useGifRun.getState().run?.jobId
    if (!id) return
    await window.api.video.cancelGif(id)
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="image">Export as GIF</PanelHeader>
      {/* T-112: the wrapper is always mounted, so changing Speed ANNOUNCES the warning —
          a live region that appears together with its content is not reliably read.
          T-114: and while it is empty it is still a flex item, with a 12 px gap on each side - a
          12 px hole under the header. `-mb-3` takes back the second gap and nothing is hidden:
          the element stays in the accessibility tree, empty, ready to speak (no display:none,
          no visibility:hidden - either would drop it, and a region added later is not reliably
          announced). With a warning in it the margin is gone and it is a row like any other. */}
      <div role="status" className={tooLong ? undefined : '-mb-3'}>
        {tooLong ? (
          <p className="text-xs text-warn">
            GIF exports over about 10 s get huge. Trim the clip first.
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">Width</span>
          <select
            className="bg-bg-base rounded px-1 py-0.5"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          >
            <option value="240">240 px</option>
            <option value="320">320 px</option>
            <option value="480">480 px</option>
            <option value="640">640 px</option>
            <option value="800">800 px</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">Frame rate</span>
          <select
            className="bg-bg-base rounded px-1 py-0.5"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          >
            <option value="10">10 fps</option>
            <option value="12">12 fps</option>
            <option value="15">15 fps</option>
            <option value="20">20 fps</option>
            <option value="24">24 fps</option>
            <option value="30">30 fps</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">Speed</span>
          <select
            className="bg-bg-base rounded px-1 py-0.5"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        {/* T-126 (13): the chip side gives (`min-w-0`, its name already ends in an ellipsis); the primary's words stay on one line. */}
        {/* T-131 (13): the folder is not changed while a job runs - it would do nothing for the running one - and the chip is the neighbor
            a double-click's second press can land on once the busy primary has shrunk (executed: a chooser opened mid-job on a 120 ms second press). */}
        <button className="btn-ghost min-w-0 px-3 py-1.5 text-xs disabled:opacity-50" onClick={pickDir} disabled={busy}>
          <OutputDirLabel outDir={outDir} />
        </button>
        <button
          className="btn-primary px-4 py-1.5 ml-auto whitespace-nowrap disabled:opacity-50"
          disabled={busy}
          onClick={exportGif}
          // The GIF job has no percent feed — this button label IS the
          // progress line. aria-live announces the Exporting…/done flip to
          // screen readers (role="status" would clobber the button role).
          aria-live="polite"
        >
          {busy ? 'Exporting…' : 'Export GIF'}
        </button>
      </div>
      {/* T-126 (20): Cancel has a row of its own. Beside the primary it took the place the primary's right edge had a moment ago - the
          busy label is shorter, so the second click of a double-click landed on Cancel and cancelled the job it had just started
          (measured: the idle button spans 1093-1205, Cancel 1147-1205). Where the second press lands now is the disabled primary. */}
      {/* Round 17 B2 */}
      {busy ? (
        <div className="flex justify-end">
          <button
            className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft"
            onClick={cancel}
            title="Cancel GIF export"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
