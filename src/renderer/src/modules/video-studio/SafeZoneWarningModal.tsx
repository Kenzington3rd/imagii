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
      {/* T-113: focusable, so a long list can be scrolled from the keyboard (Chromium 126 does
          not make a scroller focusable by itself, and these rows hold nothing to tab to). */}
      <ul
        className="bg-bg-hover rounded p-2 text-xs flex flex-col gap-1.5 max-h-40 overflow-y-auto mb-4 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        tabIndex={0}
        aria-label="Clips that will be cropped"
      >
        {affectedClips.map((row) => (
          <li key={row.clipName}>
            {/* T-134 (5): a clip's name is whatever was typed, unbroken included; a long one is cut here (the whole of it is the tooltip) instead of
                making this scroller scroll sideways. */}
            <span className="font-medium block truncate" title={row.clipName}>
              {row.clipName}
            </span>
            {/* T-135 (6): and so is each zone line, which embeds a custom preset's NAME (60 characters measured 474 px against the 406 px box, an 80-character
                one already on disk 977): cut with an ellipsis, the whole line as the tooltip. */}
            {row.clippedZones.map((zone) => (
              <div key={zone} className="text-ink-muted truncate" title={zone}>
                {zone}
              </div>
            ))}
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        {/* T-114: opens on Cancel, the safe answer. The trap would otherwise focus the first thing with
            a tab stop - the list above, which has to keep one so a long list can be scrolled. */}
        <button className="btn-ghost px-3 py-1.5 text-sm" data-initial-focus onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={onContinue}>
          Export anyway
        </button>
      </div>
    </Modal>
  )
}
