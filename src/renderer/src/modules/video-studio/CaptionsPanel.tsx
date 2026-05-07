import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import path from 'path-browserify'
import type {
  CaptionSegment,
  CaptionsInstallStatus,
  CaptionsProgress,
  CaptionStyle,
  CaptionPosition
} from '@shared/captions'
import { DEFAULT_CAPTION_STYLE } from '@shared/captions'
import { useVideoStore } from './store/videoStore'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function CaptionsPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const clips = useVideoStore((s) => s.clips)
  const [status, setStatus] = useState<CaptionsInstallStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<CaptionsProgress | null>(null)
  const [segments, setSegments] = useState<CaptionSegment[] | null>(null)
  const [srtPath, setSrtPath] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  const [trimToClip, setTrimToClip] = useState(false)

  useEffect(() => {
    void window.api.captions.status().then(setStatus)
  }, [])

  useEffect(() => {
    const off = window.api.captions.onProgress((p) => setProgress(p))
    return off
  }, [])

  if (!source) return null

  async function refreshStatus(): Promise<void> {
    const s = await window.api.captions.status()
    setStatus(s)
  }

  async function transcribe(): Promise<void> {
    if (!source) return
    if (!status?.ready) {
      setShowSetup(true)
      return
    }
    setRunning(true)
    setProgress(null)
    try {
      const result = await window.api.captions.transcribe({
        jobId: nanoid(10),
        sourcePath: source.filePath
      })
      setSegments(result.segments)
      setSrtPath(result.srtPath)
      toast.success(`Captioned ${result.segments.length} segments`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Transcription failed')
    } finally {
      setRunning(false)
    }
  }

  async function saveSrt(): Promise<void> {
    if (!srtPath) return
    const defaultName = source ? `${path.parse(source.fileName).name}.srt` : 'captions.srt'
    const saved = await window.api.captions.saveSrt(srtPath, defaultName)
    if (saved) toast.success('SRT saved')
  }

  async function burnIn(): Promise<void> {
    if (!srtPath || !source) return
    const defaultName = `${path.parse(source.fileName).name}-captioned.mp4`
    const outputPath = await window.api.captions.pickBurnInOutput(defaultName)
    if (!outputPath) return
    // Phase 3.1: when "trim to selected clip" is on, burn captions over the
    // active clip's range only. The IPC handler validates the range, but
    // double-check here so the toast comes from us, not from a thrown
    // assert message.
    const selectedClip =
      trimToClip && selectedClipId
        ? clips.find((c) => c.id === selectedClipId) ?? null
        : null
    if (trimToClip && !selectedClip) {
      toast.error('Pick a clip first to use trim-to-clip burn-in.')
      return
    }
    setRunning(true)
    try {
      await window.api.captions.burnIn({
        jobId: nanoid(10),
        videoPath: source.filePath,
        srtPath,
        outputPath,
        // Legacy field — main process picks pixel size from style.fontSize
        // when it's set, falling back to fontSizePct * 10 otherwise.
        fontSizePct: style.fontSize / 10,
        style,
        ...(selectedClip && {
          startSec: selectedClip.startSec,
          endSec: selectedClip.endSec
        })
      })
      toast.success('Captions burned in')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Burn-in failed')
    } finally {
      setRunning(false)
    }
  }

  function updateStyle(patch: Partial<CaptionStyle>): void {
    setStyle((prev) => ({ ...prev, ...patch }))
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-captions">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          🎙 Auto-captions
        </h3>
        <button
          className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          onClick={transcribe}
          disabled={running}
        >
          {running ? 'Transcribing…' : segments ? 'Re-transcribe' : 'Transcribe'}
        </button>
      </div>

      {!status?.ready ? (
        <div className="bg-amber-400/10 border border-amber-400/30 rounded p-2 text-xs">
          <div className="font-semibold text-amber-300 mb-1">Captions need setup</div>
          <button
            className="text-amber-200 hover:underline"
            onClick={() => setShowSetup((v) => !v)}
          >
            {showSetup ? 'Hide' : 'Show'} setup instructions
          </button>
          {showSetup ? (
            <div className="mt-2 flex flex-col gap-1.5 text-ink-muted">
              <div>
                1. Download <code>whisper.exe</code> from{' '}
                <a
                  href="https://github.com/ggerganov/whisper.cpp/releases"
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  whisper.cpp releases
                </a>{' '}
                and place at:
                <button
                  className="ml-1 text-accent hover:underline"
                  onClick={() => window.api.captions.openBinFolder()}
                >
                  open folder
                </button>
              </div>
              <div className="font-mono break-all">{status?.exePath}</div>
              <div>
                2. Download <code>ggml-base.en.bin</code> (~150 MB) from{' '}
                <a
                  href="https://huggingface.co/ggerganov/whisper.cpp/tree/main"
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Hugging Face
                </a>{' '}
                and place at:
                <button
                  className="ml-1 text-accent hover:underline"
                  onClick={() => window.api.captions.openModelsFolder()}
                >
                  open folder
                </button>
              </div>
              <div className="font-mono break-all">{status?.modelPath}</div>
              <button
                className="text-accent hover:underline mt-1 self-start"
                onClick={refreshStatus}
              >
                Refresh status
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {progress ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="uppercase tracking-wide">{progress.phase}</span>
          <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.round(progress.percent)}%` }}
            />
          </div>
          <span className="font-mono w-10 text-right">
            {Math.round(progress.percent)}%
          </span>
        </div>
      ) : null}

      {segments ? (
        <div className="bg-bg-hover rounded p-2 max-h-40 overflow-y-auto text-xs">
          {segments.map((seg, i) => (
            <div key={i} className="py-0.5">
              <span className="text-ink-dim font-mono mr-2">{formatTime(seg.startSec)}</span>
              {seg.text}
            </div>
          ))}
        </div>
      ) : null}

      {/* Phase 3.1: standalone Save SRT — enabled whenever a srtPath is
          available, even before the user has burned-in or re-transcribed
          this session. */}
      {srtPath ? (
        <div className="flex flex-col gap-2 text-xs border-t border-ink-dim/20 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-1.5">
              <span className="text-ink-muted w-14">Font px</span>
              <input
                type="range"
                min={16}
                max={96}
                step={1}
                value={style.fontSize}
                onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="font-mono w-8">{style.fontSize}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-ink-muted w-14">Position</span>
              <select
                className="bg-bg-base rounded px-2 py-0.5 flex-1"
                value={style.position}
                onChange={(e) => updateStyle({ position: e.target.value as CaptionPosition })}
              >
                <option value="bottom">Bottom</option>
                <option value="middle">Middle</option>
                <option value="top">Top</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-ink-muted w-14">Text</span>
              <input
                type="color"
                value={style.primaryColor}
                onChange={(e) => updateStyle({ primaryColor: e.target.value })}
                className="w-10 h-6 rounded"
              />
              <span className="font-mono">{style.primaryColor}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-ink-muted w-14">Outline</span>
              <input
                type="color"
                value={style.outlineColor}
                onChange={(e) => updateStyle({ outlineColor: e.target.value })}
                className="w-10 h-6 rounded"
              />
              <span className="font-mono">{style.outlineColor}</span>
            </label>
          </div>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={trimToClip}
              onChange={(e) => setTrimToClip(e.target.checked)}
              disabled={!selectedClipId}
            />
            <span className={selectedClipId ? '' : 'text-ink-dim'}>
              Burn captions over selected clip range only
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button className="btn-ghost px-2 py-1 mr-auto" onClick={saveSrt}>
              💾 Save .srt
            </button>
            <button
              className="btn-primary px-3 py-1 disabled:opacity-50"
              onClick={burnIn}
              disabled={running || !srtPath}
            >
              Burn into video
            </button>
          </div>
        </div>
      ) : null}

      {!segments && status?.ready ? (
        <p className="text-xs text-ink-dim">
          Transcribe the source video, then save as .srt or burn captions into a new MP4
          export. English only by default; the model file you choose determines languages.
        </p>
      ) : null}
    </div>
  )
}
