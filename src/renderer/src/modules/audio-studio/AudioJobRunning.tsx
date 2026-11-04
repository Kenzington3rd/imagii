import { audioPassLabel } from '@shared/audio'
import { Icon } from '../../components/Icon'
import { RunningCancel } from '../../components/RunningCancel'
import { useAudioStore } from './state/audioStore'
import { cancelAudioExport, useAudioExport, type AudioExportJob } from './state/audioExport'

/**
 * The closed sound's running export (T-146).
 *
 * Closing the sound unmounts the Export panel (it is drawn only with a source), which held the export's bar and its Cancel, while the export - or the
 * re-attach to the video - goes on in main: minutes of rendering with nothing on screen until another sound was opened. T-144 fixed that for Video Studio
 * (`VideoJobsRunning`); this is the same card for Audio Studio, which has one long job.
 */

/** What the card says. Plain data, so the choice and the words are unit-testable without a DOM. */
export interface AudioJobRow {
  /** What is running and for which file ("Export — voice.wav"). */
  label: string
  /** The pass as the Export panel names it ("Step 2 of 2 - attaching to video"). Not a moving figure: announced when it changes. */
  pass: string
  /** The percent as the panel shows it; `aria-hidden` on the card, since a figure that moves every second would be read out each time. */
  percent: string
  cancelTitle: string
}

/** The row for the export that is running, or null when none is. Whether a sound is open is the card's business, not this choice's. */
export function audioJobRow(run: { running: boolean; job: AudioExportJob | null; sourceName: string | null }): AudioJobRow | null {
  if (!run.running || !run.job) return null
  const name = run.sourceName?.trim() ?? ''
  return {
    label: name === '' ? 'Export' : `Export — ${name}`,
    pass: audioPassLabel(run.job.pass, run.job.plan),
    percent: `${Math.round(run.job.percent)}%`,
    cancelTitle: 'Cancel export'
  }
}

/**
 * Mounted by AudioStudio AHEAD of its open-or-closed conditional, built the way `VideoJobsRunning` is (T-137 (3), T-138 (4), T-144): the wrapper is an
 * ALWAYS-mounted polite live region, empty and taking no gap (`-mb-5` gives back the flex gap the empty wrapper would add) unless no sound is open and
 * the export runs, because a region that arrives with its text is not reliably announced. The Cancel is the Export panel's own function.
 */
export function AudioJobRunning(): JSX.Element {
  const soundOpen = useAudioStore((s) => s.source !== null)
  const running = useAudioExport((s) => s.running)
  const job = useAudioExport((s) => s.job)
  const sourceName = useAudioExport((s) => s.sourceName)
  const row = soundOpen ? null : audioJobRow({ running, job, sourceName })
  return (
    <div aria-live="polite" className={row ? undefined : '-mb-5'}>
      {row ? (
        <div className="card p-3 flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Icon name="download" size={14} />
            <span className="min-w-0 flex-1 truncate" title={row.label}>
              {row.label}
            </span>
            <span className="text-xs text-ink-muted whitespace-nowrap">{row.pass}</span>
            <span className="text-xs text-ink-muted font-mono whitespace-nowrap" aria-hidden="true">
              {row.percent}
            </span>
            <RunningCancel title={row.cancelTitle} onClick={() => void cancelAudioExport()} />
          </div>
          <p className="text-xs text-ink-muted">The sound is closed; the export keeps going until it finishes or you cancel it.</p>
        </div>
      ) : null}
    </div>
  )
}
