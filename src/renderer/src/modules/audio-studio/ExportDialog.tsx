import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import type { AudioJobProgress, AudioOutputFormat } from '@shared/audio'
import { assertDefined } from '@shared/assert'
import { useAudioStore } from './state/audioStore'
import { PanelHeader } from '../../components/PanelHeader'

interface JobState {
  jobId: string
  pass: 'measure' | 'render' | 'mux'
  percent: number
  outputPath?: string
}

const FORMATS: AudioOutputFormat[] = ['mp3', 'wav', 'flac', 'aac']

export function ExportDialog(): JSX.Element | null {
  const source = useAudioStore((s) => s.source)
  const chain = useAudioStore((s) => s.chain)
  const [format, setFormat] = useState<AudioOutputFormat>('mp3')
  const [bitrate, setBitrate] = useState('192k')
  const [muxBack, setMuxBack] = useState(true)
  const [job, setJob] = useState<JobState | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const off = window.api.audio.onProgress((p: AudioJobProgress) => {
      setJob((prev) => (prev && prev.jobId === p.jobId ? { ...prev, ...p } : prev))
    })
    return off
  }, [])

  if (!source) return null

  async function startExport(): Promise<void> {
    if (!source) return
    const defaultName = await window.api.audio.suggestOutputName(
      source.fromVideo?.videoPath ?? source.filePath,
      source.fromVideo && muxBack ? 'mp4' : format
    )
    const outputPath = await window.api.audio.pickOutputFile({
      defaultName,
      format: source.fromVideo && muxBack ? 'mp4' : format
    })
    if (!outputPath) return

    const jobId = nanoid(10)
    setJob({ jobId, pass: 'render', percent: 0 })
    setRunning(true)
    try {
      if (source.fromVideo && muxBack) {
        const tempAudioPath = outputPath.replace(/\.mp4$/i, '.cleaned.wav')
        await window.api.audio.export({
          jobId,
          sourcePath: source.filePath,
          outputPath: tempAudioPath,
          chain,
          format: 'wav'
        })
        await window.api.audio.mux({
          jobId,
          videoPath: source.fromVideo.videoPath,
          audioPath: tempAudioPath,
          outputPath
        })
        toast.success('Audio cleaned and muxed back to video')
      } else {
        await window.api.audio.export({
          jobId,
          sourcePath: source.filePath,
          outputPath,
          chain,
          format,
          bitrate: format === 'mp3' || format === 'aac' ? bitrate : undefined
        })
        toast.success('Cleaned audio exported')
      }
      setJob((prev) => (prev ? { ...prev, percent: 100, outputPath } : prev))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      toast.error(msg)
    } finally {
      setRunning(false)
    }
  }

  // B10 fix (round 16): audio export+mux passes can run for minutes on a
  // long source. Round 15 wired Cancel into video export / ClipKit /
  // RecordStudio but the audio dialog was missed. Backend cancelAudioJob
  // already exists.
  async function cancelExport(): Promise<void> {
    if (!job) return
    try {
      await window.api.audio.cancel(job.jobId)
      toast('Audio export cancelled')
    } catch {
      /* the renderer Promise rejecting on kill is fine */
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <PanelHeader icon="download">Export</PanelHeader>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-ink-muted text-xs">Format</span>
          <select
            className="bg-bg-base rounded px-2 py-1"
            value={format}
            onChange={(e) => setFormat(e.target.value as AudioOutputFormat)}
            disabled={Boolean(source.fromVideo && muxBack)}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        {(format === 'mp3' || format === 'aac') &&
        !(source.fromVideo && muxBack) ? (
          <label className="flex items-center gap-1.5">
            <span className="text-ink-muted text-xs">Bitrate</span>
            <select
              className="bg-bg-base rounded px-2 py-1"
              value={bitrate}
              onChange={(e) => setBitrate(e.target.value)}
            >
              <option value="128k">128 kbps</option>
              <option value="192k">192 kbps</option>
              <option value="256k">256 kbps</option>
              <option value="320k">320 kbps</option>
            </select>
          </label>
        ) : null}
        {source.fromVideo ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={muxBack}
              onChange={(e) => setMuxBack(e.target.checked)}
            />
            Re-attach to video (output .mp4)
          </label>
        ) : null}

        <button
          className="btn-primary px-4 py-1.5 ml-auto disabled:opacity-50"
          disabled={running}
          onClick={startExport}
        >
          {running ? 'Exporting…' : 'Export'}
        </button>
        {running && job ? (
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded bg-bg-hover hover:bg-bg-elevated text-ink-base"
            onClick={cancelExport}
          >
            Cancel
          </button>
        ) : null}
      </div>

      {job ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-xs uppercase tracking-wide text-ink-muted w-16">
            {job.pass}
          </span>
          <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.round(job.percent)}%` }}
            />
          </div>
          <span className="font-mono text-xs text-ink-muted w-10 text-right">
            {Math.round(job.percent)}%
          </span>
          {job.outputPath ? (
            <button
              className="text-xs text-accent hover:underline"
              // M13 fix (round 15): `!` was guarded by the outer `job.outputPath ?`
              // ternary, but the inner closure runs later (click) and TS narrowing
              // doesn't survive that gap. assertDefined makes the contract explicit
              // and gives a clean error if the queue state ever drifts.
              onClick={() =>
                window.api.audio.revealInFolder(
                  assertDefined(job.outputPath, 'job.outputPath')
                )
              }
            >
              Show
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
