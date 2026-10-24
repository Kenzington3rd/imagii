import { useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import toast from 'react-hot-toast'
import { OutputDirLabel, basename } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'
import { DraftField } from '../../components/DraftField'
import { clampTyped, isTypedInRange } from '@shared/draftNumber'
import { claimFirst } from '../../lib/claimFirst'
import { reportFailure } from '../../lib/reportFailure'
import { toastSaved } from '../../lib/savedToast'
import { useVideoOutputDir } from '../../hooks/useVideoOutputDir'

type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** The overlay width the box takes (px): the same 120 to 960 its attributes say, enforced when typing ends. */
const PIP_WIDTH_MIN = 120
const PIP_WIDTH_MAX = 960

export function PipPanel(): JSX.Element {
  const [basePath, setBasePath] = useState<string | null>(null)
  const [overlayPath, setOverlayPath] = useState<string | null>(null)
  const [overlayWidth, setOverlayWidth] = useState(360)
  const [position, setPosition] = useState<Position>('bottom-right')
  const [margin, setMargin] = useState(32)
  // T-124 (21): the folder is remembered between visits, like Export's (one key for the four side panels).
  const { outDir, pick: pickDir, resolve: resolveOutDir, remember: rememberOutDir } = useVideoOutputDir()
  const [busy, setBusy] = useState(false)
  // Round 17 B5
  const jobIdRef = useRef<string | null>(null)
  // T-126 (19): one start at a time, claimed the instant the function runs - the pattern `ExportPanel.startExport` has (T-125 (18)). The
  // `busy` state is set only after the awaits in the start (the folder chooser), so a double-click ran a second start
  // in that gap: two choosers, two jobs, two files. A `finally` gives the claim back; a second press is dropped in silence (the first
  // one's chooser is on screen). Declared with the other hooks, ahead of any early return.
  const startingRef = useRef(false)

  // T-131 (5): one chooser at a time across the two file buttons (Base and Overlay). A double-click opened two, and the second answer
  // replaced the first. Declared with the other hooks, ahead of any early return.
  const pickingRef = useRef(false)

  async function pick(setter: (path: string | null) => void): Promise<void> {
    await claimFirst(pickingRef, async () => {
      const f = await window.api.video.pickFile()
      if (f) setter(f)
    })
  }

  async function run(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (!basePath || !overlayPath) {
        toast.error('Pick both files')
        return
      }
      const dir = await resolveOutDir()
      if (!dir) return
      setBusy(true)
      const jobId = nanoid(10)
      jobIdRef.current = jobId
      try {
        const result = await window.api.video.pipComposite({
          jobId,
          basePath,
          overlayPath,
          outDir: dir,
          overlayWidth,
          position,
          margin
        })
        // T-112: the file's own name, so "name (2).mp4" (T-106) is never a surprise.
        toastSaved(`Saved ${basename(result.outputPath)}`, result.outputPath)
        rememberOutDir(dir)
      } catch (err) {
        reportFailure(err, {
          failed: 'Picture-in-picture failed.',
          canceled: 'Picture-in-picture canceled.'
        })
      } finally {
        setBusy(false)
        jobIdRef.current = null
      }
    } finally {
      startingRef.current = false
    }
  }

  async function cancel(): Promise<void> {
    const id = jobIdRef.current
    if (!id) return
    await window.api.video.cancelPip(id)
  }

  function nameOf(path: string | null): string {
    if (!path) return 'none'
    const c = path.replace(/\\/g, '/')
    return c.substring(c.lastIndexOf('/') + 1)
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="image">Picture-in-picture composite</PanelHeader>
      <p className="text-xs text-ink-dim">
        Overlay one video on top of another (e.g. webcam on screen). Audio comes from the base
        video.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="btn-ghost px-3 py-1.5 text-xs text-left truncate"
          onClick={() => pick(setBasePath)}
          title={basePath ?? ''}
        >
          Base: {nameOf(basePath)}
        </button>
        <button
          className="btn-ghost px-3 py-1.5 text-xs text-left truncate"
          onClick={() => pick(setOverlayPath)}
          title={overlayPath ?? ''}
        >
          Overlay: {nameOf(overlayPath)}
        </button>
      </div>
      {/* T-125 (12): two boxes to a row and the Position select on a row of its own. In three columns each cell was a third of a
          card that is about 300 px, so the select drew "Bottom rig" and cut "Bottom right" off at the default window, and the
          "Overlay width (px)" label wrapped onto two lines. */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Overlay width (px)</span>
          {/* T-123 (4): the box keeps what is typed until typing ends. `Number(typed) || 360` snapped an emptied box to
              360 on the spot, so the digits typed next appended to it: "600" was 360600, and the composite failed. */}
          <DraftField
            type="number"
            min={PIP_WIDTH_MIN}
            max={PIP_WIDTH_MAX}
            step={20}
            value={String(overlayWidth)}
            live={(typed) => isTypedInRange(typed, PIP_WIDTH_MIN, PIP_WIDTH_MAX)}
            commit={(typed) => {
              const n = clampTyped(typed, PIP_WIDTH_MIN, PIP_WIDTH_MAX)
              if (n !== null) setOverlayWidth(n)
              return null
            }}
            className="bg-bg-base rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Margin (px)</span>
          <input
            type="number"
            min={0}
            max={200}
            step={4}
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value) || 0)}
            className="bg-bg-base rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-ink-muted">Position</span>
          <select
            className="bg-bg-base rounded px-1 py-1"
            value={position}
            onChange={(e) => setPosition(e.target.value as Position)}
          >
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        {/* T-131 (13): the folder is not changed while a job runs - it would do nothing for the running one - and the chip is the neighbor
            a double-click's second press can land on once the busy primary has shrunk (executed: a chooser opened mid-job on a 120 ms second press). */}
        <button className="btn-ghost min-w-0 px-3 py-1.5 text-xs disabled:opacity-50" onClick={pickDir} disabled={busy}>
          <OutputDirLabel outDir={outDir} />
        </button>
        <button
          className="btn-primary px-3 py-1.5 text-xs ml-auto whitespace-nowrap disabled:opacity-50"
          disabled={busy}
          onClick={run}
        >
          {busy ? 'Compositing…' : 'Composite'}
        </button>
      </div>
      {/* T-126 (20): Cancel has a row of its own. Beside the primary it took the place the primary's right edge had a moment ago - the
          busy label is shorter, so the second click of a double-click landed on Cancel and cancelled the job it had just started
          (measured: the idle button spans 1093-1205, Cancel 1147-1205). Where the second press lands now is the disabled primary. */}
      {/* Round 17 B5 */}
      {busy ? (
        <div className="flex justify-end">
          <button
            className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft"
            onClick={cancel}
            title="Cancel PiP composite"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
