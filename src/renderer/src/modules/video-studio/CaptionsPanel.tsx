import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import path from 'path-browserify'
import type {
  CaptionSegment,
  CaptionsInstallStatus,
  CaptionsProgress,
  CaptionStyle,
  CaptionPosition,
  ModelInstallProgress
} from '@shared/captions'
import {
  DEFAULT_CAPTION_STYLE,
  CAPTION_STYLE_PRESETS,
  burnInDoneMessage,
  captionPhaseLabel,
  captionSizeReadout,
  captionsReadyMessage
} from '@shared/captions'
import { useVideoStore } from './store/videoStore'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'
import { reportFailure } from '../../lib/reportFailure'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function CaptionsPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const clips = useVideoStore((s) => s.clips)
  // Tech-debt fix: srtPath now lives in the videoStore so it (a) persists
  // across sessions via project save/load and (b) is available to other
  // panels (like Clip Kit) that want to bundle the SRT.
  const srtPath = useVideoStore((s) => s.srtPath)
  const setSrtPath = useVideoStore((s) => s.setSrtPath)
  const [status, setStatus] = useState<CaptionsInstallStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<CaptionsProgress | null>(null)
  const [segments, setSegments] = useState<CaptionSegment[] | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  const [trimToClip, setTrimToClip] = useState(false)
  // Phase 4E: Whisper model auto-install state
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<ModelInstallProgress | null>(null)

  useEffect(() => {
    void window.api.captions.status().then(setStatus)
  }, [])

  // Bug fix: clear local segment + progress state when the source video
  // changes. Without this, after loading a new video, the captions panel
  // showed segments transcribed from the *previous* video. The store's
  // srtPath already clears on loadSource — segments needs to follow.
  useEffect(() => {
    setSegments(null)
    setProgress(null)
  }, [source?.filePath])

  useEffect(() => {
    const off = window.api.captions.onProgress((p) => setProgress(p))
    return off
  }, [])

  useEffect(() => {
    const off = window.api.captions.onModelProgress((p) => setInstallProgress(p))
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
      toast.success(captionsReadyMessage(result.segments.length))
    } catch (err) {
      reportFailure(err, { failed: 'Transcription failed.', canceled: 'Transcription canceled.' })
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
      const result = await window.api.captions.burnIn({
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
      // T-89: a ranged burn over a stretch nobody speaks in still writes the
      // clip, with nothing on it. Say that, not "Captions burned in".
      if (result.captioned) {
        toast.success(burnInDoneMessage(true))
      } else {
        toast(burnInDoneMessage(false), { icon: <Icon name="warning" size={18} />, duration: 6000 })
      }
    } catch (err) {
      reportFailure(err, { failed: 'Burn-in failed.', canceled: 'Burn-in canceled.' })
    } finally {
      setRunning(false)
    }
  }

  function updateStyle(patch: Partial<CaptionStyle>): void {
    setStyle((prev) => ({ ...prev, ...patch }))
  }

  async function installModel(): Promise<void> {
    setInstalling(true)
    setInstallProgress({ phase: 'starting', percent: 0 })
    try {
      const result = await window.api.captions.installModel()
      if (result.ok) {
        toast.success('Caption model downloaded')
        await refreshStatus()
      } else {
        // `reason` is a string, not a thrown error: main resolves a failed or
        // canceled download as { ok: false } (a cancel carries the sentinel).
        reportFailure(result.reason, {
          failed: "Couldn't download the model.",
          canceled: 'Download canceled.'
        })
      }
    } catch (err) {
      reportFailure(err, {
        failed: "Couldn't download the model.",
        canceled: 'Download canceled.'
      })
    } finally {
      setInstalling(false)
      // Tech-debt fix: clear stale progress so a re-attempted install
      // doesn't briefly show the prior run's state before the first
      // event of the new run lands.
      setInstallProgress(null)
    }
  }

  // T-89: a phase main cannot measure sends no percent, and gets an
  // indeterminate bar rather than a number that means nothing.
  const percent = progress?.percent
  const determinate = typeof percent === 'number'

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-captions">
      <PanelHeader
        icon="microphone"
        actions={
          <button
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={transcribe}
            disabled={running}
          >
            {running ? 'Transcribing…' : segments ? 'Re-transcribe' : 'Transcribe'}
          </button>
        }
      >
        Auto-captions
      </PanelHeader>

      {!status?.ready ? (
        <div className="bg-ember/10 border border-ember/30 rounded p-2 text-xs">
          <div className="font-semibold text-warn mb-1">Captions need setup</div>
          <button
            className="text-warn hover:underline"
            onClick={() => setShowSetup((v) => !v)}
          >
            {showSetup ? 'Hide' : 'Show'} setup instructions
          </button>
          {showSetup ? (
            <div className="mt-2 flex flex-col gap-1.5 text-ink-muted">
              {/* T-89: what is manual and what is automatic, in one line, and
                  which part goes online. */}
              <p className="text-ink-base">
                You download the captions engine once (<code>whisper-cli.exe</code>); imagii
                downloads the English model (~141 MB) for you — that download goes online,
                once.
              </p>
              <div>
                1. Download <code>whisper-cli.exe</code> from the{' '}
                <a
                  href="https://github.com/ggerganov/whisper.cpp/releases"
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  whisper.cpp releases
                </a>{' '}
                (the Windows build) and save it exactly here:
                <button
                  className="ml-1 text-accent hover:underline"
                  onClick={() => window.api.captions.openBinFolder()}
                >
                  Open folder
                </button>
              </div>
              <div className="font-mono break-all">{status?.exePath}</div>
              <div>
                2. The English model (~141 MB). The button below downloads it for you, or
                you can grab it from{' '}
                <a
                  href="https://huggingface.co/ggerganov/whisper.cpp/tree/main"
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Hugging Face
                </a>{' '}
                yourself and save it exactly here:
              </div>
              <div className="font-mono break-all">{status?.modelPath}</div>
              {/* Round 17 B9: surface the models-folder shortcut next to the
                  binaries link so a power user can drop a different .bin in
                  alongside the auto-installed one. */}
              <button
                className="text-accent hover:underline self-start text-xs"
                onClick={() => window.api.captions.openModelsFolder()}
              >
                Show models folder
              </button>
              {/* Phase 4E: in-app model auto-install. Visible whenever the
                  model is missing (regardless of whisper.exe state) so the
                  download can run while the user grabs the exe in parallel. */}
              {!status?.modelInstalled ? (
                <div className="flex flex-col gap-1.5 mt-1">
                  <button
                    className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50 self-start inline-flex items-center gap-1.5"
                    onClick={installModel}
                    disabled={installing}
                  >
                    {installing ? (
                      'Downloading model…'
                    ) : (
                      <>
                        <Icon name="download" size={13} /> Download model (~141 MB)
                        automatically
                      </>
                    )}
                  </button>
                  {installing && installProgress ? (
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent"
                          style={{
                            width: `${Math.round(installProgress.percent ?? 0)}%`
                          }}
                        />
                      </div>
                      <span className="font-mono w-10 text-right">
                        {Math.round(installProgress.percent ?? 0)}%
                      </span>
                      <button
                        className="text-ink-dim hover:text-danger px-1"
                        onClick={() => void window.api.captions.cancelInstall()}
                        title="Cancel download"
                        aria-label="Cancel download"
                      >
                        ✕
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
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
          <span>{captionPhaseLabel(progress.phase)}</span>
          <div
            className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden"
            role="progressbar"
            aria-label={captionPhaseLabel(progress.phase)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={determinate ? Math.round(percent) : undefined}
          >
            {determinate ? (
              <div className="h-full bg-accent" style={{ width: `${Math.round(percent)}%` }} />
            ) : (
              <div className="h-full bg-accent progress-indeterminate" />
            )}
          </div>
          {determinate ? (
            <span className="font-mono w-10 text-right">{Math.round(percent)}%</span>
          ) : null}
          {/* Round 17 B6: burn-in is the only phase the user can usefully
              abort (transcribe is short). Show Cancel while the burn-in
              phase is in flight. */}
          {progress.phase === 'burning-in' ? (
            <button
              className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft"
              onClick={() => void window.api.captions.cancelBurnIn()}
              title="Cancel burn-in"
            >
              Cancel
            </button>
          ) : null}
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
          this session. Phase 4A.2 adds the preset row above the dials. */}
      {srtPath ? (
        <div className="flex flex-col gap-2 text-xs border-t border-ink-dim/20 pt-2">
          {/* Phase 4A.2: one-click style presets. Sets `style` to a known-
              good preset; the dials below stay editable for fine-tuning. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-ink-muted">Preset</span>
            {CAPTION_STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                title={preset.hint}
                onClick={() => setStyle(preset.style)}
                className="px-2 py-0.5 rounded border border-ink-dim/30 hover:border-accent hover:bg-bg-hover text-xs transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {/* T-89: this was "Font px", and it is not pixels — libass scales
                the number against a 288-line script, so the default 32 paints
                ~120 px tall on 1080p. The stored value is unchanged; the label
                says what it is and the line under it says what it comes to. */}
            <div className="col-span-2 flex flex-col gap-0.5">
              <label className="flex items-center gap-1.5">
                <span className="text-ink-muted w-14">Size</span>
                <input
                  type="range"
                  min={16}
                  max={96}
                  step={1}
                  value={style.fontSize}
                  onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
                  className="flex-1"
                  // M11 fix (round 15)
                  aria-label="Caption size"
                  aria-valuetext={`${style.fontSize}, ${captionSizeReadout(style.fontSize)}`}
                />
                <span className="font-mono w-8">{style.fontSize}</span>
              </label>
              <span className="text-ink-dim pl-[3.875rem]">{captionSizeReadout(style.fontSize)}</span>
            </div>
            <label className="col-span-2 flex items-center gap-1.5">
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
            <button
              className="btn-ghost px-2 py-1 mr-auto inline-flex items-center gap-1.5"
              onClick={saveSrt}
            >
              <Icon name="save" size={14} /> Save .srt
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
          Transcribe the source video, then save the text as .srt or burn it into a new MP4.
        </p>
      ) : null}
      {/* T-89: two things the panel never said. The language is fixed (the
          model is English-only), and a burn-in reads the ORIGINAL file — the
          platform exports (Export, Clip Kit) are made separately and carry no
          captions. */}
      <p className="text-xs text-ink-dim">
        Captions are English only. Captions burn into the original video, not the platform
        exports.
      </p>
    </div>
  )
}
