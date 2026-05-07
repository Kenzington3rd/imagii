interface SafeZoneWarningModalProps {
  open: boolean
  affectedClips: Array<{
    clipName: string
    clippedZones: string[]
  }>
  onCancel: () => void
  onContinue: () => void
}

/**
 * Phase 3.4: pre-export warning when one selected platform's crop would
 * lose another selected platform's safe zone. The user can continue
 * anyway — a hard block would create false-positive lockouts on
 * intentional asymmetric crops.
 */
export function SafeZoneWarningModal(props: SafeZoneWarningModalProps): JSX.Element | null {
  const { open, affectedClips, onCancel, onContinue } = props
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[1100] bg-black/70 flex items-center justify-center p-6"
      onClick={onCancel}
    >
      <div
        className="bg-bg-elevated border border-amber-400/40 rounded-xl shadow-2xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-amber-300">⚠️</span>
          <h2 className="text-lg font-semibold">Safe-zone warning</h2>
        </div>
        <p className="text-sm text-ink-base mb-3">
          Some clips have a crop that would clip a safe zone for another platform you selected.
          The export will still produce one file per clip+platform, but subjects framed inside
          the tighter crop may fall outside the safe zone of the wider one.
        </p>
        <ul className="bg-bg-hover rounded p-2 text-xs flex flex-col gap-1.5 max-h-40 overflow-y-auto mb-4">
          {affectedClips.map((row) => (
            <li key={row.clipName}>
              <span className="font-medium">{row.clipName}</span>{' '}
              <span className="text-ink-muted">
                — clips: {row.clippedZones.join(', ')}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel export
          </button>
          <button className="btn-primary px-4 py-1.5 text-sm" onClick={onContinue}>
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  )
}
