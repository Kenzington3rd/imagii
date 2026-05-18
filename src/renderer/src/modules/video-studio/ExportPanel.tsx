import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import type {
  Clip,
  ExportJobSpec,
  ExportProgress,
  PlatformId,
  WatermarkSpec
} from '@shared/clip'
import { expandFilenameTemplate } from '@shared/filename'
import { computeCropBox, findClippedSafeZones } from '@shared/safeZone'
import { useVideoStore } from './store/videoStore'
import { ALL_PLATFORM_IDS, PLATFORM_INFO } from './presets'
import { SuccessIndicator } from './SuccessIndicator'
import { CustomPresetManager } from './CustomPresetManager'
import { SafeZoneWarningModal } from './SafeZoneWarningModal'
import { Icon } from '../../components/Icon'
import { OutputDirLabel } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'

interface SafeZoneRow {
  clipName: string
  clippedZones: string[]
}

/**
 * Phase 3.4: for each clip×preset pair in the export queue, ask whether
 * the chosen preset's centered crop would lose the safe zone of any
 * other selected preset. The bound is `clips.length × presets.length`,
 * with hard caps in the validators.
 */
function findSafeZoneIssues(
  clips: ReadonlyArray<Clip>,
  sourceWidth: number,
  sourceHeight: number
): SafeZoneRow[] {
  const rows: SafeZoneRow[] = []
  const clipCount = clips.length
  for (let i = 0; i < clipCount; i++) {
    const clip = clips[i]
    if (!clip) continue
    const selected = clip.selectedPresets
    if (selected.length < 2) continue
    // For each platform the user picked for this clip, compute its centered
    // crop, then check whether any of the OTHER selected platforms' safe
    // zones would fall outside that crop.
    const clippedSet = new Set<string>()
    for (const presetId of selected) {
      const preset = PLATFORM_INFO[presetId]
      const userCrop = computeCropBox(sourceWidth, sourceHeight, preset.aspectRatio)
      const others = selected
        .filter((p) => p !== presetId)
        .map((p) => ({ label: PLATFORM_INFO[p].label, aspect: PLATFORM_INFO[p].aspectRatio }))
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
  preset: PlatformId
  percent: number
  outputPath?: string
  error?: string
}

export function ExportPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const togglePreset = useVideoStore((s) => s.togglePreset)

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
    return () => {
      cancelled = true
    }
  }, [])

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
    const issues = findSafeZoneIssues(clips, source.probe.width, source.probe.height)
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
      for (const preset of clip.selectedPresets) {
        const jobId = nanoid(10)
        const filename = expandFilenameTemplate(filenameTemplate, {
          source: sourceBase,
          clip: clip.name,
          preset,
          handle: watermark?.text,
          ext: 'mp4'
        })
        queue.push({
          jobId,
          sourcePath: source.filePath,
          outDir,
          clip,
          preset,
          watermark,
          outputFilename: filename
        })
        statuses.push({ jobId, clipName: clip.name, preset, percent: 0 })
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

  const totalQueued = clips.reduce((acc, c) => acc + c.selectedPresets.length, 0)

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
          {ALL_PLATFORM_IDS.map((id) => {
            const platform = PLATFORM_INFO[id]
            const checked = selectedClip.selectedPresets.includes(id)
            const clipDuration = selectedClip.endSec - selectedClip.startSec
            return (
              <label
                key={id}
                className={`flex items-start gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                  checked
                    ? 'border-accent bg-accent/10'
                    : 'border-ink-dim/30 hover:bg-bg-hover'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePreset(selectedClip.id, id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{platform.label}</span>
                  </div>
                  <div className="text-xs text-ink-dim mt-0.5">
                    {platform.width}×{platform.height}
                  </div>
                  <div className="mt-1">
                    <SuccessIndicator
                      platform={platform}
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
                {j.clipName} · {PLATFORM_INFO[j.preset].label}
              </span>
              <div className="w-40 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                <div
                  className={`h-full ${j.error ? 'bg-rose-400' : 'bg-accent'}`}
                  style={{ width: `${Math.round(j.percent)}%` }}
                />
              </div>
              <span className="font-mono text-xs text-ink-muted w-10 text-right">
                {Math.round(j.percent)}%
              </span>
              {j.outputPath ? (
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() => window.api.video.revealInFolder(j.outputPath!)}
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
      />
    </div>
    </>
  )
}
