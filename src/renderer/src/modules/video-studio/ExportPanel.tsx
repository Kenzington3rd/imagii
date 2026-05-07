import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import type {
  ExportJobSpec,
  ExportProgress,
  PlatformId,
  WatermarkSpec
} from '@shared/clip'
import { expandFilenameTemplate } from '@shared/filename'
import { useVideoStore } from './store/videoStore'
import { ALL_PLATFORM_IDS, PLATFORM_INFO } from './presets'
import { SuccessIndicator } from './SuccessIndicator'
import { CustomPresetManager } from './CustomPresetManager'

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
    <div className="card p-4 flex flex-col gap-4" data-tutorial="video-export">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Export
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost px-3 py-1.5 text-sm"
            onClick={() => setShowPresetManager(true)}
            title="Manage custom export presets"
          >
            ⚙ Presets
          </button>
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={pickOutDir}>
            {outDir ? `📁 ${outDir.split(/[\\/]/).pop()}` : 'Choose folder…'}
          </button>
          <button
            className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
            disabled={running || totalQueued === 0}
            onClick={startExport}
          >
            {running ? 'Exporting…' : `Export ${totalQueued || ''}`}
          </button>
        </div>
      </div>

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
                    <span>{platform.emoji}</span>
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
          <h4 className="text-xs uppercase tracking-wide text-ink-muted">Queue</h4>
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
  )
}
