import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Optional aria-label for AT when there is no visible title. */
  ariaLabel?: string
  /** Pass `false` to disable the Escape-to-close behavior (rare). */
  closeOnEscape?: boolean
  /** Pass `false` to disable the scrim-click-to-close behavior. */
  closeOnScrimClick?: boolean
  /** Extra class names for the inner content card. */
  className?: string
  children: ReactNode
}

/**
 * M12 fix (round 15): shared dialog helper used by TemplatesDialog,
 * CustomPresetManager, ThumbnailVariants, SafeZoneWarningModal, FixWizard,
 * HotkeyOverlay, NameDialog, ClipKitButton, and the video-studio
 * ExportPanel. Centralizes:
 *   - role="dialog" + aria-modal="true"
 *   - aria-labelledby (or aria-label when no visible title)
 *   - first-focusable-on-mount + Tab trapping + focus restore on unmount
 *     (all three from `useFocusTrap`, which the tutorial coachmark shares
 *     since T-64 — one trap, two dialogs)
 *   - Escape-to-close, but only for the TOPMOST dialog (T-73)
 *   - Scrim-click-to-close (and stopPropagation on the inner card)
 *
 * Body scroll lock is NOT added here — every previous modal positioned itself
 * over a fixed-height app shell so the renderer doesn't scroll in the first
 * place. If a future host adds long-scroll content we'll layer that on then.
 */

/**
 * T-68: how many Modals are open right now.
 *
 * A studio's window-level hotkeys (Delete, the tool letters, Ctrl+Z) guarded
 * only INPUT/TEXTAREA, so with the Variants or Templates dialog up, Delete
 * removed the layer BEHIND the scrim and R/O/L/P retargeted a canvas the user
 * could not see. A modal is a claim over the whole window, and the least
 * fragile way to state that is the component that owns the claim: a counter,
 * not a DOM query (`[role="dialog"]` would also match a dialog rendered by
 * something that is not a Modal, and would go stale between a render and the
 * keydown that reads it). A counter rather than a boolean because T-72's
 * HotkeyOverlay needs to subtract its own claim (see openModalCount below),
 * and because no Modal stacks over another today (the T-73 audit found none —
 * the only real stack is a Modal over the tutorial coachmark, which is not a
 * Modal) but the first one that does must not un-guard the window when the
 * inner one closes.
 */
let openModals = 0

/**
 * How many `<Modal>`s are open right now.
 *
 * T-72: exposed alongside the boolean because HotkeyOverlay is BOTH a
 * window-level key handler and a Modal. "Is any modal open" is the wrong
 * question for it — once it is up, one of the open modals is its own, and a
 * blanket guard would leave `?` unable to close the overlay it opened. The
 * count lets a handler subtract its own claim and ask the real question:
 * "is a modal that isn't mine open?"
 */
export function openModalCount(): number {
  return openModals
}

/** Is any `<Modal>` open? Read at event time by window-level key handlers. */
export function isModalOpen(): boolean {
  return openModalCount() > 0
}

export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  closeOnEscape = true,
  closeOnScrimClick = true,
  className = '',
  children
}: ModalProps): JSX.Element | null {
  const contentRef = useRef<HTMLDivElement | null>(null)
  // B7 fix (round 16): React 18 useId() so two titled Modals mounted at once
  // anywhere in the tree don't collide on a shared aria-labelledby target.
  const generatedTitleId = useId()
  const isTopmost = useFocusTrap(open, contentRef)

  useEffect(() => {
    if (!open) return
    openModals++
    return () => {
      openModals--
    }
  }, [open])

  useEffect(() => {
    if (!open || !closeOnEscape) return
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      // T-73: one Escape closes ONE dialog. Every open dialog — Modal or the
      // tutorial coachmark — has a listener on this same event, so without
      // the claim the `?` shortcuts overlay raised over a coachmark took the
      // coachmark down with it.
      if (!isTopmost()) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeOnEscape, onClose, isTopmost])

  if (!open) return null

  const titleId = title ? generatedTitleId : undefined
  const labelProps = titleId
    ? { 'aria-labelledby': titleId }
    : ariaLabel
      ? { 'aria-label': ariaLabel }
      : {}

  // T-73: z-[1200] sits above the tutorial coachmark's z-[1000]. A Modal can
  // only ever open OVER a coachmark (the scrim eats every click that would
  // open one the other way round), so the dialog that owns Escape is also the
  // dialog on top of the screen — the shortcuts overlay `?` raises over a
  // coachmark is clickable rather than dimmed underneath it.
  return (
    <div
      className="fixed inset-0 z-[1200] bg-black/70 flex items-center justify-center p-6"
      onClick={() => {
        if (closeOnScrimClick) onClose()
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        {...labelProps}
        className={`bg-bg-elevated border border-ink-dim/40 rounded-xl shadow-2xl outline-none ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>
  )
}
