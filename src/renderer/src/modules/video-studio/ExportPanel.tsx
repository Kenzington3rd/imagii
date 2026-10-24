import { useCallback, useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import {
  clipForExport,
  type Clip,
  type ExportJobSpec,
  type WatermarkSpec
} from '@shared/clip'
import type { CustomPreset } from '@shared/customPresets'
import { expandFilenameTemplate } from '@shared/filename'
import { countOf } from '@shared/plural'
import { computeCropBox, cropFrameSize, findClippedSafeZones } from '@shared/safeZone'
import { assertDefined } from '@shared/assert'
import { WATERMARK_POSITIONS, buildWatermark, isWatermarkPosition } from '@shared/watermark'
import { useVideoStore } from './store/videoStore'
import { runExportBatch, settleJobs, useExportQueue, type JobStatus } from './store/exportQueue'
import { ALL_PLATFORM_IDS, PLATFORM_INFO, customPresetInfo, type PlatformInfo } from './presets'
import { SuccessIndicator } from './SuccessIndicator'
import { CustomPresetManager } from './CustomPresetManager'
import { SafeZoneWarningModal } from './SafeZoneWarningModal'
import { Icon } from '../../components/Icon'
import { OutputDirLabel, basename } from '../../components/OutputDirLabel'
import { claimFirst } from '../../lib/claimFirst'
import { PanelHeader } from '../../components/PanelHeader'
import { Modal } from '../../components/Modal'
import { persistSetting } from '../../lib/persistSetting'

/** Why Export is disabled when no platform is checked on any clip (T-112). */
const NOTHING_QUEUED = 'Check at least one platform below to export.'

export interface SafeZoneRow {
  clipName: string
  clippedZones: string[]
}

const WATERMARK_POSITION_LABELS: Record<WatermarkSpec['position'], string> = {
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left'
}

/**
 * Every export target queued on one clip, platform presets first and the
 * user's own custom presets after — the order the grid draws them in and
 * the order the queue runs them in. A custom preset id with no preset
 * behind it is dropped rather than resolved to a placeholder: the panel
 * prunes those on every refresh, and a stale one must never become a job.
 */
function queuedPresets(
  clip: Clip,
  customPresets: ReadonlyArray<CustomPreset>
): Array<{ key: string; info: PlatformInfo; custom: CustomPreset | null }> {
  const out: Array<{ key: string; info: PlatformInfo; custom: CustomPreset | null }> = []
  for (const id of clip.selectedPresets) {
    out.push({ key: id, info: PLATFORM_INFO[id], custom: null })
  }
  for (const id of clip.customPresetIds ?? []) {
    const preset = customPresets.find((p) => p.id === id)
    if (preset) out.push({ key: preset.id, info: customPresetInfo(preset), custom: preset })
  }
  return out
}

/**
 * Phase 3.4: for each clip×preset pair in the export queue, ask whether
 * the chosen preset's centered crop would lose the safe zone of any
 * other selected preset. The bound is `clips.length × presets.length`,
 * with hard caps in the validators.
 *
 * T-83: "the frame" is the clip's EFFECTIVE frame — the manual crop's
 * rectangle when it has one, the whole source otherwise — because that is what
 * the export pipeline cuts every platform's shape out of. Asking the question
 * of the source instead warned about edges the user had already cropped away,
 * and named the wrong platform as the one losing picture: with a 9:16 crop
 * the tall platforms keep all of it and the wide one is the one cut down.
 *
 * Exported for ExportPanel.test.ts. (Clip Kit no longer runs this pre-flight
 * at all: choosing "all five platforms" already answers the question it asks,
 * T-85.) T-50: custom presets are export targets too, so they
 * take part in the pre-flight — a 16:9 custom preset beside Reels loses
 * the same safe zone a platform 16:9 preset would.
 */
export function findSafeZoneIssues(
  clips: ReadonlyArray<Clip>,
  sourceWidth: number,
  sourceHeight: number,
  customPresets: ReadonlyArray<CustomPreset> = []
): SafeZoneRow[] {
  const rows: SafeZoneRow[] = []
  const clipCount = clips.length
  for (let i = 0; i < clipCount; i++) {
    const clip = clips[i]
    if (!clip) continue
    const selected = queuedPresets(clip, customPresets).map((p) => p.info)
    if (selected.length < 2) continue
    const frame = cropFrameSize(sourceWidth, sourceHeight, clip.cropRect)
    // For each target the user picked for this clip, compute its centered
    // crop of the frame, then check whether any of the OTHER selected
    // targets' safe zones would fall outside that crop.
    const clippedSet = new Set<string>()
    for (const preset of selected) {
      const userCrop = computeCropBox(frame.w, frame.h, preset.aspectRatio)
      const others = selected
        .filter((p) => p !== preset)
        .map((p) => ({ label: p.label, aspect: p.aspectRatio }))
      for (const lost of findClippedSafeZones(frame.w, frame.h, userCrop, others)) {
        // Read as: the picture this other platform shows is cut down when
        // `preset` is made. The modal prints it as-is, so it has to be plain.
        clippedSet.add(`${lost} frame → cut down for ${preset.label}`)
      }
    }
    if (clippedSet.size > 0) {
      rows.push({ clipName: clip.name, clippedZones: [...clippedSet] })
    }
  }
  return rows
}

// T-135 (1): the queue's rows and the batch that fills them live in `store/exportQueue.ts` (they outlive this panel); these two are what this
// file's tests and its callers have always imported from here.
export { settleJobs }
export type { JobStatus }

export function ExportPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const togglePreset = useVideoStore((s) => s.togglePreset)
  const toggleCustomPreset = useVideoStore((s) => s.toggleCustomPreset)
  const pruneCustomPresets = useVideoStore((s) => s.pruneCustomPresets)

  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  const [outDir, setOutDir] = useState<string | null>(null)
  // T-135 (1): the queue is a module store, not this panel's state - a route change unmounts the panel, and a batch main is still running must still
  // show its rows, its progress and its Cancel when the person comes back. The rows are those of the last batch; they are drawn for the video the batch
  // was made from (or while it runs), not under another video.
  const queueJobs = useExportQueue((s) => s.jobs)
  const running = useExportQueue((s) => s.running)
  const queueSource = useExportQueue((s) => s.sourcePath)
  const jobs = queueJobs.length > 0 && (running || queueSource === source?.filePath) ? queueJobs : []
  // T-125 (18): one start at a time, claimed the instant the function runs. `running` is state, set only after the awaits in
  // `startExport` (the chooser, then `runExportQueue`'s settings writes), so a fast double-click ran a second start in that gap: main's
  // gate (T-111) refused the second batch and its catch settled the rows - Failed, Not run - while the first one ran. The ref is the
  // guard (the video Importer's `busyRef`, the audio importer's, Record's `startingRef`), and a `finally` gives it back. Declared with
  // the other hooks, ahead of the `if (!source) return null` below.
  const startingRef = useRef(false)
  // T-131 (5): the same claim for the folder chip's chooser, which goes straight to a native dialog.
  const pickingDirRef = useRef(false)
  const [watermarkText, setWatermarkText] = useState<string>('')
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkSpec['position']>(
    'bottom-right'
  )
  const [filenameTemplate, setFilenameTemplate] = useState('{source}_{clip}_{preset}')
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [pendingSafeZoneRows, setPendingSafeZoneRows] = useState<SafeZoneRow[] | null>(null)
  // INIT-I (round 16): show a confirm before canceling when >=2 jobs are
  // running. The 20-clip mistake-click scenario is the motivator.
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  // T-131 (9): the question is about the batch that is running. When the batch ends (the last job finished, or failed) with the question
  // still up, it read "Cancel 0 running jobs?" and "Cancel jobs" had nothing to cancel. The question goes with the batch.
  useEffect(() => {
    if (!running) setShowCancelConfirm(false)
  }, [running])

  useEffect(() => {
    let cancelled = false
    window.api.settings.get<string>('streamerHandle').then((handle) => {
      if (cancelled) return
      if (handle) setWatermarkText(handle)
    })
    // T-49: the corner comes back with the handle. Remembering the text but
    // not where it goes gave a user who picked "top left" bottom-right back
    // on the next launch, with no way to tell which one the export used.
    window.api.settings
      .get<WatermarkSpec['position']>('watermarkPosition')
      .then((position) => {
        if (cancelled || !position) return
        if (isWatermarkPosition(position)) setWatermarkPosition(position)
      })
    window.api.settings.get<string>('filenameTemplate').then((tpl) => {
      if (cancelled) return
      if (tpl) setFilenameTemplate(tpl)
    })
    // INIT-E (round 15): seed the output dir from the last successful export
    // so a power user doing back-to-back batches doesn't re-pick every time.
    window.api.settings.get<string>('export.lastOutputDir').then((dir) => {
      if (cancelled) return
      if (dir) setOutDir(dir)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // T-50: the panel owns the saved-preset list, because it is the surface
  // that turns those presets into export targets. The manager edits them and
  // calls back here; every read also prunes ids the clips still hold for a
  // preset that is now gone, so a delete unqueues it everywhere at once.
  const refreshCustomPresets = useCallback(async (): Promise<void> => {
    const list = await window.api.video.listCustomPresets()
    setCustomPresets(list)
    pruneCustomPresets(list.map((p) => p.id))
  }, [pruneCustomPresets])

  useEffect(() => {
    void refreshCustomPresets()
  }, [refreshCustomPresets])

  if (!source) return null

  const selectedClip = clips.find((c) => c.id === selectedClipId)

  async function pickOutDir(): Promise<void> {
    // T-131 (5): one chooser at a time: a double-click on the folder chip opened two.
    await claimFirst(pickingDirRef, async () => {
      // T-126 (6): the chooser opens ON the folder the button shows (the four side panels' hook and Clip Kit do), not wherever the OS
      // last was. `outDir` is null until a folder is chosen or remembered, and the chooser opens where it always did.
      const picked = await window.api.video.pickOutputDir(outDir ?? undefined)
      if (picked) setOutDir(picked)
    })
  }

  async function startExport(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (!source) return
      // T-112: no folder yet opens the chooser, as GIF, Compile and Reframe do. The
      // red toast this used to raise sent the person to press a different button to
      // get to the same dialog. A chooser that is canceled starts nothing and says
      // nothing: the person changed their mind.
      let dir = outDir
      if (!dir) {
        dir = await window.api.video.pickOutputDir()
        if (!dir) return
        setOutDir(dir)
      }
      // Phase 3.4: check for safe-zone collisions across the user's selected
      // platforms before kicking off the queue. If anything is flagged, defer
      // the actual run to the modal's "Continue anyway".
      const issues = findSafeZoneIssues(
        clips,
        source.probe.width,
        source.probe.height,
        customPresets
      )
      if (issues.length > 0) {
        setPendingSafeZoneRows(issues)
        return
      }
      await runExportQueue(dir)
    } finally {
      startingRef.current = false
    }
  }

  /** The modal's "Export anyway": the same single start (the question closes on the first press, but two presses can land before it does). */
  async function continueExport(dir: string): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      await runExportQueue(dir)
    } finally {
      startingRef.current = false
    }
  }

  /** `dir` is a parameter, not read from state: the folder chosen a moment ago by
   *  `startExport` is not in this closure's state yet (the same trap ReframePanel's
   *  M13 comment records). */
  async function runExportQueue(dir: string): Promise<void> {
    if (!source) return
    // T-85: the same constructor Clip Kit uses on the saved values, so the
    // panel and the kit cannot stamp two different looks.
    const watermark: WatermarkSpec | null = buildWatermark(watermarkText, watermarkPosition)
    // T-119: the guide says Clip Kit stamps "the watermark you last exported with", so an export with the
    // field blank is the last one and the watermark is forgotten: both keys go together, as they are
    // written together. Left alone, a person who cleared the field to stop stamping still got the old handle
    // on every kit file.
    // T-128 (4): remembered for Clip Kit and the next visit, and nothing below depends on it: these used to be awaited bare, so a write
    // main refused ended `startExport` here and the export never began (no toast, no rows). Fire-and-forget through the helper.
    if (watermark) {
      void persistSetting('streamerHandle', watermark.text)
      void persistSetting('watermarkPosition', watermark.position)
    } else {
      void persistSetting('streamerHandle', undefined)
      void persistSetting('watermarkPosition', undefined)
    }
    if (filenameTemplate) void persistSetting('filenameTemplate', filenameTemplate)
    const sourceBase = source.fileName.replace(/\.[^.]+$/, '')
    const queue: ExportJobSpec[] = []
    const statuses: JobStatus[] = []
    for (const clip of clips) {
      // Platform presets first, then the clip's custom presets — one job per
      // target, whichever kind it is (T-50). `target.custom` is what tells
      // main to encode at the custom geometry; `target.info.id` stays the
      // base platform so the advisory tables and the filter graph still have
      // a platform row to start from.
      for (const target of queuedPresets(clip, customPresets)) {
        const jobId = nanoid(10)
        const filename = expandFilenameTemplate(filenameTemplate, {
          source: sourceBase,
          clip: clip.name,
          // {preset} reads as the user sees the target named: the platform
          // id for a platform preset, the preset's own name for a custom one
          // (two custom presets on the same base must not collide).
          preset: target.custom ? target.custom.name : target.info.id,
          handle: watermark?.text,
          ext: 'mp4'
        })
        queue.push({
          jobId,
          sourcePath: source.filePath,
          outDir: dir,
          // T-113: the clip as it plays — a stored speed of 0 is 1x, not a batch refusal.
          clip: clipForExport(clip),
          preset: target.info.id,
          customPreset: target.custom,
          watermark,
          outputFilename: filename
        })
        statuses.push({
          jobId,
          clipName: clip.name,
          presetLabel: target.info.label,
          percent: 0
        })
      }
    }
    // No empty-queue branch: `totalQueued` counts the same `queuedPresets`
    // this loop pushes, and the Export button is disabled while that count is
    // zero, so the queue can never arrive here empty. T-49 deleted the
    // nothing-queued toast that used to sit here — copy no path can reach is
    // copy nobody notices going wrong.
    // T-135 (1): the batch runs in the queue's store (its listeners, its toast, its settling of the rows), not in this component: the person can
    // leave this studio while it runs, and it still ends where it should.
    await runExportBatch({ queue, statuses, dir, sourcePath: source.filePath })
  }

  // Counts custom targets too, so the button's number is the number of files
  // the batch will actually write (T-50).
  const totalQueued = clips.reduce(
    (acc, c) => acc + queuedPresets(c, customPresets).length,
    0
  )

  /** Everything the user can tick for a clip: the six built-in cards (five platforms, YouTube
   *  1080p60 beside YouTube), then the saved custom presets in the order the manager lists them (by name). */
  const gridTargets: Array<{ key: string; info: PlatformInfo; custom: CustomPreset | null }> = [
    ...ALL_PLATFORM_IDS.map((id) => ({ key: id, info: PLATFORM_INFO[id], custom: null })),
    ...customPresets.map((p) => ({ key: p.id, info: customPresetInfo(p), custom: p }))
  ]

  const remainingJobCount = jobs.filter((j) => j.percent < 100 && !j.error).length

  return (
    <>
    <SafeZoneWarningModal
      open={pendingSafeZoneRows !== null}
      affectedClips={pendingSafeZoneRows ?? []}
      onCancel={() => setPendingSafeZoneRows(null)}
      onContinue={() => {
        setPendingSafeZoneRows(null)
        if (outDir) void continueExport(outDir)
      }}
    />
    {/* INIT-I (round 16): confirm before canceling a multi-job batch. */}
    <Modal
      open={showCancelConfirm}
      onClose={() => setShowCancelConfirm(false)}
      title="Cancel running jobs"
      className="max-w-sm w-full p-5"
    >
      <h2 className="text-lg font-semibold mb-2">Cancel running jobs</h2>
      <p className="text-sm text-ink-base mb-4">
        Cancel {countOf(remainingJobCount, 'running job')}?
      </p>
      <div className="flex justify-end gap-2">
        <button
          className="btn-ghost px-3 py-1.5 text-sm"
          onClick={() => setShowCancelConfirm(false)}
        >
          Keep running
        </button>
        <button
          className="btn-primary px-3 py-1.5 text-sm"
          onClick={() => {
            setShowCancelConfirm(false)
            void window.api.video.cancelAll()
          }}
        >
          Cancel jobs
        </button>
      </div>
    </Modal>
    <div className="card p-4 flex flex-col gap-4" data-tutorial="video-export">
      <PanelHeader
        icon="download"
        actions={
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost px-3 py-1.5 text-sm inline-flex items-center gap-1.5"
              onClick={() => setShowPresetManager(true)}
              title="Manage custom export presets"
            >
              <Icon name="gear" size={14} /> Presets
            </button>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={pickOutDir}>
              <OutputDirLabel outDir={outDir} />
            </button>
            <button
              className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
              disabled={running || totalQueued === 0}
              onClick={startExport}
              // T-112: a disabled button says why (the same sentence is under the
              // header, visible without hovering — the Compile card's pattern).
              title={!running && totalQueued === 0 ? NOTHING_QUEUED : undefined}
            >
              {/* T-94: the button says what it will produce. "Export 6" left a
                  user who had scanned a VOD for highlights to guess whether
                  that meant their five excerpts or five plus the whole video. */}
              {running ? 'Exporting…' : totalQueued === 0 ? 'Export' : `Export ${countOf(totalQueued, 'file')}`}
            </button>
          </div>
        }
      >
        Export
      </PanelHeader>
      {!running && totalQueued === 0 ? <p className="text-xs text-warn">{NOTHING_QUEUED}</p> : null}
      {running ? (
        // B8 fix (round 15) + INIT-I (round 16): a long batch had no abort path. Cancel calls cancelAll, but a misclick during a
        // 20-clip batch was too costly - confirm before nuking >=2 running jobs.
        // T-127 (2): and Cancel has a row of its own (Compile, GIF and Picture-in-picture got theirs in T-126 (20); this one was left out).
        // Beside the primary it took the place the primary's right edge had a moment ago - "Export 1 file" is wider than "Exporting..." -
        // so the second press of a double-click landed on Cancel, and with ONE job there is no confirm: "Export canceled." and no file.
        // Where the second press lands now is the disabled primary.
        <div className="flex justify-end">
          <button
            className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft"
            title="Cancel export"
            onClick={() => {
              const remaining = jobs.filter((j) => j.percent < 100 && !j.error).length
              if (remaining >= 2) {
                setShowCancelConfirm(true)
              } else {
                void window.api.video.cancelAll()
              }
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-xs">
        <span className="text-ink-muted">Watermark:</span>
        <input
          type="text"
          placeholder="@yourhandle (leave blank for none)"
          value={watermarkText}
          onChange={(e) => setWatermarkText(e.target.value)}
          className="flex-1 bg-bg-base rounded px-2 py-1 font-mono"
          maxLength={40}
        />
        <select
          className="bg-bg-base rounded px-2 py-1"
          value={watermarkPosition}
          onChange={(e) => setWatermarkPosition(e.target.value as WatermarkSpec['position'])}
          aria-label="Watermark position"
        >
          {WATERMARK_POSITIONS.map((position) => (
            <option key={position} value={position}>
              {WATERMARK_POSITION_LABELS[position]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-ink-muted">Filename:</span>
          <input
            type="text"
            value={filenameTemplate}
            onChange={(e) => setFilenameTemplate(e.target.value)}
            className="flex-1 bg-bg-base rounded px-2 py-1 font-mono"
            placeholder="{source}_{clip}_{preset}"
          />
        </div>
        {/* T-131 (14): the token list is its own line under the box. Beside it, at the 1024 px window, it took the row and left the box 168 px
            for a 189 px default template: the one input in the app that cut its own value. */}
        <span className="text-ink-dim font-mono">
          Tokens: {'{source} {clip} {preset} {date} {time} {handle}'}
        </span>
      </div>

      {selectedClip ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {/* T-50: the six built-in cards (T-130: YouTube 1080p60 joined the five), then every saved custom preset. Same
              checkbox, same geometry line, same success indicator — a saved
              preset is an export target, so it looks and behaves like one.
              The only difference is the "custom" tag that lets the eye split
              the two groups. */}
          {gridTargets.map((target) => {
            const checked = target.custom
              ? (selectedClip.customPresetIds ?? []).includes(target.key)
              : selectedClip.selectedPresets.includes(target.info.id)
            const detailId = `export-target-${target.key}-detail`
            return (
              // T-92: the label wraps the checkbox and the platform's NAME and
              // nothing else. Round 50 (T-83) put the verdict's reasons inside
              // the label to make them visible, and a screen reader then read
              // the whole paragraph as the checkbox's name ("YouTube 1920×1080
              // OK Under the 1-minute sweet spot · 25% of the picture's height
              // is trimmed…"). The size, frame rate and verdict sit beside it
              // as the checkbox's DESCRIPTION (aria-describedby): announced
              // after the name, never part of it. The label's ::after stretches
              // over the card, so the whole card is still one hit area.
              <div
                key={target.key}
                data-export-target={target.key}
                className={`relative px-3 py-2 rounded-md border transition-colors ${
                  checked
                    ? 'border-accent bg-accent/10'
                    : 'border-ink-dim/30 hover:bg-bg-hover'
                }`}
              >
                <label className="flex items-center gap-2 text-sm cursor-pointer after:absolute after:inset-0 after:content-['']">
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-describedby={detailId}
                    // Above the label's stretched ::after, so a click on the box
                    // itself lands on the box (a pointer, a test) rather than on
                    // an overlay that forwards it.
                    className="relative z-10"
                    onChange={() =>
                      target.custom
                        ? toggleCustomPreset(selectedClip.id, target.key)
                        : togglePreset(selectedClip.id, target.info.id)
                    }
                  />
                  <span className="font-medium truncate" title={target.info.label}>{target.info.label}</span>
                  {target.custom ? (
                    <span className="text-xs uppercase tracking-wide text-ink-dim border border-ink-dim/40 rounded px-1 shrink-0">
                      Custom
                    </span>
                  ) : null}
                </label>
                <div id={detailId} className="pl-7 min-w-0">
                  <div className="text-xs text-ink-dim mt-0.5">
                    {target.info.width}×{target.info.height} · {target.info.fps} fps
                  </div>
                  <div className="mt-1">
                    {/* T-83 / T-97: the verdict is about the clip as it will be
                        exported — its crop is the frame, its speed sets the
                        length — so it gets the clip, not numbers read off the
                        source. */}
                    <SuccessIndicator
                      platform={target.info}
                      clip={selectedClip}
                      sourceWidth={source.probe.width}
                      sourceHeight={source.probe.height}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <div className="flex flex-col gap-2 mt-2">
          <PanelHeader icon="package">Queue</PanelHeader>
          {jobs.map((j) => (
            <div key={j.jobId} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 truncate" title={`${j.clipName} · ${j.presetLabel}`}>
                  {j.clipName} · {j.presetLabel}
                  {/* T-112: the file this row wrote, by the name main gave it —
                      "clip (2).mp4" when the name was taken (T-106) — so a numbered
                      file is never a surprise in the folder. */}
                  {j.outputPath ? (
                    <span className="block truncate text-xs text-ink-dim font-mono" title={j.outputPath}>
                      {basename(j.outputPath)}
                    </span>
                  ) : null}
                </span>
                {/* T-114: a progressbar named for its job and valued - four identical bars were four
                    unnamed divs. The percent beside it stays the live region that speaks. */}
                <div
                  className="w-40 h-1.5 bg-bg-hover rounded-full overflow-hidden"
                  role="progressbar"
                  aria-label={`${j.clipName} · ${j.presetLabel}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(j.percent)}
                >
                  {/* T-100: red is for a fault. A row the user canceled keeps its
                      label and loses the color that said "something broke". */}
                  <div
                    className={`h-full ${
                      j.error ? (j.canceled ? 'bg-ink-muted' : 'bg-danger-strong') : 'bg-accent'
                    }`}
                    style={{ width: `${Math.round(j.percent)}%` }}
                  />
                </div>
                <span
                  className="font-mono text-xs text-ink-muted w-10 shrink-0 whitespace-nowrap text-right"
                  role="status"
                  aria-live="polite"
                >
                  {Math.round(j.percent)}%
                </span>
                {/* T-84: the words for a bar that stopped. The toast fades in a
                    few seconds; a red bar alone never said whether the file was
                    lost to a fault or to the user's own Cancel. T-112: a row the
                    batch never reached says "Not run", in neutral ink — a failure
                    of the job before it, not of this one. */}
                {j.error ? (
                  <span
                    className={`text-xs font-medium ${j.canceled ? 'text-ink-muted' : 'text-danger'}`}
                    title={j.error}
                  >
                    {j.canceled ? 'Canceled' : 'Failed'}
                  </span>
                ) : j.notRun ? (
                  <span className="text-xs font-medium text-ink-muted">Not run</span>
                ) : null}
                {j.outputPath ? (
                  <button
                    className="text-xs text-accent hover:underline"
                    // M13 fix (round 15): see audio ExportDialog — closure-time
                    // narrowing escape; assertDefined keeps the contract explicit.
                    onClick={() =>
                      window.api.video.revealInFolder(
                        assertDefined(j.outputPath, 'j.outputPath')
                      )
                    }
                  >
                    Show in folder
                  </button>
                ) : null}
              </div>
              {/* T-112: the reason is text on the row that failed, not only a hover
                  title — "you can still see which one, and why, after the message
                  fades". A canceled row's reason is the cancel sentence, which the
                  word "Canceled" already says. */}
              {j.error && !j.canceled ? <p className="text-xs text-danger">{j.error}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <CustomPresetManager
        open={showPresetManager}
        onClose={() => setShowPresetManager(false)}
        presets={customPresets}
        onChanged={refreshCustomPresets}
      />
    </div>
    </>
  )
}
