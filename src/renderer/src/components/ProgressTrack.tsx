/**
 * The bar of a job that reports how far along it is (T-136 (7)).
 *
 * Six panels drew the same track by hand (the highlight scan, Reframe, both Captions bars, the Export queue and the audio export). It is a
 * `role="progressbar"` named for its job, with a fill that is a MEASUREMENT or absent (STYLE_GUIDE, "A progress number is a measurement"):
 * `percent` is a number only when main knows how far along the work is, and `null` draws the sliding `.progress-indeterminate` segment with no
 * `aria-valuenow` - never an invented number. `tone` is for a row that STOPPED: red is for a fault, and the user's own Cancel is not one (T-100).
 * `className` is the width: the track is `flex-1` in a row, or a fixed width (`w-40`) in a table of rows.
 *
 * The percent readout beside a bar, and the words for a stopped row, stay with the panel: they differ (a live region in the Export queue, none
 * where the label already says the phase).
 */
export type ProgressTone = 'active' | 'canceled' | 'failed'

const FILL: Readonly<Record<ProgressTone, string>> = {
  active: 'bg-accent',
  canceled: 'bg-ink-muted',
  failed: 'bg-danger-strong'
}

interface ProgressTrackProps {
  /** The job the bar is for: its accessible name. */
  label: string
  /** 0-100, or null when main cannot measure this phase. */
  percent: number | null
  tone?: ProgressTone
  /** The track's width: `flex-1` (the default) or a fixed one. */
  className?: string
}

export function ProgressTrack({ label, percent, tone = 'active', className = 'flex-1' }: ProgressTrackProps): JSX.Element {
  const known = percent !== null
  const shown = known ? Math.max(0, Math.min(100, Math.round(percent))) : 0
  return (
    <div
      className={`${className} h-1.5 bg-bg-hover rounded-full overflow-hidden`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? shown : undefined}
    >
      {known ? (
        <div className={`h-full ${FILL[tone]}`} style={{ width: `${shown}%` }} />
      ) : (
        <div className="h-full bg-accent progress-indeterminate" />
      )}
    </div>
  )
}
