import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import path from 'path-browserify'
import type { CaptionsProgress, CaptionStyle, CaptionPosition } from '@shared/captions'
import {
  DEFAULT_CAPTION_STYLE,
  CAPTION_STYLE_PRESETS,
  burnInDoneMessage,
  captionPhaseLabel,
  captionSizeReadout,
  captionsReadyMessage,
  clearedTranscriptsMessage,
  clearTranscriptsQuestion,
  staleCaptionsMessage
} from '@shared/captions'
import { countOf } from '@shared/plural'
import { ERROR_TOAST_MS } from '@shared/userFacingError'
import { NO_SOUND_MESSAGE, useVideoStore, videoHasNoSound } from './store/videoStore'
import { useCaptionsProgress, useCaptionsRun, useCaptionsStatus, useModelInstallRun } from './store/runs'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { PanelHeader } from '../../components/PanelHeader'
import { ProgressTrack } from '../../components/ProgressTrack'
import { RunningCancel } from '../../components/RunningCancel'
import { reportFailure } from '../../lib/reportFailure'
import { formatClock } from '@shared/clockTime'

export function CaptionsPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const clips = useVideoStore((s) => s.clips)
  // Tech-debt fix: srtPath now lives in the videoStore so it (a) persists
  // across sessions via project save/load and (b) is available to other
  // panels (like Clip Kit) that want to bundle the SRT.
  const srtPath = useVideoStore((s) => s.srtPath)
  const setSrtPathFor = useVideoStore((s) => s.setSrtPathFor)
  // T-136 (4): what `captions:status` last answered is a module store, written by whoever asked - the model download that ends while this panel is on
  // another screen refreshes it for the panel that comes back.
  const status = useCaptionsStatus((s) => s.status)
  // T-112: WHICH job is running, not just that one is. The header button said
  // "Transcribing…" for a burn-in too, because both shared one boolean.
  // T-135 (1), (4): which job is running and the progress line main last sent are a module store, and the transcript preview is the open video's own
  // result in the video store. They were this panel's state, so leaving the studio left it idle over a transcription main was still running (Burn
  // into video enabled, no Cancel: USER_GUIDE promises one) and forgot a transcription that took minutes.
  const captionsRun = useCaptionsRun((s) => s.run)
  const job = captionsRun?.job ?? null
  const running = job !== null
  const progress: CaptionsProgress | null = useCaptionsProgress((s) => s.progress)
  const segments = useVideoStore((s) => s.derived.transcript)
  const setDerived = useVideoStore((s) => s.setDerived)
  // T-136 (4): the download is started from inside the setup card, so a panel that mounts over a download that is running opens the card - the bar and
  // its Cancel are in it, and "back to the download" must not need a click to find them.
  const [showSetup, setShowSetup] = useState(() => useModelInstallRun.getState().run !== null)
  // T-140 (10): the same instructions are also reachable when the files exist - "Captions setup", closed until asked for. After a failed Transcribe the setup card was gone
  // (it showed only while `!status.ready`), and with it the way back to the folders the engine and the model live in.
  const [showReadySetup, setShowReadySetup] = useState(false)
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  const [trimToClip, setTrimToClip] = useState(false)
  // T-126 (19): one start at a time, claimed the instant the function runs - the pattern `ExportPanel.startExport` has (T-125 (18)). The
  // `busy` state is set only after the awaits in the start (the save dialog), so a double-click ran a second start
  // in that gap: two save dialogs, two burn-ins into two files. A `finally` gives the claim back; a second press is dropped in silence (the first
  // one's chooser is on screen). Declared with the other hooks, ahead of any early return.
  const burnStartingRef = useRef(false)
  // T-127 (11): the same claim for "Save .srt", which goes straight to a native Save dialog (a double-click opened two, and answered
  // twice wrote the file twice). Claimed first, given back in a finally.
  const saveSrtStartingRef = useRef(false)
  // T-128 (3): "Clear saved transcripts" - how many transcripts the captions folder holds (null until main has answered), the confirm
  // that stands in front of deleting them, and the same claim-first guard for the confirm button (one press, one clear).
  const [transcriptCount, setTranscriptCount] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const clearStartingRef = useRef(false)
  // Phase 4E: Whisper model auto-install. T-136 (4): the download and its progress are a module store, like the jobs above - the bar and its Cancel were
  // this panel's state, so a trip to Home left Download enabled over a download main was still running (its second press was refused by main) and the
  // finished download refreshed the status of a panel that was gone.
  const installRun = useModelInstallRun((s) => s.run)
  const installing = installRun !== null
  const installProgress = installRun?.progress ?? null

  useEffect(() => {
    void refreshStatus()
    void refreshTranscriptCount()
  }, [])

  // (The transcript preview used to be cleared HERE when the video changed, so it also cleared on every mount: it is the video store's now, and
  // `loadSource` / `clearSource` empty it with the srtPath it goes with.)
  useEffect(() => {
    const off = window.api.captions.onProgress((p) => useCaptionsProgress.setState({ progress: p }))
    return off
  }, [])

  if (!source) return null
  const noSound = videoHasNoSound(source)

  async function refreshStatus(): Promise<void> {
    useCaptionsStatus.setState({ status: await window.api.captions.status() })
  }

  /** How many transcripts are saved, for the line under the panel and the Clear button. A count main could not read leaves the line out. */
  async function refreshTranscriptCount(): Promise<void> {
    try {
      setTranscriptCount(await window.api.captions.countTranscripts())
    } catch (err) {
      console.warn('[imagii] could not count the saved transcripts', err)
      setTranscriptCount(null)
    }
  }

  /**
   * T-128 (3), T-110 (s): the confirm's "Clear transcripts". Every transcript in the captions folder goes, including the one for the video
   * that is open, so the panel goes back to "not transcribed yet" (its Save .srt and Burn into video would be pointing at a file that is
   * gone). Claimed first and given back in a finally: one press, one clear.
   */
  async function clearTranscripts(): Promise<void> {
    if (clearStartingRef.current) return
    clearStartingRef.current = true
    try {
      // The video the clear was pressed for, held across the await like a job's (T-112): the forgetting below is for it, not for what is open by then.
      const startedFor = source?.filePath
      setConfirmClear(false)
      const result = await window.api.captions.clearTranscripts()
      const message = clearedTranscriptsMessage(result)
      if (message.error) toast.error(message.text, { duration: ERROR_TOAST_MS })
      // T-132 (14): a clear that got PART of the way is a warning, not a green tick - the rest are still on disk and the sentence says what
      // to do (the pattern Home's "some of the project could not be opened" uses: the warning icon, the long error duration).
      else if (result.failed > 0) toast(message.text, { icon: <Icon name="warning" size={18} />, duration: ERROR_TOAST_MS })
      else toast.success(message.text)
      if (result.removed > 0) {
        setDerived({ transcript: null })
        if (startedFor) setSrtPathFor(startedFor, null)
      }
    } catch (err) {
      reportFailure(err, { failed: "Couldn't clear the saved transcripts." })
    } finally {
      clearStartingRef.current = false
      void refreshTranscriptCount()
    }
  }

  async function transcribe(): Promise<void> {
    if (!source || noSound) return
    if (!status?.ready) {
      setShowSetup(true)
      return
    }
    // T-112: the video this job is FOR. It takes minutes and nothing locks the app: close
    // it, drop another, and the result arrived to attach itself to whatever was open.
    const startedFor = source.filePath
    const startedName = source.fileName
    if (!useCaptionsRun.getState().begin({ job: 'transcribe' })) return
    useCaptionsProgress.setState({ progress: null })
    try {
      const result = await window.api.captions.transcribe({
        jobId: nanoid(10),
        sourcePath: startedFor
      })
      if (!setSrtPathFor(startedFor, result.srtPath)) {
        toast(staleCaptionsMessage(startedName), {
          icon: <Icon name="warning" size={18} />,
          duration: 8000
        })
        return
      }
      useVideoStore.getState().setDerivedFor(startedFor, { transcript: result.segments })
      toast.success(captionsReadyMessage(result.segments.length))
    } catch (err) {
      reportFailure(err, { failed: 'Transcription failed.', canceled: 'Transcription canceled.' })
    } finally {
      // T-100 + T-108: the row below the header shows a job that is running. One that
      // stopped is not, whatever phase its last event named; and one that finished is
      // not either — "Done 100%" with nothing to press stayed there for good. The toast
      // says it finished, as in every other single-job panel.
      useCaptionsProgress.setState({ progress: null })
      useCaptionsRun.getState().end()
      void refreshTranscriptCount()
    }
  }

  async function saveSrt(): Promise<void> {
    if (saveSrtStartingRef.current) return
    saveSrtStartingRef.current = true
    try {
      if (!srtPath) return
      const defaultName = source ? `${path.parse(source.fileName).name}.srt` : 'captions.srt'
      // T-115: this had no catch, so a rejection did nothing, visibly - main THROWS for a transcript
      // outside the captions folder (a project file may name one as its srtPath), and the copy itself
      // can fail (a full disk, a read-only destination). Either is the panel's one plain sentence.
      const saved = await window.api.captions.saveSrt(srtPath, defaultName)
      if (saved) toast.success('SRT saved')
    } catch (err) {
      reportFailure(err, { failed: "Couldn't save the captions file." })
    } finally {
      saveSrtStartingRef.current = false
    }
  }

  async function burnIn(): Promise<void> {
    if (burnStartingRef.current) return
    burnStartingRef.current = true
    try {
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
      if (!useCaptionsRun.getState().begin({ job: 'burn-in' })) return
      useCaptionsProgress.setState({ progress: null })
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
        // T-100 + T-108: without this a stopped burn froze at "Burning in… 40%" with a
        // Cancel button for a job that no longer existed, and a finished one left
        // "Done 100%" for good. The toast says what happened; the row goes back to idle.
        useCaptionsProgress.setState({ progress: null })
        useCaptionsRun.getState().end()
      }
    } finally {
      burnStartingRef.current = false
    }
  }

  function updateStyle(patch: Partial<CaptionStyle>): void {
    setStyle((prev) => ({ ...prev, ...patch }))
  }

  async function installModel(): Promise<void> {
    // The claim, before the first await: a second press (or a second panel, after a round trip) starts nothing.
    if (!useModelInstallRun.getState().begin({ progress: { phase: 'starting', percent: 0 } })) return
    // The listener lasts exactly this download and writes to the store, so the bar moves while the panel is on another screen.
    const offProgress = window.api.captions.onModelProgress((p) => useModelInstallRun.getState().patch({ progress: p }))
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
      // The run ends, so a re-attempted install starts from "starting" and never shows the prior run's state.
      useModelInstallRun.getState().end()
      offProgress()
    }
  }

  // T-112: the header button names the job that is running (never "Transcribing…" during a
  // burn-in), and otherwise what pressing it will do.
  const headerLabel =
    job === 'transcribe'
      ? 'Transcribing…'
      : job === 'burn-in'
        ? 'Burning in…'
        : segments
          ? 'Re-transcribe'
          : 'Transcribe'
  // T-89: a phase main cannot measure sends no percent, and gets an
  // indeterminate bar rather than a number that means nothing.
  const percent = progress?.percent
  const determinate = typeof percent === 'number'

  // T-140 (10): the setup instructions are ONE piece of markup shown in two places: the "Captions need setup" card while the engine or the model is missing, and the
  // "Captions setup" disclosure under the panel once they are there (so a failed Transcribe can still reach the folders).
  const setupDetails = (
    <div className="mt-2 flex flex-col gap-1.5 text-ink-muted">
      {/* T-89: what is manual and what is automatic, in one line, and
          which part goes online. */}
      <p className="text-ink-base">
        You download the captions engine once (<code>whisper-cli.exe</code>); imagii
        downloads the English model (~141 MB) for you — that download goes online,
        once.
      </p>
      {/* T-139 (6): the releases page offers no file called whisper-cli.exe. The Windows build is a zip, listed under the newest release that has one (some are
          marked Pre-release), and whisper.cpp's release workflow zips the folder build/bin/Release as it is, so the program and the .dll files it needs
          beside it are inside a Release folder in the zip. */}
      <div>
        1. Download <code>whisper-bin-x64.zip</code> from the{' '}
        <a
          href="https://github.com/ggml-org/whisper.cpp/releases"
          className="text-warn underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          whisper.cpp releases
        </a>{' '}
        (the newest release that lists it; some are marked Pre-release). Open the zip and copy <code>whisper-cli.exe</code> and every{' '}
        <code>.dll</code> next to it (they are in its Release folder) into the folder below, so the engine sits exactly here:
        <button
          className="ml-1 text-warn underline"
          onClick={() => window.api.captions.openBinFolder()}
        >
          Open folder
        </button>
      </div>
      <div className="font-mono break-all">{status?.exePath}</div>
      {/* T-102: this is imagii's own data folder, not the app's install
          folder — the portable build unpacks to a temp folder that is
          rebuilt on every launch, so a file placed there would vanish. */}
      <div>This folder survives app updates, so you only set this up once.</div>
      <div>
        2. The English model (~141 MB). The button below downloads it for you, or
        you can grab it from{' '}
        <a
          href="https://huggingface.co/ggerganov/whisper.cpp/tree/main"
          className="text-warn underline"
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
        className="text-warn underline self-start text-xs"
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
              <ProgressTrack label="Downloading the caption model" percent={installProgress.percent ?? 0} />
              <span className="font-mono w-10 shrink-0 whitespace-nowrap text-right">
                {Math.round(installProgress.percent ?? 0)}%
              </span>
              <RunningCancel title="Cancel download" onClick={() => void window.api.captions.cancelInstall()} />
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        className="text-warn underline mt-1 self-start"
        onClick={refreshStatus}
      >
        Refresh status
      </button>
    </div>
  )

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-captions">
      <PanelHeader
        icon="microphone"
        actions={
          <button
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={transcribe}
            disabled={running || noSound}
            title={noSound ? NO_SOUND_MESSAGE : undefined}
          >
            {headerLabel}
          </button>
        }
      >
        Auto-captions
      </PanelHeader>
      {/* T-112: a video with no sound track has nothing to transcribe. */}
      {noSound ? <p className="text-xs text-warn">{NO_SOUND_MESSAGE}</p> : null}

      {!status?.ready ? (
        // T-112: the links on this ember wash are `text-warn` (10.4:1 on it) and underlined at
        // rest. They were `text-accent`, which measures 4.09:1 on the wash — under AA — and
        // only underlined on hover, so a link was a color and nothing else.
        <div className="bg-ember/10 border border-ember/30 rounded p-2 text-xs">
          <div className="font-semibold text-warn mb-1">Captions need setup</div>
          <button
            className="text-warn underline"
            onClick={() => setShowSetup((v) => !v)}
          >
            {showSetup ? 'Hide' : 'Show'} setup instructions
          </button>
          {showSetup ? setupDetails : null}
        </div>
      ) : null}

      {progress ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span>{captionPhaseLabel(progress.phase)}</span>
          <ProgressTrack label={captionPhaseLabel(progress.phase)} percent={determinate ? percent : null} />
          {determinate ? (
            <span className="font-mono w-10 shrink-0 whitespace-nowrap text-right">{Math.round(percent)}%</span>
          ) : null}
          {/* Round 17 B6: Cancel while the burn-in phase is in flight. T-108:
              transcription of a long VOD is not short — extracting the sound and
              the engine run for minutes — so those two phases carry one too (the
              SRT write after them is instant, and ends the job either way). */}
          {progress.phase === 'burning-in' ? (
            <RunningCancel title="Cancel burn-in" onClick={() => void window.api.captions.cancelBurnIn()} />
          ) : progress.phase === 'extracting' || progress.phase === 'transcribing' ? (
            <RunningCancel title="Cancel transcription" onClick={() => void window.api.captions.cancelTranscribe()} />
          ) : null}
        </div>
      ) : null}

      {segments ? (
        // T-113: a scroller must be reachable by keyboard — this Electron (Chromium 126) does not
        // make a scrollable region focusable by itself, and its lines hold nothing to tab to.
        // T-114: and it is a region, so its name is announced when focus lands (a name on a plain
        // div is not).
        <div
          className="bg-bg-hover rounded p-2 max-h-40 overflow-y-auto text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
          role="region"
          tabIndex={0}
          aria-label="Transcript preview"
        >
          {segments.map((seg, i) => (
            <div key={i} className="py-0.5">
              <span className="text-ink-dim font-mono mr-2">{formatClock(seg.startSec)}</span>
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
                  className="flex-1 min-w-0"
                  // M11 fix (round 15)
                  aria-label="Caption size"
                  aria-valuetext={`${style.fontSize}, ${captionSizeReadout(style.fontSize, source.probe)}`}
                />
                <span className="font-mono w-8 shrink-0 whitespace-nowrap">{style.fontSize}</span>
              </label>
              {/* T-112: about THIS video's frame (the size the burn draws), not 1080p. */}
              <span className="text-ink-dim pl-[3.875rem]">
                {captionSizeReadout(style.fontSize, source.probe)}
              </span>
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
              aria-describedby="srt-scope-hint"
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
          {/* T-123 (16): "Save .srt" copies the WHOLE transcript, on the source's clock (`captions:saveSrt` is a copy), and
              it sits directly under a box that says "clip range only". The scope is said at the button, and the button
              is described by it. The range-aware save is the ledgered upgrade (it is what the Clip Kit's `.srt` already is). */}
          <p id="srt-scope-hint" className="text-xs text-ink-dim">
            The box above only changes Burn into video. Save .srt keeps the captions for the whole video.
          </p>
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
      {/* T-140 (10): once the engine and the model are there the card above is gone, and a failed Transcribe ("The captions engine stopped ... Open Captions setup")
          had nowhere to send the person. The same instructions, closed until asked for, in the wash the card has them in (the links on it are `text-warn`, 10.4:1 there). */}
      {status?.ready ? (
        <div className="text-xs">
          <button
            className="text-ink-muted underline"
            aria-expanded={showReadySetup}
            onClick={() => setShowReadySetup((v) => !v)}
          >
            Captions setup
          </button>
          {showReadySetup ? (
            <div className="bg-ember/10 border border-ember/30 rounded px-2 pb-2 mt-1">{setupDetails}</div>
          ) : null}
        </div>
      ) : null}
      {/* T-128 (3), T-110 (s): every transcription keeps its .srt in imagii's data folder for good. This is the way to empty it from
          here: the line says how many are kept, the button is off with none (and while a job runs, which may be reading one). */}
      {transcriptCount !== null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-dim border-t border-ink-dim/20 pt-2">
          <span>
            {transcriptCount === 0
              ? 'No saved transcripts.'
              : `${countOf(transcriptCount, 'saved transcript')} kept on this computer.`}
          </span>
          {/* T-132 (3): the row wraps by ITEM and the label never wraps by word - in the 295-345 px column the button used to be squeezed
              beside the sentence and broke "Clear saved / transcripts" onto two lines, the only single-label button in the app that did. */}
          <button
            className="btn-ghost px-2 py-1 ml-auto inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            onClick={() => setConfirmClear(true)}
            disabled={running || transcriptCount === 0}
          >
            <Icon name="trash" size={13} /> Clear saved transcripts
          </button>
        </div>
      ) : null}
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear saved transcripts?"
        className="max-w-md w-full p-5"
      >
        <h2 className="text-lg font-semibold mb-3">Clear saved transcripts?</h2>
        <p className="text-sm text-ink-base mb-2">{clearTranscriptsQuestion(transcriptCount ?? 0, srtPath !== null)}</p>
        <p className="text-xs text-ink-muted mb-4">
          Captions you already saved as .srt files or burned into a video are not touched.
        </p>
        <div className="flex justify-end gap-2">
          {/* Opens on Cancel, the safe answer (T-114): the trap would otherwise focus the first button it finds. */}
          <button className="btn-ghost px-3 py-1.5 text-sm" data-initial-focus onClick={() => setConfirmClear(false)}>
            Cancel
          </button>
          <button className="btn-primary px-4 py-1.5 text-sm" onClick={() => void clearTranscripts()}>
            Clear transcripts
          </button>
        </div>
      </Modal>
    </div>
  )
}
