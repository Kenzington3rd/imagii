import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import type {
  Clip,
  ExportJobSpec,
  ExportProgress,
  WatermarkSpec
} from '@shared/clip'
import type { CustomPreset } from '@shared/customPresets'
import { expandFilenameTemplate } from '@shared/filename'
import { computeCropBox, findClippedSafeZones } from '@shared/safeZone'
import { assertDefined } from '@shared/assert'
import { useVideoStore } from './store/videoStore'
import { ALL_PLATFORM_IDS, PLATFORM_INFO, customPresetInfo, type PlatformInfo } from './presets'
import { SuccessIndicator } from './SuccessIndicator'
import { CustomPresetManager } from './CustomPresetManager'
import { SafeZoneWarningModal } from './SafeZoneWarningModal'
import { Icon } from '../../components/Icon'
import { OutputDirLabel } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'
import { Modal } from '../../components/Modal'

export interface SafeZoneRow {
  clipName: string
  clippedZones: string[]
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
 * Exported so ClipKitButton can run the same pre-flight before its
 * 5-platform batch. T-50: custom presets are export targets too, so they
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
    // For each target the user picked for this clip, compute its centered
    // crop, then check whether any of the OTHER selected targets' safe
    // zones would fall outside that crop.
    const clippedSet = new Set<string>()
    for (const preset of selected) {
      const userCrop = computeCropBox(sourceWidth, sourceHeight, preset.aspectRatio)
      const others = selected
        .filter((p) => p !== preset)
        .map((p) => ({ label: p.label, aspect: p.aspectRatio }))
      for (const lost of findClippedSafeZones(sourceWidth, sourceHeight, userCrop, others)) {
        clippedSet.add(`${preset.label} → ${lost}`)
      }
    }
    if (clippedSet.size > 0) {
      rows.push({ clipName: clip.name, clippedZones: [...clippedSet] })
    }
  }
  return rows
}

interface JobStatus {
  jobId: string
  clipName: string
  /** What the queue row shows — a platform's label or the user's own
   *  preset name. Carried rather than looked up, because a custom preset
   *  deleted mid-batch would otherwise leave the row with nothing to
   *  render (T-50). */
  presetLabel: string
  percent: number
  outputPath?: string
  error?: string
}

export function ExportPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const togglePreset = useVideoStore((s) => s.togglePreset)
  const toggleCustomPreset = useVideoStore((s) => s.toggleCustomPreset)
  const pruneCustomPresets = useVideoStore((s) => s.pruneCustomPresets)

  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  const [outDir, setOutDir] = useState<string | null>(null)
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const [running, setRunning] = useState(false)
  const [watermarkText, setWatermarkText] = useState<string>('')
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkSpec['position']>(
    'bottom-right'
  )
  const [filenameTemplate, setFilenameTemplate] = useState('{source}_{clip}_{preset}')
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [pendingSafeZoneRows, setPendingSafeZoneRows] = useState<SafeZoneRow[] | null>(null)
  // INIT-I (round 16): show a confirm before cancelling when >=2 jobs are
  // running. The 20-clip mistake-click scenario is the motivator.
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.settings.get<string>('streamerHandle').then((handle) => {
      if (cancelled) return
      if (handle) setWatermarkText(handle)
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

  useEffect(() => {
    const offProgress = window.api.video.onProgress((p: ExportProgress) => {
      setJobs((prev) =>
        prev.map((j) => (j.jobId === p.jobId ? { ...j, percent: p.percent } : j))
      )
    })
    const offDone = window.api.video.onJobComplete(({ jobId, outputPath }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.jobId === jobId ? { ...j, outputPath, percent: 100 } : j
        )
      )
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [])

  if (!source) return null

  const selectedClip = clips.find((c) => c.id === selectedClipId)

  async function pickOutDir(): Promise<void> {
    const picked = await window.api.video.pickOutputDir()
    if (picked) setOutDir(picked)
  }

  async function startExport(): Promise<void> {
    if (!source) return
    if (!outDir) {
      toast.error('Choose an output folder first')
      return
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
    await runExportQueue()
  }

  async function runExportQueue(): Promise<void> {
    if (!source) return
    if (!outDir) return
    const watermark: WatermarkSpec | null = watermarkText.trim()
      ? {
          text: watermarkText.trim(),
          position: watermarkPosition,
          opacity: 0.85,
          fontSizePct: 3.5
        }
      : null
    if (watermark) await window.api.settings.set('streamerHandle', watermark.text)
    if (filenameTemplate) await window.api.settings.set('filenameTemplate', filenameTemplate)
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
          outDir,
          clip,
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
    if (queue.length === 0) {
      toast.error('No presets selected on any clip')
      return
    }
    setJobs(statuses)
    setRunning(true)
    try {
      await window.api.video.exportBatch(queue)
      toast.success(`Exported ${queue.length} file${queue.length === 1 ? '' : 's'}`)
      // INIT-E (round 15): persist the choice on success so the next batch
      // defaults to the same folder.
      void window.api.settings.set('export.lastOutputDir', outDir)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      toast.error(msg)
      setJobs((prev) =>
        prev.map((j) => (j.percent < 100 ? { ...j, error: msg } : j))
      )
    } finally {
      setRunning(false)
    }
  }

  // Counts custom targets too, so the button's number is the number of files
  // the batch will actually write (T-50).
  const totalQueued = clips.reduce(
    (acc, c) => acc + queuedPresets(c, customPresets).length,
    0
  )

  /** Everything the user can tick for a clip: the five platforms, then the
   *  saved custom presets in the order the manager lists them (by name). */
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
        void runExportQueue()
      }}
    />
    {/* INIT-I (round 16): confirm before cancelling a multi-job batch. */}
    <Modal
      open={showCancelConfirm}
      onClose={() => setShowCancelConfirm(false)}
      title="Cancel running jobs"
      className="max-w-sm w-full p-5"
    >
      <h2 className="text-lg font-semibold mb-2">Cancel running jobs</h2>
      <p className="text-sm text-ink-base mb-4">
        Cancel {remainingJobCount} running jobs?
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
            >
              {running ? 'Exporting…' : `Export ${totalQueued || ''}`}
            </button>
            {running ? (
              // B8 fix (round 15) + INIT-I (round 16): a long batch had no
              // abort path. Cancel calls cancelAll, but a misclick during a
              // 20-clip batch was too costly — confirm before nuking >=2
              // running jobs.
              <button
                className="btn-ghost px-3 py-1.5 text-sm"
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
            ) : null}
          </div>
        }
      >
        Export
      </PanelHeader>

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
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="top-right">Top right</option>
          <option value="top-left">Top left</option>
        </select>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-ink-muted">Filename:</span>
        <input
          type="text"
          value={filenameTemplate}
          onChange={(e) => setFilenameTemplate(e.target.value)}
          className="flex-1 bg-bg-base rounded px-2 py-1 font-mono"
          placeholder="{source}_{clip}_{preset}"
        />
        <span className="text-ink-dim font-mono">
          Tokens: {'{source} {clip} {preset} {date} {time} {handle}'}
        </span>
      </div>

      {selectedClip ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {/* T-50: the five platforms, then every saved custom preset. Same
              checkbox, same geometry line, same success indicator — a saved
              preset is an export target, so it looks and behaves like one.
              The only difference is the "custom" tag that lets the eye split
              the two groups. */}
          {gridTargets.map((target) => {
            const checked = target.custom
              ? (selectedClip.customPresetIds ?? []).includes(target.key)
              : selectedClip.selectedPresets.includes(target.info.id)
            const clipDuration = selectedClip.endSec - selectedClip.startSec
            return (
              <label
                key={target.key}
                className={`flex items-start gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                  checked
                    ? 'border-accent bg-accent/10'
                    : 'border-ink-dim/30 hover:bg-bg-hover'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    target.custom
                      ? toggleCustomPreset(selectedClip.id, target.key)
                      : togglePreset(selectedClip.id, target.info.id)
                  }
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium truncate">{target.info.label}</span>
                    {target.custom ? (
                      <span className="text-xs uppercase tracking-wide text-ink-dim border border-ink-dim/40 rounded px-1 shrink-0">
                        custom
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-ink-dim mt-0.5">
                    {target.info.width}×{target.info.height}
                  </div>
                  <div className="mt-1">
                    <SuccessIndicator
                      platform={target.info}
                      clipDuration={clipDuration}
                      sourceWidth={source.probe.width}
                      sourceHeight={source.probe.height}
                      cropAspect={null}
                    />
                  </div>
                </div>
              </label>
            )
          })}
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <div className="flex flex-col gap-2 mt-2">
          <PanelHeader icon="package">Queue</PanelHeader>
          {jobs.map((j) => (
            <div key={j.jobId} className="flex items-center gap-3 text-sm">
              <span className="flex-1 truncate">
                {j.clipName} · {j.presetLabel}
              </span>
              <div className="w-40 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                <div
                  className={`h-full ${j.error ? 'bg-rose-400' : 'bg-accent'}`}
                  style={{ width: `${Math.round(j.percent)}%` }}
                />
              </div>
              <span
                className="font-mono text-xs text-ink-muted w-10 text-right"
                role="status"
                aria-live="polite"
              >
                {Math.round(j.percent)}%
              </span>
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
                  Show
                </button>
              ) : null}
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
