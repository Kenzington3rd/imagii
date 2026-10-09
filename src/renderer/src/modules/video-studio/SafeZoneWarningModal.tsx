import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'

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
 *
 * INIT-G (round 16): migrated to the shared <Modal> helper for Escape +
 * focus trap + focus restore. Amber border is now an inner ring on the
 * body container since Modal owns the outer card frame.
 *
 * T-83: the copy is plain words. It used "clip" as a noun AND a verb in one
 * sentence ("some clips have a crop that would clip a safe zone"), and named
 * a "safe zone" no user has a picture of. It says what happens to the
 * picture instead, and the rows say which platform's picture is cut down for
 * which. The buttons are the two things the user can do: Cancel, or Export
 * anyway.
 */
export function SafeZoneWarningModal(props: SafeZoneWarningModalProps): JSX.Element | null {
  const { open, affectedClips, onCancel, onContinue } = props
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Some platforms will crop the picture"
      className="max-w-md w-full p-5 ring-1 ring-ember/40"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-warn">
          <Icon name="warning" size={18} />
        </span>
        <h2 className="text-lg font-semibold">Some platforms will crop the picture</h2>
      </div>
      <p className="text-sm text-ink-base mb-3">
        Wide and tall platforms need different shapes. When you export one clip for both, the
        tall ones keep only the middle of the frame, and anything near the edges is lost.
      </p>
      <p className="text-xs text-ink-muted mb-1.5">What gets cut down:</p>
      <ul className="bg-bg-hover rounded p-2 text-xs flex flex-col gap-1.5 max-h-40 overflow-y-auto mb-4">
        {affectedClips.map((row) => (
          <li key={row.clipName}>
            <span className="font-medium">{row.clipName}</span>
            {row.clippedZones.map((zone) => (
              <div key={zone} className="text-ink-muted">
                {zone}
              </div>
            ))}
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={onContinue}>
          Export anyway
        </button>
      </div>
    </Modal>
  )
}
