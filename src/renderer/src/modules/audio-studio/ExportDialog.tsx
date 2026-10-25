import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import type { AudioOutputFormat } from '@shared/audio'
import { AUDIO_FORMAT_LABELS, audioPassLabel, audioPassPlan } from '@shared/audio'
import { assertDefined } from '@shared/assert'
import { useAudioStore } from './state/audioStore'
import { useAudioExport } from './state/audioExport'
import { PanelHeader } from '../../components/PanelHeader'
import { ProgressTrack } from '../../components/ProgressTrack'
import { RunningCancel } from '../../components/RunningCancel'
import { reportFailure } from '../../lib/reportFailure'
import { toastSaved } from '../../lib/savedToast'
import { useEditInVideoStudio } from '../../lib/editInVideoStudio'

const FORMATS: AudioOutputFormat[] = ['mp3', 'wav', 'flac', 'aac']

export function ExportDialog(): JSX.Element | null {
  const source = useAudioStore((s) => s.source)
  const chain = useAudioStore((s) => s.chain)
  const [format, setFormat] = useState<AudioOutputFormat>('mp3')
  const [bitrate, setBitrate] = useState('192k')
  const [muxBack, setMuxBack] = useState(true)
  // T-135 (1): the export's row and running flag are a module store, not this dialog's state - leaving Audio Studio unmounts the dialog, and it came
  // back idle (Export enabled, no Cancel) over an export main was still rendering. The row is drawn for the file it was made from (or while it runs).
  const exportJob = useAudioExport((s) => s.job)
  const running = useAudioExport((s) => s.running)
  const exportSource = useAudioExport((s) => s.sourcePath)
  const job = exportJob !== null && (running || exportSource === source?.filePath) ? exportJob : null
  // T-126 (19): one start at a time, claimed the instant the function runs - the pattern `ExportPanel.startExport` has (T-125 (18)). The
  // `busy` state is set only after the awaits in the start (the save dialog), so a double-click ran a second start
  // in that gap: two save dialogs, two jobs, two files. A `finally` gives the claim back; a second press is dropped in silence (the first
  // one's chooser is on screen). Declared with the other hooks, ahead of any early return.
  const startingRef = useRef(false)
  // T-124 (20): the re-attached video is a finished file Video Studio can open - the same next step Record's take and Reframe's
  // 9:16 file offer, through the same ask-before-replace bridge.
  const editInVideoStudio = useEditInVideoStudio("Couldn't open the cleaned video in Video Studio.")

  if (!source) return null

  async function startExport(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (!source) return
      const saveFormat = source.fromVideo && muxBack ? 'mp4' : format
      let outputPath: string | null
      try {
        // T-125 (7, 22): the name is the person's file's, never the scratch's: the ORIGINAL of a converted import (the video's working copy
        // is `stream-aB3dE5fG.mp4`), a video as it is, or the AIFF / WMA a sound was taken from, before the scratch WAV it is played from.
        const defaultName = await window.api.audio.suggestOutputName(
          source.fromVideo?.convertedFrom ?? source.fromVideo?.videoPath ?? source.extractedFrom ?? source.filePath,
          saveFormat
        )
        outputPath = await window.api.audio.pickOutputFile({ defaultName, format: saveFormat })
      } catch (err) {
        // Before the first await this was outside any catch: a rejection here
        // left the button looking fine and the user with no word at all.
        reportFailure(err, { failed: 'Export failed.' })
        return
      }
      if (!outputPath) return

      const jobId = nanoid(10)
      // The first phase is the measuring pass when loudness is on (the render
      // can only start once it is done) — naming "Rendering…" first would say
      // the wrong thing for as long as the measure takes.
      const plan = audioPassPlan({
        loudnorm: chain.loudnorm,
        reattach: Boolean(source.fromVideo && muxBack)
      })
      if (!useAudioExport.getState().begin({ jobId, pass: plan[0] ?? 'render', plan, percent: 0 }, source.filePath)) return
      // The progress listener is this export's own, for as long as it runs (the store holds the row, so it works with this dialog gone).
      const offProgress = window.api.audio.onProgress((p) => useAudioExport.getState().progress(p))
      try {
        if (source.fromVideo && muxBack) {
          await window.api.audio.mux({
            jobId,
            videoPath: source.fromVideo.videoPath,
            sourcePath: source.filePath,
            outputPath,
            chain
          })
          // Only THIS output: an audio-only export has no video for Video Studio to open.
          toastSaved('Cleaned audio attached to the video', outputPath, {
            label: 'Edit in Video Studio',
            onClick: () => {
              void editInVideoStudio(outputPath)
            }
          })
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
        useAudioExport.getState().done(outputPath)
      } catch (err) {
        // T-84: a Cancel arrives here too — the killed ffmpeg rejects this
        // call — carrying the sentinel, so the neutral line is raised from ONE
        // place (cancelExport below only asks main to stop).
        const { cancelled, message } = reportFailure(err, {
          failed: 'Export failed.',
          canceled: 'Audio export canceled.'
        })
        // T-100: the toast fades in a few seconds; the row says what became of it.
        useAudioExport.getState().fail({ error: message, canceled: cancelled })
      } finally {
        offProgress()
        useAudioExport.getState().finish()
      }
    } finally {
      startingRef.current = false
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
    } catch {
      /* the export call rejecting on the kill is the signal; nothing to add */
    }
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <PanelHeader icon="download">Export</PanelHeader>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-ink-muted text-xs">Format</span>
          <select
            className="bg-bg-base rounded px-2 py-1 disabled:opacity-50"
            value={format}
            onChange={(e) => setFormat(e.target.value as AudioOutputFormat)}
            disabled={Boolean(source.fromVideo && muxBack)}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {AUDIO_FORMAT_LABELS[f]}
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
        {source.fromVideo && muxBack && chain.cutRegions.length > 0 ? (
          <p className="basis-full text-xs text-ink-dim">
            Parts you removed come out of the picture too, so imagii re-encodes the video to
            match. That takes longer than attaching the sound alone.
          </p>
        ) : null}

        <button
          className="btn-primary px-4 py-1.5 ml-auto disabled:opacity-50"
          disabled={running}
          onClick={startExport}
        >
          {running ? 'Exporting…' : 'Export'}
        </button>
        {running && job ? (
          <RunningCancel title="Cancel export" onClick={cancelExport} />
        ) : null}
      </div>

      {job ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-xs text-ink-muted w-56 shrink-0">
            {audioPassLabel(job.pass, job.plan)}
          </span>
          {/* T-112: a bar is a progressbar to a screen reader, named by the pass it is in
              ("Step 2 of 2 — rendering") like the Captions and Reframe rows. */}
          <ProgressTrack
            label={audioPassLabel(job.pass, job.plan)}
            percent={job.percent}
            tone={job.error ? (job.canceled ? 'canceled' : 'failed') : 'active'}
          />
          <span className="font-mono text-xs text-ink-muted w-10 shrink-0 whitespace-nowrap text-right">
            {Math.round(job.percent)}%
          </span>
          {/* T-100: the words for a bar that stopped — a red or gray bar alone
              never said whether the file was lost to a fault or to the user's
              own Cancel. Same two words, same rule, as the video queue. */}
          {job.error ? (
            <span
              className={`text-xs font-medium ${job.canceled ? 'text-ink-muted' : 'text-danger'}`}
              title={job.error}
            >
              {job.canceled ? 'Canceled' : 'Failed'}
            </span>
          ) : null}
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
              Show in folder
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
